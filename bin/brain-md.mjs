#!/usr/bin/env node
// brain-md — the brain-md installer.
//
// Fans the packaged skill bundles (and the brain CLI they carry) out into the
// global skills directory of each agent runtime you choose. Default mode copies
// the bundles (robust on Windows and after the source moves); --symlink keeps
// the old development behaviour; --project installs into the current project.
//
// Usage:
//   brain-md [setup] [--project] [--symlink] [--yes]
//   brain-md uninstall [--project] [--keep-state] [--yes]
//
// `npx brain-md setup` runs this with the `setup` subcommand.

import { runSetup, runUninstall } from "./lib/installer.mjs";

const HELP = `brain-md — installer for the Open Project Brain Standard toolkit

Usage:
  brain-md [setup] [options]      install the skills + brain CLI
  brain-md uninstall [options]    remove what setup installed

Options:
  --project        install into the current project's .claude/, .codex/, …
                   (self-contained checkout) instead of your home dir
  --symlink        symlink the bundles instead of copying (development)
  --yes, -y        non-interactive: act on every runtime without asking (CI)
  --keep-state     (uninstall) keep the install manifest
  -h, --help       show this help

Default (no subcommand) is \`setup\`. Installing never touches any project's
brain knowledge — that is per-project state created by the brain-setup skill.`;

function parse(argv) {
  const opts = { assumeYes: false, symlink: false, project: false, keepState: false };
  for (const a of argv) {
    switch (a) {
      case "--yes":
      case "-y":
        opts.assumeYes = true;
        break;
      case "--symlink":
        opts.symlink = true;
        break;
      case "--project":
        opts.project = true;
        break;
      case "--keep-state":
        opts.keepState = true;
        break;
      case "-h":
      case "--help":
        console.log(HELP);
        process.exit(0);
        break;
      default:
        console.error(`brain-md: unknown option '${a}'`);
        process.exit(2);
    }
  }
  return opts;
}

async function main() {
  const argv = process.argv.slice(2);
  let sub = "setup";
  if (argv.length && !argv[0].startsWith("-")) sub = argv.shift();

  const opts = parse(argv);

  switch (sub) {
    case "setup":
      return runSetup(opts);
    case "uninstall":
      return runUninstall(opts);
    case "help":
      console.log(HELP);
      return;
    default:
      console.error(`brain-md: unknown command '${sub}' (expected 'setup' or 'uninstall')`);
      process.exit(2);
  }
}

main().catch((e) => {
  console.error(`brain-md: ${e?.message || e}`);
  process.exit(1);
});
