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
      "<!-- compiled_truth -->",
      "",
      "intro",
      "",
      "## nested heading",
      "",
      "nested content",
      "",
      "## Timeline",
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
  assert.doesNotMatch(truth, /## Timeline/);

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

test("reads legacy page markers and interim timeline comment marker", async (t) => {
  const project = makeProject(t);

  writeFileSync(
    join(project, "brain", "pages", "legacy.md"),
    [
      "---",
      "id: legacy",
      "category: concept",
      "title: Legacy markers",
      'created: "2026-06-22T00:00:00"',
      'updated: "2026-06-22T00:00:00"',
      "---",
      "",
      "## compiled_truth",
      "",
      "legacy truth",
      "",
      "## nested heading",
      "",
      "nested content",
      "",
      "## timeline",
      "",
      "- time: 2026-06-22T00:00:00",
      "  kind: note",
      "  summary: legacy timeline",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(project, "brain", "pages", "interim.md"),
    [
      "---",
      "id: interim",
      "category: concept",
      "title: Interim markers",
      'created: "2026-06-22T00:00:00"',
      'updated: "2026-06-22T00:00:00"',
      "---",
      "",
      "<!-- compiled_truth -->",
      "",
      "interim truth",
      "",
      "<!-- timeline -->",
      "",
      "- time: 2026-06-22T00:00:00",
      "  kind: note",
      "  summary: interim timeline",
      "",
    ].join("\n"),
  );

  const brain = await loadBrain();
  const legacy = brain.loadDoc(join(project, "brain", "pages", "legacy.md"));
  const interim = brain.loadDoc(join(project, "brain", "pages", "interim.md"));

  assert.match(brain.extractSection(legacy.body, "compiled_truth"), /## nested heading/);
  assert.match(brain.extractSection(legacy.body, "timeline"), /legacy timeline/);
  assert.match(brain.extractSection(interim.body, "compiled_truth"), /interim truth/);
  assert.match(brain.extractSection(interim.body, "timeline"), /interim timeline/);
});

test("write helpers normalize legacy page markers to the current format", async (t) => {
  const project = makeProject(t);

  writeFileSync(
    join(project, "brain", "pages", "legacy-write.md"),
    [
      "---",
      "id: legacy-write",
      "category: concept",
      "title: Legacy write markers",
      'created: "2026-06-22T00:00:00"',
      'updated: "2026-06-22T00:00:00"',
      "---",
      "",
      "## compiled_truth",
      "",
      "old truth",
      "",
      "## timeline",
      "",
      "- time: 2026-06-22T00:00:00",
      "  kind: note",
      "  summary: old timeline",
      "",
    ].join("\n"),
  );

  const brain = await loadBrain();
  const doc = brain.loadDoc(join(project, "brain", "pages", "legacy-write.md"));
  const entry = brain.formatTimelineEntry({
    time: "2026-06-23T00:00:00",
    kind: "decision",
    summary: "normalized markers",
  });

  let body = brain.replaceSection(doc.body, "compiled_truth", "new truth");
  body = brain.appendToSection(body, "timeline", entry);

  assert.match(body, /<!-- compiled_truth -->/);
  assert.doesNotMatch(body, /^## compiled_truth$/m);
  assert.match(body, /^## Timeline$/m);
  assert.doesNotMatch(body, /^## timeline$/m);
  assert.match(brain.extractSection(body, "compiled_truth"), /new truth/);
  assert.match(brain.extractSection(body, "timeline"), /normalized markers/);
});

test("append helper normalizes compiled_truth marker even when only timeline changes", async (t) => {
  const project = makeProject(t);

  writeFileSync(
    join(project, "brain", "pages", "append-only.md"),
    [
      "---",
      "id: append-only",
      "category: concept",
      "title: Append only",
      'created: "2026-06-22T00:00:00"',
      'updated: "2026-06-22T00:00:00"',
      "---",
      "",
      "## compiled_truth",
      "",
      "truth that is not being rewritten",
      "",
      "## timeline",
      "",
      "- time: 2026-06-22T00:00:00",
      "  kind: note",
      "  summary: old timeline",
      "",
    ].join("\n"),
  );

  const brain = await loadBrain();
  const doc = brain.loadDoc(join(project, "brain", "pages", "append-only.md"));
  const entry = brain.formatTimelineEntry({
    time: "2026-06-23T00:00:00",
    kind: "note",
    summary: "append only",
  });

  const body = brain.appendToSection(doc.body, "timeline", entry);

  assert.match(body, /<!-- compiled_truth -->/);
  assert.doesNotMatch(body, /^## compiled_truth$/m);
  assert.match(body, /^## Timeline$/m);
  assert.doesNotMatch(body, /^## timeline$/m);
  assert.match(brain.extractSection(body, "compiled_truth"), /truth that is not being rewritten/);
  assert.match(brain.extractSection(body, "timeline"), /append only/);
});

test("prefers visible Timeline marker over comment text in compiled_truth", async (t) => {
  const project = makeProject(t);

  writeFileSync(
    join(project, "brain", "pages", "mixed.md"),
    [
      "---",
      "id: mixed",
      "category: concept",
      "title: Mixed markers",
      'created: "2026-06-22T00:00:00"',
      'updated: "2026-06-22T00:00:00"',
      "---",
      "",
      "<!-- compiled_truth -->",
      "",
      "```markdown",
      "<!-- timeline -->",
      "```",
      "",
      "content after example",
      "",
      "## Timeline",
      "",
      "- time: 2026-06-22T00:00:00",
      "  kind: note",
      "  summary: real timeline",
      "",
    ].join("\n"),
  );

  const brain = await loadBrain();
  const doc = brain.loadDoc(join(project, "brain", "pages", "mixed.md"));
  const truth = brain.extractSection(doc.body, "compiled_truth");

  assert.match(truth, /<!-- timeline -->/);
  assert.match(truth, /content after example/);
  assert.match(brain.extractSection(doc.body, "timeline"), /real timeline/);
});

test("prefers interim timeline comment over visible Timeline heading inside compiled_truth", async (t) => {
  const project = makeProject(t);

  writeFileSync(
    join(project, "brain", "pages", "interim-heading.md"),
    [
      "---",
      "id: interim-heading",
      "category: concept",
      "title: Interim heading",
      'created: "2026-06-22T00:00:00"',
      'updated: "2026-06-22T00:00:00"',
      "---",
      "",
      "<!-- compiled_truth -->",
      "",
      "Intro.",
      "",
      "## Timeline",
      "",
      "This is a normal compiled_truth heading.",
      "",
      "<!-- timeline -->",
      "",
      "- time: 2026-06-22T00:00:00",
      "  kind: note",
      "  summary: real timeline",
      "",
    ].join("\n"),
  );

  const brain = await loadBrain();
  const doc = brain.loadDoc(join(project, "brain", "pages", "interim-heading.md"));
  const truth = brain.extractSection(doc.body, "compiled_truth");

  assert.match(truth, /## Timeline/);
  assert.match(truth, /normal compiled_truth heading/);
  assert.doesNotMatch(truth, /real timeline/);
  assert.match(brain.extractSection(doc.body, "timeline"), /real timeline/);
});

test("ignores stray interim timeline comment after existing timeline entries", async (t) => {
  const project = makeProject(t);

  writeFileSync(
    join(project, "brain", "pages", "stray-comment.md"),
    [
      "---",
      "id: stray-comment",
      "category: concept",
      "title: Stray comment",
      'created: "2026-06-22T00:00:00"',
      'updated: "2026-06-22T00:00:00"',
      "---",
      "",
      "<!-- compiled_truth -->",
      "",
      "Truth.",
      "",
      "## Timeline",
      "",
      "- time: 2026-06-22T00:00:00",
      "  kind: note",
      "  summary: real timeline",
      "",
      "<!-- timeline -->",
      "",
    ].join("\n"),
  );

  const brain = await loadBrain();
  const doc = brain.loadDoc(join(project, "brain", "pages", "stray-comment.md"));
  const entry = brain.formatTimelineEntry({
    time: "2026-06-23T00:00:00",
    kind: "note",
    summary: "appended after real timeline",
  });

  const body = brain.appendToSection(doc.body, "timeline", entry);

  assert.match(body, /^## Timeline$/m);
  assert.match(body, /summary: real timeline[\s\S]*summary: appended after real timeline/);
  assert.doesNotMatch(body, /<!-- timeline -->/);
  assert.equal([...body.matchAll(/^## Timeline$/gm)].length, 1);
});

test("uses final empty Timeline marker as compiled_truth boundary", async (t) => {
  const project = makeProject(t);

  writeFileSync(
    join(project, "brain", "pages", "empty-timeline.md"),
    [
      "---",
      "id: empty-timeline",
      "category: concept",
      "title: Empty timeline",
      'created: "2026-06-22T00:00:00"',
      'updated: "2026-06-22T00:00:00"',
      "---",
      "",
      "<!-- compiled_truth -->",
      "",
      "A normal section that mentions timeline history:",
      "",
      "## Timeline",
      "",
      "- this is ordinary compiled_truth content, not a timeline entry",
      "",
      "## Timeline",
      "",
    ].join("\n"),
  );

  const brain = await loadBrain();
  const doc = brain.loadDoc(join(project, "brain", "pages", "empty-timeline.md"));
  const entry = brain.formatTimelineEntry({
    time: "2026-06-23T00:00:00",
    kind: "note",
    summary: "first real timeline entry",
  });

  const truth = brain.extractSection(doc.body, "compiled_truth");
  const body = brain.appendToSection(doc.body, "timeline", entry);

  assert.match(truth, /ordinary compiled_truth content/);
  assert.doesNotMatch(truth, /first real timeline entry/);
  assert.match(body, /ordinary compiled_truth content[\s\S]*summary: first real timeline entry/);
  assert.equal([...body.matchAll(/^## Timeline$/gm)].length, 2);
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
      "<!-- compiled_truth -->",
      "",
      "Current link [[missing-current-link]].",
      "",
      "## Timeline",
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
