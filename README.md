<p align="center">
  <img src="https://projectbrain.md/icon.svg" width="84" height="84" alt="brain.md">
</p>

<h1 align="center">brain.md</h1>

<p align="center">
  <b>A persistent, file-based memory layer for your coding agents.</b><br>
  An open, agent-agnostic standard for capturing a project's durable knowledge as plain
  Markdown — read and written through one small CLI. It lives in your repo and travels across agents, machines, and models.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-Apache--2.0-171717?style=flat-square" alt="License: Apache-2.0">
  <img src="https://img.shields.io/badge/CLI-zero%20dependencies-171717?style=flat-square" alt="Zero-dependency CLI">
  <img src="https://img.shields.io/badge/agents-Claude%20Code%20%C2%B7%20Codex%20%C2%B7%20Cursor%20%C2%B7%20Pi-171717?style=flat-square" alt="Agents: Claude Code, Codex, Cursor, Pi">
  <img src="https://img.shields.io/badge/version-0.3.0-171717?style=flat-square" alt="Version 0.3.0">
</p>

<p align="center">
  <a href="#why-a-brain">Why</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#see-it-work">See it work</a> ·
  <a href="#the-brain-cli">CLI</a> ·
  <a href="#how-it-works">How it works</a>
</p>

---

This repository is the **toolkit**, not a brain itself. Install it once, then in any project run
`brain init`: it scaffolds a [`BRAIN.md`](./skills/brain-setup/assets/BRAIN.md) protocol file, a
`brain/` directory, and default-wires agent config files into **your** repo. From then on, any
coding agent — Claude Code, Codex, anything that reads files — learns to use that brain just by
reading the project's `BRAIN.md`. The brain is plain Markdown, lives in the repo, and outlives
every session.

## Why a brain

A coding agent's knowledge lives nowhere durable. The reasons behind a decision, the
constraints you agreed on, the path *not* taken — they sit in chat logs and in your head,
and they vanish the moment the session ends. The next agent starts from zero.

A brain fixes that. It is the project's **persistent memory**: the durable decisions,
requirements, and constraints, written down as plain Markdown next to the code.

- **Repo-native** — Markdown that lives in your project and travels in git, with or without a runtime on top.
- **Agent-agnostic** — the contract is a file (`BRAIN.md`). Any agent that can read it can use the brain.
- **Correct by construction** — every write goes through the `brain` CLI, so the brain's
  invariants can't be broken by a malformed edit. There is no validator because none is needed.

The test for what belongs in it: **will this still matter in six months, and is it hard to
reconstruct from the code itself?** If yes, it goes in the brain. Pure implementation details
and anything readable straight from the code and git history stay where they are.

## Quick start

**1. Install the tools once (global) — no clone required.** This puts `brain` on your `PATH` and copies skills into every detected agent (`~/.claude/skills`, …):

```bash
npm install -g @mindmux/brain-md
brain setup -y
# reverse: brain uninstall   # never touches any project's brain data
```

Prefer not to install globally? Use `npx` for **both** steps (npx does not leave `brain` on your `PATH`):

```bash
npx @mindmux/brain-md setup -y
npx @mindmux/brain-md init          # same as step 2 — not bare `brain init`
# reverse: npx @mindmux/brain-md uninstall
```

From a git checkout of this repo you can still run `./setup` (same installer; use `--symlink` while developing the toolkit).

**2. Initialize a project** (from the project root; requires the global install from step 1, or use `npx @mindmux/brain-md init` above):

```bash
brain init
# or, after setup only (no global bin): node ~/.claude/skills/brain-page/bin/brain.mjs init
```

This ensures `BRAIN.md`, scaffolds empty brain data (brainRoot-aware), and **default-wires**
`CLAUDE.md` + `AGENTS.md` (creates them if missing; if they already exist, only updates the
marked brain block — never whole-file overwrite). Optionally use the **brain-setup** skill for
the same flow plus a pre-commit hook, or `brain install-hooks` for a project-local Claude Code
SessionStart snapshot (`--agent codex` for Codex).

**3. Seed real knowledge** — run the **brain-bootstrap** skill. On an existing project it reads
the code, docs, and `git log` to draft the root pages and capture key decisions; on a near-empty
one it interviews you. (Init leaves content seeding as a deliberate next step.)

**4. Work as usual.** Maintain the brain **while coding**: load relevant pages at task start;
capture decisions/constraints when they settle; skip pure implementation noise; reverse when
overturning. All reads/writes go through the `brain` CLI following `BRAIN.md` — never hand-edit
brain files.

## See it work

The point of a brain is what happens *across* sessions — a decision made today is still
there, with its rationale, weeks later:

```text
You    Let's store config as Markdown, not SQLite — easier to diff and migrate.

Agent  Capturing that as a decision so it outlives this session.
       $ brain create-page --id config-as-markdown --category decision \
             --title "Store config as Markdown, not SQLite"
       ✓ page created · indexed

— three weeks and a fresh session later —

You    Why aren't we using a database for config?

Agent  $ brain read-page config-as-markdown
       We chose Markdown for diff-ability and zero migrations. Here's the original call
       and the trade-offs we weighed …
```

## The `brain` CLI

Reading and writing the brain both go through one zero-dependency Node CLI (run with `node`):

```bash
brain() { node skills/brain-page/bin/brain.mjs "$@"; }   # or use the global `brain` bin after npm install -g

brain init                                   # BRAIN.md + skeleton + default wire CLAUDE.md / AGENTS.md
brain wire                                   # same default wire (no --agent needed)
brain install-hooks                          # opt-in Claude Code SessionStart snapshot (project-local)
brain uninstall-hooks                        # remove that SessionStart hook
brain install-hooks --agent codex            # opt-in Codex startup/resume/compaction snapshot
brain uninstall-hooks --agent codex          # remove only the Codex hook
brain brain-dir                              # where is the brain?
brain list-pages                             # list pages
brain read-page my-decision                  # read a page
brain create-page --id my-decision --category decision --title "Use X over Y"
echo "the new understanding" | brain update-truth --id my-decision --summary "why it changed"
brain append-timeline --id my-decision --kind evidence --summary "benchmark confirmed it"
echo "## Overview …" | brain update-root architecture
brain reindex && brain lint-links
```

A page carries a rewritable **compiled_truth** (the current best understanding) plus an
append-only **timeline** (the chain of evidence). `update-truth` rewrites the truth and appends
its timeline entry in one atomic write — so the understanding can never change without a trace.

## Codex lifecycle hooks

From the project root, run `brain install-hooks --agent codex`. It installs
`.codex/hooks/brain-session-start` and merges one `SessionStart` command into
`.codex/hooks.json`. Run `brain uninstall-hooks --agent codex` to remove it.
No flag still means Claude Code; `--agent claude-code` is also accepted.

Use **Codex CLI 0.153.4 or newer** as the supported baseline for this integration
([release notes](https://learn.chatgpt.com/docs/changelog)). Older releases have not
been validated. Node 18+ and a POSIX shell with `awk` must be available to the hook
(macOS/Linux; native Windows shells are not supported). The hook locates the CLI
in installed skill directories or on `PATH`; `BRAIN_CLI` can specify its absolute
`.mjs` path.

Trust the project and use Codex `/hooks` to review and trust the installed command.
Hooks must be enabled (`features.hooks`, enabled by default in this release).
The installer leaves global configuration, `config.toml`, and trust settings alone;
malformed settings or a foreign script at the destination produce an error without
overwriting them. If inline TOML hooks already exist, Codex loads both sources.
The command contains an absolute project path: **uninstall before moving a project,
then reinstall at its new location**. Do the same for a separate clone/worktree;
do not share the generated absolute command between machines.

The [documented lifecycle](https://learn.chatgpt.com/docs/hooks) covers startup,
resume, clear, and post-compaction through `SessionStart`. The hook resolves the
brain via `brain brain-dir`, including relative or absolute `brainRoot` redirects,
and emits only `brain list-pages` metadata. It exits successfully without context
when the brain is missing/unpopulated or the CLI fails; Codex limits execution to
five seconds. Page bodies are read on demand with `brain read-page <id>`.

### Astra experimental context

Codex snapshots are limited to **8 KiB of UTF-8**, preserving complete rows and
leaving Codex's own context limit enabled. Truncated snapshots tell the agent to
run `brain list-pages` for the full index. This keeps the same bounded behavior
with or without Astra's experimental context management. Snapshots refresh at each
supported boundary; an unchanged index is not suppressed across context windows.

For eligible clients, opt in yourself in `config.toml`, then start a new task:

```toml
[features.context_management]
experimental_mode = true
```

See [current eligibility and behavior](https://learn.chatgpt.com/docs/models#experimental-context-management):
the launch guide lists ChatGPT Plus/Pro, excluding Business, Enterprise, and API-key
sign-in; the [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
also lists Pro Lite. The installer does not enable this experiment or change model
or compaction settings.

When native notes/history are available, retain relevant brain page IDs and
unresolved task state there, search earlier task history for evidence, and re-read
brain pages for current facts after a rollover. Run `brain wire --agent codex` to
refresh this guidance in `AGENTS.md`. Hooks never write native notes or brain pages.
Automatic experimental-rollover delivery and the desktop app require separate
runtime validation; do not assume all experimental rollovers emit ordinary
compaction events. The wired instructions and explicit CLI reads remain available.


## How it works

Three design choices keep the brain durable and tamper-evident:

- **Correct by construction, no validator.** The CLI is the only writer. Frontmatter is always
  generated, and `update-truth` rewrites understanding + records why in a single atomic write.
  The two things a validator used to guard are now structurally impossible.
- **Exactly one brain, location-independent.** It defaults to `./brain`, but a project can
  redirect it via `brainRoot` in `.mindmux/preferences.json` (e.g. an external sidecar). Every
  command resolves the location itself — tools never create a second, shadow brain.
- **Pure files, portable.** The brain is Markdown plus one Node script — it lives in your repo
  and travels in git, and runtimes (MindMux over MCP, more to come) layer on top of the same files.

The skills that drive it all:

| skill | what it does |
|---|---|
| **brain-setup** | same scaffold/wire as `brain init`, plus optional pre-commit and Claude Code/Codex SessionStart hooks — prefer `brain init` for day-to-day |
| **brain-bootstrap** | seed the brain from code / docs / `git log` — or interview you on a greenfield project |
| **brain-page** | the operating manual for reading and writing pages + root pages (carries the `brain` CLI) |
| **brain-ingest** | digest a conversation, document, or research result into the brain |

---

<sub>brain.md is led and incubated by **MindMux** — the standalone open-source landing of
MindMux's Brain Spec + coding-agent adapter. The specification layer uses neutral naming so it
can be adopted widely; stewardship and maintenance belong to MindMux. Licensed under Apache-2.0.</sub>
