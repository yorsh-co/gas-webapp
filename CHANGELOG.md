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
- TypeScript source compiling to plain global-scope `.js` with matching `.d.ts` declarations — no bundler or build step required downstream
- Release pipeline (`scripts/release.sh`) publishing compiled `dist/*.js`/`.d.ts` plus README/LICENSE/CHANGELOG to a dedicated `dist` branch for `git subtree` consumption
- Project scaffolding: TypeScript, ESLint, and Prettier configuration; npm package manifest and scripts
