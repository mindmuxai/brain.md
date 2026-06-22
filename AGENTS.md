# AGENTS.md

@import ./BRAIN.md

## Brain skills (required reading for Codex and other agents)

Claude Code automatically loads the skill bundles under `.claude/skills/`; other agents (such as Codex) should treat the following skills as mandatory operating manuals for this repository and read them before acting in the matching situation:

- **page-management** — `.claude/skills/page-management/SKILL.md`
  The page category taxonomy and the create / update / append protocol. **Read it before creating or modifying any `brain/pages/*.md`.**
- **ingest** — `.claude/skills/ingest/SKILL.md`
  The process for digesting a conversation / document / research result, classifying it, and writing it down as brain content. Read it whenever you need to capture knowledge.

Before committing, run `node scripts/reindex.mjs`, `node scripts/lint-links.mjs`, and `node scripts/validate.mjs` in that order.
