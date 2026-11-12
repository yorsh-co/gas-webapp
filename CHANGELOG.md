# Changelog

---

## [Unreleased]

### Added

- `createClientErrorHandler` middleware that receives, sanitizes and logs browser error reports
- Optional `gas-webapp.reporter` web file and `GasWebApp.reporter.install()` to forward `logger.error` calls and uncaught errors to that route; `reporter` is now a reserved `GasWebApp` namespace key
- ADR 0001 recording the client error reporting design

---

## [1.0.5] - 2026-11-12

### Changed

- README installs `gasdev` `^3.0.0` (`gasdev bundle`)
- Tooling now requires `gasdev` `^3.0.0`, replacing `gas-dev-config`, `gas-dev-bundle` and `gas-dev-release`
- `engines.node` minimum is now `^22.15.0`

---

## [1.0.4] - 2026-11-04

### Changed

- Peer type declarations are synced with `gas-dev-config peers sync`; `peers:check` script added
- Requires `gas-dev-config` `^2.0.0`
- Requires `gas-dev-release` `^2.0.0`
- Requires `gas-dev-bundle` `^2.0.0`

### Fixed

- `engines.node` narrowed to `^22.13.0`, `^24.0.0` or `>=26.0.0`, the range the dev toolchain supports
- Overrides transitive `minimatch` to `^11.0.1` (GHSA-g3hv-75wg-m249) and `gaxios` to `^7.3.1` (drops `rimraf` 5 → `glob` 10); `rimraf` is updated to `6.1.4` in the lockfile to clear `glob` 13 (GHSA-3g3m-2fjr-6pw4); `zod` via `@google/clasp` is accepted risk; see `gas-dev-config` ADR 0005

---

## [1.0.3] - 2026-11-04

### Changed

- Requires `gas-dev-release` `^1.3.0`, whose release preflight checks that the peer declarations' `@version` header matches `package.json`
- Requires `gas-dev-config` `^1.9.0`
- `.prettierignore` lists `.claude/handoff`, as required by `gas-dev-config check`

### Fixed

- The peer declarations' `@version` header now matches the package version (1.0.2); the vendored gas-lock, gas-error and gas-logger peer declarations are re-copied from gas-lock 1.2.2, gas-error 1.2.3 and gas-logger 2.0.2

---

## [1.0.2] - 2026-11-04

### Changed

- Releases also publish the GitHub Release for `vX.Y.Z` (`gasDevRelease.githubRelease`); `gas-dev-release` dev dependency bumped to `^1.2.1`

---

## [1.0.1] - 2026-11-03

### Changed

- `gas-dev-config` dev dependency bumped to `^1.8.0`
- `.prettierignore` now lists `.claude/worktrees` and `.claude/plans`, which `gas-dev-config check` requires
- `gas-logger` peer range widened to `^1.3.0 || ^2.0.0`; vendored gas-logger declarations updated to 2.0.1
- README install example lists the latest `gas-error` (`^1.2.2`), `gas-logger` (`^2.0.1`) and `gas-lock` (`^1.2.1`)

---

## [1.0.0] - 2026-10-31

First tagged release, planned as 1.0.0. The API changed throughout against the untagged 0.x code; see the [migration guide](https://github.com/yorsh-co/gas-webapp/blob/main/docs/migration-1.0.md).

### Breaking

- The `(next) => (request) => result` middleware composition is replaced by Express-style `(req, res, next)` handlers and `(err, req, res, next)` error handlers. Handler return values are ignored: a route responds only through `res`
- `RouteRequest`, `Handler`, `Middleware`, `JsonResponse`, `HtmlResponse`, `GasWebApp.json()` and `GasWebApp.render()` are removed. Use `GasWebAppRequest`, `GasWebAppHandler`, `res.json()` and `res.render()`
- `req` is reshaped: `route` becomes `path` (relative to the mount) and `originalPath`; `params` becomes `query`, and `params` now holds path parameters; `reqId` becomes `id`; `isHttpRequest` becomes `transport` (`'http' | 'rpc'`); `email` and `session` become `req.user = { email }`
- `use()` middleware and routes run in registration order. Middleware registered after a route no longer applies to it, and `use('/', mw)` now matches every path instead of the root only
- Registering the same method and path twice stacks the handlers instead of overwriting the first
- A request nothing answers is a 404 reading `Cannot GET /path`, after the middleware has run; a wrong method is also a 404, as `gas-error` has no 405
- A handler that returns without responding or calling `next` is a 500 reading `Route did not respond: GET /path`
- `res.status(code).json(data)` with a `code` of 400 or more sends the error envelope (`ok: false`) instead of the success envelope, and is thrown over `google.script.run`, so the browser client rejects it. Error middleware that answers with a status of 400 or more throws the envelope over `google.script.run` instead of returning it as data
- `render` resolves the view and the layout through the `html` static dir, as `html()` does. Pass logical names (`res.render('pages/home', { layout: 'layouts/main' })`); callers that passed `resolveStaticFilePath(...)` results are resolved twice and must drop the wrapper
- A POST body is parsed by `postData.type`: `application/json` is parsed, form encodings leave `req.body` undefined, and any other type, or none, is passed through as the raw string. Previously every body was parsed as JSON
- `createAuthMiddleware` sets `req.user` instead of `email` and `session`, and rejects an unidentifiable user (`Session` throws or returns an empty email) with a `GasUnauthorizedError` reading `Unable to identify the signed-in user`, and an unauthorised user with `Not authorized`; the email is no longer echoed to the client
- `createLoggingMiddleware` reads `res.statusCode` after `next()` returns, and logs `req.query` and `req.user` instead of `params` and `session`
- Requires `gas-error` 1.2 or later: `GasError.handle` replaces `errorHandler`, and the error classes are `GasNotFoundError`, `GasValidationError`, `GasForbiddenError`, `GasUnauthorizedError`, `GasConflictError` and `GasRateLimitError`
- `scripts/sync-gas-webapp.sh` installs the browser client only. The backend and its peers install through `gas-dev-bundle`, which needs `gas-error` listed explicitly because it treats peers as optional

### Added

- `GasWebApp` entry point extending `GasWebAppRouter`, handling `doGet`/`doPost` for both real HTTP requests and `google.script.run` calls through the same route table
- Express-style routing in `GasWebAppRouter`: `get`, `post`, `put`, `patch`, `delete`, `all` and `use` share one ordered stack, with `next()`, `next(err)` and `next('route')`, error middleware detected by its four parameters, and thrown errors passed to `next(err)`
- Path patterns in the Express 5 syntax, compiled at registration without dependencies: `:name`, `*name` and `{optional}` groups, case-insensitive with an optional trailing slash and URI-decoded parameters
- Routers mounted by reference (`use('/api', router)`): routes added later are live, and `req.baseUrl`/`req.path` follow the mount
- `GasWebAppResponse` (`status`, `json`, `send`, `render`, `redirect`, `statusCode`, `sent`, `locals`); a second response throws `Response already sent`
- `GasWebAppRequest` interface, open to declaration merging
- Route resolution: `doGet` falls back to `e.pathInfo` when `route` is absent (`route` wins when both are present), so `/exec/users/42` reaches `/users/42`; `doPost` resolves the route the same way
- `put`, `patch` and `delete` through a `_method` override on a POST (RPC and HTTP); any value other than PUT, PATCH or DELETE is a 400, and `_method` is ignored on GET
- `GasWebApp.locals`, merged into `res.render` data under `res.locals` and the render options
- `res.redirect([status,] url)`, an HTTP-only navigation of the top window to an absolute `http(s)` URL
- `GasWebApp` `errorView` option, rendering errors on HTTP `GET` requests as an HTML page and falling back to the JSON envelope
- Template helpers (`include`, `js`, `css`, `html`) for `HtmlService` views, with configurable static asset directories and extensions
- Request logging middleware (`createLoggingMiddleware`), logging the response at `warn` from 400 and `error` from 500, and masking the values of `options.redact` query keys (default `token`, `password`, `secret`, `key`, `auth`, `authorization`; case-insensitive) as `[REDACTED]`
- Auth middleware (`createAuthMiddleware`) with an injectable per-app authorization check
- Rate limit and concurrency limit middleware (`createRateLimiter`, `createConcurrencyLimiter`), with an optional `lockService` accepting any object exposing `getLock(scope)` (pass [`gas-lock`](https://github.com/yorsh-co/gas-lock) to share its lock registry), and an optional `lockScope` that defaults to `'user'`; the scope rule and the throughput cost of `'script'` are documented
- Delivery acknowledgement middleware (`createAckTracker`), so a `google.script.run` caller can tell a request that never reached the server apart from one that's simply slow
- `createIdempotencyGuard` on the backend, which runs a keyed request once, replays its stored success envelope, answers 409 while it is in flight and clears the key on failure
- Browser client (`window.GasWebApp`), published as compiled `.js` and `.d.ts` on the `dist-web` release branch, separate from the backend's `dist`
- `GasWebApp.api.get`, `.post`, `.put`, `.patch` and `.delete` — promisified `google.script.run` wrappers with per-call timeouts and automatic retry of GETs on transient (`429`/`5xx`) failures. Writes do not retry by default
- `idempotencyKey` request option on the client (`true` generates one UUID per logical request, reused by every retry); a keyed request retries like a GET by default
- `GasWebApp.errors.ServerError`, parsing the router's error payload out of a failed `google.script.run` call so consumers can branch on `.status`/`.code` without re-parsing `Error.message`
- Client-side delivery acknowledgement, pairing with the backend's `createAckTracker` to detect a `google.script.run` call that never reached the server and fail it distinctly, instead of waiting out the full timeout
- Client tunables on `GasWebApp.configure()` — timeout, retry count/backoff, retryable statuses, and the ack route/poll/deadline settings
- TypeScript source compiling to plain global-scope `.js` with matching `.d.ts` declarations — no bundler or build step required downstream
- `peer/gas-webapp.peer.types.d.ts`, the canonical ambient declaration of the backend surface for downstream gas-\* libraries, type-checked standalone by `npm run typecheck:peer`
- Release pipeline through `gas-dev-release` (`npm run release`), publishing `dist/vX.Y.Z` and `dist-web/vX.Y.Z` tags. The `dist` one carries the `gasLibrary` metadata (`loadOrder`, `peers`) that `gas-dev-bundle` reads
- Vitest suites for the router, response, middleware, transport and browser client, run against the released `gas-error`, `gas-logger` and `gas-lock` peers with fakes for `HtmlService`, `ContentService`, `CacheService`, `LockService`, `Session` and `Utilities`, plus a fixture reproducing magb.kpis's `app.ts` routing on the new API
- Apps Script tests (`npm run test:gas`) against the real services: HTTP and RPC envelopes, body parsing by content type, nested routers and error middleware, route resolution, `render` over both transports, the auth, ack, idempotency and both limiter middleware, and static path resolution
- A fixture web app and checklist for the checks that need a deployment (`manual/`, `npm run manual:build`)
- A [migration guide](https://github.com/yorsh-co/gas-webapp/blob/main/docs/migration-1.0.md) from the 0.x API, using magb.kpis's `app.ts` as the worked example

### Changed

- Prettier, TypeScript and ESLint configuration come from [`gas-dev-config`](https://github.com/yorsh-co/gas-dev-config) `^1.5.0`; the backend compiles to ES2020, as Apps Script rejects newer syntax on push
- `async` functions and `await` are lint errors in the backend sources, through the gas-dev-config 1.5 `gas` preset
- `gasDevConfig` in `package.json` declares the load order and the `gas-error`, `gas-logger` and `gas-lock` peers
- `src/internal/` holds the canonical `peer/*.d.ts` files of `gas-error`, `gas-logger` and `gas-lock`
- Failed requests are resolved into the response as the router stack finishes, so middleware reading `res.statusCode` after `next()` sees the error status (404, 500...) instead of 200; the error is logged once, by `GasError.handle`
- `render(view)` and `render(view, {})` render the view standalone, like `layout: null`; `RenderOptions.layout` is optional
- The concurrency limiter's counter TTL is 420 s, covering the 6-minute execution limit, instead of 60 s
- Documented that `req.transport` is advisory (a `google.script.run` caller controls the whole event, including `contextPath`) and must not drive security decisions, and that `NOT_DELIVERED` can be a false negative when a call is queued past `ackDeadlineMs` and then runs
- Both READMEs rewritten for the new API, with Express differences, platform limitations and the file push order reduced to what still applies
- The package description matches the README and GitHub: "Express-style router and middleware for Google Apps Script web apps."
- `doPost` falls back to `e.pathInfo` when `route` is absent, like `doGet`; `route` wins when both are present and empty values count as absent. A deployed web app showed `pathInfo` is populated on POST
- `res.redirect` sends a "Continue to <host>" page with the link as a button, since browsers block the automatic navigation from `HtmlService`'s sandbox; the host shown drops any `user@` credentials
- `build:watch` watches the browser client as well as the backend, and stops both compilers on interrupt or termination
- `dist-web` no longer ships the empty `gas-webapp.client.d.ts`, `gas-webapp.config.d.ts` and `gas-webapp.errors.d.ts`; the client's types are in `types/gas-webapp.client.types.d.ts`

### Fixed

- Entry points must be function declarations for `google.script.run`: the README, migration guide and manual fixture recommended `const doGet = app.doGet`, which works over HTTP but fails over `google.script.run` (`chained.doGet is not a function`). Every example now declares `function doGet(e)` and `function doPost(e)`
- Docs: the README platform notes record the observed `pathInfo`, trailing slash, `contextPath`, MIME type and `res.redirect` behaviour of a deployed web app, and the sandbox caveat on `res.redirect` (P9)
- Prefix middleware at root and root-mounted routers match every path; sub-routers are live rather than copied at mount time; unmatched requests pass through middleware before the 404
- The session id passed to the error handler is the authenticated user's email, as the request is mutated in place
- Request normalisation runs inside the error boundary, so a malformed JSON body returns the 400 envelope to HTTP and RPC callers instead of an Apps Script error page
- HTTP errors are serialised from `GasError.handle(err, { rethrow: false })`, so the output is always valid JSON; every error takes this one path and is logged once
- `resolveStaticFilePath('js', 'app')` returned `dist/web/public/jsapp/.js.html`; the separator is now prepended, and a leading `/`, or surrounding whitespace, is tolerated
- `createConcurrencyLimiter` honours `config.lockService`
- The concurrency limiter retries a contended slot release once, with a longer lock wait, instead of leaking the slot until the TTL expires
- The browser client resolves `undefined` for a `null`/`undefined` success value instead of throwing
- The browser client normalises a rejection that is not a `ServerError` through `errors.clientError` instead of crashing the retry loop
- The browser client rejects `params` containing `route`, `callId`, `_method` or `idempotencyKey` with a `CLIENT_ERROR` instead of letting them collide with the reserved event keys
- Documentation: `ackDeadlineMs` default is `15000`, the browser client ships as compiled `.js` and `.d.ts`, and the scriptlet examples are no longer merged onto shared lines by Prettier

### Removed

- `scripts/release.sh` and `scripts/write-release-package-json.js`, replaced by `gas-dev-release`
- `.prettierrc.json` and `tsconfig.base.json`, replaced by the shared presets
- `docs/gas-suite-integration.md`, once its items were adopted
