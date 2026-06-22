#!/usr/bin/env node
// reindex — scan brain/pages/*.md and regenerate brain/index.md.
// Pure file operation, zero npm dependencies. Run: `node scripts/reindex.mjs`.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { BRAIN_DIR, listPages } from "./lib/brain.mjs";

const pages = listPages();

const rows = pages
  .map((p) => {
    const fm = p.frontmatter;
    const id = fm.id || p.id;
    const title = fm.title || "(untitled)";
    const category = fm.category || "?";
    const status = fm.status || "?";
    const tags = Array.isArray(fm.tags) ? fm.tags.join(", ") : fm.tags || "";
    const updated = fm.updated || fm.created || "";
    return `| [[${id}]] | ${title} | ${category} | ${status} | ${tags} | ${updated} |`;
  })
  .join("\n");

const active = pages.filter((p) => (p.frontmatter.status || "active") === "active").length;

const lines = [
  "# Brain Index",
  "",
  "> Generated automatically by `scripts/reindex.mjs` — do not edit by hand. Re-run it after changing `brain/pages/`.",
  "",
  `Pages: ${pages.length} (active: ${active})`,
  "",
  "| id | title | category | status | tags | updated |",
  "|----|-------|----------|--------|------|---------|",
  rows || "| _(no pages yet)_ | | | | | |",
  "",
];

const outPath = join(BRAIN_DIR, "index.md");
writeFileSync(outPath, lines.join("\n"));
console.log(`reindex: wrote ${outPath} (${pages.length} page${pages.length === 1 ? "" : "s"})`);
