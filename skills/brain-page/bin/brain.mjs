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
//   wire            [--agent <claude-code|codex|opencode|cursor|pi|all>]
//                   (default: wire CLAUDE.md + AGENTS.md)
//   init            [--no-wire] [--agent …]   scaffold BRAIN.md + brain/ + default wire
//   install-hooks   [--agent <claude-code|codex>] (opt-in, project-local)
//   uninstall-hooks (remove that SessionStart hook)
//   reindex | lint-links

import { existsSync, lstatSync, readFileSync, readdirSync, mkdirSync, cpSync, chmodSync, rmSync, rmdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
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

/** Directory of this CLI binary (…/skills/brain-page/bin). */
const CLI_DIR = dirname(fileURLToPath(import.meta.url));
/** skills/ directory that holds all skill bundles (sibling of brain-page). */
const SKILLS_ROOT = join(CLI_DIR, "..", "..");
/** Scaffold templates shipped with brain-setup. */
const SETUP_ASSETS = join(SKILLS_ROOT, "brain-setup", "assets");

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
  if (!existsSync(BRAIN_DIR)) fail(`no brain directory found at ${BRAIN_DIR} — run brain init (or the brain-setup skill) first`);
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
    "<!-- compiled_truth -->",
    "",
    "<current best understanding — replace this with the real content>",
    "",
    "## Timeline",
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
/** Default wire set: one writer per config file (CLAUDE.md + AGENTS.md). */
const DEFAULT_WIRE_AGENTS = ["claude-code", "codex"];
const WIRE_BEGIN = "<!-- BEGIN brain.md -->";
const WIRE_END = "<!-- END brain.md -->";

function brainWireBlock(agent) {
  const lines = [
    "## Project Brain",
    "",
    "This project keeps a **Project Brain**: a persistent memory layer of its durable decisions, requirements, and constraints. Read `./BRAIN.md` for the full read/write contract.",
    "",
    "The `brain` CLI is not guaranteed to be on `PATH`. From the project root, invoke it as `node <brain-page-skill-dir>/bin/brain.mjs <subcommand> [flags]`, resolving `<brain-page-skill-dir>` to the installed `brain-page` skill directory.",
    "",
    "Maintain the brain as part of normal coding work — not as a separate task. While discussing or implementing features:",
    "- **Start of a task:** load relevant context with the `brain` CLI (`list-pages`, `read-page`, `read-root`). Prefer a narrow read over scanning everything.",
    "- **When a decision, requirement, constraint, or durable insight settles** (in chat or while coding): capture it immediately via the `brain` CLI. Do not wait to be asked and do not batch it for later.",
    "- **Pure implementation with no new decision:** do not write to the brain.",
    "- **When overturning a prior conclusion:** update the page (`update-truth` and/or `append-timeline` with `kind: reversal`, or `archive-page`).",
    "- Only store what will still matter in six months and is hard to reconstruct from the code alone.",
    "- All reads and writes go through the `brain` CLI — never hand-edit brain files.",
    "",
    "The brain skills (`brain-setup`, `brain-page`, `brain-ingest`, `brain-bootstrap`) are installed in your global skills directory. To scaffold a new project, run `node <brain-page-skill-dir>/bin/brain.mjs init` from its root.",
  ];
  if (agent === "codex") lines.push(
    "If native notes/history are available, keep relevant brain page IDs and unresolved task state in notes; search history for earlier task evidence. After context rollover, re-read relevant pages through the CLI for current project facts. Do not copy task history into the brain.",
  );
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

/**
 * Resolve which agents to wire. Empty / `all` → default set covering CLAUDE.md + AGENTS.md.
 * Dedupes so each target file is written once (first agent wins for block flavor).
 */
function resolveWireAgents(requested) {
  let agents = requested.length === 0 || requested.includes("all")
    ? [...DEFAULT_WIRE_AGENTS]
    : [...requested];
  for (const a of agents) {
    if (a === "all") continue;
    if (!(a in WIRE_AGENTS)) {
      fail(`unknown agent "${a}" (one of ${Object.keys(WIRE_AGENTS).join(" / ")} / all)`);
    }
  }
  agents = agents.filter((a) => a !== "all");
  if (agents.length === 0) agents = [...DEFAULT_WIRE_AGENTS];

  const byFile = new Map();
  for (const agent of agents) {
    const file = WIRE_AGENTS[agent];
    if (!byFile.has(file)) byFile.set(file, agent);
  }
  return [...byFile.values()];
}

function countOccurrences(haystack, needle) {
  let n = 0;
  let i = 0;
  while (true) {
    const j = haystack.indexOf(needle, i);
    if (j === -1) return n;
    n += 1;
    i = j + needle.length;
  }
}

function wireOneAgent(agent) {
  const file = WIRE_AGENTS[agent];
  const path = join(ROOT, file);
  const block = brainWireBlock(agent);

  let action;
  if (!existsSync(path)) {
    writeFileAtomic(path, `${block}\n`);
    action = "created";
  } else {
    const current = readFileSync(path, "utf8");
    const beginCount = countOccurrences(current, WIRE_BEGIN);
    const endCount = countOccurrences(current, WIRE_END);
    if (beginCount !== endCount)
      fail(
        `${file} has a damaged brain block (${beginCount > endCount ? "BEGIN" : "END"} marker without its pair) — repair or remove the marker and re-run`,
      );
    if (beginCount > 1)
      fail(
        `${file} has ${beginCount} brain blocks (duplicate BEGIN/END pairs) — leave a single pair and re-run`,
      );
    if (beginCount === 1) {
      const re = new RegExp(`${escapeRegExp(WIRE_BEGIN)}[\\s\\S]*?${escapeRegExp(WIRE_END)}`);
      // Function replacer so `$` in the block is never treated as a special
      // substitution pattern (String.replace with a string replacement would).
      // Do not use `next === current` to detect a miss: an already-current block
      // is a successful no-op update (idempotent re-run).
      let matched = false;
      const next = current.replace(re, () => {
        matched = true;
        return block;
      });
      if (!matched)
        fail(`${file} has BEGIN/END markers but the brain block could not be matched — repair the markers and re-run`);
      writeFileAtomic(path, next);
      action = "updated the brain block in";
    } else {
      const trimmed = current.replace(/\s*$/, "");
      writeFileAtomic(path, `${trimmed}\n\n${block}\n`);
      action = "appended a brain block to";
    }
  }
  console.log(`brain: ${action} ${file} (agent: ${agent})`);
  return { file, action, agent };
}

function cmdWire(rest) {
  const agents = resolveWireAgents(collectAgents(rest));
  for (const agent of agents) wireOneAgent(agent);
}

// ---- init (deterministic project scaffold + default wire) -------------------

function copyIfMissing(src, dest) {
  if (existsSync(dest)) return false;
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
  return true;
}

function isBrainPopulated() {
  return listRootPages().length > 0 || listPages().length > 0;
}

function cmdInit(rest) {
  const { flags } = parseArgs(rest);
  const noWire = Boolean(flags["no-wire"]);

  if (!existsSync(SETUP_ASSETS)) {
    fail(
      `init cannot find scaffold assets at ${SETUP_ASSETS} — is the brain-setup skill installed next to brain-page?`,
    );
  }

  // 1. BRAIN.md in project root (never overwrite).
  const brainMdSrc = join(SETUP_ASSETS, "BRAIN.md");
  const brainMdDest = join(ROOT, "BRAIN.md");
  if (copyIfMissing(brainMdSrc, brainMdDest)) {
    console.log("brain: created BRAIN.md");
  } else {
    console.log("brain: BRAIN.md already present (left untouched)");
  }

  // 2. Scaffold brain data only if the resolved location is empty.
  if (isBrainPopulated()) {
    console.log(`brain: brain data already populated at ${BRAIN_DIR} (left untouched)`);
  } else {
    const skeletonSrc = join(SETUP_ASSETS, "brain");
    mkdirSync(BRAIN_DIR, { recursive: true });
    mkdirSync(PAGES_DIR, { recursive: true });
    for (const name of readdirSync(skeletonSrc)) {
      if (name === "pages") continue; // pages/ scaffolded empty (PAGES_DIR above)
      const from = join(skeletonSrc, name);
      const to = join(BRAIN_DIR, name);
      if (copyIfMissing(from, to)) {
        const rel = to.startsWith(`${ROOT}/`) ? to.slice(ROOT.length + 1) : to;
        console.log(`brain: scaffolded ${rel}`);
      }
    }
    try {
      const { count } = reindexBrain();
      console.log(`brain: reindexed (${count} pages) at ${BRAIN_DIR}`);
    } catch {
      // best-effort on partial scaffolds
    }
    console.log(`brain: brain data ready at ${BRAIN_DIR} (source: ${BRAIN_DIR_SOURCE})`);
  }

  // 3. Default wire CLAUDE.md + AGENTS.md (create or update block only).
  if (noWire) {
    console.log("brain: skipped wire (--no-wire)");
  } else {
    const agents = resolveWireAgents(collectAgents(rest));
    for (const agent of agents) wireOneAgent(agent);
  }

  console.log(
    "brain: init done. Seed real knowledge next (brain-bootstrap skill), then maintain the brain while coding.",
  );
  console.log(
    "brain: optional: brain install-hooks — SessionStart snapshot (project-local; add --agent codex for Codex).",
  );
}

// ---- SessionStart hooks (opt-in, project-local only) -------------------------

const SESSION_HOOK_FILE = "brain-session-start";
const SESSION_HOOK_COMMAND = "${CLAUDE_PROJECT_DIR}/.claude/hooks/" + SESSION_HOOK_FILE;
const SESSION_HOOK_SRC = join(SKILLS_ROOT, "brain-setup", "hooks", "session-start");
const SESSION_HOOK_MARKER = "# brain.md SessionStart hook —";

function hookTarget(rest) {
  let agent = "claude-code";
  if (rest.length === 2 && rest[0] === "--agent") agent = rest[1];
  else if (rest.length === 1 && rest[0].startsWith("--agent=")) agent = rest[0].slice(8);
  else if (rest.length) fail("expected [--agent <claude-code|codex>]");
  if (agent !== "claude-code" && agent !== "codex") fail(`unsupported hook agent "${agent}"; use claude-code or codex`);
  const codex = agent === "codex";
  const dir = join(ROOT, codex ? ".codex" : ".claude");
  const dest = join(dir, "hooks", SESSION_HOOK_FILE);
  const settings = join(dir, codex ? "hooks.json" : "settings.json");
  // Refuse symlinks so project-local installation cannot mutate global settings.
  for (const path of [dir, dirname(dest), settings, dest]) {
    if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink()) fail(`refusing hook symlink: ${path}`);
  }
  const command = codex ? `sh '${dest.replaceAll("'", "'\\''")}' codex` : SESSION_HOOK_COMMAND;
  return { codex, dest, settings, command, label: codex ? "Codex" : "Claude Code" };
}

function isOurSessionHook(hook, target) {
  return hook?.type === "command" && hook.command === target.command;
}

function sessionStartHasOurHook(groups, target) {
  return groups.some((group) => group.hooks.some((hook) => isOurSessionHook(hook, target)));
}

function removeOurSessionHook(groups, target) {
  return groups.flatMap((group) => {
    const hooks = group.hooks.filter((hook) => !isOurSessionHook(hook, target));
    if (hooks.length === group.hooks.length) return [group];
    return hooks.length ? [{ ...group, hooks }] : [];
  });
}

function readHookSettings(path) {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf8");
  if (!raw.trim()) return {};
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    fail(`${path} is not valid JSON — repair it and re-run`);
  }
  const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  if (!object(value)) fail(`${path} must be a JSON object`);
  if (value.hooks !== undefined && !object(value.hooks)) fail(`${path} hooks must be an object`);
  const groups = value.hooks?.SessionStart;
  if (groups !== undefined && (!Array.isArray(groups) || groups.some((g) =>
    !object(g) || !Array.isArray(g.hooks) || g.hooks.some((h) => !object(h))))) {
    fail(`${path} hooks.SessionStart must be an array of groups with hook objects`);
  }
  return value;
}

function checkOwnedScript(dest) {
  if (!existsSync(dest)) return false;
  if (!lstatSync(dest).isFile() || !readFileSync(dest, "utf8").startsWith(`#!/bin/sh\n${SESSION_HOOK_MARKER}`)) {
    fail(`refusing to overwrite or remove unrelated hook script: ${dest}`);
  }
  return true;
}

function cmdInstallHooks(rest) {
  const target = hookTarget(rest);
  const value = readHookSettings(target.settings);
  checkOwnedScript(target.dest);
  if (!existsSync(SESSION_HOOK_SRC)) fail(`install-hooks cannot find ${SESSION_HOOK_SRC} — is brain-setup installed next to brain-page?`);
  const groups = value.hooks?.SessionStart || [];
  if (!sessionStartHasOurHook(groups, target)) {
    groups.push(target.codex
      ? { matcher: "^(startup|resume|clear|compact)$", hooks: [{ type: "command", command: target.command, timeout: 5 }] }
      : { hooks: [{ type: "command", command: target.command }] });
  }
  value.hooks = { ...value.hooks, SessionStart: groups };
  mkdirSync(dirname(target.dest), { recursive: true });
  writeFileAtomic(target.dest, readFileSync(SESSION_HOOK_SRC, "utf8"));
  chmodSync(target.dest, 0o755);
  writeFileAtomic(target.settings, `${JSON.stringify(value, null, 2)}\n`);
  console.log(`brain: installed ${target.label} SessionStart hook in ${target.settings} (project-local)`);
  if (target.codex) console.log("brain: use Codex /hooks to review and trust this hook; project trust and enabled hooks are required.");
}

function cmdUninstallHooks(rest) {
  const target = hookTarget(rest);
  const value = readHookSettings(target.settings);
  const scriptExists = checkOwnedScript(target.dest);
  const groups = value.hooks?.SessionStart || [];
  const changed = sessionStartHasOurHook(groups, target);
  if (changed) {
    const next = removeOurSessionHook(groups, target);
    if (next.length) value.hooks.SessionStart = next;
    else delete value.hooks.SessionStart;
    if (!Object.keys(value.hooks).length) delete value.hooks;
    if (!Object.keys(value).length) rmSync(target.settings);
    else writeFileAtomic(target.settings, `${JSON.stringify(value, null, 2)}\n`);
  }
  if (scriptExists) {
    rmSync(target.dest);
    if (!readdirSync(dirname(target.dest)).length) rmdirSync(dirname(target.dest));
  }
  console.log(changed || scriptExists
    ? `brain: removed ${target.label} SessionStart hook from ${target.settings}`
    : `brain: ${target.label} SessionStart hook not installed (nothing to do)`);
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

Project setup:
  init            [--no-wire] [--agent …]   ensure BRAIN.md, scaffold empty brain, default-wire CLAUDE.md + AGENTS.md
  install-hooks   [--agent <claude-code|codex>] opt-in project-local SessionStart hook (default: claude-code)
  uninstall-hooks [--agent <claude-code|codex>] remove only that agent's brain hook

Wiring (deterministic agent-config):
  wire            [--agent <claude-code|codex|opencode|cursor|pi|all>]
                  default (no --agent, or --agent all): wire CLAUDE.md + AGENTS.md
                  missing files are created; existing files only update the marked brain block
                  (<!-- BEGIN brain.md --> … <!-- END brain.md -->); never whole-file overwrite

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
    case "init": return cmdInit(rest);
    case "wire": return cmdWire(rest);
    case "install-hooks": return cmdInstallHooks(rest);
    case "uninstall-hooks": return cmdUninstallHooks(rest);
    case "reindex": return cmdReindex();
    case "lint-links": return cmdLintLinks();
    case "setup":
    case "uninstall":
      // Toolchain management only exists on the npm-installed `brain`; a
      // copied/symlinked skill bundle has no installer alongside it.
      fail(`"brain ${sub}" is only available from the npm-installed CLI — run: npm install -g @mindmux/brain-md, then brain ${sub}`);
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
