# gas-\* suite integration: reference for adopting gas-dev-bundle and Apps Script tests

Written 2026-10-30, when the gas-dev-bundle and Apps Script test work landed in the rest of the suite. gas-webapp was deliberately left out of that work. This document records what the other repos now do, what was verified in real Apps Script, and what remains for gas-webapp. Delete it once gas-webapp has adopted the parts it wants.

## State of the suite

| Repo            | Version | Relevant to gas-webapp                                                                                                 |
| --------------- | ------- | ---------------------------------------------------------------------------------------------------------------------- |
| gas-dev-config  | 1.4.1   | Presets, `check`, `loadOrder`/`peers`/`gasTest` config, the `gas-test` runtime and commands                            |
| gas-dev-release | 1.1.0   | Writes `gasLibrary` metadata into the release `package.json`                                                           |
| gas-dev-bundle  | 1.1.1   | Bundles gas-\* libraries from their `dist/vX.Y.Z` tags into one script                                                 |
| gas-lock        | 1.2.1   | Has `gasLibrary`; Apps Script tests                                                                                    |
| gas-logger      | 1.3.1   | Has `gasLibrary` (peer: gas-lock); Apps Script tests                                                                   |
| gas-error       | 1.2.1   | Has `gasLibrary` (peer: gas-logger); Apps Script tests. 1.1.0 cannot be pushed to Apps Script (see "Push-time parser") |
| gas-sheetdb     | 2.1.1   | Has `gasLibrary` (peers: gas-lock, gas-error); Apps Script tests (ported from the former smoke test)                   |

The minimum versions that gas-dev-bundle can bundle (the first with `gasLibrary`) are gas-lock 1.2.0, gas-logger 1.3.0, gas-error 1.2.0 and gas-sheetdb 2.1.0. Each library's README documents both install methods (gas-dev-bundle for several libraries, git subtree for one).

## How gas-dev-bundle works

A consumer installs it as a dev dependency (`github:yorsh-co/gas-dev-bundle#semver:^1.1.1`) and configures `package.json`:

```json
{
  "gasDevBundle": {
    "libraries": {
      "gas-error": "^1.2.0",
      "gas-logger": "^1.3.0",
      "gas-lock": "^1.2.0"
    },
    "outFile": "src/lib/gas-libraries.js",
    "typesFile": "types/gas-libraries.d.ts"
  }
}
```

`npx gas-dev-bundle`:

1. Lists each library's `refs/tags/dist/v*` tags with `git ls-remote`, picks the highest one in range and shallow-clones it into `node_modules/.cache/gas-dev-bundle/`.
2. Reads `gasLibrary` from that tag's `package.json`; a release without it is rejected with the minimum version. A peer whose resolved version is outside the declared range prints a warning. Unlisted peers are fine (peers are optional, "used when present").
3. Orders libraries topologically by peers (ties keep config order), then each library's files by its `loadOrder`.
4. Writes one file: a header with each library's version and full commit SHA, one `'use strict';`, then every file under a `// ---- <library>/<path> ----` marker with its own directive stripped. It runs `node --check` before writing.
5. Optionally concatenates the libraries' `.d.ts` files into `typesFile` (keep it outside the clasp `rootDir`).

The bundle is committed; its header is the lock record. There is one copy of each library by construction, so GasLock's per-execution registry cannot split. The bundle file must load before any consumer code that uses the globals at top level (one `filePushOrder` entry).

The release metadata, written by gas-dev-release from `gasDevConfig`:

```json
"gasLibrary": {
  "loadOrder": ["gas-sheetdb.errors.js", "gas-sheetdb.constants.js", "..."],
  "peers": { "gas-lock": "^1.1.0", "gas-error": "^1.1.0" }
}
```

`loadOrder` holds `.js` names relative to the release root, with type-only files dropped; `peers` is copied from `gasDevConfig.peers`.

## What remains for gas-webapp

These were Phase 9 of the plan and were deferred to the gas-webapp review.

1. **Release tags with a `v` prefix.** `scripts/release.sh` tags `dist/$VERSION` and `dist-web/$VERSION`; gas-dev-bundle only lists `dist/v*`, and the rest of the suite tags `vX.Y.Z` / `dist/vX.Y.Z`. gas-webapp has no tags yet (version `0.0.0`), so this only needs settling before the first release.
2. **`gasLibrary` in the `dist` `package.json`.** Either move the backend release to gas-dev-release (it supports several targets, each with `packageJson: true`, which may also cover `dist-web`), or extend `scripts/write-release-package-json.js`. Whichever writes it needs:
   - `loadOrder`: the backend `.js` files, type-only files excluded (`types/`, `shared/`, `internal/`). `GasWebApp extends GasWebAppRouter`, so the router file must precede the class: this is the one load-time dependency between files (the README's push-order step already says so).
   - `peers`: gas-error, gas-logger and gas-lock with the ranges gas-webapp is compatible with.
3. **gas-dev-config adoption** (lint, TypeScript and Prettier presets, `check`, `gasDevConfig.loadOrder`/`peers`). gas-webapp currently carries its own ESLint/TypeScript setup. The `gas` TypeScript preset now targets ES2020; see "Push-time parser" before choosing any target.
4. **Sync script.** `scripts/sync-gas-webapp.sh` subtree-pulls gas-webapp's `dist` and `dist-web` plus gas-error, gas-logger and gas-lock. The backend part (gas-webapp `dist` and the three peers) can become one gas-dev-bundle entry list. The browser client (`dist-web`) stays on subtree or the script: the bundle covers Apps Script code only.
5. **Install docs.** Mirror the library READMEs: gas-dev-bundle for several libraries, subtree for one.
6. **Optional: Apps Script tests** with `gas-dev-config gas-test` (below).

## Apps Script tests (gas-dev-config `gas-test`)

- Tests live in `gas-test/*.ts` (global scripts, no import/export), type-checked by `gas-test/tsconfig.json` extending `gas-dev-config/tsconfig/gas-test.json` with `"include": ["../src/**/*.ts", "*.ts"]`. The ESLint `gas` preset lints them once that tsconfig exists.
- Runtime globals: `test(name, fn)`, `info(name, fn)` (reports a string, never fails), `assert(condition, message)`. `fn` receives `{ spreadsheet, prefix }`; name every sheet `${prefix}<name>` and the runtime deletes them after the run (and sweeps stale ones from killed runs).
- Config: `gasDevConfig.gasTest.scopes` (the generated manifest's `oauthScopes`; `check` then requires the scripts below).
- Scripts: `"test:gas:build": "gas-dev-config gas-test build"` writes one self-contained script (peers bundled ahead of the library) for pasting into the editor; `"test:gas": "gas-dev-config gas-test run"` pushes it to a dedicated project with clasp, runs `runGasTests` and exits 1 on failure.
- Environment: `GAS_TEST_SCRIPT_ID` (dedicated project; its contents are replaced on every run) and `GAS_TEST_SPREADSHEET_ID`. Editor runs read the spreadsheet from the `GAS_TEST_SPREADSHEET_ID` script property instead.
- The suite's dedicated test project and its `gas-test` spreadsheet already exist (the user has their IDs; they are never committed). The clasp login covers `spreadsheets` and `script.storage`.
- They are a manual pre-release step on the release branch; `npm run check` stays offline.

## Verified in real Apps Script (2026-10-30)

### Push-time parser

Apps Script checks syntax on push with a parser older than its V8 runtime. One construct per push:

| Accepted                        | Rejected                                                                                                             |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| optional `catch {}`, `?.`, `??` | `\|\|=`, `&&=`, `??=`, numeric separators (`1_000`), BigInt literals (`1n`), class fields, `#private`, static blocks |

TypeScript at target ES2020 downlevels logical assignment and numeric separators, and compiles class fields into constructor assignments; BigInt literals must be avoided. `lib` can stay ES2021. gas-webapp's `tsconfig.base.json` targets ES2021, which emits that syntax unchanged; its backend source contained none of it on 2026-10-30, but lowering the target (or adopting the gas preset) removes the risk.

### LockService

- Locks are owned per execution. A nested `tryLock` on the held scope succeeds immediately.
- `hasLock()` reports the execution's ownership on **any** handle, even one that never acquired.
- `releaseLock()` is a no-op on a handle that never acquired; once a handle has acquired (including by joining), its release ends the execution's lock, i.e. the caller's critical section.
- GasLock cannot see a lock taken with raw `LockService`; outer sections must use `GasLock.withLock` for nested gas-\* writes to keep them.
- `getDocumentLock()` returns `null` in a standalone project.

### Sheets and Session

- A cell accepts at most 50,000 characters ("Your input contains more than the maximum of 50000 characters in a single cell.").
- ISO timestamp strings written with `appendRow` or `setValues` stay strings.
- The `'` prefix stores `=1+1`, `+1`, `-5`, `@x` as text through both write paths.
- `Session.getActiveUser().getEmail()` without the `userinfo.email` scope throws in a normal (editor) execution, but returns the email under `clasp run` (Apps Script API), whose token carries that scope.

### clasp 3.4.1

- `clasp run` prints a returned string verbatim (33 KB came back untruncated); `push --force`, `run` and `logs --simplified` need the script linked to the user's GCP project, and the manifest needs `executionApi: { access: "MYSELF" }`.
- `NOT_FOUND ... reading from storage` means the script is not linked to that GCP project.
- `clasp push --force` skips the push when every local file matches the remote, so remote-only files survive.
