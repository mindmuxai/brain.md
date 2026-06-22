# BRAIN.md — Project Brain protocol entry point

This file is the protocol entry point for the **Open Project Brain Standard**. Any coding agent (Claude Code / Codex / anything else) that reads it should know how to work with this repository's `brain/` directory — no runtime service required, just plain-file conventions plus a few deterministic scripts.

`brain/` is the project's "brain": project knowledge captured as plain Markdown files. You read and write these files directly, then use the scripts under `scripts/` to validate them and rebuild the index.

---

## Your role: both a coding agent and a brain editor

In this repository you wear two hats, and neither can be neglected:

- **Before you change code, read the brain.** Before implementing, refactoring, or debugging, consult the relevant root pages and `brain/pages/` to understand the existing decisions, constraints, and context. `brain/index.md` is the entry point for an overview of all pages.
- **After a change that affects decisions, write back to the brain.** When a change shifts the project's positioning, architecture, technology choices, or roadmap — or establishes or overturns a decision — capture it back in the brain (update a root page, or create / update a page). Pure implementation details, and anything readable straight from the code and git history, do not belong in the brain.

The test: **will this still matter in six months, and is it hard to reconstruct from the code itself?** Yes → write it into the brain; no → leave it in the code and the commit message.

---

## The kinds of brain files

`brain/` holds a few distinct kinds of files. Don't conflate them.

### 1. Root pages (`brain/*.md`) — project-level deliverables (a fixed set of six)

Project-wide, structured, always present:

| slug | file | role | typical content |
|------|------|------|-----------------|
| `background` | `background.md` | project background | why / goals / non-goals / target users |
| `architecture` | `architecture.md` | system architecture | layers, modules, mermaid diagrams |
| `flow` | `flow.md` | key flows | end-to-end path of a typical request, mermaid sequenceDiagram |
| `mindmap` | `mindmap.md` | feature mindmap | main branches from the project root, mermaid mindmap |
| `stack` | `stack.md` | technology choices | domain / candidates / decision / rationale table + open items |
| `roadmap` | `roadmap.md` | milestones | 2–4 week slices, mermaid gantt |

Rules:

- **Fixed in number — only updated, never created.** Edit the corresponding file directly, rewriting the body wholesale.
- **No timeline** — a root page's history is carried by git.
- Lean on ` ```mermaid ` code blocks (graph / sequenceDiagram / mindmap / gantt) to make the content visual.

### 2. Pages (`brain/pages/*.md`) — incremental knowledge

Each page is a durable unit of project knowledge, of exactly one of these five categories: `project` / `concept` / `decision` / `person` / `reference`. There is no limit on the number of pages; create them as needed. For the full category boundaries and structure template, see the **`page-management`** skill.

Each page = **compiled_truth** (a rewritable "current best understanding") + **timeline** (an append-only chain of evidence).

File structure:

```markdown
---
id: <kebab-case-id>          # required, must equal the filename (without .md)
title: <one-line title>      # required
category: decision           # required, one of the five categories
status: active               # required: active / draft / archived
tags: [a, b]                 # optional, inline array
created: "2026-06-22"        # required
updated: "2026-06-22T12:00"  # optional
---

## compiled_truth

<current best understanding, rewritable as a whole>

## timeline

- time: 2026-06-22T12:00
  kind: decision
  summary: <one line describing this entry>
  source: <where the information came from>
  affects: [<page-id>, ...]
```

Rules:

- **The timeline is append-only.** Existing entries are never modified or deleted. When a conclusion is overturned, append an entry with `kind: reversal`.
- **compiled_truth may be rewritten wholesale**, but every rewrite must append a `kind: decision` entry to the timeline recording the reason for the rewrite — this is the easiest step to forget in a pure-file form, and the most important; `validate` back-stops it.
- Always reference other pages with `[[page-id]]`; do not rely on a `refs` field in the frontmatter.
- A page's lifecycle status is a matter of context hygiene: when loading context day-to-day, look only at `status: active` pages; include draft / archived ones only when the user explicitly asks to see them.

### 3. `[[wiki-link]]` mention convention

When you mention a specific brain page in a user-facing reply, prefer the clickable `[[page-id]]` form. This matters most for page search results, page lists, related / suggested pages, and replies that read one page and then point to others. Keep natural-language context alongside it where helpful, e.g. `[[welcome]] — the example page`.

Use `[[page-id]]` only when the identifier truly is the id of a brain page (it appears in `brain/index.md`, in a page's frontmatter, or in trusted page content). **Do not** wrap root-page slugs, file paths, ordinary words, bare titles, or uncertain entities in `[[ ]]`.

### 4. Workspace skills — the AI's operating manual for this repository

Skills are reusable operating manuals scoped to this repository. They are not knowledge deliverables like pages or root pages; they are "how to do it" rulebooks written for the AI.

- Claude Code form: `.claude/skills/<skill-name>/SKILL.md` (a bundle directory that may carry sibling helper docs / scripts).
- Codex / other agents: pick up the same rules through the repository's root `AGENTS.md`.

This repository ships two foundational skills in v0.1:

- **`page-management`** — the page category taxonomy plus the create / update / append protocol. **Read it before creating any page.**
- **`ingest`** — the process for digesting a conversation / document / research result, classifying it, and writing it down as brain content.

---

## Choosing where to write

When you need to capture knowledge, ask yourself first:

- **Does this change the project's overall positioning / architecture / stack / roadmap?** → Update the corresponding root page.
- **Is this about a specific entity (a decision, a concept, a person, a reference)?** → Update or create a page; for the category taxonomy and template see the `page-management` skill (and read it before creating any page).

A single discussion often touches both — e.g. "we decided to use Markdown rather than SQLite" is both a decision page and an update to `stack.md`.

---

## Tool semantics → file-contract translation table

This standard grew out of a tool-call-based brain system. In the pure-file form, those "tools" all reduce to concrete file operations. The table below is the core translation — when performing any of these actions, follow it exactly:

| original tool semantics | pure-file contract action |
|---|---|
| `create_page` | Create `brain/pages/<id>.md` from the template above, with frontmatter + `## compiled_truth` + `## timeline` (including at least one `kind: decision` creation entry), then run `node scripts/reindex.mjs` to rebuild `brain/index.md`. Read the `page-management` skill before creating. |
| `update_compiled_truth` | Edit the file's `## compiled_truth` section directly; **and manually append a `kind: decision` entry to the `## timeline` section** recording the reason for the rewrite. |
| `append_timeline` | Append a new entry at the end of the `## timeline` section. Append-only — never modify or delete an existing entry. |
| `archive_page` | Set the frontmatter `status` to `archived`; if this is a case of an overturned conclusion, also append a `kind: reversal` timeline entry. |
| `set_page_tags` | Edit the frontmatter `tags` array. |
| `update_root_page` | Edit the corresponding `brain/<slug>.md` directly, rewriting the body wholesale (root pages have no timeline). |
| `reindex` / `lint-links` / `validate` | Run the corresponding Node.js script under `scripts/` (see below). |

---

## Deterministic scripts

Three Node.js scripts under `scripts/`, zero npm dependencies, runnable directly with `node`:

- `node scripts/reindex.mjs` — scan `brain/pages/*.md` and rebuild `brain/index.md`. **Run it after creating, deleting, or renaming any page.**
- `node scripts/lint-links.mjs` — verify that every `[[page-id]]` points to an existing page; report broken links.
- `node scripts/validate.mjs` — check the frontmatter schema; and back-stop the case of "compiled_truth changed but no timeline entry was appended" (relies on a git baseline, and skips that check automatically when there are no commits yet).

Before committing, it's good practice to run `reindex → lint-links → validate` in that order.

---

## Language

Reply in the **user's working language**, inferred from the user's messages — not from the UI locale, tool names, or the language of this file. Write the body of timelines, compiled_truth, and root pages in the user's working language; keep technical identifiers (ids, slugs, field names, file paths) verbatim.
