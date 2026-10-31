# Changelog

---

## [Unreleased]

### Breaking

- The `(next) => (request) => result` middleware composition is replaced by Express-style `(req, res, next)` handlers and `(err, req, res, next)` error handlers. Handler return values are ignored: a route responds only through `res`
- `RouteRequest`, `Handler`, `Middleware`, `JsonResponse`, `HtmlResponse`, `GasWebApp.json()` and `GasWebApp.render()` are removed. Use `GasWebAppRequest`, `GasWebAppHandler`, `res.json()` and `res.render()`
- `req` is reshaped: `route` becomes `path` (relative to the mount) and `originalPath`; `params` becomes `query`, and `params` now holds path parameters; `reqId` becomes `id`; `isHttpRequest` becomes `transport` (`'http' | 'rpc'`); `email` and `session` become `req.user = { email }`
- `use()` middleware and routes run in registration order. Middleware registered after a route no longer applies to it, and `use('/', mw)` now matches every path instead of the root only
- Registering the same method and path twice stacks the handlers instead of overwriting the first
- A request nothing answers is a 404 reading `Cannot GET /path`, after the middleware has run; a wrong method is also a 404, as `gas-error` has no 405
- A handler that returns without responding or calling `next` is a 500 reading `Route did not respond: GET /path`
- `createAuthMiddleware` no longer sets `email` or `session` on the request
- `createLoggingMiddleware` reads `res.statusCode` after `next()` returns, and logs `req.query` and `req.user` instead of `params` and `session`
- `res.status(code).json(data)` with a `code` of 400 or more sends the error envelope (`ok: false`) instead of the success envelope, and is thrown over `google.script.run`, so the browser client rejects it
- Over `google.script.run`, error middleware that answers with a status of 400 or more now throws the envelope instead of returning it as data

### Added

- `GasWebApp` entry point extending `GasWebAppRouter`, handling `doGet`/`doPost` for both real HTTP requests and `google.script.run` calls through the same route table
- `GasWebAppRouter` with `get`/`post`/`use` route registration, path-prefixed middleware, and mountable sub-routers
- Response helpers (`json`, `render`) and template helpers (`include`, `js`, `css`, `html`) for `HtmlService` views, with configurable static asset directories/extensions
- Request logging middleware (`createLoggingMiddleware`)
- Auth middleware (`createAuthMiddleware`) with an injectable per-app authorization check — session management not yet implemented
- Rate limit and concurrency limit middleware (`createRateLimiter`, `createConcurrencyLimiter`)
- Delivery acknowledgement middleware (`createAckTracker`), so a `google.script.run` caller can tell a request that never reached the server apart from one that's simply slow
- TypeScript source compiling to plain global-scope `.js` with matching `.d.ts` declarations — no bundler or build step required downstream
- Release pipeline through `gas-dev-release` (`npm run release`), publishing `dist/vX.Y.Z` and `dist-web/vX.Y.Z` tags, each with its own `package.json`. The `dist` one carries the `gasLibrary` metadata (`loadOrder`, `peers`) that `gas-dev-bundle` reads
- Project scaffolding: TypeScript, ESLint, and Prettier configuration; npm package manifest and scripts
- Browser client (`window.GasWebApp`), published as compiled `.js` and `.d.ts` on a new `dist-web` release branch, separate from the backend's `dist`
- `GasWebApp.api.get`/`.post` — promisified `google.script.run.doGet`/`doPost` wrappers with per-call timeouts and automatic retry on transient (`429`/`5xx`) failures
- `GasWebApp.errors.ServerError`, parsing the router's error payload out of a failed `google.script.run` call so consumers can branch on `.status`/`.code` without re-parsing `Error.message`
- Client-side delivery acknowledgement, pairing with the backend's `createAckTracker` to detect a `google.script.run` call that never reached the server and fail it distinctly, instead of waiting out the full timeout
- `scripts/sync-gas-webapp.sh` — a standalone installer, distributed for consumers to download rather than reimplement, that adds or updates the browser client subtree (`dist-web`) in one reviewable operation. The backend and its peers install through `gas-dev-bundle`, which needs `gas-error` listed explicitly because it treats peers as optional
- `peer/gas-webapp.peer.types.d.ts`, the canonical ambient declaration of the backend surface for downstream gas-\* libraries, type-checked standalone by `npm run typecheck:peer`
- Optional `lockService` on `createRateLimiter`/`createConcurrencyLimiter` configs, accepting any object exposing `getLock(scope)`. Pass [`gas-lock`](https://github.com/yorsh-co/gas-lock) to route limiter locks through the same registry as the rest of the app; omitted, both resolve `LockService` directly
- Client tunables on `GasWebApp.configure()` — timeout, retry count/backoff, retryable statuses, and the ack route/poll/deadline settings, all previously fixed in the client source. `ackRoute` in particular now matches apps that mount `ack.handler` somewhere other than `/ack`
- Vitest smoke tests for `doGet` and `doPost` over both transports, run against the released `gas-error`, `gas-logger` and `gas-lock` peers, with fakes for `HtmlService`, `ContentService`, `CacheService`, `LockService`, `Session` and `Utilities`
- Apps Script tests (`npm run test:gas`): the bundled peers and `GasWebApp` load, and simulated RPC and HTTP requests return the success and error envelopes
- Vitest harness for the browser client, loading `src/web` in a sandbox with a fake `window` and `google.script.run`
- Apps Script tests for HTTP error output, body parsing by content type, `HtmlResponse` over both transports, static path resolution, and the auth and concurrency middleware against the real services
- Express-style routing in `GasWebAppRouter`: `get`, `post`, `put`, `patch`, `delete`, `all` and `use` share one ordered stack, with `next()`, `next(err)` and `next('route')`, error middleware detected by its four parameters, and thrown errors passed to `next(err)`
- Path patterns in the Express 5 syntax, compiled at registration without dependencies: `:name`, `*name` and `{optional}` groups, case-insensitive with an optional trailing slash and URI-decoded parameters
- Routers mounted by reference (`use('/api', router)`): routes added later are live, and `req.baseUrl`/`req.path` follow the mount
- `GasWebAppResponse` (`status`, `json`, `send`, `render`, `statusCode`, `sent`, `locals`); a second response throws `Response already sent`
- `GasWebAppRequest` interface, open to declaration merging
- `put`, `patch` and `delete` through a `_method` override on a POST (RPC and HTTP); any value other than PUT, PATCH or DELETE is a 400, and `_method` is ignored on GET
- Router, response and method-override unit tests, and a fixture reproducing magb.kpis's `app.ts` routing on the new API
- Apps Script test for a request through nested routers, a path parameter and error middleware

- Failed requests are resolved into the response as the router stack finishes, so middleware reading `res.statusCode` after `next()` sees the error status (404, 500...) instead of 200; the error is still logged once, by `GasError.handle`
- `createLoggingMiddleware(logger, options?)` logs the response at `warn` from 400 and `error` from 500, and masks the values of `options.redact` query keys (default `token`, `password`, `secret`, `key`, `auth`, `authorization`; case-insensitive) as `[REDACTED]`
- `lockScope` is optional on `createRateLimiter` and `createConcurrencyLimiter` and defaults to `'user'`; the scope rule and the throughput cost of `'script'` are documented
- `GasWebApp.locals`, merged into `res.render` data under `res.locals` and the render options
- `res.redirect([status,] url)`, an HTTP-only navigation of the top window to an absolute `http(s)` URL
- `GasWebApp` `errorView` option, rendering errors on HTTP `GET` requests as an HTML page and falling back to the JSON envelope
- Unit tests for every built-in middleware, and Apps Script tests for the `CacheService`-backed ack and rate limiter, lock contention in both limiters, and `Session` email availability

- Route resolution: `doGet` falls back to `e.pathInfo` when `route` is absent (`route` wins when both are present), so `/exec/users/42` reaches `/users/42`; `doPost` never reads `e.pathInfo`
- Browser client `api.put`, `api.patch` and `api.delete`, sent through `doPost` with `_method`; `_method` and `idempotencyKey` join `route` and `callId` as reserved params. They do not retry by default, like `post`
- `idempotencyKey` request option on the browser client (`true` generates one UUID per logical request, reused by every retry) and `createIdempotencyGuard` on the backend, which runs a keyed request once, replays its stored success envelope, answers 409 while it is in flight and clears the key on failure. A keyed request retries like a GET by default
- Unit and Apps Script tests for route resolution, the client's new methods and the idempotency guard

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

- Documented that `req.transport` is advisory (a `google.script.run` caller controls the whole event, including `contextPath`) and must not drive security decisions (X8), and that `NOT_DELIVERED` can be a false negative when a call is queued past `ackDeadlineMs` and then runs (C4)
- Prefix middleware at root and root-mounted routers match every path (R1, R2); sub-routers are live rather than copied at mount time (R3); unmatched requests pass through middleware before the 404 (R5)
- The session id passed to the error handler is the authenticated user's email, as the request is mutated in place (L4)
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
