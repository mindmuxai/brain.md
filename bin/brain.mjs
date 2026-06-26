#!/usr/bin/env node
// `brain` — the reference CLI for the Open Project Brain Standard, exposed as a
// package bin. The canonical implementation ships inside the brain-page skill
// bundle (so a copied/symlinked bundle stays self-contained and runnable on its
// own); this entry point just delegates to it from within the npm package.
//
// All reads and writes into a project's brain/ go through this command. See
// `brain help` for the full subcommand reference.

import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)); // <pkg>/bin
const cli = join(dirname(here), "skills", "brain-page", "bin", "brain.mjs");

// Importing runs the CLI's main() against the current process.argv / cwd.
// Use a file:// URL so the absolute path also resolves on Windows ESM.
await import(pathToFileURL(cli).href);
