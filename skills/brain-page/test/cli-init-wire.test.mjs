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
  assert.match(text, /working language/);
  assert.match(text, /--summary/);
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
  assert.ok(!existsSync(join(project, "brain", "background.md")));
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

test("update-root creates an on-demand root page and preserves its authored title", (t) => {
  const project = makeEmptyProject(t);
  let r = runBrain(project, ["init", "--no-wire"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  r = runBrain(project, ["update-root", "background"], {
    input: "# Notes that matter\n\nA real reason to create this page.\n",
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const root = readFileSync(join(project, "brain", "background.md"), "utf8");
  assert.match(root, /title: Notes that matter/);
  assert.match(root, /# Notes that matter/);
});

test("init creates none of the six root-page files", (t) => {
  const project = makeEmptyProject(t);
  const r = runBrain(project, ["init", "--no-wire"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  for (const slug of ["background", "architecture", "flow", "mindmap", "stack", "roadmap"]) {
    assert.ok(!existsSync(join(project, "brain", `${slug}.md`)), `${slug}.md must be on-demand`);
  }
});

test("update-root rejects a body whose first line is not an H1", (t) => {
  const project = makeEmptyProject(t);
  let r = runBrain(project, ["init", "--no-wire"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  r = runBrain(project, ["update-root", "background"], {
    input: "An introductory paragraph\n\n# Too late\n",
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /must start with a Markdown H1 title/);
  assert.ok(!existsSync(join(project, "brain", "background.md")));
});

test("update-root normalizes an existing legacy root page without an H1", (t) => {
  const project = makeEmptyProject(t);
  let r = runBrain(project, ["init", "--no-wire"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  writeFileSync(
    join(project, "brain", "background.md"),
    "---\nslug: background\ntitle: Legacy project notes\nrole: project context\n---\n\nOld notes.\n",
  );
  r = runBrain(project, ["update-root", "background"], { input: "Updated legacy notes.\n" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const root = readFileSync(join(project, "brain", "background.md"), "utf8");
  assert.match(root, /# Legacy project notes/);
  assert.match(root, /Updated legacy notes\./);
});

test("update-root quotes a title that contains YAML-special characters", (t) => {
  const project = makeEmptyProject(t);
  let r = runBrain(project, ["init", "--no-wire"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  r = runBrain(project, ["update-root", "background"], {
    input: '# Notes: the "real" ones\n\nA reason to keep this page.\n',
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const root = readFileSync(join(project, "brain", "background.md"), "utf8");
  assert.match(root, /title: "Notes: the \\"real\\" ones"/);
  assert.match(root, /# Notes: the "real" ones/);
});

test("update-root rejects a missing H1 on a page that already has one and leaves the file unchanged", (t) => {
  const project = makeEmptyProject(t);
  let r = runBrain(project, ["init", "--no-wire"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  r = runBrain(project, ["update-root", "background"], {
    input: "# Notes that matter\n\nA real reason to create this page.\n",
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const before = readFileSync(join(project, "brain", "background.md"), "utf8");
  r = runBrain(project, ["update-root", "background"], { input: "Updated notes without a heading.\n" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /must start with a Markdown H1 title/);
  assert.equal(readFileSync(join(project, "brain", "background.md"), "utf8"), before);
});

test("update-root rejects an overlong H1 title", (t) => {
  const project = makeEmptyProject(t);
  let r = runBrain(project, ["init", "--no-wire"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  r = runBrain(project, ["update-root", "background"], {
    input: `# ${"a".repeat(201)}\n\nUseful content.\n`,
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /1 to 200 characters/);
  assert.ok(!existsSync(join(project, "brain", "background.md")));
});

test("update-root rejects a heading-only root page", (t) => {
  const project = makeEmptyProject(t);
  let r = runBrain(project, ["init", "--no-wire"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  r = runBrain(project, ["update-root", "background"], { input: "# Just a title\n" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /meaningful content/);
  assert.ok(!existsSync(join(project, "brain", "background.md")));
});

test("update-root rejects placeholder headings and comments after its H1", (t) => {
  const project = makeEmptyProject(t);
  let r = runBrain(project, ["init", "--no-wire"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  r = runBrain(project, ["update-root", "background"], { input: "# Just a title\n\n## Placeholder\n" });
  assert.notEqual(r.status, 0);
  r = runBrain(project, ["update-root", "background"], { input: "# Just a title\n\n<!-- placeholder -->\n" });
  assert.notEqual(r.status, 0);
  assert.ok(!existsSync(join(project, "brain", "background.md")));
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
  assert.ok(!existsSync(join(external, "background.md")));
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
  assert.match(page, /summary: Use Markdown not SQLite/);
  assert.match(page, /summary: capture decision/);
  assert.doesNotMatch(page, /Created this page/);
  assert.doesNotMatch(page, /Rewrote compiled_truth/);
});

test("timeline summaries stay in the caller's language", (t) => {
  const project = makeEmptyProject(t);
  let r = runBrain(project, ["init", "--no-wire"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);

  r = runBrain(project, [
    "create-page",
    "--id",
    "report-export",
    "--category",
    "decision",
    "--title",
    "报告导出约定",
    "--source",
    "用户明确要求中文记录",
  ]);
  assert.equal(r.status, 0, r.stderr || r.stdout);

  const created = readFileSync(join(project, "brain", "pages", "report-export.md"), "utf8");
  assert.match(created, /summary: "报告导出约定"/);
  assert.doesNotMatch(created, /Created this page/);

  r = runBrain(
    project,
    [
      "update-truth",
      "--id",
      "report-export",
      "--summary",
      "记录用户确认的报告导出约定",
      "--source",
      "用户本轮确认",
    ],
    { input: "报告默认导出为 Markdown，并保留原始来源链接。\n" },
  );
  assert.equal(r.status, 0, r.stderr || r.stdout);

  r = runBrain(
    project,
    ["update-truth", "--id", "report-export", "--source", "用户省略摘要"],
    { input: "# 导出时保留来源链接\n\n不另写英文说明。\n" },
  );
  assert.equal(r.status, 0, r.stderr || r.stdout);

  const page = readFileSync(join(project, "brain", "pages", "report-export.md"), "utf8");
  assert.match(page, /summary: "报告导出约定"/);
  assert.match(page, /summary: "记录用户确认的报告导出约定"/);
  assert.match(page, /summary: "导出时保留来源链接"/);
  assert.doesNotMatch(page, /Created this page/);
  assert.doesNotMatch(page, /Rewrote compiled_truth/);
  // The creation entry is left as first written. Later Chinese summaries do not rewrite it.
  assert.equal(page.match(/summary:/g).length, 3);

  r = runBrain(project, [
    "create-page",
    "--id",
    "named-create",
    "--category",
    "decision",
    "--title",
    "报告导出约定",
    "--summary",
    "按用户语言记录页面创建",
  ]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const named = readFileSync(join(project, "brain", "pages", "named-create.md"), "utf8");
  assert.match(named, /summary: "按用户语言记录页面创建"/);
  assert.doesNotMatch(named, /summary: "报告导出约定"/);
  assert.doesNotMatch(named, /Created this page/);

  r = runBrain(
    project,
    ["update-truth", "--id", "named-create"],
    { input: "```\n<!-- note -->\n```\n" },
  );
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--summary/);
  const unchanged = readFileSync(join(project, "brain", "pages", "named-create.md"), "utf8");
  assert.equal(unchanged, named);

  r = runBrain(project, [
    "create-page",
    "--id",
    "blank-summary",
    "--category",
    "decision",
    "--title",
    "ignored",
    "--summary",
    "   ",
  ]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--summary requires a non-empty value/);
  assert.ok(!existsSync(join(project, "brain", "pages", "blank-summary.md")));
});
