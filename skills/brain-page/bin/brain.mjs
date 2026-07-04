#!/usr/bin/env node
// `brain` — the reference CLI for the Open Project Brain Standard.
//
// ALL reads and writes into a project's brain/ go through this one command. The
// brain directory is location-independent: it is resolved from
// `./.mindmux/preferences.json` (`brainRoot`) when present, otherwise `./brain`.
// Writes are correct-by-construction, so frontmatter can never be mis-shaped and
// the most fragile failure mode (rewriting compiled_truth without leaving a
// timeline entry) is structurally impossible.
//
// NEVER hand-edit any file under the brain directory. There is no validator to
// catch a manual edit — correctness is guaranteed only by going through this CLI.
//
// Zero npm dependencies; run it straight with `node`:
//   node <brain-page-skill>/bin/brain.mjs <subcommand> [flags]
//
// Subcommands:
//   brain-dir                       (print the resolved brain dir, its source, and whether it exists/is populated)
//   list-pages                      (list pages: id / title / category / status)
//   read-page <id>                  (print brain/pages/<id>.md)
//   read-root <slug>                (print a root page brain/<slug>.md)
//   create-page     --id --category --title [--tags] [--status] [--source]
//   update-truth    --id            (new compiled_truth read from stdin)
//   append-timeline --id --kind --summary [--source] [--affects]
//   archive-page    --id [--reversal-summary]
//   set-tags        --id --tags
//   update-root     <slug>          (body read from stdin)
//   wire            --agent <claude-code|codex|opencode|cursor|pi>   (wire CLAUDE.md / AGENTS.md to the brain)
//   reindex | lint-links

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ROOT,
  BRAIN_DIR,
  BRAIN_DIR_SOURCE,
  PAGES_DIR,
  ROOT_PAGE_META,
  ROOT_PAGE_SLUGS,
  PAGE_CATEGORIES,
  PAGE_STATUSES,
  TIMELINE_KINDS,
  listPages,
  listRootPages,
  loadDoc,
  pagePath,
  rootPagePath,
  nowStamp,
  yamlScalar,
  yamlInlineArray,
  setFrontmatterField,
  replaceSection,
  appendToSection,
  formatTimelineEntry,
  writeFileAtomic,
  reindexBrain,
  lintBrainLinks,
} from "../lib/brain.mjs";

// ---- argument parsing -------------------------------------------------------

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function fail(msg) {
  console.error(`brain: ${msg}`);
  process.exit(1);
}

function requireFlag(flags, name) {
  const v = flags[name];
  if (v === undefined || v === true || v === "") fail(`missing required --${name}`);
  return String(v);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function ensureBrainExists() {
  if (!existsSync(BRAIN_DIR)) fail(`no brain directory found at ${BRAIN_DIR} — run the brain-setup skill first`);
}

// ---- subcommands ------------------------------------------------------------

function cmdCreatePage(flags) {
  ensureBrainExists();
  const id = requireFlag(flags, "id");
  const category = requireFlag(flags, "category");
  const title = requireFlag(flags, "title");
  const status = flags.status ? String(flags.status) : "active";
  const source = flags.source ? String(flags.source) : "created via brain create-page";
  const tags = flags.tags ? String(flags.tags).split(",").map((s) => s.trim()).filter(Boolean) : [];

  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) fail(`invalid --id "${id}" (use kebab-case: a-z 0-9 -)`);
  if (!PAGE_CATEGORIES.includes(category))
    fail(`invalid --category "${category}" (one of ${PAGE_CATEGORIES.join(" / ")})`);
  if (!PAGE_STATUSES.includes(status))
    fail(`invalid --status "${status}" (one of ${PAGE_STATUSES.join(" / ")})`);
  if (existsSync(pagePath(id))) fail(`brain/pages/${id}.md already exists`);

  const stamp = nowStamp();
  const fmLines = [
    `id: ${id}`,
    `title: ${yamlScalar(title)}`,
    `category: ${category}`,
    `status: ${status}`,
  ];
  if (tags.length) fmLines.push(`tags: ${yamlInlineArray(tags)}`);
  fmLines.push(`created: ${yamlScalar(stamp)}`);
  fmLines.push(`updated: ${yamlScalar(stamp)}`);

  const timeline = formatTimelineEntry({
    time: stamp,
    kind: "decision",
    summary: `Created this page: ${title}`,
    source,
    affects: [id],
  });

  const content = [
    "---",
    fmLines.join("\n"),
    "---",
    "",
    "## compiled_truth",
    "",
    "<current best understanding — replace this with the real content>",
    "",
    "## timeline",
    "",
    timeline,
    "",
  ].join("\n");

  writeFileAtomic(pagePath(id), content);
  const { count } = reindexBrain();
  console.log(`brain: created brain/pages/${id}.md and reindexed (${count} pages)`);
}

async function cmdUpdateTruth(flags) {
  ensureBrainExists();
  const id = requireFlag(flags, "id");
  const source = flags.source ? String(flags.source) : "brain update-truth";
  const summary = flags.summary
    ? String(flags.summary)
    : "Rewrote compiled_truth to the new best understanding";
  if (!existsSync(pagePath(id))) fail(`brain/pages/${id}.md does not exist`);

  const newTruth = (await readStdin()).trim();
  if (!newTruth) fail("update-truth reads the new compiled_truth from stdin, but stdin was empty");

  const doc = loadDoc(pagePath(id));
  const stamp = nowStamp();

  // 1. replace compiled_truth, 2. append a decision timeline entry —
  //    both in one atomic write, so "changing understanding" and
  //    "recording why" can never come apart.
  let body = replaceSection(doc.body, "compiled_truth", newTruth);
  const entry = formatTimelineEntry({
    time: stamp,
    kind: "decision",
    summary,
    source,
    affects: [id],
  });
  body = appendToSection(body, "timeline", entry);

  const fm = setFrontmatterField(doc.rawFrontmatter, "updated", yamlScalar(stamp));
  const content = `---\n${fm}\n---\n${body.startsWith("\n") ? "" : "\n"}${body}`;
  writeFileAtomic(pagePath(id), content);
  const { count } = reindexBrain();
  console.log(`brain: rewrote compiled_truth + appended a decision timeline entry to brain/pages/${id}.md and reindexed (${count} pages)`);
}

function cmdAppendTimeline(flags) {
  ensureBrainExists();
  const id = requireFlag(flags, "id");
  const kind = requireFlag(flags, "kind");
  const summary = requireFlag(flags, "summary");
  const source = flags.source ? String(flags.source) : undefined;
  const affects = flags.affects
    ? String(flags.affects).split(",").map((s) => s.trim()).filter(Boolean)
    : [id];
  if (!TIMELINE_KINDS.includes(kind)) fail(`invalid --kind "${kind}" (one of ${TIMELINE_KINDS.join(" / ")})`);
  if (!existsSync(pagePath(id))) fail(`brain/pages/${id}.md does not exist`);

  const doc = loadDoc(pagePath(id));
  const stamp = nowStamp();
  const entry = formatTimelineEntry({ time: stamp, kind, summary, source, affects });
  const body = appendToSection(doc.body, "timeline", entry);
  const fm = setFrontmatterField(doc.rawFrontmatter, "updated", yamlScalar(stamp));
  const content = `---\n${fm}\n---\n${body.startsWith("\n") ? "" : "\n"}${body}`;
  writeFileAtomic(pagePath(id), content);
  const { count } = reindexBrain();
  console.log(`brain: appended a ${kind} timeline entry to brain/pages/${id}.md and reindexed (${count} pages)`);
}

function cmdArchivePage(flags) {
  ensureBrainExists();
  const id = requireFlag(flags, "id");
  const reversal = flags["reversal-summary"] ? String(flags["reversal-summary"]) : undefined;
  if (!existsSync(pagePath(id))) fail(`brain/pages/${id}.md does not exist`);

  const doc = loadDoc(pagePath(id));
  const stamp = nowStamp();
  let body = doc.body;
  if (reversal) {
    const entry = formatTimelineEntry({
      time: stamp,
      kind: "reversal",
      summary: reversal,
      source: "brain archive-page",
      affects: [id],
    });
    body = appendToSection(body, "timeline", entry);
  }
  let fm = setFrontmatterField(doc.rawFrontmatter, "status", "archived");
  fm = setFrontmatterField(fm, "updated", yamlScalar(stamp));
  const content = `---\n${fm}\n---\n${body.startsWith("\n") ? "" : "\n"}${body}`;
  writeFileAtomic(pagePath(id), content);
  const { count } = reindexBrain();
  console.log(`brain: archived brain/pages/${id}.md and reindexed (${count} pages)`);
}

function cmdSetTags(flags) {
  ensureBrainExists();
  const id = requireFlag(flags, "id");
  const tagsRaw = requireFlag(flags, "tags");
  const tags = tagsRaw.split(",").map((s) => s.trim()).filter(Boolean);
  if (!existsSync(pagePath(id))) fail(`brain/pages/${id}.md does not exist`);

  const doc = loadDoc(pagePath(id));
  const stamp = nowStamp();
  let fm = setFrontmatterField(doc.rawFrontmatter, "tags", yamlInlineArray(tags));
  fm = setFrontmatterField(fm, "updated", yamlScalar(stamp));
  const content = `---\n${fm}\n---\n${doc.body.startsWith("\n") ? "" : "\n"}${doc.body}`;
  writeFileAtomic(pagePath(id), content);
  const { count } = reindexBrain();
  console.log(`brain: set tags on brain/pages/${id}.md to [${tags.join(", ")}] and reindexed (${count} pages)`);
}

async function cmdUpdateRoot(positional, flags) {
  ensureBrainExists();
  const slug = positional[0] || flags.slug;
  if (!slug) fail("update-root needs a slug: brain update-root <slug>");
  if (!ROOT_PAGE_SLUGS.includes(slug))
    fail(`invalid root slug "${slug}" (one of ${ROOT_PAGE_SLUGS.join(", ")})`);

  const meta = ROOT_PAGE_META[slug];
  let body = (await readStdin()).replace(/^﻿/, "").trim();
  if (!body) fail("update-root reads the page body from stdin, but stdin was empty");

  // Guarantee the canonical H1 heading is present exactly once at the top.
  const canonicalH1 = `# ${meta.title}`;
  const firstLine = body.split("\n", 1)[0].trim();
  if (firstLine !== canonicalH1) {
    // Drop any other leading H1 the author may have written, then prepend ours.
    if (/^#\s+/.test(firstLine)) body = body.split("\n").slice(1).join("\n").trim();
    body = `${canonicalH1}\n\n${body}`.trim();
  }

  const stamp = nowStamp();
  const fm = [
    `slug: ${slug}`,
    `title: ${yamlScalar(meta.title)}`,
    `role: ${yamlScalar(meta.role)}`,
    `updated: ${yamlScalar(stamp)}`,
  ].join("\n");
  const content = `---\n${fm}\n---\n\n${body}\n`;
  writeFileAtomic(rootPagePath(slug), content);
  console.log(`brain: rewrote root page brain/${slug}.md (canonical H1 ensured, no timeline)`);
}

function cmdReindex() {
  ensureBrainExists();
  const { path, count } = reindexBrain();
  console.log(`reindex: wrote ${path} (${count} page${count === 1 ? "" : "s"})`);
}

function cmdLintLinks() {
  ensureBrainExists();
  const { broken, rootRefs, pageCount, rootCount } = lintBrainLinks();
  for (const r of rootRefs)
    console.warn(`warn: ${r.from} → [[${r.target}]] points at a root page slug; root pages are addressed by slug, not [[ ]].`);
  if (broken.length === 0) {
    console.log(`lint-links: OK (${pageCount} pages, ${rootCount} root pages scanned, no broken links)`);
    return;
  }
  for (const b of broken)
    console.error(`error: ${b.from} → [[${b.target}]] has no matching brain/pages/${b.target}.md`);
  console.error(`lint-links: ${broken.length} broken link${broken.length === 1 ? "" : "s"}`);
  process.exit(1);
}

// ---- read subcommands (location-independent) --------------------------------

function cmdBrainDir() {
  const origin = BRAIN_DIR_SOURCE === "brainRoot"
    ? "from brainRoot in ./.mindmux/preferences.json"
    : "default ./brain";
  // "populated" means the resolved location already holds real brain content —
  // any root page or any page under pages/. An empty/absent directory is not.
  const populated = listRootPages().length > 0 || listPages().length > 0;
  console.log(BRAIN_DIR);
  console.log(`(${origin})`);
  console.log(`source: ${BRAIN_DIR_SOURCE}`);
  console.log(`exists: ${existsSync(BRAIN_DIR)}`);
  console.log(`populated: ${populated}`);
}

function cmdListPages() {
  ensureBrainExists();
  const pages = listPages();
  if (pages.length === 0) {
    console.log("(no pages yet)");
    return;
  }
  for (const p of pages) {
    const fm = p.frontmatter;
    const id = fm.id || p.id;
    const title = fm.title || "(untitled)";
    const category = fm.category || "?";
    const status = fm.status || "?";
    console.log(`${id}\t${title}\t${category}\t${status}`);
  }
}

function cmdReadPage(positional) {
  ensureBrainExists();
  const id = positional[0];
  if (!id) fail("read-page needs a page id: brain read-page <id>");
  const path = pagePath(id);
  if (!existsSync(path)) fail(`brain/pages/${id}.md does not exist`);
  process.stdout.write(readFileSync(path, "utf8"));
}

function cmdReadRoot(positional) {
  ensureBrainExists();
  const slug = positional[0];
  if (!slug) fail("read-root needs a root slug: brain read-root <slug>");
  if (!ROOT_PAGE_SLUGS.includes(slug))
    fail(`invalid root slug "${slug}" (one of ${ROOT_PAGE_SLUGS.join(", ")})`);
  const path = rootPagePath(slug);
  if (!existsSync(path)) fail(`brain/${slug}.md does not exist`);
  process.stdout.write(readFileSync(path, "utf8"));
}

// ---- wire (deterministic agent-config wiring) -------------------------------

// agent → the project-root config file it reads.
const WIRE_AGENTS = {
  "claude-code": "CLAUDE.md",
  "codex": "AGENTS.md",
  "opencode": "AGENTS.md",
  "cursor": "AGENTS.md",
  "pi": "AGENTS.md",
};
const WIRE_BEGIN = "<!-- BEGIN brain.md -->";
const WIRE_END = "<!-- END brain.md -->";

// The unified, neutral, self-contained brain block. Every agent gets byte-for-byte
// the same body; the ONLY difference is that claude-code additionally carries an
// `@import ./BRAIN.md` line (an @import is Claude Code-specific syntax — the other
// agents, which read AGENTS.md, do not understand it, so their block relies on the
// plain "read ./BRAIN.md" instruction instead).
function brainWireBlock(agent) {
  const lines = [
    "## Project Brain",
    "",
    "This project keeps a **Project Brain**: a persistent memory layer of its durable decisions, requirements, and constraints. Read `./BRAIN.md` for the full read/write contract.",
    "",
    "Use it actively:",
    "- Before any task or discussion, load the relevant brain context with the `brain` CLI's read commands.",
    "- Whenever a decision, requirement, constraint, or durable insight surfaces — in discussion or in code — record it with the `brain` CLI before moving on; don't wait to be asked.",
    "- All reads and writes go through the `brain` CLI — never hand-edit brain files.",
    "",
    "The brain skills (`brain-setup`, `brain-page`, `brain-ingest`, `brain-bootstrap`) are installed in your global skills directory.",
  ];
  // claude-code only: the @import line trails the read instruction. Removing this
  // single line yields a body identical to the codex block.
  if (agent === "claude-code") lines.splice(3, 0, "@import ./BRAIN.md");
  return [WIRE_BEGIN, ...lines, WIRE_END].join("\n");
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectAgents(rest) {
  const out = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--agent") {
      const v = rest[i + 1];
      if (v !== undefined && !v.startsWith("--")) {
        out.push(...v.split(",").map((s) => s.trim()).filter(Boolean));
        i++;
      }
    } else if (a.startsWith("--agent=")) {
      out.push(...a.slice("--agent=".length).split(",").map((s) => s.trim()).filter(Boolean));
    }
  }
  return out;
}

function cmdWire(rest) {
  const agents = collectAgents(rest);
  if (agents.length === 0)
    fail(`wire needs at least one --agent (one of ${Object.keys(WIRE_AGENTS).join(" / ")})`);
  for (const a of agents)
    if (!(a in WIRE_AGENTS))
      fail(`unknown agent "${a}" (one of ${Object.keys(WIRE_AGENTS).join(" / ")})`);

  for (const agent of [...new Set(agents)]) {
    const file = WIRE_AGENTS[agent];
    const path = join(ROOT, file);
    const block = brainWireBlock(agent);

    let action;
    if (!existsSync(path)) {
      // File absent → create it from the unified format.
      writeFileAtomic(path, `${block}\n`);
      action = "created";
    } else {
      const current = readFileSync(path, "utf8");
      if (current.includes(WIRE_BEGIN) && current.includes(WIRE_END)) {
        // Marked block present → replace it in place (supports upgrades).
        const re = new RegExp(`${escapeRegExp(WIRE_BEGIN)}[\\s\\S]*?${escapeRegExp(WIRE_END)}`);
        writeFileAtomic(path, current.replace(re, block));
        action = "updated the brain block in";
      } else {
        // File present, no marker → append the block with a leading blank line.
        const trimmed = current.replace(/\s*$/, "");
        writeFileAtomic(path, `${trimmed}\n\n${block}\n`);
        action = "appended a brain block to";
      }
    }
    console.log(`brain: ${action} ${file} (agent: ${agent})`);
  }
}

// ---- dispatch ---------------------------------------------------------------

const HELP = `brain — reference CLI for the Open Project Brain Standard

Usage: node <brain-page-skill>/bin/brain.mjs <subcommand> [flags]

The brain directory is resolved from ./.mindmux/preferences.json (brainRoot)
when present, otherwise ./brain. ALL reads and writes go through this CLI —
NEVER hand-edit any file under the brain directory.

Reads (location-independent):
  brain-dir         print the resolved brain dir, its source, and exists/populated
  list-pages        list pages (id / title / category / status)
  read-page <id>    print brain/pages/<id>.md
  read-root <slug>  print a root page brain/<slug>.md

Writes (correct-by-construction):
  create-page     --id <kebab> --category <cat> --title <t> [--tags a,b] [--status active] [--source s]
  update-truth    --id <kebab> [--summary s] [--source s]      (new compiled_truth read from stdin)
  append-timeline --id <kebab> --kind <k> --summary <s> [--source s] [--affects a,b]
  archive-page    --id <kebab> [--reversal-summary s]
  set-tags        --id <kebab> --tags a,b,c
  update-root     <slug>                                        (body read from stdin)

Wiring (deterministic agent-config):
  wire            --agent <claude-code|codex|opencode|cursor|pi>  (repeatable, or comma-separated)
                  writes a unified brain block into ./CLAUDE.md (claude-code) / ./AGENTS.md (codex / opencode / cursor / pi);
                  idempotent via <!-- BEGIN brain.md --> … <!-- END brain.md --> markers.

Index / checks:
  reindex         rebuild brain/index.md
  lint-links      verify [[page-id]] wiki-links resolve

Categories: ${PAGE_CATEGORIES.join(" / ")}
Statuses:   ${PAGE_STATUSES.join(" / ")}
Kinds:      ${TIMELINE_KINDS.join(" / ")}
Root slugs: ${ROOT_PAGE_SLUGS.join(" / ")}`;

async function main() {
  const [, , sub, ...rest] = process.argv;
  const { positional, flags } = parseArgs(rest);

  switch (sub) {
    case "brain-dir": return cmdBrainDir();
    case "list-pages": return cmdListPages();
    case "read-page": return cmdReadPage(positional);
    case "read-root": return cmdReadRoot(positional);
    case "create-page": return cmdCreatePage(flags);
    case "update-truth": return cmdUpdateTruth(flags);
    case "append-timeline": return cmdAppendTimeline(flags);
    case "archive-page": return cmdArchivePage(flags);
    case "set-tags": return cmdSetTags(flags);
    case "update-root": return cmdUpdateRoot(positional, flags);
    case "wire": return cmdWire(rest);
    case "reindex": return cmdReindex();
    case "lint-links": return cmdLintLinks();
    case undefined:
    case "help":
    case "-h":
    case "--help":
      console.log(HELP);
      return;
    default:
      fail(`unknown subcommand "${sub}"\n\n${HELP}`);
  }
}

main().catch((e) => fail(e?.message || String(e)));
