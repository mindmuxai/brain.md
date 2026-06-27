---
name: brain-page
description: Operating manual for reading and writing a project's brain — every read and write goes through the bundled zero-dependency `brain` CLI; never hand-edit brain files. Read it before creating or modifying any page or root page.
---

# brain-page

This skill is the operating manual for working with a project's brain under the **Open Project Brain Standard**. The protocol overview lives in the project's root `BRAIN.md`; here we expand the category taxonomy and the exact command for every operation.

The model is simple: **everything goes through the `brain` CLI.**

- **Read = `brain` read subcommands** (`brain-dir` / `list-pages` / `read-page <id>` / `read-root <slug>`) — location-independent, no need to know where the brain lives.
- **Write = `brain` write subcommands.** Every mutation (create / update / append / archive / tag / root-page rewrite / reindex) is correct-by-construction, so frontmatter can never be mis-shaped and a compiled_truth rewrite can never silently skip its timeline entry.

> **NEVER hand-edit any file under the brain directory. All reads and writes MUST go through the `brain` CLI. Manual edits are unsupported and illegitimate.** Correctness is guaranteed by construction inside the CLI — there is no validator, and nothing at the file layer can catch or undo a bad manual edit, so a hand edit silently breaks the brain's invariants. Always reach for a `brain` subcommand instead of an editor.

## Invoking the CLI

The CLI ships inside this skill bundle at `bin/brain.mjs`. It is zero-dependency Node (ESM) — run it directly:

```
node <this-skill-bundle>/bin/brain.mjs <subcommand> [flags]
```

Resolve `<this-skill-bundle>` to the directory this `SKILL.md` lives in. In the brain.md source repository itself that path is `skills/brain-page/bin/brain.mjs`; when the skill is installed globally it is wherever `setup` linked it (e.g. `~/.claude/skills/brain-page/bin/brain.mjs`). Run all commands from the **project root**.

The CLI resolves the brain directory itself: it reads `brainRoot` from `./.mindmux/preferences.json` when present (absolute or relative to the project root), otherwise falls back to `./brain`. A missing file, broken JSON, or absent field all fall back silently. Run `brain brain-dir` to see the resolved directory and its source.

Run `node <bundle>/bin/brain.mjs help` for the full flag reference.

## Read operations

Define a shell function (do **not** use `BRAIN="node <bundle>/bin/brain.mjs"; $BRAIN …` — `VAR="node x"; $VAR` only word-splits in bash; zsh, macOS's default shell, treats `node /…/brain.mjs` as a single command name and fails with `exit 127`. A function is portable across bash and zsh, so keep this form):

```
brain() { node <bundle>/bin/brain.mjs "$@"; }
brain brain-dir       # print the resolved brain directory + its source (brainRoot / default)
brain list-pages      # list every page: id / title / category / status
brain read-page <id>  # print brain/pages/<id>.md
brain read-root <slug> # print a root page brain/<slug>.md
```

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
- The `id` must **equal the filename** (`brain/pages/<id>.md`, without the extension). The CLI enforces this.
- Once an id is referenced via `[[ ]]` it should stay stable; renaming means updating every reference and re-running `lint-links`.

## Write operations (every one is a CLI subcommand)

Assume the `brain` shell function defined above (`brain() { node <bundle>/bin/brain.mjs "$@"; }`) and that you are in the project root.

### Create a page

```
brain create-page --id <kebab-id> --category <category> --title "<one-line title>" \
  [--tags a,b] [--status active] [--source "<where this came from>"]
```

Generates `brain/pages/<id>.md` from the template (frontmatter + `## compiled_truth` + a `## timeline` seeded with one `kind: decision` creation entry), then reindexes. Fill in the real compiled_truth afterwards via `update-truth`.

### Rewrite compiled_truth (atomic with its timeline entry)

```
echo "<new compiled_truth markdown>" | brain update-truth --id <id> \
  --summary "<what changed and why>" [--source "<source>"]
```

Reads the new compiled_truth from **stdin**, rewrites the `## compiled_truth` section, and **in the same atomic write** appends a `kind: decision` entry to the timeline and bumps `updated`. Changing the understanding and recording why are inseparable — you cannot do one without the other.

### Append a timeline entry (append-only)

```
brain append-timeline --id <id> --kind <decision|evidence|reversal|note> \
  --summary "<one line>" [--source "<source>"] [--affects a,b]
```

Appends to the **end** of the timeline only; existing entries are never touched.

### Archive a page

```
brain archive-page --id <id> [--reversal-summary "<why it was overturned>"]
```

Sets `status: archived`, optionally appends a `kind: reversal` entry, then reindexes.

### Change tags

```
brain set-tags --id <id> --tags a,b,c
```

### Rewrite a root page

```
echo "<root page body markdown>" | brain update-root <slug>
```

`<slug>` must be one of the six fixed root pages: `background` / `architecture` / `flow` / `mindmap` / `stack` / `roadmap`. The CLI validates the slug, rewrites the whole `brain/<slug>.md`, regenerates the frontmatter, and **guarantees the canonical H1 heading** is present. Root pages have **no timeline** — their history lives in git. Lean on ` ```mermaid ` blocks (graph / sequenceDiagram / mindmap / gantt) to keep them visual.

### Index / checks

```
brain reindex              # rebuild brain/index.md (also run automatically by the write commands above)
brain lint-links           # verify current [[page-id]] links resolve
```

`lint-links` treats Page `compiled_truth` as the current knowledge graph and root page bodies as current root knowledge. It intentionally does not lint Page timeline entries, because timeline is append-only provenance and may contain historical syntax examples or obsolete references.

## Why there is no validator

There is deliberately no `validate` command. Because every write goes through this CLI, the failure modes a validator used to guard are structurally impossible: frontmatter is always CLI-generated, and `update-truth` rewrites compiled_truth and appends its timeline entry in one atomic write. The guarantee holds **only as long as you never hand-edit a brain file** — there is nothing to catch a manual edit afterwards. `reindex` and `lint-links` remain as optional hygiene, not load-bearing gates.

## Cross-page references

- Always reference another page with `[[page-id]]` (the bare id, without brackets, is for filenames / CLI flags).
- After adding references, run `lint-links` to confirm nothing is broken.
- Do **not** wrap root-page slugs, file paths, ordinary words, or uncertain entities in `[[ ]]`.
