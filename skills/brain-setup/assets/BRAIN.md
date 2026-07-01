# BRAIN.md — Project Brain protocol entry point

The brain is the project's knowledge, captured as plain Markdown. **Both reads and writes go through the `brain` CLI:**

- **Read = `brain` read subcommands** (`brain-dir` / `list-pages` / `read-page <id>` / `read-root <slug>`). They are location-independent — you do not need to know where the brain directory lives.
- **Write = `brain` write subcommands.** Every mutation is correct-by-construction, so frontmatter is never mis-shaped and the most fragile failure mode — rewriting a page's understanding without leaving a timeline trace — is structurally impossible.

> **NEVER hand-edit any file under the brain directory. All reads and writes MUST go through the `brain` CLI. Manual edits are unsupported and illegitimate.** Correctness is guaranteed by construction inside the CLI; there is no validator and nothing at the file layer can stop a bad manual edit, so a hand edit silently breaks the brain's invariants (mis-shaped frontmatter, a compiled_truth rewrite with no timeline trace). If you find yourself opening a brain file in an editor, stop and use a `brain` subcommand instead.

This file is the **single source of truth for the full read + write contract**, covering both pages and root pages. Read it once and you know everything about reading from and writing to the brain.

---

## The brain is the project's persistent memory — use it actively

The brain is not a passive archive you touch only when told. It is **this project's persistent memory**, and using it is part of every task — across **both discussion and code**. Whenever you talk through a requirement or design with the user, or implement, refactor, or debug, the brain is in the loop: you read from it to recall what was already decided, and you write to it the moment something durable emerges. Treat it the way an agent with a built-in memory would — proactively, not on request.

The working rhythm:

- **At the start — load the brain.** When you pick up a task or a requirement lands, first read the brain: `brain list-pages` for the index, then `brain read-page <id>` / `brain read-root <slug>` to pull in the relevant existing decisions, constraints, and context. Don't design or code against a blank slate when the brain already holds the answer.
- **In flight — capture as it surfaces, immediately.** The moment a decision, requirement, constraint, or durable insight appears — in conversation or in code — write it back through the `brain` CLI right then (a `decision` page, or a root-page update for positioning / architecture / stack / roadmap). Proactively and immediately; don't batch it to "later" and don't wait to be asked.
- **When you overturn a past conclusion** — append a `kind: reversal` entry to the relevant page's timeline (via `brain append-timeline`, or `brain archive-page --reversal-summary` when retiring the page), so the chain of evidence shows the change of mind.

The test for what is worth keeping: **will this still matter in six months, and is it hard to reconstruct from the code itself?** Yes → write it into the brain; no → leave it in the code and the commit message. Pure implementation details, and anything readable straight from the code and git history, do not belong in the brain.

And the access rule is constant: **read = the `brain` read subcommands, write = the `brain` write subcommands, never hand-edit a brain file.**

> Note: Claude Code and Codex have no per-turn system prompt the way a memory-native runtime does, so "use the brain proactively" is enforced only by always-present instruction files like this one and the wired agent-config block — a prompt-level *soft* constraint, in the same family as "never hand-edit a brain file". A harder, hook-based mechanism is deferred to v0.2.

---

## The `brain` CLI — how to invoke

All reads and writes go through one zero-dependency Node (ESM) CLI shipped in the **brain-page** skill bundle at `bin/brain.mjs`:

```
node <brain-page-skill-bundle>/bin/brain.mjs <subcommand> [flags]
```

Resolve `<brain-page-skill-bundle>` to wherever the brain-page skill is installed (globally, e.g. `~/.claude/skills/brain-page/`; or, in the brain.md source repo, `skills/brain-page/`). Run all commands from the **project root**. Run `... bin/brain.mjs help` for the full flag reference.

**Where the brain lives.** The CLI resolves the brain directory itself, so every command is location-independent:

1. If `./.mindmux/preferences.json` exists and has a `brainRoot` field, that path is the brain root (it contains `pages/` and the six root pages). It may be absolute (e.g. a MindMux-managed sidecar like `/Users/me/Work/myproject-brain`) or relative to the project root.
2. Otherwise the brain is `./brain`.

A missing file, broken JSON, or absent `brainRoot` all fall back silently to `./brain`. Run `brain brain-dir` to see the resolved directory, which rule produced it (`source:`), and whether that location already exists and is `populated:`. There is **exactly one brain, at the resolved location** — tools never create a second local `./brain` when `brainRoot` redirects elsewhere.

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

- **Fixed in number — only updated, never created.** Rewrite one with `brain update-root <slug>` (body on stdin). The CLI regenerates the frontmatter and guarantees the canonical H1 heading.
- **No timeline** — a root page's history is carried by git.
- **Read** a root page with `brain read-root <slug>`.
- Lean on ` ```mermaid ` code blocks (graph / sequenceDiagram / mindmap / gantt) to make the content visual.

### 2. Pages (`brain/pages/*.md`) — incremental knowledge

Each page is a durable unit of project knowledge, of exactly one of five categories: `project` / `concept` / `decision` / `person` / `reference`. There is no limit on the number of pages; create them as needed. For the full category boundaries see the **brain-page** skill.

Each page = **compiled_truth** (a rewritable "current best understanding") + **timeline** (an append-only chain of evidence).

File structure:

```markdown
---
id: <kebab-case-id>          # required, must equal the filename (without .md)
title: <one-line title>      # required
category: decision           # required, one of the five categories
status: active               # required: active / draft / archived
tags: [a, b]                 # optional, inline array
created: "2026-06-22T12:00:00"  # required
updated: "2026-06-22T12:00:00"  # maintained by the CLI
---

## compiled_truth

<current best understanding, rewritable as a whole>

## timeline

- time: 2026-06-22T12:00:00
  kind: decision
  summary: <one line describing this entry>
  source: <where the information came from>
  affects: [<page-id>, ...]
```

Rules:

- **Read** a page with `brain read-page <id>`; list all pages with `brain list-pages`.
- **The timeline is append-only.** Existing entries are never modified or deleted. When a conclusion is overturned, append an entry with `kind: reversal`.
- **compiled_truth may be rewritten wholesale**, but every rewrite must append a `kind: decision` entry to the timeline recording why. `brain update-truth` does both in a single atomic write, so you cannot do one without the other.
- Always reference other pages with `[[page-id]]`; do not rely on a `refs` frontmatter field.
- Lifecycle status is context hygiene: day-to-day, look only at `status: active` pages; include draft / archived ones only when explicitly asked.

### 3. `[[wiki-link]]` mention convention

When you mention a specific brain page in a user-facing reply, prefer the clickable `[[page-id]]` form. This matters most for page search results, page lists, related / suggested pages, and replies that read one page and point to others. Keep natural-language context alongside it, e.g. `[[welcome]] — the example page`.

Use `[[page-id]]` only when the identifier truly is the id of a brain page (it appears in `brain/index.md`, in a page's frontmatter, or in trusted page content). **Do not** wrap root-page slugs, file paths, ordinary words, bare titles, or uncertain entities in `[[ ]]`.

### 4. Workspace skills — the AI's operating manuals

Skills are reusable operating manuals for working with `brain/`. They are not knowledge deliverables; they are "how to do it" rulebooks for the AI, installed into each agent's global skills directory (so Claude Code, Codex, and others share them). This standard ships four:

- **brain-setup** — ensure `BRAIN.md` is in the project root; resolve the brain data location with `brain brain-dir` (brainRoot-aware) and scaffold the `brain/` skeleton there only if that location is empty — never a second local `./brain` when `brainRoot` redirects to an external directory. Then wire the chosen agents' config files via `brain wire` (see below), and optionally install a pre-commit hook.
- **brain-bootstrap** — seed a freshly-scaffolded brain with real project knowledge: on an existing project, read the code / docs / `git log` to draft the six root pages and capture key decisions; on an empty project, interview the user. All writes go through the `brain` CLI. Run it after **brain-setup**.
- **brain-page** — the operating manual for reading and writing pages + root pages; this is the bundle that carries the `brain` CLI. **Read it before creating or modifying any page.**
- **brain-ingest** — the process for digesting a conversation / document / research result and writing it down through the `brain` CLI.

---

## Choosing where to write

When you need to capture knowledge, ask first:

- **Does this change the project's overall positioning / architecture / stack / roadmap?** → Rewrite the corresponding root page (`brain update-root <slug>`).
- **Is this about a specific entity (a decision, concept, person, reference)?** → Create or update a page; for the taxonomy see the **brain-page** skill.

A single discussion often touches both — e.g. "we decided to use Markdown rather than SQLite" is both a decision page and an update to `stack.md`.

---

## Read + write contract (the translation table)

This standard grew out of a tool-call-based brain system. Here, **every read and write is a `brain` CLI subcommand**. The table below is the complete mapping — follow it exactly.

| original tool semantics | brain.md contract action |
|---|---|
| read a page | `brain read-page <id>` — prints the page. |
| read a root page | `brain read-root <slug>` — prints the root page. |
| list pages | `brain list-pages` — id / title / category / status for every page. |
| locate the brain | `brain brain-dir` — prints the resolved brain directory and its source. |
| `create_page` | `brain create-page --id <id> --category <cat> --title "<t>" [--tags a,b] [--status] [--source]` — writes the page from the template (frontmatter + compiled_truth + a seed `kind: decision` timeline entry) and reindexes. Read the **brain-page** skill before creating. |
| `update_compiled_truth` | `brain update-truth --id <id>` with the new compiled_truth on **stdin** — rewrites compiled_truth **and atomically appends a `kind: decision` timeline entry** + bumps `updated`. |
| `append_timeline` | `brain append-timeline --id <id> --kind <k> --summary "<s>" [--source] [--affects]` — appends at the end of the timeline only (append-only). |
| `archive_page` | `brain archive-page --id <id> [--reversal-summary "<s>"]` — sets `status: archived`, optionally appends a `kind: reversal` entry, reindexes. |
| `set_page_tags` | `brain set-tags --id <id> --tags a,b,c` — rewrites the frontmatter tags, reindexes. |
| `update_root_page` | `brain update-root <slug>` with the body on **stdin** — rewrites `brain/<slug>.md` wholesale, regenerates frontmatter, guarantees the canonical H1; root pages have no timeline. |
| `reindex` / `lint-links` | `brain reindex` / `brain lint-links`. `lint-links` checks Page `compiled_truth` and root page bodies as current knowledge; Page timeline entries are append-only provenance and are not linted. |
| wire an agent's config | `brain wire --agent <claude-code\|codex\|opencode>` — writes the unified brain block into `./CLAUDE.md` / `./AGENTS.md` (see below). |

---

## Wiring agent-config files — `brain wire`

So that a coding agent picks up this contract automatically, the project's agent-config files point at `BRAIN.md`. This is done **deterministically by the CLI**, never by hand:

```
brain wire --agent <claude-code|codex|opencode>      # repeatable, or comma-separated: --agent claude-code,codex,opencode
```

- `claude-code → ./CLAUDE.md`, `codex / opencode → ./AGENTS.md` (written in the project root).
- It writes one **unified, neutral, self-contained brain block**, wrapped in `<!-- BEGIN brain.md -->` … `<!-- END brain.md -->`: it frames `brain/` as the project's memory layer, tells the agent to read `./BRAIN.md` (this contract), gives the active-memory triggers (load brain context before any task or discussion; capture decisions / requirements / insights through the CLI the moment they surface), states the core rule (all reads/writes go through the `brain` CLI; never hand-edit a brain file), and notes the four brain skills are installed globally.
- Both files get the **same** block body. The only difference: `CLAUDE.md` also carries an `@import ./BRAIN.md` line. **`@import` is Claude Code-specific** — Codex and OpenCode (which read `AGENTS.md`) do not understand it, so `AGENTS.md` relies on the plain "read `./BRAIN.md`" instruction instead.
- **Idempotent** via the markers: no file → created; file without markers → block appended; existing marked block → replaced in place (re-running upgrades, never duplicates).

---

## Why there is no validator — correctness by construction

There is deliberately **no `validate` command**. Because every write goes through the CLI, the two things a validator used to guard are now structurally impossible: frontmatter is always CLI-generated so it can't be mis-shaped, and `update-truth` rewrites compiled_truth and appends its timeline entry in one atomic write, so a "changed understanding with no trace" can never occur. The guarantee comes from *only ever using the CLI*.

That is also why the guardrail above is absolute: **never hand-edit a brain file.** Nothing at the file layer can stop a manual edit, and there is no validator to catch one afterwards — a hand edit silently breaks invariants that the rest of the system trusts. `brain reindex` (rebuilds `index.md`) and `brain lint-links` (checks every `[[page-id]]` resolves) remain as optional hygiene, and `brain-setup` can install a pre-commit hook that runs them; neither is load-bearing.

---

## Language

Reply in the **user's working language**, inferred from the user's messages — not from the UI locale, tool names, or the language of this file. Write the body of timelines, compiled_truth, and root pages in the user's working language; keep technical identifiers (ids, slugs, field names, file paths) verbatim.
