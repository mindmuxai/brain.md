---
name: page-management
description: The brain page category taxonomy and the create/update/append protocol. Read it before creating or modifying any brain/pages/*.md.
---

# page-management

This skill is the rulebook for writing `brain/pages/*.md`. The protocol overview lives in the root `BRAIN.md`; here we expand the category taxonomy and the precise steps for each operation.

## The five page categories

Each page's `category` must be one of:

| category | boundary (what to write) | typical compiled_truth structure |
|---|---|---|
| `project` | The state and intent of a self-contained piece of work / sub-project / module — the part that can't be read straight from the code | goal, scope, current status, key constraints |
| `concept` | A concept / term / mechanism that needs a shared, lasting understanding | definition, why it's this way, boundaries and counter-examples |
| `decision` | An established judgment and its reasoning (the most common) | what was decided, alternatives, rationale, blast radius |
| `person` | A relevant person / role, their preferences and responsibilities | who they are, what they care about, collaboration conventions |
| `reference` | An external resource / object of analysis worth keeping | what it is, key takeaways, links, implications for this project |

When in doubt, most knowledge lands in `decision` or `concept`.

## Page id conventions

- Use kebab-case for `id`, semantically clear, e.g. `markdown-over-sqlite`, `auth-flow`.
- The `id` must **equal the filename** (`brain/pages/<id>.md`, without the extension).
- Once an id is referenced via `[[ ]]` it should stay stable; if you genuinely must rename it, update every reference at the same time and re-run `lint-links`.

## Create a page (`create_page`)

1. Pick a `category` and a stable kebab-case `id`.
2. Write `brain/pages/<id>.md` from the template:
   ```markdown
   ---
   id: <id>
   title: <one-line title>
   category: <one of the five categories>
   status: active
   tags: [..]
   created: "YYYY-MM-DD"
   updated: "YYYY-MM-DDTHH:MM"
   ---

   ## compiled_truth

   <current best understanding>

   ## timeline

   - time: YYYY-MM-DDTHH:MM
     kind: decision
     summary: Created this page: <reason>
     source: <source>
     affects: [<id>]
   ```
3. Run `node scripts/reindex.mjs` to rebuild `brain/index.md`.
4. Run `node scripts/lint-links.mjs` and `node scripts/validate.mjs` as appropriate.

## Rewrite compiled_truth (`update_compiled_truth`)

- Edit the `## compiled_truth` section directly, rewriting it wholesale into the new best understanding.
- You **must** append a `kind: decision` entry to the `## timeline` section, with a summary describing what this rewrite changed and why.
- Update the frontmatter `updated`.
- This is the easiest step to forget in a pure-file form — `validate` reports an error when "compiled_truth changed but the timeline did not grow".

## Append to the timeline (`append_timeline`)

- Append new entries only at the **end** of the `## timeline` section.
- Append-only: existing entries are never modified, deleted, or reordered.
- `kind` conventions: `decision` (an established judgment) / `evidence` (new evidence / observation) / `reversal` (overturning a prior conclusion) / `note` (supplementary remark).

## Archive a page (`archive_page`)

- Set the frontmatter `status` to `archived`.
- If it's a case of an overturned conclusion, append a `kind: reversal` entry explaining why.
- Re-run `reindex`.

## Change tags (`set_page_tags`)

- Edit only the frontmatter `tags` inline array, then re-run `reindex`.

## Cross-page references

- Always use `[[page-id]]` (the bare id, without brackets, is used for scripts / filenames).
- After adding a reference, run `lint-links` to confirm there are no broken links.
