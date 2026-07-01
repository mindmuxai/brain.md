#!/usr/bin/env node
// brain-md-uninstall — reverse what `brain-md setup` installed.
//
// Reads the install manifest and removes exactly the skills it recorded —
// copies or symlinks — confirming one runtime at a time. This NEVER touches any
// project's brain knowledge; per-project BRAIN.md and brain/ are state, not
// tools, and removing the tools leaves them intact.
//
// Usage:
//   brain-md-uninstall [--project] [--keep-state] [--yes]
//
// Equivalent to `brain-md uninstall`.

import { runUninstall } from "./lib/installer.mjs";

const HELP = `brain-md-uninstall — remove the brain.md toolkit

Usage:
  brain-md-uninstall [options]

Options:
  --project        operate on the current project's install manifest
  --keep-state     keep the install manifest after removing
  --yes, -y        non-interactive: remove from every recorded runtime (CI)
  -h, --help       show this help

Project brain/ data is never touched.`;

const opts = { assumeYes: false, keepState: false, project: false };
for (const a of process.argv.slice(2)) {
  switch (a) {
    case "--yes":
    case "-y":
      opts.assumeYes = true;
      break;
    case "--keep-state":
      opts.keepState = true;
      break;
    case "--project":
      opts.project = true;
      break;
    case "-h":
    case "--help":
      console.log(HELP);
      process.exit(0);
      break;
    default:
      console.error(`brain-md-uninstall: unknown option '${a}'`);
      process.exit(2);
  }
}

runUninstall(opts).catch((e) => {
  console.error(`brain-md-uninstall: ${e?.message || e}`);
  process.exit(1);
});
