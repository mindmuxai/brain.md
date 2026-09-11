import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "brain.mjs");
const WIRE_BEGIN = "<!-- BEGIN brain.md -->";
const WIRE_END = "<!-- END brain.md -->";

function makeEmptyProject(t) {
  const originalCwd = process.cwd();
  const project = mkdtempSync(join(tmpdir(), "brain-cli-"));
  t.after(() => {
    process.chdir(originalCwd);
    rmSync(project, { recursive: true, force: true });
  });
  return project;
}

function runBrain(project, args, opts = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: project,
    encoding: "utf8",
    input: opts.input,
    env: process.env,
  });
}

function countMarkers(text, marker) {
  let n = 0;
  let i = 0;
  while (true) {
    const j = text.indexOf(marker, i);
    if (j === -1) return n;
    n += 1;
    i = j + marker.length;
  }
}

function assertCompanionBlock(text) {
  assert.match(text, new RegExp(WIRE_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(text, new RegExp(WIRE_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(text, /Start of a task/i);
  assert.match(text, /settles/i);
  assert.match(text, /Pure implementation/i);
  assert.match(text, /overturning/i);
  assert.match(text, /never hand-edit/i);
  assert.match(text, /If a brain MCP server is connected and authenticated, prefer it/);
  assert.match(text, /otherwise use the `brain` CLI/);
  assert.doesNotMatch(text, /All reads and writes go through the `brain` CLI — never hand-edit brain files/);
  assert.equal(countMarkers(text, WIRE_BEGIN), 1);
  assert.equal(countMarkers(text, WIRE_END), 1);
}

test("wire with no --agent creates CLAUDE.md and AGENTS.md with companion block", (t) => {
  const project = makeEmptyProject(t);
  const r = runBrain(project, ["wire"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /created CLAUDE\.md/);
  assert.match(r.stdout, /created AGENTS\.md/);

  const claude = readFileSync(join(project, "CLAUDE.md"), "utf8");
  const agents = readFileSync(join(project, "AGENTS.md"), "utf8");
  assertCompanionBlock(claude);
  assertCompanionBlock(agents);
  assert.match(claude, /@import \.\/BRAIN\.md/);
  assert.doesNotMatch(agents, /@import/);
});

test("wire --agent all matches default dual-file wiring", (t) => {
  const project = makeEmptyProject(t);
  const r = runBrain(project, ["wire", "--agent", "all"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.ok(existsSync(join(project, "CLAUDE.md")));
  assert.ok(existsSync(join(project, "AGENTS.md")));
});

test("wire appends block without overwriting existing user content", (t) => {
  const project = makeEmptyProject(t);
  writeFileSync(join(project, "AGENTS.md"), "# Team rules\n\nKeep PRs small.\n");
  writeFileSync(join(project, "CLAUDE.md"), "# Local notes\n\nUse Biome.\n");

  const r = runBrain(project, ["wire"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /appended a brain block to AGENTS\.md/);
  assert.match(r.stdout, /appended a brain block to CLAUDE\.md/);

  const agents = readFileSync(join(project, "AGENTS.md"), "utf8");
  const claude = readFileSync(join(project, "CLAUDE.md"), "utf8");
  assert.match(agents, /Keep PRs small/);
  assert.match(claude, /Use Biome/);
  assertCompanionBlock(agents);
  assertCompanionBlock(claude);
});

test("wire upgrades a pre-MCP companion block in place without duplicating", (t) => {
  const project = makeEmptyProject(t);
  const oldBlock = [
    WIRE_BEGIN,
    "## Project Brain",
    "",
    "This project keeps a **Project Brain**: a persistent memory layer of its durable decisions, requirements, and constraints. Read `./BRAIN.md` for the full read/write contract.",
    "",
    "Maintain the brain as part of normal coding work — not as a separate task. While discussing or implementing features:",
    "- **Start of a task:** load relevant context with the `brain` CLI (`list-pages`, `read-page`, `read-root`). Prefer a narrow read over scanning everything.",
    "- All reads and writes go through the `brain` CLI — never hand-edit brain files.",
    "",
    "The brain skills (`brain-setup`, `brain-page`, `brain-ingest`, `brain-bootstrap`) are installed in your global skills directory. Prefer `brain init` to scaffold a new project.",
    WIRE_END,
  ].join("\n");
  writeFileSync(join(project, "AGENTS.md"), `# Team rules\n\nKeep PRs small.\n\n${oldBlock}\n`);

  const r = runBrain(project, ["wire"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /updated the brain block in AGENTS\.md/);

  const agents = readFileSync(join(project, "AGENTS.md"), "utf8");
  assert.match(agents, /Keep PRs small/);
  assertCompanionBlock(agents);
  assert.doesNotMatch(agents, /Prefer `brain init`/);
  assert.equal(countMarkers(agents, WIRE_BEGIN), 1);
  assert.equal(countMarkers(agents, WIRE_END), 1);
});

test("wire is idempotent: second run replaces the marked block only once", (t) => {
  const project = makeEmptyProject(t);
  writeFileSync(join(project, "AGENTS.md"), "# Team rules\n\nKeep PRs small.\n");

  let r = runBrain(project, ["wire"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  r = runBrain(project, ["wire"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /updated the brain block in AGENTS\.md/);

  const agents = readFileSync(join(project, "AGENTS.md"), "utf8");
  assert.match(agents, /Keep PRs small/);
  assertCompanionBlock(agents);
  assert.match(agents, /not guaranteed to be on `PATH`/);
  assert.match(
    agents,
    /node <brain-page-skill-dir>\/bin\/brain\.mjs <subcommand> \[flags\]/,
  );
  assert.match(
    agents,
    /node <brain-page-skill-dir>\/bin\/brain\.mjs init/,
  );
  assert.doesNotMatch(agents, /Prefer `brain init`/);
});

test("wire fails loudly on a damaged block (one marker without its pair)", (t) => {
  const project = makeEmptyProject(t);
  writeFileSync(
    join(project, "AGENTS.md"),
    `# Notes\n\n${WIRE_BEGIN}\n\nstale block, END marker lost\n`,
  );

  const r = runBrain(project, ["wire"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /damaged brain block/);
  // File left untouched; no second block appended.
  const agents = readFileSync(join(project, "AGENTS.md"), "utf8");
  assert.equal(countMarkers(agents, WIRE_BEGIN), 1);
});

test("wire fails loudly on duplicate complete BEGIN/END pairs", (t) => {
  const project = makeEmptyProject(t);
  const block = `${WIRE_BEGIN}\nold block\n${WIRE_END}`;
  const original = `# Notes\n\n${block}\n\n## Extra\n\n${block}\n`;
  writeFileSync(join(project, "AGENTS.md"), original);

  const r = runBrain(project, ["wire"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /2 brain blocks|duplicate/i);
  // File left untouched; no partial update of the first pair only.
  assert.equal(readFileSync(join(project, "AGENTS.md"), "utf8"), original);
});

test("init creates BRAIN.md, scaffolds brain, and default-wires agent files", (t) => {
  const project = makeEmptyProject(t);
  const r = runBrain(project, ["init"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /created BRAIN\.md/);
  assert.match(r.stdout, /init done/);

  assert.ok(existsSync(join(project, "BRAIN.md")));
  assert.ok(existsSync(join(project, "brain", "background.md")));
  assert.ok(existsSync(join(project, "brain", "pages")));
  assert.ok(existsSync(join(project, "CLAUDE.md")));
  assert.ok(existsSync(join(project, "AGENTS.md")));

  assertCompanionBlock(readFileSync(join(project, "CLAUDE.md"), "utf8"));
  assertCompanionBlock(readFileSync(join(project, "AGENTS.md"), "utf8"));
  assert.match(readFileSync(join(project, "BRAIN.md"), "utf8"), /Project Brain protocol/i);
});

test("init on existing agent files preserves user sections", (t) => {
  const project = makeEmptyProject(t);
  writeFileSync(join(project, "AGENTS.md"), "# Preexisting\n\nDo not delete me.\n");
  writeFileSync(join(project, "CLAUDE.md"), "# Preexisting Claude\n\nKeep this.\n");

  const r = runBrain(project, ["init"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);

  const agents = readFileSync(join(project, "AGENTS.md"), "utf8");
  const claude = readFileSync(join(project, "CLAUDE.md"), "utf8");
  assert.match(agents, /Do not delete me/);
  assert.match(claude, /Keep this/);
  assertCompanionBlock(agents);
  assertCompanionBlock(claude);
});

test("init does not overwrite BRAIN.md or populated brain data", (t) => {
  const project = makeEmptyProject(t);
  writeFileSync(join(project, "BRAIN.md"), "# Custom BRAIN\n\nmine\n");
  mkdirSync(join(project, "brain", "pages"), { recursive: true });
  writeFileSync(
    join(project, "brain", "background.md"),
    "---\nslug: background\ntitle: Project background\nrole: project background\nupdated: \"2026-01-01T00:00:00\"\n---\n\n# Project background\n\ncustom body\n",
  );

  const r = runBrain(project, ["init"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /BRAIN\.md already present/);
  assert.match(r.stdout, /already populated/);
  assert.match(readFileSync(join(project, "BRAIN.md"), "utf8"), /Custom BRAIN/);
  assert.match(readFileSync(join(project, "brain", "background.md"), "utf8"), /custom body/);
});

test("init --no-wire skips agent config files", (t) => {
  const project = makeEmptyProject(t);
  const r = runBrain(project, ["init", "--no-wire"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /skipped wire/);
  assert.ok(existsSync(join(project, "BRAIN.md")));
  assert.ok(!existsSync(join(project, "CLAUDE.md")));
  assert.ok(!existsSync(join(project, "AGENTS.md")));
});

test("init scaffolds into brainRoot when preferences redirect", (t) => {
  const project = makeEmptyProject(t);
  const external = join(project, "external-brain");
  mkdirSync(join(project, ".mindmux"), { recursive: true });
  writeFileSync(
    join(project, ".mindmux", "preferences.json"),
    JSON.stringify({ version: 1, brainRoot: external }),
  );

  const r = runBrain(project, ["init", "--no-wire"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.ok(existsSync(join(project, "BRAIN.md")));
  assert.ok(existsSync(join(external, "background.md")));
  assert.ok(existsSync(join(external, "pages")));
  assert.ok(!existsSync(join(project, "brain", "background.md")));
});

test("create-page and update-truth still work after init", (t) => {
  const project = makeEmptyProject(t);
  let r = runBrain(project, ["init", "--no-wire"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);

  r = runBrain(project, [
    "create-page",
    "--id",
    "markdown-over-sqlite",
    "--category",
    "decision",
    "--title",
    "Use Markdown not SQLite",
  ]);
  assert.equal(r.status, 0, r.stderr || r.stdout);

  r = runBrain(
    project,
    ["update-truth", "--id", "markdown-over-sqlite", "--summary", "capture decision"],
    { input: "We store config as Markdown for diff-ability.\n" },
  );
  assert.equal(r.status, 0, r.stderr || r.stdout);

  r = runBrain(project, ["list-pages"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /markdown-over-sqlite/);

  const page = readFileSync(join(project, "brain", "pages", "markdown-over-sqlite.md"), "utf8");
  assert.match(page, /diff-ability/);
  assert.match(page, /<!-- compiled_truth -->/);
  assert.match(page, /## Timeline/);
});
