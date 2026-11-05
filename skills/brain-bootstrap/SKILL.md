---
name: brain-bootstrap
description: Seed a freshly-scaffolded brain with real project knowledge — on an existing (brownfield) project read the code, docs, and git log, then draft only the root pages that have meaningful content and capture key historical decisions; on a near-empty (greenfield) project interview the user. Every write goes through the `brain` CLI. Run it after brain-setup.
---

# brain-bootstrap

`brain-setup` scaffolds an **empty** brain — no root pages and an empty `pages/`. This skill fills it with real, durable project knowledge for the first time. It is the bridge between "a brain exists" and "the brain is worth reading".

You gather information by **reasoning over the project itself** — reading code, docs, and `git log`, or interviewing the user — but you **never write the brain by hand**. Every landing of knowledge is a `brain` CLI subcommand.

> **NEVER hand-edit any file under the brain directory. All reads and writes MUST go through the `brain` CLI. Manual edits are unsupported and illegitimate.** There is no validator and nothing at the file layer can catch a bad manual edit; correctness is guaranteed only by going through the CLI, so a hand edit silently breaks the brain's invariants.

The exact command surface (`update-root` / `create-page` / `update-truth` / `reindex` / `ls` …) and the page-category taxonomy live in the **brain-page** skill — read it before creating or modifying any page. Resolve `<brain-page-bundle>` to wherever that skill is installed (in the brain.md source repo, `skills/brain-page/`); define the shell function `brain() { node <brain-page-bundle>/bin/brain.mjs "$@"; }` (a function is portable across bash and zsh, unlike `BRAIN="node …"; $BRAIN …`, which only word-splits in bash) and run everything from the project root.

## Step 0 — Pick the mode

Inspect the project to decide which path you are on:

- **Brownfield** — there is substantial source code, and/or real `git log` history. There is something to read; go to **Brownfield**.
- **Greenfield** — a near-empty repo: no meaningful source, little or no history. There is nothing to read; go to **Greenfield**.

When it is genuinely mixed (a little code, a little history), prefer Brownfield for whatever *can* be inferred, and fall back to interview questions for the parts the code can't tell you.

---

## Brownfield — synthesize from code, docs, and history

Gather from three sources, then **synthesize** (do not transcribe):

1. **Existing code** — directory structure, module boundaries, entry points, the tech stack and dependencies (manifest files: `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, …). This is your strongest evidence for `architecture` and `stack`.
2. **Existing docs** — `README`, `docs/`, `CONTRIBUTING`, design notes. Good for stated intent, goals, and naming.
3. **`git log`** — read the commit messages (`git log --oneline -n 200` and spot-read full messages for the interesting ones). Mine them for the **real decisions** that were made over time.

### Draft only the needed root pages

Write each with `echo "<body>" | brain update-root <slug>` (body on stdin). Lean on ` ```mermaid ` blocks (graph / sequenceDiagram / mindmap / gantt) to keep them visual.

- Consider `architecture` for layers, modules, boundaries, and a mermaid `graph` when this is useful and inferable from code.
- Consider `stack` for a domain / choice / rationale table when real decisions are evident from dependencies and usage.
- Consider `flow` for an end-to-end path and `mindmap` for feature structure only where there is enough evidence to explain them.
- Consider `background` and `roadmap` only with grounded user intent; do not invent goals or plans.

### Capture key historical decisions as pages

For each genuine decision you can see in the history or the code (e.g. "switched from X to Y", "adopted pattern Z", a deliberate constraint), create a `decision` page and fill in its understanding:

```
brain create-page --id <kebab-id> --category decision \
  --title "<one-line decision>" \
  --summary "<why this page was created, in the user's working language>" \
  --source "<where this came from>"
echo "<what was decided, the alternatives, the rationale, the blast radius>" | \
  brain update-truth --id <kebab-id> \
  --summary "<what was captured, in the user's working language>" \
  --source "<where this came from>"
```

Link related pages and the relevant root area with `[[page-id]]`.

### Quality guardrails (mandatory)

- **Synthesize, don't copy.** Combine the three sources into a coherent picture; never paste a README section or a directory listing verbatim.
- **`git log` → real decisions only.** Distill the commits that represent actual choices or turning points. Do **not** produce a commit-by-commit changelog; routine "fix typo / bump dep" commits are noise.
- **Infer only what the evidence supports.** `architecture` and `stack` can be inferred from code and dependencies. `background` and `roadmap` usually cannot — for anything you can't ground in evidence, **mark it low-confidence and ask the user to confirm**, or leave it as an explicit open question. **Never fabricate** goals, history, or plans.
- **Prefer less but accurate.** Only sediment knowledge that (a) will still matter in six months and (b) is hard to reconstruct from the code itself. If the code already says it plainly, leave it in the code.

---

## Greenfield — interview the user

There is nothing to read, so **switch to an interview.** Ask open-ended questions and let the answers drive what you seed. Cover at least:

- **Goal** — what is this project for? What problem does it solve?
- **Target users** — who is it for?
- **Non-goals** — what is explicitly out of scope?
- **Rough shape** — the rough form/architecture/stack the user has in mind (may still be loose).

From the answers:

- Seed `background` (goal / target users / non-goals) with `update-root background` — this is the primary greenfield deliverable.
- If the user already has a sense of the tech choices or milestones, draft `stack` and/or `roadmap` as early sketches with `update-root`. Mark them as provisional. Leave other slots absent until there is something real to say — don't invent `architecture`/`flow`/`mindmap` for code that doesn't exist yet.

---

## Wrap up (both modes)

1. Rebuild the index and review what you seeded:

   ```
   brain reindex
   brain list-pages
   ```

2. Report back to the user: which root pages you drafted, which decision pages you created, and anything you marked **low-confidence / needs confirmation**.
3. Remind the user of the standing rule: **all reads and writes go through the `brain` CLI — never hand-edit a brain file.** From here, ongoing knowledge capture flows through the **brain-page** and **brain-ingest** skills.

Write the body of root pages, compiled_truth, and timelines in the user's working language, including every `--summary`. Keep technical identifiers (ids, slugs, field names, paths) verbatim. The CLI does not invent an English timeline sentence: pass `--summary`, or accept the title (`create-page`) / first line of the new compiled_truth (`update-truth`) as the entry.
