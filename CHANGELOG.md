# Changelog

---

## [Unreleased]

### Added

- `GasWebApp` entry point extending `GasWebAppRouter`, handling `doGet`/`doPost` for both real HTTP requests and `google.script.run` calls through the same route table
- `GasWebAppRouter` with `get`/`post`/`use` route registration, path-prefixed middleware, and mountable sub-routers
- Response helpers (`json`, `render`) and template helpers (`include`, `js`, `css`, `html`) for `HtmlService` views, with configurable static asset directories/extensions
- Request logging middleware (`createLoggingMiddleware`)
- Auth middleware (`createAuthMiddleware`) with an injectable per-app authorization check — session management not yet implemented
- Rate limit and concurrency limit middleware (`createRateLimiter`, `createConcurrencyLimiter`)
- Delivery acknowledgement middleware (`createAckTracker`), so a `google.script.run` caller can tell a request that never reached the server apart from one that's simply slow
- TypeScript source compiling to plain global-scope `.js` with matching `.d.ts` declarations — no bundler or build step required downstream
- Release pipeline (`scripts/release.sh`) publishing compiled `dist/*.js`/`.d.ts` plus README/LICENSE/CHANGELOG to a dedicated `dist` branch for `git subtree` consumption
- Project scaffolding: TypeScript, ESLint, and Prettier configuration; npm package manifest and scripts
- Browser client (`window.GasWebApp`), published as compiled `.js` and `.d.ts` on a new `dist-web` release branch, separate from the backend's `dist`
- `GasWebApp.api.get`/`.post` — promisified `google.script.run.doGet`/`doPost` wrappers with per-call timeouts and automatic retry on transient (`429`/`5xx`) failures
- `GasWebApp.errors.ServerError`, parsing the router's error payload out of a failed `google.script.run` call so consumers can branch on `.status`/`.code` without re-parsing `Error.message`
- Client-side delivery acknowledgement, pairing with the backend's `createAckTracker` to detect a `google.script.run` call that never reached the server and fail it distinctly, instead of waiting out the full timeout
- `scripts/sync-gas-webapp.sh` — a standalone installer, distributed for consumers to download rather than reimplement, that installs or updates the backend, browser client, and `gas-error`/`gas-logger` peer dependencies together in one reviewable operation; each target is added if missing or pulled if already present, and `--backend-only` skips the browser client
- Optional `lockService` on `createRateLimiter`/`createConcurrencyLimiter` configs, accepting any object exposing `getLock(scope)`. Pass [`gas-lock`](https://github.com/yorsh-co/gas-lock) to route limiter locks through the same registry as the rest of the app; omitted, both resolve `LockService` directly
- Client tunables on `GasWebApp.configure()` — timeout, retry count/backoff, retryable statuses, and the ack route/poll/deadline settings, all previously fixed in the client source. `ackRoute` in particular now matches apps that mount `ack.handler` somewhere other than `/ack`
- Vitest smoke tests for `doGet` and `doPost` over both transports, run against the released `gas-error`, `gas-logger` and `gas-lock` peers, with fakes for `HtmlService`, `ContentService`, `CacheService`, `LockService`, `Session` and `Utilities`
- Apps Script tests (`npm run test:gas`): the bundled peers and `GasWebApp` load, and simulated RPC and HTTP requests return the success and error envelopes
- Vitest harness for the browser client, loading `src/web` in a sandbox with a fake `window` and `google.script.run`
- Apps Script tests for HTTP error output, body parsing by content type, `HtmlResponse` over both transports, static path resolution, and the auth and concurrency middleware against the real services

### Changed

- Prettier, TypeScript and ESLint configuration now come from [`gas-dev-config`](https://github.com/yorsh-co/gas-dev-config); the backend compiles to ES2020, as Apps Script rejects newer syntax on push
- Releases are published by [`gas-dev-release`](https://github.com/yorsh-co/gas-dev-release) to the `dist` and `dist-web` branches
- `async` functions and `await` are lint errors in the backend sources
- `gasDevConfig` in `package.json` declares the load order and the `gas-error`, `gas-logger` and `gas-lock` peers
- Migrated to the `gas-error` 1.2 API: `GasError.handle` replaces `errorHandler`, and the error classes are `GasNotFoundError`, `GasValidationError`, `GasForbiddenError`, `GasUnauthorizedError` and `GasRateLimitError`. Earlier `gas-error` releases are no longer supported
- `src/internal/` now holds the canonical `peer/*.d.ts` files of `gas-error`, `gas-logger` and `gas-lock`
- Added a Vitest suite that loads the library in a sandboxed global scope

- **Breaking:** `render` now resolves the view and the layout through the `html` static dir, as `html()` does. Pass logical names (`render('pages/home', { layout: 'layouts/main' })`); callers that passed `resolveStaticFilePath(...)` results are resolved twice and must drop the wrapper
- `render(view)` and `render(view, {})` render the view standalone, like `layout: null`; `RenderOptions.layout` is optional
- `createAuthMiddleware` rejects an unidentifiable user (`Session` throws or returns an empty email) with a `GasUnauthorizedError` reading `Unable to identify the signed-in user`, and an unauthorised user with `Not authorized`; the email is no longer echoed to the client
- A POST body is parsed by `postData.type`: `application/json` is parsed, form encodings leave `request.body` undefined, and any other type, or none, is passed through as the raw string. Previously every body was parsed as JSON
- The concurrency limiter's counter TTL is 420 s, covering the 6-minute execution limit, instead of 60 s
- The browser client ships as compiled `.js` and `.d.ts` on `dist-web`; the documentation said TypeScript source

### Fixed

- Request normalisation runs inside the error boundary, so a malformed JSON body returns the 400 envelope to HTTP and RPC callers instead of an Apps Script error page
- HTTP errors are serialised from `GasError.handle(err, { rethrow: false })`, so the output is always valid JSON; every error, including an `HtmlResponse` returned over `google.script.run`, takes this one path and is logged once
- `resolveStaticFilePath('js', 'app')` returned `dist/web/public/jsapp/.js.html`; the separator is now prepended, and a leading `/`, or surrounding whitespace, is tolerated
- `createConcurrencyLimiter` honours `config.lockService`
- The concurrency limiter retries a contended slot release once, with a longer lock wait, instead of leaking the slot until the TTL expires
- The browser client resolves `undefined` for a `null`/`undefined` success value instead of throwing
- The browser client normalises a rejection that is not a `ServerError` through `errors.clientError` instead of crashing the retry loop
- The browser client rejects `params` containing `route` or `callId` with a `CLIENT_ERROR` instead of letting them collide with the reserved event keys
- Documentation: `ackDeadlineMs` default is `15000`, the scriptlet examples in both READMEs are no longer merged onto shared lines by Prettier, and the `filePushOrder` example lists the current `gas-error` files

### Removed

- `scripts/release.sh` and `scripts/write-release-package-json.js`, replaced by `gas-dev-release`
- `.prettierrc.json` and `tsconfig.base.json`, replaced by the shared presets
