---
name: brain-ingest
description: The process for digesting a conversation, document, or research result, classifying it, and writing it down as brain content (a root-page update or a new/updated page) through the `brain` CLI.
---

# brain-ingest

This skill is about "turning scattered input into structured brain knowledge". The input can be a conclusion from a conversation, an external document, a piece of research, or the decisions behind a set of code changes. The goal is to land that knowledge in the **right place, the right category, and the right structure** — and to write it through the `brain` CLI so it is correct by construction.

Reach for this process not only when explicitly asked to "ingest" something. The brain is the project's persistent memory (see `BRAIN.md`), so **trigger it proactively whenever knowledge crystallizes** — a decision settled in discussion, a requirement or constraint agreed, an insight that will still matter in six months. Capture it as it surfaces rather than waiting to be told.

Every read and write below is a `brain` CLI subcommand (`list-pages` / `read-page` / `read-root` to read; `create-page` / `update-truth` / … to write). The command details and the category taxonomy live in the **brain-page** skill — read it before creating or modifying any page.

> **NEVER hand-edit any file under the brain directory. All reads and writes MUST go through the `brain` CLI. Manual edits are unsupported and illegitimate.** There is no validator and nothing at the file layer can catch a bad manual edit; correctness is guaranteed only by going through the CLI, so a hand edit silently breaks the brain's invariants.

## Process

### 1. Break down the input

Split the input into individual **atomic knowledge points**. A knowledge point = one judgment / fact / decision that stands on its own. Ignore purely procedural chatter.

### 2. Place each knowledge point (see "Choosing where to write" in `BRAIN.md`)

- Changes the project's overall positioning / architecture / stack / roadmap → **rewrite the corresponding root page** with `brain update-root <slug>` (`background` / `architecture` / `flow` / `mindmap` / `stack` / `roadmap`).
- About a specific entity (a decision / concept / person / reference / sub-project) → **create or update a page**.
- It's common for one knowledge point to touch both — write to both sides.

### 3. Decide between "create" and "update existing"

- First run `brain list-pages` (and `brain read-page <id>` on likely hits) to look for an existing page on the same topic.
- Found → update it: `brain update-truth --id <id>` (rewrites compiled_truth and appends a timeline entry atomically), or `brain append-timeline` for a new piece of evidence that doesn't change the conclusion.
- Not found → create it: read the **brain-page** skill, then `brain create-page`, then fill in the real understanding with `brain update-truth`.
- **Avoid duplication**: don't scatter one topic across multiple pages.

### 4. Write

- All writes go through the `brain` CLI — see **brain-page** for exact commands. Never hand-edit frontmatter or timelines.
- Root pages are rewritten wholesale via `update-root`; they have no timeline.
- Write the body in the user's working language; keep technical identifiers (ids, slugs, field names, paths) verbatim.
- Connect related pages explicitly with `[[page-id]]`.

### 5. Verify

The write commands reindex for you, and correctness is guaranteed by construction — there is no validator to run. To optionally confirm that every `[[page-id]]` resolves:

```
node <brain-page-bundle>/bin/brain.mjs lint-links
```

The CLI makes "compiled_truth changed but the timeline entry was forgotten" structurally impossible; the only way to break it is a hand edit, which is why you must never make one.

## Principles

- **Prefer less but accurate.** Only capture knowledge that still matters in six months and is hard to reconstruct from the code / git.
- **Every compiled_truth rewrite carries its own timeline trace** — `update-truth` guarantees this, keeping the chain of evidence unbroken.
- **Keep the category boundaries clear** — the taxonomy lives in the **brain-page** skill.
