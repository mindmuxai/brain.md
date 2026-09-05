# Issue #22: Codex lifecycle hooks

Issue: https://github.com/mindmuxai/brain.md/issues/22

Implemented on 2026-09-06 from `dafdde9`. Live Astra experimental rollover and desktop UI validation remain outstanding; the shipped instructions explicitly retain CLI reads as the fallback.

## Delivered

- `brain install-hooks --agent codex` / `brain uninstall-hooks --agent codex`, with Claude Code preserved as the default and explicit `--agent claude-code` supported.
- Shared JSON validation and merge/removal logic; exact command ownership, foreign-script checks, symlink refusal, and preservation of unrelated configuration and mixed hook groups.
- One project-local `.codex/hooks.json` entry for `SessionStart` sources startup, resume, clear, and compact, using the existing snapshot script with a five-second runtime timeout.
- Project resolution from the installed script location, `brainRoot` resolution through `brain brain-dir`, and page metadata through `brain list-pages`. No direct brain-file reads, note writes, or automatic memory write-back.
- Codex-only 8 KiB UTF-8 output budget, complete rows, stable ordering, and a full-index command when truncated. Each supported lifecycle invocation refreshes the snapshot.
- Native notes/history guidance in the Codex wired block and shipped skills: retain page IDs and task state, recover historical task evidence, and re-read current brain pages on demand.
- Documentation covering installation, trust, supported versions, shell prerequisites, the experimental context opt-in, and unsupported/unverified behavior.

No dependencies were added. Both npm and copied skill bundles use the same implementation.

## Compatibility choices

The supported baseline is **Codex CLI 0.153.4**, tested using a separately pinned binary. This is a minimum supported/tested version for this integration, not a claim that hooks first appeared in that release. See the [official release notes](https://learn.chatgpt.com/docs/changelog) and [hook contract](https://learn.chatgpt.com/docs/hooks).

The generated Codex command uses a quoted absolute script path, supporting non-Git projects and nested working directories. Uninstall before moving the project, then reinstall at the new location. Generated absolute commands must not be shared between clones or machines. This is a documented limitation of the initial implementation.

Project and hook trust are left to Codex. Global settings, `config.toml`, model settings, compaction limits, and experimental flags are not modified by the installer.

## Validation

| Check | Result |
| --- | --- |
| `fnm exec --using 18 npm test` (18.20.8) | 49 passed |
| `fnm exec --using 20 npm test` (20.20.2) | 49 passed |
| `fnm exec --using 22 npm test` (22.22.2) | 49 passed |
| Codex 0.153.4 configuration discovery | Generated project hook discovered without configuration errors; initially untrusted |
| Codex 0.153.4 startup | Hook completed and developer context appeared in the model request |
| Codex 0.153.4 resume after app-server restart | Hook completed and index appeared in the resumed request |
| Codex 0.153.4 manual/automatic compaction | Compaction events observed; hook context appeared in the following request |
| Codex 0.153.4 hook timeout | Synthetic slow CLI timed out at 5,003 ms; model turn still completed without a snapshot |

The Codex checks used its real app-server protocol with an isolated temporary configuration, a synthetic project, and a local mock Responses endpoint. These prove runtime hook delivery, not live model recall, remote compaction behavior, or Astra experimental rollover behavior. No user project hooks or global trust settings were changed.

The regression suite additionally exercises repeated installation/removal, agent isolation, malformed settings, mixed groups, foreign scripts, symlinks, nested paths with shell metacharacters, absolute/relative brain redirects, empty/missing brains, CLI failures, local skill discovery, Unicode/oversized rows, snapshot refresh, and exclusion of page bodies.

A five-run local benchmark with a synthetic 500-page multilingual listing produced:

| Snapshot | Output bytes | Median time |
| --- | ---: | ---: |
| Existing uncapped Claude snapshot | 22,321 | 62.6 ms |
| Bounded Codex snapshot | 8,164 | 64.4 ms |

This measures roughly 63% fewer injected bytes on that fixture, not a tokenizer-based reduction or a latency improvement.

## Remaining runtime validation

Astra's [experimental context management](https://learn.chatgpt.com/docs/models#experimental-context-management) uses notes and searchable task history. It is separately enabled with `features.context_management.experimental_mode = true`, followed by a new task. The launch guide excludes Business, Enterprise, and API-key sign-in; the available sign-in could not exercise the experiment. The configuration reference also lists Pro Lite alongside Plus/Pro; recheck eligibility as rollout changes.

On an eligible account, run a new Astra task with the experiment on and off, record actual rollover events, and verify recovery of a known project decision after a page changes between windows. Test the desktop client separately. Do not assume experimental rollovers emit the same events as standard compaction, or that a model label alone establishes feature availability. Until verified, retain the documented wired-instruction/explicit-read fallback.
