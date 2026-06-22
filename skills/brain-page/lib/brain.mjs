// Shared library for the `brain` reference CLI and the brain.md skills.
// Zero npm dependencies — only Node.js built-ins. The frontmatter parser is a
// deliberately tiny YAML subset, just enough for brain page / root page headers.
//
// This module carries two layers:
//   1. read helpers (parse frontmatter, extract sections, list pages) — also used
//      to render the index and lint links;
//   2. write helpers + command implementations (create / update / ...)
//      that back the correct-by-construction `brain` CLI.

import {
  readFileSync,
  writeFileSync,
  renameSync,
  readdirSync,
  existsSync,
  statSync,
} from "node:fs";
import { join, basename, dirname, isAbsolute, resolve } from "node:path";

export const ROOT = process.cwd();

/**
 * Resolve the brain directory. Order:
 *   1. `./.mindmux/preferences.json` with a `brainRoot` field — used as the brain
 *      root directly (it contains `pages/` and the six root pages). Absolute paths
 *      are taken verbatim; relative paths are resolved against the cwd.
 *   2. Fallback: `<cwd>/brain`.
 * Resolution is robust: a missing file, broken JSON, or absent `brainRoot` all
 * fall back silently to the default — never throwing.
 * Returns { dir, source } where source is "brainRoot" or "default".
 */
export function resolveBrainDir(cwd = ROOT) {
  const prefsPath = join(cwd, ".mindmux", "preferences.json");
  try {
    if (existsSync(prefsPath)) {
      const prefs = JSON.parse(readFileSync(prefsPath, "utf8"));
      const brainRoot = prefs && typeof prefs.brainRoot === "string" ? prefs.brainRoot.trim() : "";
      if (brainRoot) {
        const dir = isAbsolute(brainRoot) ? brainRoot : resolve(cwd, brainRoot);
        return { dir, source: "brainRoot" };
      }
    }
  } catch {
    // missing file / bad JSON / unreadable — fall through to the default.
  }
  return { dir: join(cwd, "brain"), source: "default" };
}

const BRAIN = resolveBrainDir();

export const BRAIN_DIR = BRAIN.dir;
export const BRAIN_DIR_SOURCE = BRAIN.source;
export const PAGES_DIR = join(BRAIN_DIR, "pages");
export const INDEX_PATH = join(BRAIN_DIR, "index.md");

/** The six fixed root pages, with their canonical title + role. */
export const ROOT_PAGE_META = {
  background: { title: "Project background", role: "project background" },
  architecture: { title: "System architecture", role: "system architecture" },
  flow: { title: "Key flows", role: "key flows" },
  mindmap: { title: "Feature mindmap", role: "feature mindmap" },
  stack: { title: "Tech stack", role: "tech-stack choices" },
  roadmap: { title: "Roadmap", role: "milestones" },
};

/** The six fixed root page slugs (ordered). */
export const ROOT_PAGE_SLUGS = Object.keys(ROOT_PAGE_META);

/** The five page categories. */
export const PAGE_CATEGORIES = ["project", "concept", "decision", "person", "reference"];

/** Allowed page lifecycle statuses. */
export const PAGE_STATUSES = ["active", "draft", "archived"];

/** Timeline entry kinds. */
export const TIMELINE_KINDS = ["decision", "evidence", "reversal", "note"];

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

/**
 * Split a raw markdown file into { frontmatter (raw string), body }.
 * Returns frontmatter: null when no `---` fenced header is present.
 */
export function splitFrontmatter(raw) {
  if (!raw.startsWith("---")) return { frontmatter: null, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { frontmatter: null, body: raw };
  const fmEnd = raw.indexOf("\n", end + 1);
  const frontmatter = raw.slice(raw.indexOf("\n") + 1, end);
  const body = fmEnd === -1 ? "" : raw.slice(fmEnd + 1);
  return { frontmatter, body };
}

/**
 * Parse a tiny YAML subset: `key: value` lines, where value is a plain scalar,
 * a quoted string, or an inline array `[a, b, c]`. Good enough for brain headers.
 */
export function parseFrontmatter(raw) {
  const out = {};
  if (!raw) return out;
  for (const line of raw.split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if (val.startsWith("[") && val.endsWith("]")) {
      val = val
        .slice(1, -1)
        .split(",")
        .map((s) => unquote(s.trim()))
        .filter((s) => s.length > 0);
    } else {
      val = unquote(val);
    }
    out[key] = val;
  }
  return out;
}

function unquote(s) {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * Extract a named `## section` body from a page. Returns the text between the
 * heading and the next `## ` heading (or EOF). null when the section is absent.
 */
export function extractSection(body, name) {
  const re = new RegExp(`^##\\s+${escapeRe(name)}[ \\t]*$`, "m");
  const m = body.match(re);
  if (!m) return null;
  const start = m.index + m[0].length;
  const rest = body.slice(start);
  const next = rest.search(/^##\s+/m);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Count timeline entries (top-level `- ` list items) in a timeline section body. */
export function countTimelineEntries(timelineBody) {
  if (!timelineBody) return 0;
  return timelineBody.split("\n").filter((l) => /^-\s+\S/.test(l)).length;
}

/** List all page files under brain/pages as { id, path, raw, frontmatter, body }. */
export function listPages() {
  if (!existsSync(PAGES_DIR)) return [];
  return readdirSync(PAGES_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => loadDoc(join(PAGES_DIR, f)));
}

/** List the root page files that actually exist under brain/. */
export function listRootPages() {
  if (!existsSync(BRAIN_DIR)) return [];
  return readdirSync(BRAIN_DIR)
    .filter((f) => f.endsWith(".md") && f !== "index.md")
    .filter((f) => statSync(join(BRAIN_DIR, f)).isFile())
    .sort()
    .map((f) => loadDoc(join(BRAIN_DIR, f)));
}

export function loadDoc(path) {
  const raw = readFileSync(path, "utf8");
  const { frontmatter, body } = splitFrontmatter(raw);
  return {
    id: basename(path, ".md"),
    path,
    raw,
    frontmatter: parseFrontmatter(frontmatter),
    rawFrontmatter: frontmatter,
    body,
  };
}

/** Strip fenced code blocks and inline code so their contents aren't scanned. */
export function stripCode(text) {
  return text.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
}

/**
 * Find every [[wiki-link]] target in a string, returning bare ids. Wiki-links
 * inside code spans / fenced blocks are ignored — there they are syntax
 * illustrations, not real cross-references.
 */
export function findWikiLinks(text) {
  const out = [];
  const re = /\[\[([^\]|]+?)\]\]/g;
  let m;
  const scannable = stripCode(text);
  while ((m = re.exec(scannable)) !== null) {
    out.push(m[1].trim());
  }
  return out;
}

// ---------------------------------------------------------------------------
// Write helpers (used only by the CLI)
// ---------------------------------------------------------------------------

const pad2 = (n) => String(n).padStart(2, "0");

/** `YYYY-MM-DDTHH:MM` local-time stamp for timeline entries / `updated`. */
export function nowStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** `YYYY-MM-DD` local-time stamp for `created`. */
export function todayStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Render a scalar for a YAML-ish frontmatter / timeline value, quoting when needed. */
export function yamlScalar(value) {
  const s = String(value);
  if (s === "") return '""';
  if (/^[A-Za-z0-9 _./-]+$/.test(s) && !/^\s|\s$/.test(s)) return s;
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Render an inline array `[a, b, c]`. */
export function yamlInlineArray(items) {
  return `[${items.map((i) => i.trim()).filter(Boolean).join(", ")}]`;
}

/**
 * Set (or append) a single `key: value` line in a raw frontmatter string.
 * `value` must already be rendered (use yamlScalar / yamlInlineArray).
 */
export function setFrontmatterField(rawFm, key, value) {
  const lines = (rawFm || "").split("\n");
  const re = new RegExp(`^\\s*${escapeRe(key)}:\\s*.*$`);
  let found = false;
  const out = lines.map((l) => {
    if (!found && re.test(l)) {
      found = true;
      return `${key}: ${value}`;
    }
    return l;
  });
  if (!found) {
    while (out.length && out[out.length - 1].trim() === "") out.pop();
    out.push(`${key}: ${value}`);
  }
  return out.join("\n");
}

/** Replace the body of a `## name` section, wholesale. Throws if absent. */
export function replaceSection(body, name, newContent) {
  const re = new RegExp(`^##\\s+${escapeRe(name)}[ \\t]*$`, "m");
  const m = body.match(re);
  if (!m) throw new Error(`section \`## ${name}\` not found`);
  const headEnd = m.index + m[0].length;
  const rest = body.slice(headEnd);
  const nextRel = rest.search(/^##\s+/m);
  const head = body.slice(0, headEnd);
  const after = nextRel === -1 ? "" : rest.slice(nextRel);
  const block = `${head}\n\n${newContent.trim()}\n`;
  return after ? `${block}\n${after}` : block;
}

/** Append raw text to the end of a `## name` section. Throws if absent. */
export function appendToSection(body, name, text) {
  const re = new RegExp(`^##\\s+${escapeRe(name)}[ \\t]*$`, "m");
  const m = body.match(re);
  if (!m) throw new Error(`section \`## ${name}\` not found`);
  const headEnd = m.index + m[0].length;
  const rest = body.slice(headEnd);
  const nextRel = rest.search(/^##\s+/m);
  const sectionEnd = nextRel === -1 ? body.length : headEnd + nextRel;
  const before = body.slice(0, sectionEnd).replace(/\s+$/, "");
  const after = body.slice(sectionEnd);
  const block = `${before}\n\n${text.trim()}\n`;
  return after ? `${block}\n${after.replace(/^\s+/, "")}` : block;
}

/** Format a timeline entry from fields. */
export function formatTimelineEntry({ time, kind, summary, source, affects }) {
  const lines = [
    `- time: ${time}`,
    `  kind: ${kind}`,
    `  summary: ${yamlScalar(summary)}`,
  ];
  if (source) lines.push(`  source: ${yamlScalar(source)}`);
  if (affects && affects.length) lines.push(`  affects: [${affects.join(", ")}]`);
  return lines.join("\n");
}

/** Atomic write: write to a sibling temp file, then rename into place. */
export function writeFileAtomic(path, content) {
  const tmp = join(dirname(path), `.${basename(path)}.tmp-${process.pid}`);
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

export function pagePath(id) {
  return join(PAGES_DIR, `${id}.md`);
}

export function rootPagePath(slug) {
  return join(BRAIN_DIR, `${slug}.md`);
}

// ---------------------------------------------------------------------------
// Command implementations (return structured results; the CLI prints/exits)
// ---------------------------------------------------------------------------

/** Rebuild brain/index.md from brain/pages/*.md. Returns { path, count }. */
export function reindexBrain() {
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
    "> Generated automatically by `brain reindex` — do not edit by hand. Re-run it after changing `brain/pages/`.",
    "",
    `Pages: ${pages.length} (active: ${active})`,
    "",
    "| id | title | category | status | tags | updated |",
    "|----|-------|----------|--------|------|---------|",
    rows || "| _(no pages yet)_ | | | | | |",
    "",
  ];

  writeFileAtomic(INDEX_PATH, lines.join("\n"));
  return { path: INDEX_PATH, count: pages.length };
}

/** Check every [[page-id]] resolves. Returns { broken, rootRefs, pageCount, rootCount }. */
export function lintBrainLinks() {
  const pages = listPages();
  const rootPages = listRootPages();
  const pageIds = new Set(pages.map((p) => p.frontmatter.id || p.id));
  const rootSlugs = new Set(ROOT_PAGE_SLUGS);

  const broken = [];
  const rootRefs = [];
  for (const doc of [...pages, ...rootPages]) {
    for (const target of findWikiLinks(doc.body)) {
      if (pageIds.has(target)) continue;
      if (rootSlugs.has(target)) rootRefs.push({ from: doc.path, target });
      else broken.push({ from: doc.path, target });
    }
  }
  return { broken, rootRefs, pageCount: pages.length, rootCount: rootPages.length };
}
