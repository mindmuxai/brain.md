// Shared installer logic for the brain-md setup / uninstall entry points.
//
// The toolkit (skills + the brain CLI) installs once, across all projects.
// Installing NEVER touches any project's brain knowledge — that is per-project
// state, created on demand by the brain-setup skill and never managed here.
//
// Default mode copies each skill bundle into the target agent's skills directory
// (robust on Windows and after the source repo moves). `--symlink` keeps the old
// symlink behaviour for development. `--project` installs into the current
// project's `.claude/`, `.codex/`, … instead of the user's home, for a
// self-contained, clone-and-go checkout.
//
// Zero npm dependencies — Node.js built-ins only.

import {
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
  rmdirSync,
  mkdirSync,
  cpSync,
  symlinkSync,
  lstatSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { createInterface } from "node:readline";

const HERE = dirname(fileURLToPath(import.meta.url)); // <pkg>/bin/lib
export const PKG_ROOT = dirname(dirname(HERE)); // <pkg>
const SRC = join(PKG_ROOT, "skills");

// Marker file dropped inside each copied skill bundle so we can recognise our
// own copies later (idempotent re-install + safe uninstall), and tell them apart
// from a directory the user put there by hand.
const MARKER = ".brain-md-installed";

// ---- small fs helpers -------------------------------------------------------

function lexists(p) {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

function isSymlink(p) {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

function isOurCopy(p) {
  try {
    return lstatSync(p).isDirectory() && existsSync(join(p, MARKER));
  } catch {
    return false;
  }
}

function die(msg) {
  console.error(msg);
  process.exit(1);
}

// ---- interaction ------------------------------------------------------------

// Ask a y/N question. Returns a function so the readline interface is opened
// once and closed once. Honours --yes (always true); otherwise reads stdin and
// defaults to no on empty/closed input.
function makeAsker(assumeYes) {
  if (assumeYes) {
    const f = async () => true;
    f.close = () => {};
    return f;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) =>
    new Promise((res) => rl.question(`${q} [y/N] `, (a) => res(/^y(es)?$/i.test(String(a).trim()))));
  ask.close = () => rl.close();
  return ask;
}

function printLogo() {
  process.stdout.write(`
  ██████╗ ██████╗  █████╗ ██╗███╗   ██╗   ███╗   ███╗██████╗
  ██╔══██╗██╔══██╗██╔══██╗██║████╗  ██║   ████╗ ████║██╔══██╗
  ██████╔╝██████╔╝███████║██║██╔██╗ ██║   ██╔████╔██║██║  ██║
  ██╔══██╗██╔══██╗██╔══██║██║██║╚██╗██║   ██║╚██╔╝██║██║  ██║
  ██████╔╝██║  ██║██║  ██║██║██║ ╚████║██╗██║ ╚═╝ ██║██████╔╝
  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚═╝╚═════╝

  Open Project Brain Standard — install-first, agent-agnostic toolkit.

`);
}

// ---- state manifest ---------------------------------------------------------

// Where the install manifest lives. Global installs record into the XDG state
// dir; project installs record alongside the project so the two never collide.
function manifestPath(project) {
  if (project) return join(process.cwd(), ".brain.md", "installed-skills");
  const stateHome = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  return join(stateHome, "brain.md", "installed-links");
}

// Parse the manifest into { mode, target } records. Each line is
// "<mode>\t<target>"; a bare path (legacy symlink-only format) is read as a link.
function readManifest(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.replace(/\r$/, "").trim())
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf("\t");
      if (tab === -1) return { mode: "link", target: line };
      return { mode: line.slice(0, tab), target: line.slice(tab + 1) };
    });
}

function serializeManifest(entries) {
  const map = new Map();
  for (const e of entries) map.set(e.target, e.mode); // dedup by target, last wins
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([target, mode]) => `${mode}\t${target}`)
    .join("\n");
}

function writeManifest(path, entries) {
  mkdirSync(dirname(path), { recursive: true });
  const body = serializeManifest(entries);
  writeFileSync(path, body ? `${body}\n` : "");
}

// ---- runtime targets --------------------------------------------------------

// Candidate agent runtimes: their parent config dir and the skills dir inside it.
// Global mode roots at $HOME; project mode roots at the current working dir.
function runtimeCandidates(project) {
  const base = project ? process.cwd() : homedir();
  // OpenCode's config dir differs by scope: project-local at <project>/.opencode,
  // global at ~/.config/opencode (whereas Claude/Codex use the same segment for both).
  const opencodeParent = project ? join(base, ".opencode") : join(base, ".config", "opencode");
  return [
    { label: "Claude", parent: join(base, ".claude"), skills: join(base, ".claude", "skills") },
    { label: "Codex", parent: join(base, ".codex"), skills: join(base, ".codex", "skills") },
    { label: "OpenCode", parent: opencodeParent, skills: join(opencodeParent, "skills") },
  ];
}

function discoverSkills() {
  if (!existsSync(SRC)) die(`setup: no skills/ directory in the package (${SRC})`);
  const skills = readdirSync(SRC).filter((n) => existsSync(join(SRC, n, "SKILL.md")));
  if (!skills.length) die(`setup: no skill bundles found under ${SRC}`);
  return skills;
}

// ---- install / remove a single skill ---------------------------------------

// Install one skill into a target path. Returns a manifest record, or null when
// it was skipped (an unrelated directory was in the way and can't be backed up).
function installSkill({ source, target, mode }) {
  if (lexists(target)) {
    if (isSymlink(target)) {
      rmSync(target, { force: true });
    } else if (isOurCopy(target)) {
      rmSync(target, { recursive: true, force: true }); // our own previous copy → refresh
    } else {
      // A real directory we didn't create is in the way — back it up once.
      const backup = `${target}.pre-brain.bak`;
      if (lexists(backup)) {
        console.error(`setup: ${target} exists and ${backup} is taken; skipping (resolve manually)`);
        return null;
      }
      renameSync(target, backup);
      console.log(`setup: moved existing ${target} -> ${backup}`);
    }
  }

  if (mode === "link") {
    symlinkSync(source, target);
    console.log(`setup: linked ${target} -> ${source}`);
    return { mode: "link", target };
  }

  cpSync(source, target, { recursive: true });
  writeFileSync(join(target, MARKER), `source=${source}\n`);
  console.log(`setup: copied ${target}`);
  return { mode: "copy", target };
}

// Remove one skill recorded in the manifest. Returns true when removed.
function removeSkill({ mode, target }) {
  if (mode === "link") {
    if (isSymlink(target)) {
      rmSync(target, { force: true });
      console.log(`uninstall: removed ${target}`);
      restoreBackup(target);
      return true;
    }
    if (lexists(target)) console.error(`uninstall: ${target} is not our symlink; leaving it untouched`);
    return false;
  }
  // copy
  if (isOurCopy(target)) {
    rmSync(target, { recursive: true, force: true });
    console.log(`uninstall: removed ${target}`);
    restoreBackup(target);
    return true;
  }
  if (lexists(target)) console.error(`uninstall: ${target} is not our copy; leaving it untouched`);
  return false;
}

function restoreBackup(target) {
  const backup = `${target}.pre-brain.bak`;
  if (lexists(backup)) {
    renameSync(backup, target);
    console.log(`uninstall: restored ${target} from ${backup}`);
  }
}

// ---- public commands --------------------------------------------------------

export async function runSetup({ assumeYes = false, symlink = false, project = false } = {}) {
  const skills = discoverSkills();
  const mode = symlink ? "link" : "copy";

  printLogo();
  console.log(`Mode: ${mode === "link" ? "symlink (dev)" : "copy"} · Scope: ${project ? "project" : "global"}\n`);

  const candidates = runtimeCandidates(project);
  let detected;
  if (project) {
    // Project scope is opt-in for THIS checkout — offer every runtime and create
    // its config dir on confirm, rather than only the ones that already exist.
    detected = candidates;
    console.log("Project-level runtimes (created on confirm):");
    for (const c of candidates) console.log(`  ${c.label} (${c.parent})`);
  } else {
    detected = [];
    console.log("Detecting supported runtimes:");
    for (const c of candidates) {
      if (existsSync(c.parent)) {
        console.log(`  [found]   ${c.label} (${c.parent})`);
        detected.push(c);
      } else {
        console.log(`  [missing] ${c.label} (${c.parent})`);
      }
    }
  }
  console.log();

  if (!detected.length) {
    die(
      "setup: no agent config directories detected (looked for ~/.claude, ~/.codex, ~/.config/opencode).\n" +
        "setup: create one, or use --project to install into this project, then re-run."
    );
  }

  const ask = makeAsker(assumeYes);
  const records = [];
  let installedAny = false;
  try {
    for (const c of detected) {
      if (!(await ask(`Install brain.md skills into ${c.label} (${c.parent})?`))) {
        console.log(`setup: skipped ${c.label}.`);
        continue;
      }
      mkdirSync(c.skills, { recursive: true });
      for (const skill of skills) {
        const rec = installSkill({ source: join(SRC, skill), target: join(c.skills, skill), mode });
        if (rec) {
          records.push(rec);
          installedAny = true;
        }
      }
    }
  } finally {
    ask.close();
  }

  if (!installedAny) {
    console.log("setup: nothing installed (no runtime confirmed).");
    return;
  }

  const manifest = manifestPath(project);
  writeManifest(manifest, [...readManifest(manifest), ...records]);
  console.log(`\nsetup: done. Manifest: ${manifest}`);
  console.log("setup: run the brain-setup skill inside a project to scaffold its BRAIN.md + brain/.");
}

export async function runUninstall({ assumeYes = false, keepState = false, project = false } = {}) {
  const manifest = manifestPath(project);
  const entries = readManifest(manifest);
  if (!entries.length) {
    console.log(`uninstall: nothing to do (no manifest at ${manifest}).`);
    return;
  }

  // Group records by their runtime skills dir so we can confirm one at a time.
  const byRuntime = new Map();
  for (const e of entries) {
    const dir = dirname(e.target);
    if (!byRuntime.has(dir)) byRuntime.set(dir, []);
    byRuntime.get(dir).push(e);
  }

  const ask = makeAsker(assumeYes);
  let removed = 0;
  let anyLeft = false;
  const remaining = [];
  try {
    for (const [runtime, list] of byRuntime) {
      if (!(await ask(`Remove brain.md skills from ${runtime}?`))) {
        console.log(`uninstall: kept ${runtime}.`);
        anyLeft = true;
        remaining.push(...list);
        continue;
      }
      for (const e of list) {
        if (removeSkill(e)) removed++;
        else remaining.push(e); // couldn't remove (not ours) → keep recorded
      }
    }
  } finally {
    ask.close();
  }

  if (remaining.length) {
    writeManifest(manifest, remaining);
    console.log("uninstall: some entries were kept; leaving the manifest in place.");
  } else if (keepState) {
    console.log(`uninstall: kept manifest at ${manifest} (--keep-state).`);
  } else {
    rmSync(manifest, { force: true });
    try {
      rmdirSync(dirname(manifest));
    } catch {
      // dir not empty / shared → leave it.
    }
    console.log("uninstall: removed manifest.");
  }

  console.log(`uninstall: done (${removed} skill(s) removed). Project brain/ data was not touched.`);
}
