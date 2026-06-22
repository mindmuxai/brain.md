---
name: ingest
description: The process for digesting a conversation, document, or research result, classifying it, and writing it down as brain content (a root-page update or a new/updated page).
---

# ingest

This skill is about "turning scattered input into structured brain knowledge". The input can be a conclusion from a conversation, an external document, a piece of research, or the decisions behind a set of code changes. The goal is to land that knowledge in the **right place, the right category, and the right structure**.

## Process

### 1. Break down the input

Split the input into individual **atomic knowledge points**. A knowledge point = one judgment / fact / decision that stands on its own. Ignore purely procedural chatter.

### 2. Place each knowledge point (see "Choosing where to write" in `BRAIN.md`)

- Changes the project's overall positioning / architecture / stack / roadmap → **update the corresponding root page** (`background` / `architecture` / `flow` / `mindmap` / `stack` / `roadmap`).
- About a specific entity (a decision / concept / person / reference / sub-project) → **create or update a page**.
- It's common for one knowledge point to touch both — write to both sides.

### 3. Decide between "create" and "update existing"

- First check `brain/index.md` and `brain/pages/` for an existing page on the same topic.
- Found → take the update path (`update_compiled_truth` + append to the timeline).
- Not found → take the create path (read the `page-management` skill first, then `create_page`).
- **Avoid duplication**: don't scatter one topic across multiple pages.

### 4. Write

- Create / update / append pages strictly per the `page-management` skill.
- Rewrite root pages wholesale; they have no timeline.
- Write the body in the user's working language; keep technical identifiers verbatim.
- Connect related pages explicitly with `[[page-id]]`.

### 5. Validate

After writing, run in order:

```
node scripts/reindex.mjs
node scripts/lint-links.mjs
node scripts/validate.mjs
```

Confirm: the index is updated, there are no broken links, the schema has no errors, and there's no "compiled_truth changed but the timeline entry was forgotten".

## Principles

- **Prefer less but accurate.** Only capture knowledge that still matters in six months and is hard to reconstruct from the code / git.
- **Leave a timeline trace for every compiled_truth rewrite** — this is what keeps the chain of evidence unbroken.
- **Keep the category boundaries clear** — the taxonomy lives in the `page-management` skill.
