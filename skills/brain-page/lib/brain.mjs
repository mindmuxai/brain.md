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

function markerRanges(body, re, after = 0) {
  re.lastIndex = 0;
  const ranges = [];
  for (let m = re.exec(body); m; m = re.exec(body)) {
    if (m.index < after) continue;
    ranges.push({
      headingStart: m.index,
      headingEnd: m.index + m[0].length,
      raw: m[0],
    });
  }
  return ranges;
}

function markerRange(body, re, after = 0) {
  const ranges = markerRanges(body, re, after);
  return ranges.length ? ranges[ranges.length - 1] : null;
}

function firstMarkerRange(body, re) {
  re.lastIndex = 0;
  const m = re.exec(body);
  if (!m) return null;
  return {
    headingStart: m.index,
    headingEnd: m.index + m[0].length,
    raw: m[0],
  };
}

function compiledTruthMarkerRange(body) {
  return firstMarkerRange(body, /^<!--\s*compiled_truth\s*-->\s*$/gm)
    ?? firstMarkerRange(body, /^##\s+compiled_truth[ \t]*$/gm);
}

function timelineMarkerRange(body, after = 0) {
  const candidates = [
    ...markerRanges(body, /^##\s+(?:Timeline|timeline)[ \t]*$/gm, after),
    ...markerRanges(body, /^<!--\s*timeline\s*-->\s*$/gm, after),
  ].sort((a, b) => a.headingStart - b.headingStart);
  if (candidates.length === 0) return null;

  // During the short-lived comment-marker format, compiled_truth could still
  // contain ordinary `## Timeline` headings. The real storage marker is the
  // last plausible marker before the append-only entries, while stray marker
  // examples after existing entries should be ignored.
  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    const candidate = candidates[i];
    const nextCandidate = candidates[i + 1] ?? null;
    const contentEnd = nextCandidate ? nextCandidate.headingStart : body.length;
    if (/^-\s+time:\s+\S/m.test(body.slice(candidate.headingEnd, contentEnd))) {
      return candidate;
    }
  }
  return candidates[candidates.length - 1];
}

function sectionRange(body, name) {
  let marker = null;
  if (name === "compiled_truth") {
    marker = compiledTruthMarkerRange(body);
  } else if (name === "timeline") {
    marker = timelineMarkerRange(body);
  } else {
    marker = firstMarkerRange(body, new RegExp(`^##\\s+${escapeRe(name)}[ \\t]*$`, "gm"));
  }
  if (!marker) return null;
  const start = marker.headingEnd;

  if (name === "compiled_truth") {
    const timeline = timelineMarkerRange(body, start);
    return {
      headingStart: marker.headingStart,
      headingEnd: start,
      contentStart: start,
      contentEnd: timeline ? timeline.headingStart : body.length,
    };
  }

  if (name === "timeline") {
    return {
      headingStart: marker.headingStart,
      headingEnd: start,
      contentStart: start,
      contentEnd: body.length,
    };
  }

  const rest = body.slice(start);
  const next = rest.search(/^##\s+/m);
  return {
    headingStart: marker.headingStart,
    headingEnd: start,
    contentStart: start,
    contentEnd: next === -1 ? body.length : start + next,
  };
}

/**
 * Extract a named page section body. For brain pages, `compiled_truth` starts
 * at `<!-- compiled_truth -->` (legacy `## compiled_truth` is still readable)
 * and spans until the visible `## Timeline` marker (legacy `## timeline` and
 * interim `<!-- timeline -->` are still readable), so nested `##` headings
 * remain part of the truth body instead of being mistaken for section
 * boundaries.
 */
export function extractSection(body, name) {
  const range = sectionRange(body, name);
  if (!range) return null;
  return body.slice(range.contentStart, range.contentEnd).trim();
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
  return ROOT_PAGE_SLUGS.map((slug) => `${slug}.md`)
    .filter((f) => existsSync(join(BRAIN_DIR, f)))
    .filter((f) => statSync(join(BRAIN_DIR, f)).isFile())
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
  return text.replace(/```[\s\S]*?```/g, "").replace(/`+[^`\n]*`+/g, "");
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

/** `YYYY-MM-DDTHH:MM:SS` local-time stamp for timeline entries / `updated`. */
export function nowStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
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

function canonicalSectionMarker(name, raw) {
  if (name === "compiled_truth") return "<!-- compiled_truth -->";
  if (name === "timeline") return "## Timeline";
  return raw;
}

function replaceRange(text, start, end, replacement) {
  return `${text.slice(0, start)}${replacement}${text.slice(end)}`;
}

function normalizePageSectionMarkers(body) {
  let out = body;
  const compiled = compiledTruthMarkerRange(out);
  if (compiled) {
    out = replaceRange(out, compiled.headingStart, compiled.headingEnd, "<!-- compiled_truth -->");
  }
  const afterCompiled = compiled ? compiled.headingStart + "<!-- compiled_truth -->".length : 0;
  const timeline = timelineMarkerRange(out, afterCompiled);
  if (timeline) {
    out = replaceRange(out, timeline.headingStart, timeline.headingEnd, "## Timeline");
  }
  return out;
}

/** Replace the body of a named section, wholesale. Throws if absent. */
export function replaceSection(body, name, newContent) {
  const range = sectionRange(body, name);
  if (!range) throw new Error(`section \`${name}\` not found`);
  const before = [
    body.slice(0, range.headingStart),
    canonicalSectionMarker(name, body.slice(range.headingStart, range.headingEnd)),
  ].join("");
  const after = body.slice(range.contentEnd).replace(/^\s+/, "");
  const block = `${before}\n\n${newContent.trim()}\n`;
  return normalizePageSectionMarkers(after ? `${block}\n\n${after}` : block);
}

/** Append raw text to the end of a named section. Throws if absent. */
export function appendToSection(body, name, text) {
  const range = sectionRange(body, name);
  if (!range) throw new Error(`section \`${name}\` not found`);
  const sectionContent = name === "timeline"
    ? body.slice(range.headingEnd, range.contentEnd).replace(/\n+<!--\s*timeline\s*-->\s*$/m, "")
    : body.slice(range.headingEnd, range.contentEnd);
  const before = [
    body.slice(0, range.headingStart),
    canonicalSectionMarker(name, body.slice(range.headingStart, range.headingEnd)),
    sectionContent,
  ].join("").replace(/\s+$/, "");
  const after = body.slice(range.contentEnd);
  const block = `${before}\n\n${text.trim()}\n`;
  return normalizePageSectionMarkers(after ? `${block}\n${after.replace(/^\s+/, "")}` : block);
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
  const entries = pages
    .map((p) => {
      const fm = p.frontmatter;
      const id = fm.id || p.id;
      const title = fm.title || "(untitled)";
      const category = fm.category || "?";
      const status = fm.status || "?";
      const tags = Array.isArray(fm.tags) ? fm.tags.join(", ") : fm.tags || "";
      const summary = firstSentence(extractSection(p.body, "compiled_truth")) || title;
      const meta = [`category: ${category}`];
      if (status !== "active") meta.push(`status: ${status}`);
      if (tags) meta.push(`tags: [${tags}]`);
      return `- [${id}](pages/${id}.md) — ${meta.join(" | ")} | ${summary}`;
    })
    .join("\n");

  const lines = [
    "# Brain Index",
    "",
    `_Auto-generated. Last updated ${new Date().toISOString()}._`,
    "",
    entries || "_(no Pages yet)_",
    "",
  ];

  writeFileAtomic(INDEX_PATH, lines.join("\n"));
  return { path: INDEX_PATH, count: pages.length };
}

function firstSentence(text) {
  if (!text) return "";
  const trimmed = text.trim();
  if (!trimmed) return "";
  const limit = Math.min(trimmed.length, 140);
  let end = limit;
  for (let i = 0; i < limit; i += 1) {
    const ch = trimmed[i];
    if (ch === "\n" || ch === "。") {
      end = i + 1;
      break;
    }
    if (ch === "." && !isWordChar(trimmed[i - 1]) && !isWordChar(trimmed[i + 1])) {
      end = i + 1;
      break;
    }
  }
  const raw = trimmed.slice(0, end);
  return raw.replace(/\n/g, " ").trim();
}

function isWordChar(ch) {
  return typeof ch === "string" && /[A-Za-z0-9_-]/.test(ch);
}

/** Check every [[page-id]] resolves. Returns { broken, rootRefs, pageCount, rootCount }. */
export function lintBrainLinks() {
  const pages = listPages();
  const rootPages = listRootPages();
  const pageIds = new Set(pages.map((p) => p.frontmatter.id || p.id));
  const rootSlugs = new Set(ROOT_PAGE_SLUGS);

  const broken = [];
  const rootRefs = [];
  // Pages lint only the current compiled_truth. Timeline is append-only
  // provenance: summaries may include historical syntax examples or obsolete
  // references that should not make the current knowledge graph fail lint.
  for (const doc of pages) {
    const truth = extractSection(doc.body, "compiled_truth") || "";
    for (const target of findWikiLinks(truth)) {
      if (pageIds.has(target)) continue;
      if (rootSlugs.has(target)) rootRefs.push({ from: doc.path, target });
      else broken.push({ from: doc.path, target });
    }
  }
  for (const doc of rootPages) {
    for (const target of findWikiLinks(doc.body)) {
      if (pageIds.has(target)) continue;
      if (rootSlugs.has(target)) rootRefs.push({ from: doc.path, target });
      else broken.push({ from: doc.path, target });
    }
  }
  return { broken, rootRefs, pageCount: pages.length, rootCount: rootPages.length };
}
