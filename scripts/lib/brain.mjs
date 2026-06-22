// Shared helpers for the brain.md deterministic scripts.
// Zero npm dependencies — only Node.js built-ins. The frontmatter parser is a
// deliberately tiny YAML subset, just enough for brain page / root page headers.

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, basename } from "node:path";

export const ROOT = process.cwd();
export const BRAIN_DIR = join(ROOT, "brain");
export const PAGES_DIR = join(BRAIN_DIR, "pages");

/** The six fixed root pages. */
export const ROOT_PAGE_SLUGS = [
  "background",
  "architecture",
  "flow",
  "mindmap",
  "stack",
  "roadmap",
];

/** The five page categories. */
export const PAGE_CATEGORIES = ["project", "concept", "decision", "person", "reference"];

/** Allowed page lifecycle statuses. */
export const PAGE_STATUSES = ["active", "draft", "archived"];

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
  const re = new RegExp(`^##\\s+${name}\\s*$`, "m");
  const m = body.match(re);
  if (!m) return null;
  const start = m.index + m[0].length;
  const rest = body.slice(start);
  const next = rest.search(/^##\s+/m);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
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
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`\n]*`/g, "");
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
