import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

async function loadBrain() {
  // Re-import to pick up the cwd-resolved BRAIN_DIR for each temp project.
  return import(`../lib/brain.mjs?test=${Date.now()}`);
}

function makeProject(t) {
  const originalCwd = process.cwd();
  const project = mkdtempSync(join(tmpdir(), "brain-test-"));
  mkdirSync(join(project, "brain", "pages"), { recursive: true });
  process.chdir(project);

  t.after(() => {
    process.chdir(originalCwd);
    rmSync(project, { recursive: true, force: true });
  });

  return project;
}

test("normalizes only frontmatter and timeline timestamps", async (t) => {
  const project = makeProject(t);

  writeFileSync(
    join(project, "brain", "pages", "sample-page.md"),
    [
      "---",
      "id: sample-page",
      "category: decision",
      "title: Sample page",
      'created: "2026-06-22"',
      'updated: "2026-06-22T12:30"',
      "---",
      "",
      "## compiled_truth",
      "",
      "```yaml",
      "updated: 2026-06-22",
      "time: 2026-06-22T12:30",
      "```",
      "",
      "Current link [[missing-current-link]].",
      "",
      "## timeline-time: 2026-06-22T12:30",
      "  kind: decision",
      "  summary: Historical syntax example [[missing-timeline-link]].",
      "",
    ].join("\n"),
  );

  writeFileSync(
    join(project, "brain", "background.md"),
    [
      "---",
      "slug: background",
      "title: Project background",
      "role: project background",
      'updated: "2026-06-22"',
      "---",
      "",
      "# Project background",
      "",
      "```yaml",
      "updated: 2026-06-22",
      "```",
      "",
    ].join("\n"),
  );

  const brain = await loadBrain();

  const pagePath = join(project, "brain", "pages", "sample-page.md");
  const rootPath = join(project, "brain", "background.md");
  const beforePage = readFileSync(pagePath, "utf8");
  const beforeRoot = readFileSync(rootPath, "utf8");

  const dryRun = brain.normalizeBrainTimestamps({ dryRun: true });
  assert.equal(dryRun.count, 2);
  assert.equal(readFileSync(pagePath, "utf8"), beforePage);
  assert.equal(readFileSync(rootPath, "utf8"), beforeRoot);

  const result = brain.normalizeBrainTimestamps();
  assert.equal(result.count, 2);
  assert.equal(brain.normalizeBrainTimestamps({ dryRun: true }).count, 0);

  const page = readFileSync(pagePath, "utf8");
  assert.match(page, /created: "2026-06-22T00:00:00"/);
  assert.match(page, /updated: "2026-06-22T12:30:00"/);
  assert.match(page, /## timeline\n\n- time: 2026-06-22T12:30:00/);
  assert.match(page, /```yaml\nupdated: 2026-06-22\ntime: 2026-06-22T12:30\n```/);

  const root = readFileSync(rootPath, "utf8");
  assert.match(root, /updated: "2026-06-22T00:00:00"/);
  assert.match(root, /```yaml\nupdated: 2026-06-22\n```/);

  const lint = brain.lintBrainLinks();
  assert.deepEqual(lint.broken.map((b) => b.target), ["missing-current-link"]);
});

test("preserves nested headings inside compiled_truth and appends timeline at EOF", async (t) => {
  const project = makeProject(t);

  writeFileSync(
    join(project, "brain", "pages", "nested.md"),
    [
      "---",
      "id: nested",
      "category: concept",
      "title: Nested headings",
      'created: "2026-06-22T00:00:00"',
      'updated: "2026-06-22T00:00:00"',
      "---",
      "",
      "## compiled_truth",
      "",
      "intro",
      "",
      "## nested heading",
      "",
      "nested content",
      "",
      "## timeline",
      "",
      "- time: 2026-06-22T00:00:00",
      "  kind: note",
      "  summary: first",
      "",
    ].join("\n"),
  );

  const brain = await loadBrain();
  const doc = brain.loadDoc(join(project, "brain", "pages", "nested.md"));

  const truth = brain.extractSection(doc.body, "compiled_truth");
  assert.match(truth, /## nested heading/);
  assert.match(truth, /nested content/);
  assert.doesNotMatch(truth, /## timeline/);

  const entry = brain.formatTimelineEntry({
    time: "2026-06-23T00:00:00",
    kind: "note",
    summary: "second",
  });
  const updated = brain.appendToSection(doc.body, "timeline", entry);
  assert.match(updated, /## nested heading/);
  assert.match(updated, /- time: 2026-06-23T00:00:00\n  kind: note\n  summary: second/);
  assert.ok(updated.trimEnd().endsWith('summary: second'));
});

test("listRootPages only returns canonical root pages", async (t) => {
  const project = makeProject(t);

  writeFileSync(
    join(project, "brain", "background.md"),
    ["---", "slug: background", "title: Background", "role: background", 'updated: "2026-06-22T00:00:00"', "---", "", "# Background", ""].join("\n"),
  );
  writeFileSync(
    join(project, "brain", "custom-root.md"),
    ["---", "slug: custom-root", "title: Custom", "role: custom", 'updated: "2026-06-22T00:00:00"', "---", "", "# Custom", ""].join("\n"),
  );

  const brain = await loadBrain();
  const roots = brain.listRootPages();
  assert.equal(roots.length, 1);
  assert.equal(roots[0].frontmatter.slug, "background");

  const lint = brain.lintBrainLinks();
  assert.equal(lint.rootCount, 1);
});

test("normalizes single-quoted timestamps and ignores already-normalized values", async (t) => {
  const project = makeProject(t);

  writeFileSync(
    join(project, "brain", "pages", "quoted.md"),
    [
      "---",
      "id: quoted",
      "category: reference",
      "title: Quoted",
      "created: '2026-06-22'",
      "updated: '2026-06-22T12:30'",
      "---",
      "",
      "## compiled_truth",
      "",
      "truth",
      "",
      "## timeline",
      "",
      "- time: '2026-06-22T12:30'",
      "  kind: note",
      "  summary: entry",
      "",
    ].join("\n"),
  );

  const brain = await loadBrain();
  const result = brain.normalizeBrainTimestamps();
  assert.equal(result.count, 1);

  const page = readFileSync(join(project, "brain", "pages", "quoted.md"), "utf8");
  assert.match(page, /created: '2026-06-22T00:00:00'/);
  assert.match(page, /updated: '2026-06-22T12:30:00'/);
  assert.match(page, /- time: '2026-06-22T12:30:00'/);
});
