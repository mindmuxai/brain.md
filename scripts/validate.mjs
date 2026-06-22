#!/usr/bin/env node
// validate — check brain frontmatter schema, and back-stop the most fragile part
// of the pure-file form: a compiled_truth edit with no matching timeline entry.
// Zero npm dependencies. Run: `node scripts/validate.mjs`. Exits non-zero on error.

import { execFileSync } from "node:child_process";
import { basename } from "node:path";
import {
  listPages,
  listRootPages,
  splitFrontmatter,
  parseFrontmatter,
  extractSection,
  countTimelineEntries,
  PAGE_CATEGORIES,
  PAGE_STATUSES,
  ROOT_PAGE_SLUGS,
} from "./lib/brain.mjs";

const errors = [];
const warnings = [];

const err = (file, msg) => errors.push(`${file}: ${msg}`);
const warn = (file, msg) => warnings.push(`${file}: ${msg}`);

// ---- 1. Page schema ----------------------------------------------------------
const pages = listPages();
for (const p of pages) {
  const fm = p.frontmatter;
  const rel = `brain/pages/${p.id}.md`;

  if (!fm.id) err(rel, "missing frontmatter `id`");
  else if (fm.id !== p.id) err(rel, `frontmatter id "${fm.id}" does not match filename "${p.id}"`);
  if (!fm.title) err(rel, "missing frontmatter `title`");
  if (!fm.category) err(rel, "missing frontmatter `category`");
  else if (!PAGE_CATEGORIES.includes(fm.category))
    err(rel, `category "${fm.category}" not one of ${PAGE_CATEGORIES.join(" / ")}`);
  if (!fm.status) err(rel, "missing frontmatter `status`");
  else if (!PAGE_STATUSES.includes(fm.status))
    err(rel, `status "${fm.status}" not one of ${PAGE_STATUSES.join(" / ")}`);
  if (!fm.created) err(rel, "missing frontmatter `created`");
  if (fm.tags && !Array.isArray(fm.tags)) warn(rel, "`tags` should be an inline array, e.g. [a, b]");

  if (extractSection(p.body, "compiled_truth") === null)
    err(rel, "missing `## compiled_truth` section");
  if (extractSection(p.body, "timeline") === null) err(rel, "missing `## timeline` section");
}

// ---- 2. Root page schema -----------------------------------------------------
const rootPages = listRootPages();
for (const rp of rootPages) {
  const rel = `brain/${rp.id}.md`;
  if (!ROOT_PAGE_SLUGS.includes(rp.id)) {
    warn(rel, `not one of the six fixed root pages (${ROOT_PAGE_SLUGS.join(", ")})`);
    continue;
  }
  const fm = rp.frontmatter;
  if (!fm.slug) err(rel, "missing frontmatter `slug`");
  else if (fm.slug !== rp.id) err(rel, `slug "${fm.slug}" does not match filename "${rp.id}"`);
  if (!fm.title) err(rel, "missing frontmatter `title`");
  if (extractSection(rp.body, "timeline") !== null)
    err(rel, "root pages must NOT have a timeline — history lives in git");
}

const presentSlugs = new Set(rootPages.map((r) => r.id));
for (const slug of ROOT_PAGE_SLUGS) {
  if (!presentSlugs.has(slug)) warn(`brain/${slug}.md`, "expected root page is missing");
}

// ---- 3. Timeline backstop: compiled_truth changed but timeline did not grow ---
// Compare each tracked page against its committed (HEAD) version. Skipped when
// there is no git baseline (e.g. a fresh repo with no commits yet).
let baselineAvailable = true;
try {
  execFileSync("git", ["rev-parse", "--verify", "HEAD"], { stdio: "ignore" });
} catch {
  baselineAvailable = false;
  warn("(git)", "no committed baseline (HEAD) — skipping timeline-drift backstop");
}

if (baselineAvailable) {
  for (const p of pages) {
    const rel = `brain/pages/${p.id}.md`;
    let oldRaw;
    try {
      oldRaw = execFileSync("git", ["show", `HEAD:${rel}`], { encoding: "utf8" });
    } catch {
      continue; // new file, not in HEAD — nothing to diff against
    }
    const oldDoc = splitFrontmatter(oldRaw);
    const oldCompiled = extractSection(oldDoc.body, "compiled_truth") || "";
    const newCompiled = extractSection(p.body, "compiled_truth") || "";
    if (oldCompiled === newCompiled) continue;

    const oldCount = countTimelineEntries(extractSection(oldDoc.body, "timeline"));
    const newCount = countTimelineEntries(extractSection(p.body, "timeline"));
    if (newCount <= oldCount) {
      err(
        rel,
        "compiled_truth changed but no new timeline entry was appended — every compiled_truth rewrite must record a `kind: decision` entry in the timeline",
      );
    }
  }
}

// ---- Report ------------------------------------------------------------------
for (const w of warnings) console.warn(`warn: ${w}`);
for (const e of errors) console.error(`error: ${e}`);

if (errors.length === 0) {
  console.log(
    `validate: OK (${pages.length} pages, ${rootPages.length} root pages, ${warnings.length} warning${warnings.length === 1 ? "" : "s"})`,
  );
  process.exit(0);
}
console.error(`validate: ${errors.length} error${errors.length === 1 ? "" : "s"}`);
process.exit(1);
