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
- Browser client (`window.GasWebApp`), published as TypeScript source on a new `dist-web` release branch, separate from the backend's `dist`
- `GasWebApp.api.get`/`.post` — promisified `google.script.run.doGet`/`doPost` wrappers with per-call timeouts and automatic retry on transient (`429`/`5xx`) failures
- `GasWebApp.errors.ServerError`, parsing the router's error payload out of a failed `google.script.run` call so consumers can branch on `.status`/`.code` without re-parsing `Error.message`
- Client-side delivery acknowledgement, pairing with the backend's `createAckTracker` to detect a `google.script.run` call that never reached the server and fail it distinctly, instead of waiting out the full timeout
- `createRateLimiter` attaches `retryAfterSeconds` to the thrown `RateLimitError`'s `details` when a rate-limit (not a concurrency-limit) is exceeded, so callers can back off precisely instead of guessing
- The browser client honors `details.retryAfterSeconds` when present, waiting at least that long before retrying a rate-limited call
