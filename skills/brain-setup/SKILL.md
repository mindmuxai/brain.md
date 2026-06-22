---
name: brain-setup
description: Bootstrap the Open Project Brain Standard into the current project — detect whether it already has a BRAIN.md; if not, scaffold BRAIN.md + the brain/ skeleton, idempotently wire CLAUDE.md / AGENTS.md, and optionally install a pre-commit hook.
---

# brain-setup

This skill bootstraps a project into the **Open Project Brain Standard**: it drops in the protocol entry point and the `brain/` skeleton so the **brain-page** and **brain-ingest** skills (and the `brain` CLI) have something to work with. It is **idempotent** — safe to run again on an already-initialized project.

> **NEVER hand-edit any file under the brain directory. All reads and writes MUST go through the `brain` CLI. Manual edits are unsupported and illegitimate.** This scaffold creates the brain once; from then on every read and write is a `brain` subcommand. There is no validator and nothing at the file layer can catch a bad manual edit, so a hand edit silently breaks the brain's invariants.

Run this from the **target project's root**. The skill bundle ships the templates under `assets/` and the hook under `hooks/`; resolve `<this-skill-bundle>` to the directory this `SKILL.md` lives in.

## Steps

### 1. Detect existing setup

Check the project root for `BRAIN.md`.

- **Present** → the project is already initialized. Do not overwrite it. Skip to step 4 (verify the wiring is in place) and stop.
- **Absent** → continue with the scaffold below.

### 2. Scaffold `BRAIN.md` + the `brain/` skeleton

Copy from the bundle into the project root, without clobbering anything that already exists:

- `assets/BRAIN.md` → `./BRAIN.md`
- `assets/brain/` → `./brain/` — this brings the six root page templates (`background` / `architecture` / `flow` / `mindmap` / `stack` / `roadmap`), a generated `index.md`, and an empty `pages/` directory. No example pages are scaffolded; the page format is documented in `BRAIN.md` and the **brain-page** skill.

For each destination file: copy it **only if it does not already exist** (never overwrite project content). After copying, run the CLI's `reindex` so `brain/index.md` reflects whatever pages are present:

```
node <brain-page-bundle>/bin/brain.mjs reindex
```

(The brain-page skill carries the CLI; in the brain.md source repo it is `skills/brain-page/bin/brain.mjs`, globally it is e.g. `~/.claude/skills/brain-page/bin/brain.mjs`.)

### 3. Wire the agent-config files via `brain wire`

The project's agent-config files must point at `BRAIN.md` so agents pick up the contract. Wiring is **deterministic — done by the CLI, not by hand.** Do not hand-write `@import` lines or template paragraphs.

First, **ask the user which agents to wire** for this project (v0.1 supports `claude-code` and `codex`). Then, for each chosen agent, run:

```
node <brain-page-bundle>/bin/brain.mjs wire --agent <claude-code|codex>
```

You may pass `--agent` multiple times or comma-separate them, e.g. `wire --agent claude-code,codex`.

What the command does (so you can explain it):

- Maps `claude-code → ./CLAUDE.md` and `codex → ./AGENTS.md` in the project root.
- Writes one **unified, neutral, self-contained brain block** — wrapped in `<!-- BEGIN brain.md -->` … `<!-- END brain.md -->` — that names the Open Project Brain Standard, instructs the agent to read `./BRAIN.md` (the full read/write contract), states the core rule (all brain reads/writes go through the `brain` CLI; never hand-edit a brain file), and notes that the four brain skills are installed globally.
- Both files get the **same** block body; the only difference is that `CLAUDE.md` additionally carries an `@import ./BRAIN.md` line (Claude Code-specific syntax — Codex does not understand `@import`, so `AGENTS.md` relies on the plain "read `./BRAIN.md`" instruction).
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
