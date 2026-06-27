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

test("lint-links checks compiled_truth but ignores timeline entries", async (t) => {
  const project = makeProject(t);

  writeFileSync(
    join(project, "brain", "pages", "links.md"),
    [
      "---",
      "id: links",
      "category: concept",
      "title: Links",
      'created: "2026-06-22T00:00:00"',
      'updated: "2026-06-22T00:00:00"',
      "---",
      "",
      "## compiled_truth",
      "",
      "Current link [[missing-current-link]].",
      "",
      "## timeline",
      "",
      "- time: 2026-06-22T00:00:00",
      "  kind: note",
      "  summary: Historical syntax example [[missing-timeline-link]].",
      "",
    ].join("\n"),
  );

  const brain = await loadBrain();
  const lint = brain.lintBrainLinks();
  assert.deepEqual(lint.broken.map((b) => b.target), ["missing-current-link"]);
});
