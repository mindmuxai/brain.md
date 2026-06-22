#!/usr/bin/env node
// lint-links — verify every [[page-id]] wiki-link in brain/ resolves to an
// existing page. Pure file operation, zero npm dependencies.
// Run: `node scripts/lint-links.mjs`. Exits non-zero on a broken link.

import { listPages, listRootPages, findWikiLinks, ROOT_PAGE_SLUGS } from "./lib/brain.mjs";

const pages = listPages();
const rootPages = listRootPages();

// Valid wiki-link targets = page ids. Root page slugs are intentionally NOT
// wiki-link targets (per the spec they are addressed by slug, not [[ ]]), but we
// accept them too so an accidental [[architecture]] is a warning, not a hard fail.
const pageIds = new Set(pages.map((p) => p.frontmatter.id || p.id));
const rootSlugs = new Set(ROOT_PAGE_SLUGS);

const broken = [];
const rootRefs = [];

for (const doc of [...pages, ...rootPages]) {
  const links = findWikiLinks(doc.body);
  for (const target of links) {
    if (pageIds.has(target)) continue;
    if (rootSlugs.has(target)) {
      rootRefs.push({ from: doc.path, target });
      continue;
    }
    broken.push({ from: doc.path, target });
  }
}

for (const r of rootRefs) {
  console.warn(`warn: ${r.from} → [[${r.target}]] points at a root page slug; root pages are addressed by slug, not [[ ]].`);
}

if (broken.length === 0) {
  console.log(`lint-links: OK (${pages.length} pages, ${rootPages.length} root pages scanned, no broken links)`);
  process.exit(0);
}

for (const b of broken) {
  console.error(`error: ${b.from} → [[${b.target}]] has no matching brain/pages/${b.target}.md`);
}
console.error(`lint-links: ${broken.length} broken link${broken.length === 1 ? "" : "s"}`);
process.exit(1);
