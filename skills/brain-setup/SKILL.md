---
name: brain-setup
description: Bootstrap the Open Project Brain Standard into the current project — ensure BRAIN.md is in the project root, resolve the brain data location with `brain brain-dir` (brainRoot-aware), scaffold the brain/ skeleton there only if it is empty (never a second local ./brain when redirected), idempotently wire CLAUDE.md / AGENTS.md, and optionally install a pre-commit hook.
---

# brain-setup

This skill bootstraps a project into the **Open Project Brain Standard**: it drops in the protocol entry point and the `brain/` skeleton so the **brain-page** and **brain-ingest** skills (and the `brain` CLI) have something to work with. It is **idempotent** — safe to run again on an already-initialized project.

> **NEVER hand-edit any file under the brain directory. All reads and writes MUST go through the `brain` CLI. Manual edits are unsupported and illegitimate.** This scaffold creates the brain once; from then on every read and write is a `brain` subcommand. There is no validator and nothing at the file layer can catch a bad manual edit, so a hand edit silently breaks the brain's invariants.

Run this from the **target project's root**. The skill bundle ships the templates under `assets/` and the hook under `hooks/`; resolve `<this-skill-bundle>` to the directory this `SKILL.md` lives in.

> **Core invariant: there is exactly one brain, at the resolved location.** The brain's data directory is **location-independent** — it lives at `./brain` by default, but a MindMux-managed project redirects it via `brainRoot` in `./.mindmux/preferences.json` (often an absolute path to an external sidecar directory). This skill MUST resolve that location before scaffolding, and MUST NOT create a second, local `./brain` when a `brainRoot` is set — doing so produces a **split brain** (an empty local skeleton shadowing the real external brain). The `BRAIN.md` protocol document is separate: it always lives in the project root regardless of where the brain data lives.

## Steps

### 1. Ensure `BRAIN.md` (the protocol document) is in the project root

`BRAIN.md` is the read/write contract that the agent reads to learn how to use the brain. It **always** belongs in the **project root**, independent of where the brain *data* lives.

- **Present** → leave it untouched (never overwrite project content).
- **Absent** → copy `assets/BRAIN.md` → `./BRAIN.md`.

Do **not** stop here just because `BRAIN.md` exists — its presence says nothing about whether the brain data is set up. Always continue to step 2 to resolve and check the data location.

### 2. Resolve the brain data location, then scaffold there only if empty

First, resolve where the brain data actually lives — never assume `./brain`. Ask the CLI:

```
node <brain-page-bundle>/bin/brain.mjs brain-dir
```

(The brain-page skill carries the CLI; in the brain.md source repo it is `skills/brain-page/bin/brain.mjs`, globally it is e.g. `~/.claude/skills/brain-page/bin/brain.mjs`.)

`brain brain-dir` reads `brainRoot` from `./.mindmux/preferences.json` when present (otherwise falls back to `./brain`) and prints, on separate lines: the **resolved directory**, a human-readable origin, `source:` (`brainRoot` or `default`), `exists:` (`true`/`false`), and `populated:` (`true`/`false` — whether the location already holds a root page or any page under `pages/`). Read those lines instead of guessing or `stat`-ing by hand.

Branch on the resolved state:

- **`populated: true` → the brain already exists. Do NOT scaffold.** Tell the user the brain lives at `<resolved dir>`. If `source: brainRoot`, make it explicit: *"this project's brain is redirected to an external directory (`<resolved dir>`) and is managed there — leaving it untouched."* Then continue to step 3 (wire) and step 4 (optional hook). Never lay down a local `./brain` in this case.

- **`populated: false` → scaffold the skeleton into the resolved directory** (the `brainRoot` target when redirected, otherwise `./brain`). Copy `assets/brain/` → `<resolved dir>/` — this brings the six root page templates (`background` / `architecture` / `flow` / `mindmap` / `stack` / `roadmap`), a generated `index.md`, and an empty `pages/` directory. Copy each destination file **only if it does not already exist** (never overwrite). **Never create a second local `./brain` when `source: brainRoot`** — always scaffold at the resolved path. After copying, run `reindex` so the index reflects the present pages:

  ```
  node <brain-page-bundle>/bin/brain.mjs reindex
  ```

  (`reindex` resolves the same location, so it writes the index in the right place automatically.)

No example pages are scaffolded; the page format is documented in `BRAIN.md` and the **brain-page** skill.

### 3. Wire the agent-config files via `brain wire`

The project's agent-config files must point at `BRAIN.md` so agents pick up the contract. Wiring is **deterministic — done by the CLI, not by hand.** Do not hand-write `@import` lines or template paragraphs.

First, **ask the user which agents to wire** for this project (v0.1 supports `claude-code`, `codex`, `opencode`, `cursor`, and `pi`). Then, for each chosen agent, run:

```
node <brain-page-bundle>/bin/brain.mjs wire --agent <claude-code|codex|opencode|cursor|pi>
```

You may pass `--agent` multiple times or comma-separate them, e.g. `wire --agent claude-code,codex,opencode,cursor,pi`.

What the command does (so you can explain it):

- Maps `claude-code → ./CLAUDE.md` and `codex / opencode / cursor / pi → ./AGENTS.md` in the project root.
- Writes one **unified, neutral, self-contained brain block** — wrapped in `<!-- BEGIN brain.md -->` … `<!-- END brain.md -->` — that names the Open Project Brain Standard, instructs the agent to read `./BRAIN.md` (the full read/write contract), states the core rule (all brain reads/writes go through the `brain` CLI; never hand-edit a brain file), and notes that the four brain skills are installed globally.
- Both files get the **same** block body; the only difference is that `CLAUDE.md` additionally carries an `@import ./BRAIN.md` line (Claude Code-specific syntax — the other agents don't understand `@import`, so `AGENTS.md` relies on the plain "read `./BRAIN.md`" instruction).
- It is **idempotent** via the markers: absent file → created; existing file without the markers → block appended; existing marked block → replaced in place (so re-running upgrades the block instead of duplicating it).

### 4. Optionally install a pre-commit hook

Offer to install the local index + link backstop (no CI required). Only if the project is a git repository (`.git/` exists) and the user agrees:

- Copy `hooks/pre-commit` → `.git/hooks/pre-commit` and make it executable (`chmod +x`).
- If a `.git/hooks/pre-commit` already exists, do **not** overwrite it — tell the user and show them the hook contents so they can merge it manually.

The hook runs `reindex → lint-links` on every commit and folds any index changes back in. (There is deliberately no validator — correctness is guaranteed by the CLI being the only way to write.)

## After setup

The scaffold leaves the brain empty — six root page **templates** plus an empty `pages/`. The valuable next step is to **seed it with real project knowledge**, and that is exactly what the **brain-bootstrap** skill does:

> **Recommend the user run the brain-bootstrap skill next.** On an existing (brownfield) project it reads the code, docs, and `git log` to draft the six root pages and capture the key historical decisions; on a near-empty (greenfield) project it interviews the user to seed `background` and friends. brain-setup does **not** run it automatically — initialization and knowledge-seeding are separate steps, so the user stays in control of what gets written.

Also point them at: read `BRAIN.md`, then use the **brain-page** skill to author or modify pages directly and the **brain-ingest** skill to digest scattered input into the brain. **Every read and write goes through the `brain` CLI — never hand-edit a brain file.**
