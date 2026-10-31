# gas-webapp: review and modernisation plan

Written 2026-10-30. This plan brings gas-webapp in line with the rest of the gas-\* suite (gas-dev-config, gas-dev-release, gas-dev-bundle and the current gas-error, gas-logger and gas-lock), fixes the defects found in review, and moves the API as close to Express as Apps Script allows.

The last consumer, magb.kpis, vendors gas-webapp through `git subtree` with no local edits. It is used here only as evidence of how the library is used in practice. It is not changed by this plan.

Delete this document once the last phase is merged; its findings are closed by the CHANGELOG entries of each phase.

## Decisions

| #   | Topic                | Decision                                                                                                                                                                                      |
| --- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Middleware signature | Express style: `(req, res, next)` for middleware and handlers, `(err, req, res, next)` for error middleware. Replaces the current `(next) => (req) => result` composition.                    |
| 2   | Route source         | Dual: the `route` parameter is canonical for both entry points and both transports; `doGet` falls back to `e.pathInfo` when `route` is absent; `doPost` never reads `e.pathInfo` (see below). |
| 3   | HTTP methods         | `put`, `patch` and `delete` are supported through a method override on `doPost`, mirrored in the browser client.                                                                              |

### Route resolution

In testing, `e.pathInfo` is populated for `doGet` but not reliably for `doPost`. A rule that read it on both would route a POST differently depending on a platform quirk, so the rule is per entry point:

| Entry point | Resolution order                     |
| ----------- | ------------------------------------ |
| `doGet`     | `route` parameter, `e.pathInfo`, `/` |
| `doPost`    | `route` parameter, `/`               |

- The browser client always sends `route`, so `google.script.run` callers are unaffected by the fallback.
- When a GET carries both, `route` wins. This is documented, not an error.
- Express-style links (`/exec/users/42`) therefore work for pages and GET APIs; HTTP POSTs must use `?route=`.

### Method override

Apps Script exposes only `doGet` and `doPost`. A POST carrying `_method=PUT|PATCH|DELETE` in its parameters is dispatched as that method. The override is honoured only on `doPost` and only for those three values; anything else is a 400. `req.method` reports the effective method.

### Assumptions

Veto any of these before the phase that depends on them starts.

- **A1. Breaking changes are acceptable.** gas-webapp is at `0.0.0`, untagged, with one consumer. The first tagged release is proposed as `v1.0.0`, after Phase 7.
- **A2. The response envelope stays.** `res.json(data)` sends `{ ok: true, status, data }` rather than the raw body, as Express would. The browser client and the gas-error envelope depend on it, and Apps Script cannot set an HTTP status, so the status has to travel in the body.
- **A3. Handler return values are ignored**, as in Express. A route responds only through `res`. The current "return a value and it is wrapped in `json()`" convenience is removed.
- **A4. Backend code is synchronous.** Apps Script rejects the `async` and `await` keywords on push (P8), and `doGet`/`doPost` must return their output synchronously. `next()` is a plain synchronous call and there is no async middleware. The browser client runs in the browser and keeps its `async`/`await`.
- **A5. Synchronous `next()` replaces "after" hooks.** Because `next()` returns only once everything downstream has finished, a middleware can read `res` after calling it (for example, logging the status and duration). There is no `res.on('finish')`.

## Findings

Each finding has an ID that the phases below reference. Line numbers are from `develop` at `132e08b`.

### Blocking

| ID  | Finding                                                                                                                                                                                                                                                                                                                                                                                                                           | Location                                                                                       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| B1  | gas-error 1.1.0 replaced `errorHandler` with `GasError.handle` and renamed every subclass (`GasNotFoundError`, `GasValidationError`, …). gas-webapp still calls `errorHandler`, `NotFoundError`, `ValidationError`, `ForbiddenError`, `UnauthorizedError` and `RateLimitError`, so against gas-error ≥ 1.1.0 every request fails with a `ReferenceError`. magb.kpis works only because it vendors the old `gas-error.handler.js`. | `src/gas-webapp.class.ts:164,195,210`, `src/gas-webapp.router.class.ts:96`, `src/middleware/*` |
| B2  | `src/internal/gas-webapp.peer.types.ts` is hand-written and stale: `errorHandler` is typed as returning `AppResponse` (it throws), `ValidationError` takes `details: string`, and `GasLoggerChildLogger` does not match gas-logger's `child(): GasLogger`. The suite copies each library's canonical `peer/*.d.ts` into `src/internal/` instead.                                                                                  | `src/internal/gas-webapp.peer.types.ts`                                                        |
| B3  | `target: ES2021` lets through syntax (`\|\|=`, `??=`, numeric separators) that Apps Script's push-time parser rejects. Nothing in the source triggers it today, but nothing stops it either.                                                                                                                                                                                                                                      | `tsconfig.base.json:3`                                                                         |

### Request lifecycle

| ID  | Finding                                                                                                                                                                                                                                                                        | Location                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| L1  | `_normalizeRequest` runs outside the error boundary. A bad JSON body throws a `ValidationError` that never reaches the error handler: HTTP callers get an Apps Script error page, RPC callers a client-side `INTERNAL_ERROR` fallback.                                         | `src/gas-webapp.class.ts:136`     |
| L2  | Every POST body is `JSON.parse`d whatever its `postData.type`, so form posts (`application/x-www-form-urlencoded`) and `text/plain` are always rejected with a 400.                                                                                                            | `src/gas-webapp.class.ts:159-165` |
| L3  | The HTTP catch returns `err.message` as-is with a JSON MIME type. It is only valid JSON when the error came through `errorHandler`; the `ForbiddenError` thrown by `_serialize` is also outside the handler and goes out as plain text.                                        | `src/gas-webapp.class.ts:145,210` |
| L4  | `sessionId` passed to the error handler is always empty: the auth middleware hands a copy of the request downstream, so the outer request never receives `email`. gas-error then falls back to its own `Session` lookup.                                                       | `src/gas-webapp.class.ts:199`     |
| L5  | `render(view)` without `layout` passes `undefined` to `createTemplateFromFile`, which throws. The `{} as RenderOptions` default hides the required property from the type checker.                                                                                             | `src/gas-webapp.class.ts:78`      |
| L6  | `resolveStaticFilePath('js', 'app')` returns `dist/web/public/jsapp/.js.html`: the separator is appended instead of prepended. It works only with a leading `/`, which is why magb.kpis always passes one. The README's `webApp.js('components/UserTable')` example is broken. | `src/gas-webapp.class.ts:121`     |
| L7  | `render()` does not resolve its view or layout through the static dirs, while `js()`/`css()`/`html()` do. magb.kpis wraps every view in `resolveStaticFilePath`.                                                                                                               | `src/gas-webapp.class.ts:65-81`   |

### Router

| ID  | Finding                                                                                                                                                                                                                                  | Location                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| R1  | Mounting at root is broken. `use('/', router)` normalises the prefix to `''`, `_joinPaths('', 'x')` produces `'/x'`, and a normalised request route never starts with `/`. magb.kpis survives because its web router has one `''` route. | `src/gas-webapp.router.class.ts:25,83` |
| R2  | Prefix middleware at root (`use('/', mw)`) matches only the root route `''`. In magb.kpis the logging and limiters registered on `'/'` apply to the home page only.                                                                      | `src/gas-webapp.router.class.ts:86`    |
| R3  | Sub-routers are copied at mount time. Routes added to a sub-router after `use(prefix, router)`, and routers mounted into it later, are silently lost.                                                                                    | `src/gas-webapp.router.class.ts:57-75` |
| R4  | Registering the same method and path twice silently overwrites the first route.                                                                                                                                                          | `src/gas-webapp.router.class.ts:51`    |
| R5  | A 404 is thrown before any middleware runs, so logging, ack and auth never see unmatched requests. A wrong method is reported as 404, not 405.                                                                                           | `src/gas-webapp.router.class.ts:93-99` |

### Built-in middleware

| ID  | Finding                                                                                                                                                                                                                                                        | Location                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| M1  | `createConcurrencyLimiter` ignores `config.lockService` and always uses raw `LockService`, although the README and CHANGELOG say both limiters accept it. magb.kpis passes `GasLock` to it for nothing.                                                        | `src/middleware/gas-webapp.limiter.ts:94-99`    |
| M2  | When the lock is contended on release, the concurrency slot leaks until its TTL expires. The fixed 60 s TTL is also shorter than the 6-minute execution limit, so a long request's slot can expire mid-flight and the limiter undercounts.                     | `src/middleware/gas-webapp.limiter.ts:79,85`    |
| M3  | The logging middleware's `status` is always `undefined` for handlers that return plain values, because wrapping happens after dispatch. Errors are logged twice (here and by gas-error), and every request logs all `params`, which can include PII or tokens. | `src/middleware/gas-webapp.logging.ts:39,49,58` |
| M4  | The auth middleware passes an empty email (scope declined, or a consumer account under `USER_DEPLOYING`) to `isAuthorized('')`, producing `" is not authorized"`. A `Session` call that throws becomes a 500.                                                  | `src/middleware/gas-webapp.auth.ts:22-26`       |

### Browser client

| ID  | Finding                                                                                                                                                                                                                                                                                      | Location                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| C1  | A `null` or `undefined` success value crashes on `.data`.                                                                                                                                                                                                                                    | `src/web/gas-webapp.client.ts:222`     |
| C2  | `request()` assumes every rejection is a `ServerError` and reads `error.payload`; any other throw crashes the retry loop instead of rejecting cleanly.                                                                                                                                       | `src/web/gas-webapp.client.ts:300-320` |
| C3  | `params.route` and `params.callId` silently collide with the reserved keys the client sets.                                                                                                                                                                                                  | `src/web/gas-webapp.client.ts:72-79`   |
| C4  | `NOT_DELIVERED` is not proof of non-delivery: a call queued behind the per-user concurrency limit for longer than `ackDeadlineMs` is reported as dropped and then runs. For a POST, the caller sees an error while the write commits. Needs documenting and, optionally, an idempotency key. | `src/web/gas-webapp.client.ts:268-288` |

### Documentation drift

| ID  | Finding                                                                                                    | Location                                                              |
| --- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| D1  | `ackDeadlineMs` is documented as `8000`; the code uses `15000`.                                            | `src/web/types/gas-webapp.client.types.ts:76`, `src/web/README.md:71` |
| D2  | The web README says the client ships as TypeScript source; `dist-web` contains compiled `.js` and `.d.ts`. | `src/web/README.md:31`                                                |
| D3  | Prettier has merged the `<?!= … ?>` scriptlet examples onto shared lines in both READMEs.                  | `README.md`, `src/web/README.md`                                      |
| D4  | The README's peer table and Error Handling section describe the old gas-error API.                         | `README.md:70,464`                                                    |

### Design gaps against Express

| ID  | Finding                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| X1  | **Registration order is ignored.** Every `use()` entry runs before every route, whenever it was registered. magb.kpis's `app.ts` relies on Express ordering ("/ack, registered separately above, keeps its own quieter logger"), but `withAck` and `withAuth` still run on `/ack`. There is no way to keep a route out of global middleware, which the ack route needs. |
| X2  | **The URL path is ignored.** Routes come only from `?route=`; `e.pathInfo` is never read. Resolved by decision 2.                                                                                                                                                                                                                                                       |
| X3  | **No path parameters, wildcards or `all()`.** Matching is exact-string only, and `req.params` holds the query string (`req.query` in Express).                                                                                                                                                                                                                          |
| X4  | **No response object or error middleware.** Handlers return values; error handling is hard-wired to gas-error. There is no custom 404, no HTML error page for page routes, no redirect and no `locals`.                                                                                                                                                                 |
| X5  | **Onion-style signature.** `(next) => (req) => result` instead of `(req, res, next)`. Request copies don't flow back up, which causes L4. Resolved by decision 1.                                                                                                                                                                                                       |
| X6  | **GET and POST only.** Resolved by decision 3.                                                                                                                                                                                                                                                                                                                          |
| X7  | **The rate limiter serialises requests.** With `lockScope: 'script'` every request takes a script lock for up to 10 s. With `lockScope: 'user'` and a key that isn't per-user, the lock does not protect the counter.                                                                                                                                                   |
| X8  | **Transport detection trusts the event.** `isHttpRequest` is inferred from `contextPath`, which a `google.script.run` caller can set on the event it sends.                                                                                                                                                                                                             |

### Platform limitations

These are Apps Script constraints. They are documented, not fixed.

| ID  | Limitation                                                                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Every HTTP response is a 200; the status exists only in the envelope.                                                                                                                   |
| P2  | No response headers, cookies or HTTP redirects. `res.redirect` is an HTML navigation of the top window, HTTP-only.                                                                      |
| P3  | `e.parameter` keeps only the first value of a repeated key; `e.parameters` holds them all.                                                                                              |
| P4  | `e.pathInfo` is unreliable on `doPost` (see Route resolution).                                                                                                                          |
| P5  | Delivery acknowledgement costs one `CacheService` write per request plus polling while calls are in flight.                                                                             |
| P6  | gas-dev-bundle covers Apps Script code only. The browser client stays on `git subtree`, and the consumer's build wraps it into `.js.html` for `HtmlService`.                            |
| P7  | `gasLibrary.peers` are optional by definition, so a project bundled without gas-error fails only at runtime.                                                                            |
| P8  | The push-time parser rejects `async` and `await`, so backend code has no async functions at all. TypeScript at ES2020 emits both unchanged, so only a lint rule or a push catches them. |

### Tooling

| ID  | Finding                                                                                                                                                                                                                                                                |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | Own `eslint.config.js`, `tsconfig.base.json` and `.prettierrc.json`, and direct `@eslint/js`, `typescript-eslint`, `eslint-config-prettier` and `globals` dev dependencies, instead of gas-dev-config presets. No `gas-dev-config check`.                              |
| T2  | `scripts/release.sh` has no preflight, tags `dist/$VERSION` without the `v` prefix, writes no `gasLibrary` metadata, pushes non-atomically and gives `dist-web` no `package.json`. gas-dev-release documents a gas-webapp multi-target configuration that replaces it. |
| T3  | No tests: no Vitest suite and no `gas-test/`. Every other library has both.                                                                                                                                                                                            |
| T4  | No canonical `peer/gas-webapp.peer.types.d.ts` for downstream gas-\* consumers.                                                                                                                                                                                        |
| T5  | `docs/gas-suite-integration.md` is still open; it asks to be deleted once its items are adopted.                                                                                                                                                                       |

## Target API

The shape the phases build towards. Names follow Express unless noted.

```ts
const app = new GasWebApp({ logger });
const api = new GasWebAppRouter();

api.get('/users/:id', (req, res) => {
  res.json(usersTable.get(req.params.id));
});
api.put('/users/:id', requireRole('admin'), (req, res) => {
  res.status(200).json(usersTable.update(req.params.id, req.body));
});

app.use(ack.middleware);
app.get('/ack', ack.handler); // before the limiters, so they don't apply
app.use('/api', auth, limiter);
app.use('/api', api);
app.get('/', (req, res) =>
  res.render('pages/home', { layout: 'layouts/main' }),
);

app.use((err, req, res, next) => {
  /* custom error handling; gas-error is the default */
});

const doGet = app.doGet;
const doPost = app.doPost;
```

| Object | Members                                                                                                                                                       |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app`  | `use`, `get`, `post`, `put`, `patch`, `delete`, `all`, `locals`, `doGet`, `doPost`, template helpers (`include`, `js`, `css`, `html`)                         |
| `req`  | `method` (effective, after override), `path`, `params`, `query`, `body`, `id`, `transport` (`'http' \| 'rpc'`), `raw`; middleware may add fields (`req.user`) |
| `res`  | `status`, `json`, `send`, `render`, `redirect` (HTTP only), `locals`, `headersSent`-style `sent` flag                                                         |

Deviations from Express, all forced by the platform or the wire contract: the success envelope (A2), synchronous middleware (A4, P8), no headers or cookies (P2), and `redirect`/`render` being HTTP-only.

## Testing

| Layer          | Tool                                                     | Runs                       | Covers                                                                                                                   |
| -------------- | -------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Unit           | Vitest with gas-dev-config's `createGasLoader` and mocks | `npm run check`, offline   | Routing, middleware, serialisation, client logic                                                                         |
| Apps Script    | `gas-dev-config gas-test run` (clasp push, run, logs)    | `npm run test:gas`, manual | Real `HtmlService`, `ContentService`, `CacheService`, `LockService` and `Session`; the push itself proves P8 and B3 hold |
| Ad hoc probes  | `clasp run` and `clasp logs` on the test project         | Manual                     | One-off platform questions before a design depends on them                                                               |
| Web app (HTTP) | A test deployment of the test project, called over HTTPS | Manual, Phase 6            | `e.pathInfo`, `contextPath`, POST bodies and response MIME types, which `clasp run` cannot exercise                      |

- The dedicated Apps Script test project is selected with `GAS_TEST_SCRIPT_ID`. Its ID stays out of the repository, and its contents are replaced on every run.
- Apps Script tests start in Phase 2 and grow with each phase, instead of arriving at the end, so every backend phase is proven to push and run.

## Phases

Each phase is one `feature/*` branch off `develop`, executed by a subagent, reviewed, committed with Conventional Commits and merged with `--no-ff`. A bug fix starts with a test that fails without it.

Every phase ends with the same exit items, repeated in each checklist so a phase can be ticked off on its own.

### Phase 0: async/await rule in gas-dev-config

Repository: `gas-dev-config`. Branch: `feature/no-async-rule`. Guards P8 for every gas-\* library, not only gas-webapp.

- [ ] The `gas` preset forbids `async` functions (declarations, expressions, arrows, methods) and `await` in Apps Script sources: `src/**/*.ts` outside `web.files`, and `gas-test/**/*.ts`.
- [ ] Browser sources (`web.files`), `test/**/*.ts` and `scripts/**/*.js` are unaffected.
- [ ] The rule's message names the cause: Apps Script rejects `async`/`await` on push.
- [ ] Tests in `test/eslint.test.js` cover each forbidden form, and each unaffected file set.
- [ ] README: the rule is listed under "What the `gas` preset lints".
- [ ] `npm run check` passes in gas-dev-config.
- [ ] CHANGELOG `[Unreleased]` updated; the version bump and release (`1.5.0`) are a manual step.
- [ ] Reviewed, committed, merged into gas-dev-config's `develop`.

### Phase 1: adopt gas-dev-config

Branch: `feature/gas-dev-config`. Closes T1, B3; guards P8. No runtime behaviour change.

Pulled forward because `gas-dev-config check` requires the standard `release` and `test` scripts: the gas-dev-release setup from Phase 7 (dependency, script, `gasDevRelease` targets, deletion of the release scripts) and the minimal Vitest setup from Phase 2 (`tsconfig.test.json`, `test/harness.ts`, one load test).

- [x] Add `gas-dev-config` (`^1.4.1`), `@types/node` and `@google/clasp` as dev dependencies.
- [x] Remove `@eslint/js`, `typescript-eslint`, `eslint-config-prettier` and `globals` from dev dependencies.
- [x] Set `"prettier": "gas-dev-config/prettier"`; delete `.prettierrc.json`.
- [x] `tsconfig.json` extends `gas-dev-config/tsconfig/gas.json`; target becomes ES2020.
- [x] `tsconfig.frontend.json` extends `gas-dev-config/tsconfig/web.json`.
- [x] Delete `tsconfig.base.json`.
- [x] `eslint.config.js` uses `gasEslint({ web: { files: ['src/web/**/*.ts'], tsconfig: './tsconfig.frontend.json' } })`.
- [x] Until gas-dev-config 1.5.0 is released, mirror Phase 0's rule as an extra flat config in `eslint.config.js`, marked for removal once the dependency is bumped.
- [x] Add `gasDevConfig.loadOrder`: response, router, constants, class, then `middleware/*`.
- [x] Confirm `gas-dev-config check` and gas-dev-release accept nested `middleware/` paths in `loadOrder`; if not, raise it against those tools before flattening anything here.
- [x] Add `gasDevConfig.peers`: gas-error `^1.2.0`, gas-logger `^1.3.0`, gas-lock `^1.2.0`.
- [x] Align `.gitignore`, `.prettierignore`, `.github/dependabot.yml` and the `package.json` scripts with `gas-dev-config check`.
- [x] Diff `dist/` before and after: only ES2020 downlevelling differs.
- [x] `npm run check` passes, including `gas-dev-config check`.
- [x] CHANGELOG `[Unreleased]` updated.
- [ ] Reviewed, committed, merged into `develop`.

### Phase 2: current peers and test harnesses

Branch: `feature/peer-upgrade`. Closes B1, B2; starts T3.

- [ ] Replace `src/internal/gas-webapp.peer.types.ts` with the canonical `peer/*.d.ts` from gas-error 1.2.1, gas-logger 1.3.1 and gas-lock 1.2.1.
- [ ] Migrate every `errorHandler` call to `GasError.handle`.
- [ ] Migrate every error class to its `Gas*` name.
- [x] Add `tsconfig.test.json`, Vitest and the `test`/`test:watch` scripts.
- [x] Add `test/harness.ts` using `createGasLoader` with `loadOrderFiles`.
- [ ] Add `test/mocks.ts` for `HtmlService`, `ContentService`, `CacheService`, `LockService`, `Session` and `Utilities`, in the sibling libraries' style.
- [ ] Unit smoke tests: both entry points, both transports, one success and one error each. No router characterisation tests: Phase 4 replaces that behaviour.
- [ ] Add `gas-test/tsconfig.json` and `gasDevConfig.gasTest.scopes` for the services under test (at least `userinfo.email`).
- [ ] Add the `test:gas:build` and `test:gas` scripts.
- [ ] First Apps Script test: the bundled peers and gas-webapp load, and a simulated RPC request returns the success envelope.
- [ ] `npm run test:gas` passes on the test project.
- [ ] `npm run check` passes.
- [ ] CHANGELOG `[Unreleased]` updated.
- [ ] Reviewed, committed, merged into `develop`.

### Phase 3: fixes that survive the rewrite

Branch: `feature/lifecycle-fixes`. Closes L1, L2, L3, L5, L6, L7, M1, M2, M4, C1, C2, C3, D1, D2, D3, D4.

Only code that Phase 4 keeps is touched; router and logging defects are fixed by the rewrite.

- [ ] L1: request normalisation runs inside the error boundary.
- [ ] L2: body parsed by `postData.type`: JSON parsed, form-encoded left to `e.parameter`, anything else kept as a string.
- [ ] L3: HTTP errors serialised from `GasError.handle(err, { rethrow: false })`; RPC errors rethrown. Every error, including `_serialize`'s, takes this one path.
- [ ] L5: `render` without `layout` renders standalone.
- [ ] L6: `resolveStaticFilePath` prepends the separator and tolerates a leading `/`.
- [ ] L7: `render` resolves views and layouts through the static dirs.
- [ ] M1: `createConcurrencyLimiter` uses `config.lockService`.
- [ ] M2: release retries instead of leaking the slot; the counter TTL covers the 6-minute execution limit.
- [ ] M4: an empty email, or a throwing `Session` call, is a 401 with a fixed message.
- [ ] C1: a `null`/`undefined` success value resolves instead of crashing.
- [ ] C2: non-`ServerError` rejections are normalised through `clientError`.
- [ ] C3: `route` and `callId` in `params` reject with `CLIENT_ERROR`.
- [ ] D1–D4: documentation drift corrected.
- [ ] Each fix above has a unit test that fails without it.
- [ ] Apps Script tests for L3 (real `ContentService` output) and L5–L7 (real `HtmlService` templates).
- [ ] `npm run test:gas` passes on the test project.
- [ ] `npm run check` passes.
- [ ] CHANGELOG `[Unreleased]` updated.
- [ ] Reviewed, committed, merged into `develop`.

### Phase 4: Express router core

Branch: `feature/express-router`. Closes R1–R5, X1, X3, X5, X6 (server side), L4. Breaking.

- [ ] One ordered layer stack per router: `use`, `get`, `post`, `put`, `patch`, `delete` and `all` run in registration order (X1).
- [ ] Path matching with `:param`, optional segments and `*`, compiled once at registration, with no external dependency (X3).
- [ ] Sub-routers mounted by reference, so routes added later are live (R3).
- [ ] Root mounting and root prefixes behave like Express (R1, R2).
- [ ] `(req, res, next)` dispatch with synchronous `next()`, `next(err)` and `next('route')` (X5).
- [ ] Thrown errors and `next(err)` reach `(err, req, res, next)` middleware; gas-error is the default final error handler.
- [ ] Final handler: no matching path is a 404; a path matched under another method is a 405 (R5).
- [ ] Final handler: a matched route that finishes without responding is a 500 naming the route, not a 404.
- [ ] Registering the same method and path twice throws at registration (R4).
- [ ] `req` and `res` per the Target API, mutated in place so enrichment reaches outer middleware and the final handler (L4).
- [ ] Method override: `_method` on `doPost` maps to PUT, PATCH or DELETE; any other value is a 400 (X6).
- [ ] `json()` and `render()` move from `GasWebApp` to `res`; `GasWebApp` keeps its entry points and template helpers.
- [ ] Unit tests ported from the Express router cases in scope.
- [ ] Test fixture: magb.kpis's `app.ts` routing rewritten against the new API routes the way its comments intended (that repo is not changed).
- [ ] Apps Script test: a request through nested routers, path params and error middleware, end to end.
- [ ] `npm run test:gas` passes on the test project.
- [ ] `npm run check` passes.
- [ ] CHANGELOG `[Unreleased]` updated, under a breaking-change note.
- [ ] Reviewed, committed, merged into `develop`.

### Phase 5: built-in middleware and responses on the new API

Branch: `feature/express-middleware`. Closes M3, X4, X7.

- [ ] Port `createAckTracker` to `(req, res, next)`.
- [ ] Port `createAuthMiddleware`; it sets `req.user = { email }`, and the placeholder `session` field and in-code TODO are removed.
- [ ] Port `createRateLimiter` and `createConcurrencyLimiter`.
- [ ] Port `createLoggingMiddleware`: it reads `res` after `next()` returns (status, duration, transport) (M3).
- [ ] Errors are logged once, by the error handler (M3).
- [ ] Logged parameters pass through a configurable redaction list (M3).
- [ ] Rate limiter defaults to `lockScope: 'user'`; the scope rule and the `'script'` throughput cost are documented (X7).
- [ ] `res.render` merges `app.locals` and `res.locals` into the template (X4).
- [ ] `res.redirect` as an HTTP-only top-window navigation (X4, P2).
- [ ] Optional HTML error view for page routes, falling back to the JSON envelope (X4).
- [ ] Unit tests for every built-in middleware on the new signature.
- [ ] Unit test: the ack route stays out of the limiters purely by registration order.
- [ ] Apps Script tests: `CacheService`-backed ack and rate limiting, `LockService` contention in the concurrency limiter, an `info()` probe for `Session` email availability.
- [ ] `npm run test:gas` passes on the test project.
- [ ] `npm run check` passes.
- [ ] CHANGELOG `[Unreleased]` updated.
- [ ] Reviewed, committed, merged into `develop`.

### Phase 6: transport

Branch: `feature/transport`. Closes X2, X6 (client side), X8, C4.

- [ ] Route resolution per decision 2, with a unit test for every row of the resolution table (X2).
- [ ] Transport detection a `google.script.run` caller cannot spoof through `contextPath`; if no reliable signal exists, documented as advisory and never used for security decisions (X8).
- [ ] Client: `api.put`, `api.patch` and `api.delete`, sending `_method` through `doPost` (X6).
- [ ] Client: PUT, PATCH and DELETE do not retry by default, like POST.
- [ ] Document that `NOT_DELIVERED` can be a false negative under queuing (C4).
- [ ] Optional `idempotencyKey` request option, with a server helper that checks it against `CacheService` (C4).
- [ ] Manual check on a test web app deployment: `e.pathInfo` on GET and POST, `contextPath`, form and JSON POST bodies, response MIME types. Record the results in the README's platform notes.
- [ ] `npm run test:gas` passes on the test project.
- [ ] `npm run check` passes.
- [ ] CHANGELOG `[Unreleased]` updated.
- [ ] Reviewed, committed, merged into `develop`.

### Phase 7: release and distribution

Branch: `feature/gas-dev-release`. Closes T2, T4.

- [x] Add gas-dev-release (`^1.1.0`) and `"release": "gas-dev-release"`.
- [x] `gasDevRelease.targets`: `dist` (backend, `web/` excluded) and `dist-web` (from `dist/web`, with `src/web/README.md` as its README), both with `packageJson: true`.
- [x] Delete `scripts/release.sh` and `scripts/write-release-package-json.js`.
- [ ] Add `peer/gas-webapp.peer.types.d.ts` as the canonical declaration for downstream gas-\* libraries.
- [ ] Reduce `scripts/sync-gas-webapp.sh` to the browser client; document gas-dev-bundle for the backend and its peers (P6, P7).
- [ ] `npm run release -- --dry-run` stages both targets with `v`-prefixed tags.
- [ ] The dry-run `dist` `package.json` carries `gasLibrary` that gas-dev-bundle accepts.
- [ ] `npm run check` passes.
- [ ] CHANGELOG `[Unreleased]` updated.
- [ ] Reviewed, committed, merged into `develop`.

### Phase 8: documentation and v1.0.0

Branch: `feature/docs-v1`. Closes T3, T5.

- [ ] Rewrite `README.md` for the new API: install with gas-dev-bundle, the route resolution table, method override, error middleware, Express differences, platform limitations P1–P8.
- [ ] Rewrite `src/web/README.md`: install with subtree or the sync script, `put`/`patch`/`delete`, idempotency keys.
- [ ] Migration note from the pre-1.0 API, using magb.kpis's `app.ts` as the worked example.
- [ ] Apps Script test coverage reviewed: every Apps Script service the library calls is exercised at least once.
- [ ] Delete `docs/gas-suite-integration.md`.
- [ ] Finalise the CHANGELOG for `v1.0.0`.
- [ ] Bump `gas-dev-config` to `^1.5.0` and remove the mirrored `async`/`await` rule, once 1.5.0 is released (manual if not yet released).
- [ ] Delete this document.
- [ ] `npm run test:gas` passes on the test project.
- [ ] `npm run check` passes.
- [ ] Reviewed, committed, merged into `develop`; `release/1.0.0` ready to cut.
