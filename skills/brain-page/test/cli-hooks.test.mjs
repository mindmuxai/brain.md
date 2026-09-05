import test from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "brain.mjs");
const HOOK_SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "brain-setup", "hooks", "session-start");
const HOOK_COMMAND = "${CLAUDE_PROJECT_DIR}/.claude/hooks/brain-session-start";

function makeEmptyProject(t) {
  const originalCwd = process.cwd();
  const project = mkdtempSync(join(tmpdir(), "brain-hooks-"));
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
    env: { ...process.env, ...(opts.env || {}) },
  });
}

function runHook(project, opts = {}) {
  const hook = opts.hookPath || join(project, ".claude", "hooks", "brain-session-start");
  return spawnSync("sh", [hook], {
    cwd: project,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: opts.home || join(project, "no-such-home"),
      CLAUDE_PROJECT_DIR: opts.claudeProjectDir === undefined ? project : opts.claudeProjectDir,
      BRAIN_CLI: opts.brainCli || "",
      PATH: opts.path || process.env.PATH,
      ...(opts.env || {}),
    },
  });
}

function writeMockCli(project, { populated = true, listPages = "demo-id\tDemo title\tdecision\tactive\n", failDir = false, failList = false } = {}) {
  const mock = join(project, "mock-brain.mjs");
  const log = join(project, "mock-brain.log");
  writeFileSync(
    mock,
    [
      "#!/usr/bin/env node",
      "import { appendFileSync } from 'node:fs';",
      `const log = ${JSON.stringify(log)};`,
      "appendFileSync(log, process.argv.slice(2).join(' ') + '\\n');",
      "const sub = process.argv[2];",
      `if (sub === 'brain-dir') {`,
      failDir ? "  process.exit(1);" : "",
      "  console.log('/tmp/fake-brain');",
      "  console.log('(default ./brain)');",
      "  console.log('source: default');",
      "  console.log('exists: true');",
      `  console.log('populated: ${populated ? "true" : "false"}');`,
      "  process.exit(0);",
      "}",
      `if (sub === 'list-pages') {`,
      failList ? "  process.exit(1);" : "",
      `  process.stdout.write(${JSON.stringify(listPages)});`,
      "  process.exit(0);",
      "}",
      "process.exit(1);",
      "",
    ].join("\n"),
  );
  chmodSync(mock, 0o755);
  writeFileSync(log, "");
  return { mock, log };
}

function settingsPath(project) {
  return join(project, ".claude", "settings.json");
}

function readSettings(project) {
  return JSON.parse(readFileSync(settingsPath(project), "utf8"));
}

function countOurHooks(settings) {
  const groups = settings?.hooks?.SessionStart || [];
  let n = 0;
  for (const g of groups) {
    for (const h of g.hooks || []) {
      if (typeof h.command === "string" && h.command.includes("brain-session-start")) n += 1;
    }
  }
  return n;
}

test("install-hooks writes project-local SessionStart command and copies the script", (t) => {
  const project = makeEmptyProject(t);
  const home = join(project, "home");
  mkdirSync(join(home, ".claude"), { recursive: true });

  const r = runBrain(project, ["install-hooks"], { env: { HOME: home } });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /installed Claude Code SessionStart hook/);
  assert.match(r.stdout, /project-local/);

  assert.ok(existsSync(join(project, ".claude", "hooks", "brain-session-start")));
  const settings = readSettings(project);
  assert.equal(countOurHooks(settings), 1);
  assert.equal(settings.hooks.SessionStart[0].hooks[0].type, "command");
  assert.equal(settings.hooks.SessionStart[0].hooks[0].command, HOOK_COMMAND);

  assert.ok(!existsSync(join(home, ".claude", "settings.json")));
});

test("install-hooks is idempotent and preserves unrelated settings", (t) => {
  const project = makeEmptyProject(t);
  mkdirSync(join(project, ".claude"), { recursive: true });
  writeFileSync(
    settingsPath(project),
    JSON.stringify(
      {
        permissions: { allow: ["Bash"] },
        hooks: {
          PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo other" }] }],
          SessionStart: [{ hooks: [{ type: "command", command: "echo already-there" }] }],
        },
      },
      null,
      2,
    ) + "\n",
  );

  let r = runBrain(project, ["install-hooks"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  r = runBrain(project, ["install-hooks"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);

  const settings = readSettings(project);
  assert.deepEqual(settings.permissions, { allow: ["Bash"] });
  assert.equal(settings.hooks.PreToolUse[0].hooks[0].command, "echo other");
  assert.equal(settings.hooks.SessionStart[0].hooks[0].command, "echo already-there");
  assert.equal(countOurHooks(settings), 1);
  assert.equal(readFileSync(settingsPath(project), "utf8"), JSON.stringify(readSettings(project), null, 2) + "\n");
});

test("uninstall-hooks is idempotent and leaves other hooks in place", (t) => {
  const project = makeEmptyProject(t);
  mkdirSync(join(project, ".claude"), { recursive: true });
  writeFileSync(
    settingsPath(project),
    JSON.stringify(
      {
        hooks: {
          SessionStart: [{ hooks: [{ type: "command", command: "echo keep-me" }] }],
        },
      },
      null,
      2,
    ) + "\n",
  );

  let r = runBrain(project, ["install-hooks"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  r = runBrain(project, ["uninstall-hooks"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /removed Claude Code SessionStart hook/);

  const settings = readSettings(project);
  assert.equal(countOurHooks(settings), 0);
  assert.equal(settings.hooks.SessionStart[0].hooks[0].command, "echo keep-me");
  assert.ok(!existsSync(join(project, ".claude", "hooks", "brain-session-start")));

  r = runBrain(project, ["uninstall-hooks"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /not installed/);
  assert.equal(readSettings(project).hooks.SessionStart[0].hooks[0].command, "echo keep-me");
});

test("uninstall-hooks removes an empty settings file it emptied", (t) => {
  const project = makeEmptyProject(t);
  const r1 = runBrain(project, ["install-hooks"]);
  assert.equal(r1.status, 0, r1.stderr || r1.stdout);
  const r2 = runBrain(project, ["uninstall-hooks"]);
  assert.equal(r2.status, 0, r2.stderr || r2.stdout);
  assert.ok(!existsSync(settingsPath(project)));
});

test("install-hooks fails loudly on damaged settings JSON", (t) => {
  const project = makeEmptyProject(t);
  mkdirSync(join(project, ".claude"), { recursive: true });
  writeFileSync(settingsPath(project), "{ not json");
  const r = runBrain(project, ["install-hooks"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /not valid JSON/);
  assert.equal(readFileSync(settingsPath(project), "utf8"), "{ not json");
});

test("hook no-ops without a populated brain (real CLI)", (t) => {
  const project = makeEmptyProject(t);
  const rInstall = runBrain(project, ["install-hooks"]);
  assert.equal(rInstall.status, 0, rInstall.stderr || rInstall.stdout);

  const r = runHook(project, { brainCli: CLI });
  assert.equal(r.status, 0, r.stderr);
  assert.equal((r.stdout || "").trim(), "");
});

test("hook injects list-pages snapshot when the brain is populated", (t) => {
  const project = makeEmptyProject(t);
  let r = runBrain(project, ["init", "--no-wire"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  r = runBrain(project, [
    "create-page",
    "--id",
    "store-as-markdown",
    "--category",
    "decision",
    "--title",
    "Store config as Markdown",
  ]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  r = runBrain(
    project,
    ["update-truth", "--id", "store-as-markdown", "--summary", "capture secret body"],
    { input: "SECRET_BODY_MUST_NOT_LEAK_INTO_THE_HOOK\n" },
  );
  assert.equal(r.status, 0, r.stderr || r.stdout);

  r = runBrain(project, ["install-hooks"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);

  const hook = runHook(project, { brainCli: CLI });
  assert.equal(hook.status, 0, hook.stderr);
  assert.match(hook.stdout, /brain list-pages/);
  assert.match(hook.stdout, /store-as-markdown/);
  assert.doesNotMatch(hook.stdout, /SECRET_BODY_MUST_NOT_LEAK_INTO_THE_HOOK/);
});

test("hook no-ops when brain-dir reports not populated (mock CLI)", (t) => {
  const project = makeEmptyProject(t);
  const rInstall = runBrain(project, ["install-hooks"]);
  assert.equal(rInstall.status, 0, rInstall.stderr || rInstall.stdout);
  const { mock, log } = writeMockCli(project, { populated: false, listPages: "should-not-run\n" });

  const r = runHook(project, { brainCli: mock });
  assert.equal(r.status, 0, r.stderr);
  assert.equal((r.stdout || "").trim(), "");
  const invoked = readFileSync(log, "utf8");
  assert.match(invoked, /brain-dir/);
  assert.doesNotMatch(invoked, /list-pages/);
});

test("hook failure-opens: missing CLI, failing brain-dir, failing list-pages", (t) => {
  const project = makeEmptyProject(t);
  const rInstall = runBrain(project, ["install-hooks"]);
  assert.equal(rInstall.status, 0, rInstall.stderr || rInstall.stdout);

  const missing = runHook(project, { brainCli: join(project, "no-such-cli.mjs"), path: "/usr/bin:/bin" });
  assert.equal(missing.status, 0, missing.stderr);
  assert.equal((missing.stdout || "").trim(), "");

  const { mock: failDir } = writeMockCli(project, { failDir: true });
  const dirFail = runHook(project, { brainCli: failDir });
  assert.equal(dirFail.status, 0, dirFail.stderr);
  assert.equal((dirFail.stdout || "").trim(), "");

  const { mock: failList } = writeMockCli(project, { populated: true, failList: true });
  const listFail = runHook(project, { brainCli: failList });
  assert.equal(listFail.status, 0, listFail.stderr);
  assert.equal((listFail.stdout || "").trim(), "");
});

test("hook shells out to the CLI and never touches brain files itself", (t) => {
  const src = readFileSync(HOOK_SRC, "utf8");
  assert.match(src, /\bbrain-dir\b/);
  assert.match(src, /\blist-pages\b/);
  assert.doesNotMatch(src, /brain\/pages/);
  assert.doesNotMatch(src, /index\.md/);
  assert.doesNotMatch(src, /\bcat\b/);
  assert.doesNotMatch(src, /readFile|writeFile|open\(/);

  const project = makeEmptyProject(t);
  const rInstall = runBrain(project, ["install-hooks"]);
  assert.equal(rInstall.status, 0, rInstall.stderr || rInstall.stdout);

  mkdirSync(join(project, "brain", "pages"), { recursive: true });
  writeFileSync(join(project, "brain", "pages", "secret.md"), "SECRET_FROM_FILE_NOT_CLI\n");

  const { mock, log } = writeMockCli(project, {
    populated: true,
    listPages: "from-cli\tFrom CLI\tdecision\tactive\n",
  });
  const r = runHook(project, { brainCli: mock });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /from-cli/);
  assert.doesNotMatch(r.stdout, /SECRET_FROM_FILE_NOT_CLI/);
  assert.match(readFileSync(log, "utf8"), /brain-dir[\s\S]*list-pages/);

  const installed = readFileSync(join(project, ".claude", "hooks", "brain-session-start"), "utf8");
  assert.equal(installed, src);
  const settings = readSettings(project);
  assert.equal(settings.hooks.SessionStart[0].hooks[0].command, HOOK_COMMAND);
});

test("help lists install-hooks and uninstall-hooks as project-local", (t) => {
  const project = makeEmptyProject(t);
  const r = runBrain(project, ["help"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /install-hooks/);
  assert.match(r.stdout, /uninstall-hooks/);
  assert.match(r.stdout, /project-local/);
});

test("init does not install the SessionStart hook (opt-in)", (t) => {
  const project = makeEmptyProject(t);
  const r = runBrain(project, ["init", "--no-wire"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /install-hooks/);
  assert.ok(!existsSync(settingsPath(project)));
});

function codexSettings(project) {
  return JSON.parse(readFileSync(join(project, ".codex", "hooks.json"), "utf8"));
}

function installCodex(project) {
  const r = runBrain(project, ["install-hooks", "--agent", "codex"]);
  assert.equal(r.status, 0, r.stderr);
  return codexSettings(project).hooks.SessionStart.at(-1);
}

function runCodexHook(project, { cwd = project, brainCli = CLI, ...env } = {}) {
  const command = codexSettings(project).hooks.SessionStart.at(-1).hooks[0].command;
  return spawnSync("sh", ["-c", command], {
    cwd, encoding: "utf8", input: JSON.stringify({ source: "startup", cwd }),
    env: { ...process.env, HOME: join(project, "no-home"), BRAIN_CLI: brainCli, ...env },
  });
}

test("Codex and Claude install/remove independently and preserve mixed hook groups", (t) => {
  const project = makeEmptyProject(t);
  const home = join(project, "home");
  const config = join(project, ".codex", "config.toml");
  mkdirSync(dirname(config), { recursive: true });
  writeFileSync(config, "model = 'gpt-6-astra'\n");
  const unrelated = { description: "keep", hooks: { Stop: [], SessionStart: [
    { matcher: "resume", hooks: [] },
    { hooks: [{ type: "command", command: "/other/brain-session-start" }] },
  ] } };
  const settings = join(project, ".codex", "hooks.json");
  writeFileSync(settings, JSON.stringify(unrelated));
  const group = installCodex(project);
  assert.equal(group.matcher, "^(startup|resume|clear|compact)$");
  assert.equal(group.hooks[0].timeout, 5);
  assert.equal(group.hooks[0].additionalContextLimit, undefined);
  const first = readFileSync(settings, "utf8");
  installCodex(project);
  assert.equal(readFileSync(settings, "utf8"), first);
  assert.equal(runBrain(project, ["install-hooks", "--agent=claude-code"], { env: { HOME: home } }).status, 0);
  const claude = readFileSync(settingsPath(project), "utf8");
  // A sibling inside our matcher group must survive removal too.
  const mixed = codexSettings(project);
  mixed.hooks.SessionStart.at(-1).hooks.push({ type: "command", command: "echo keep" });
  writeFileSync(settings, JSON.stringify(mixed));
  for (let i = 0; i < 2; i++) {
    assert.equal(runBrain(project, ["uninstall-hooks", "--agent", "codex"]).status, 0);
    assert.equal(readFileSync(settingsPath(project), "utf8"), claude);
  }
  assert.deepEqual(codexSettings(project), {
    ...unrelated, hooks: { ...unrelated.hooks, SessionStart: [
      ...unrelated.hooks.SessionStart,
      { matcher: group.matcher, hooks: [{ type: "command", command: "echo keep" }] },
    ] },
  });
  assert.equal(readFileSync(config, "utf8"), "model = 'gpt-6-astra'\n");
  assert.ok(!existsSync(join(home, ".codex", "hooks.json")));
  installCodex(project);
  const codex = readFileSync(settings, "utf8");
  assert.equal(runBrain(project, ["uninstall-hooks"]).status, 0);
  assert.equal(readFileSync(settings, "utf8"), codex);
});

test("hook commands reject invalid arguments, damaged settings and foreign scripts without writes", (t) => {
  const project = makeEmptyProject(t);
  for (const args of [["--agent"], ["--agent", "all"], ["--agent="], ["--agent", "codex", "extra"], ["--typo"]]) {
    for (const sub of ["install-hooks", "uninstall-hooks"]) {
      assert.notEqual(runBrain(project, [sub, ...args]).status, 0);
    }
  }
  assert.ok(!existsSync(join(project, ".claude")));
  assert.ok(!existsSync(join(project, ".codex")));
  const settings = join(project, ".codex", "hooks.json");
  mkdirSync(dirname(settings));
  for (const raw of ["{ broken", "null", "[]", '{"hooks":[]}', '{"hooks":{"SessionStart":{}}}', '{"hooks":{"SessionStart":[{"hooks":null}]}}']) {
    writeFileSync(settings, raw);
    for (const sub of ["install-hooks", "uninstall-hooks"]) {
      assert.notEqual(runBrain(project, [sub, "--agent=codex"]).status, 0);
      assert.equal(readFileSync(settings, "utf8"), raw);
      assert.ok(!existsSync(join(project, ".codex", "hooks")));
    }
  }
  writeFileSync(settings, "{}");
  const script = join(project, ".codex", "hooks", "brain-session-start");
  mkdirSync(dirname(script));
  writeFileSync(script, "#!/bin/sh\necho foreign\n");
  for (const sub of ["install-hooks", "uninstall-hooks"]) {
    assert.notEqual(runBrain(project, [sub, "--agent", "codex"]).status, 0);
    assert.equal(readFileSync(script, "utf8"), "#!/bin/sh\necho foreign\n");
    assert.equal(readFileSync(settings, "utf8"), "{}");
  }
});

test("Codex hook resolves redirected brains from nested and shell-special paths", (t) => {
  const parent = makeEmptyProject(t);
  const project = join(parent, "project ' $HOME $(touch INJECTED) `touch INJECTED` ü");
  const nested = join(project, "src", "nested");
  mkdirSync(nested, { recursive: true });
  mkdirSync(join(project, ".mindmux"));
  for (const brainRoot of [join(parent, "sidecar"), "../relative-sidecar"]) {
    writeFileSync(join(project, ".mindmux", "preferences.json"), JSON.stringify({ brainRoot }));
    assert.equal(runBrain(project, ["init", "--no-wire"]).status, 0);
    assert.ok(!existsSync(join(project, ".codex", "hooks.json")));
    assert.equal(runBrain(project, ["create-page", "--id", "decision", "--category", "decision", "--title", "Café 日本語"]).status, 0);
    assert.equal(runBrain(project, ["update-truth", "--id", "decision"], { input: "PRIVATE_PAGE_BODY" }).status, 0);
    installCodex(project);
    const first = runCodexHook(project, { cwd: nested, CLAUDE_PROJECT_DIR: parent });
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /decision\tCafé 日本語/);
    assert.doesNotMatch(first.stdout, /PRIVATE_PAGE_BODY/);
    assert.equal(runCodexHook(project).stdout, first.stdout);
    assert.equal(runBrain(project, ["create-page", "--id", "new-page", "--category", "decision", "--title", "New"]).status, 0);
    assert.match(runCodexHook(project, { cwd: nested }).stdout, /new-page/);
    assert.ok(!existsSync(join(project, "brain")));
    assert.ok(!existsSync(join(nested, "brain")));
    assert.ok(!existsSync(join(nested, "INJECTED")));
    assert.equal(runBrain(project, ["uninstall-hooks", "--agent", "codex"]).status, 0);
    assert.ok(!existsSync(join(project, ".codex", "hooks.json")));
    assert.equal(runBrain(project, ["uninstall-hooks", "--agent", "codex"]).status, 0);
  }
});

test("Codex hook stays silent for missing/empty brains and CLI failures", (t) => {
  const project = makeEmptyProject(t);
  installCodex(project);
  assert.equal(runCodexHook(project).stdout, "");
  mkdirSync(join(project, "brain", "pages"), { recursive: true });
  assert.equal(runCodexHook(project).stdout, "");
  for (const opts of [{ populated: false }, { failDir: true }, { failList: true }, { listPages: "" }]) {
    const { mock } = writeMockCli(project, opts);
    const r = runCodexHook(project, { brainCli: mock });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
    assert.equal(r.stderr, "");
  }
  const missing = runCodexHook(project, { brainCli: "", PATH: "/usr/bin:/bin" });
  assert.equal(missing.status, 0);
  assert.equal(missing.stdout, "");
  assert.equal(missing.stderr, "");
});

test("Codex snapshot preserves whole UTF-8 rows within 8 KiB and refreshes every run", (t) => {
  const project = makeEmptyProject(t);
  installCodex(project);
  for (const rows of [
    ["small\tCafé 日本語\tdecision\tactive"],
    Array.from({ length: 500 }, (_, i) => `page-${i}\tCafé 日本語 ${i}\tdecision\tactive`),
    [`huge\t${"界".repeat(9000)}\tdecision\tactive`, "after\tAfter\tdecision\tactive"],
  ]) {
    const { mock } = writeMockCli(project, { listPages: rows.join("\n") + "\n" });
    const r = runCodexHook(project, { brainCli: mock });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(Buffer.byteLength(r.stdout) <= 8192);
    assert.doesNotMatch(r.stdout, /\uFFFD/);
    const emitted = r.stdout.split("\n").filter((line) => line.includes("\t"));
    assert.deepEqual(emitted, rows.slice(0, emitted.length));
    if (emitted.length < rows.length) assert.match(r.stdout, /Index truncated; run brain list-pages/);
    else assert.doesNotMatch(r.stdout, /truncated/);
    assert.equal(runCodexHook(project, { brainCli: mock }).stdout, r.stdout);
  }
});

test("Codex hook finds a project-installed skill without BRAIN_CLI", (t) => {
  const project = makeEmptyProject(t);
  installCodex(project);
  const { mock } = writeMockCli(project);
  const local = join(project, ".codex", "skills", "brain-page", "bin", "brain.mjs");
  mkdirSync(dirname(local), { recursive: true });
  writeFileSync(local, readFileSync(mock));
  assert.match(runCodexHook(project, { brainCli: "" }).stdout, /demo-id/);
});


test("hook installation and removal refuse symlinks outside the project", (t) => {
  for (const link of [".codex", ".codex/hooks", ".codex/hooks.json", ".codex/hooks/brain-session-start"]) {
    const project = makeEmptyProject(t);
    const outside = makeEmptyProject(t);
    const dest = join(project, link);
    mkdirSync(dirname(dest), { recursive: true });
    const target = link.endsWith("json") || link.endsWith("brain-session-start") ? join(outside, "file") : outside;
    if (target !== outside) writeFileSync(target, "{}");
    symlinkSync(target, dest);
    for (const sub of ["install-hooks", "uninstall-hooks"]) {
      const result = runBrain(project, [sub, "--agent", "codex"]);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /refusing hook symlink/);
    }
    if (target !== outside) assert.equal(readFileSync(target, "utf8"), "{}");
    assert.ok(!existsSync(join(outside, "hooks")));
  }
});
