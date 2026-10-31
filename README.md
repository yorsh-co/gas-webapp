# gas-webapp

[![Built with Google Apps Script](https://img.shields.io/badge/Built%20with-Google%20Apps%20Script-4285F4?logo=google&logoColor=white)](https://developers.google.com/apps-script)

## Single-entry-point router for Google Apps Script web apps.

> The goal of this project is to give Apps Script web apps a single `doGet`/`doPost` entry point with Express-like routing and middleware, instead of hand-rolled `if`/`switch` dispatch scattered across a project.

`gas-webapp` provides a `GasWebApp` class that registers routes and middleware, dispatches incoming requests, and serializes the result back to either a real HTTP response or a plain payload for `google.script.run` callers — using the same route table and middleware chain for both.

Routes and middleware are registered through `get`, `post`, and `use` methods on a `GasWebApp` (or a plain `GasWebAppRouter` for sub-routers mounted onto it), mirroring `express()` vs `express.Router()`.

> **Disclaimer:**
> This project and [Yorsh](https://github.com/yorsh-co) are independent and are not affiliated with, endorsed by, or associated with Google LLC.

> **Browser client:**
> A companion package wraps `google.script.run` calls for you — promises, timeouts, retry, and delivery acknowledgement instead of hand-rolled `withSuccessHandler`/`withFailureHandler` callbacks. It ships from this same repository on a separate `dist-web` branch. See [`web/README.md`](./web/README.md).

### Features

- Single `doGet`/`doPost` entry point handling both real HTTP requests and `google.script.run` calls through the same route table
- Express-style `get`/`post`/`use` API, including prefixed middleware and mountable sub-routers
- Middleware chain composition, with global (`use(mw)`) or path-prefixed (`use('/api', mw)`) scoping
- Built-in middleware factories: request logging, an injectable-policy auth check, request rate/concurrency limiting with a configurable lock scope and optional injected lock service, and `google.script.run` delivery acknowledgement
- Centralized error handling — thrown `GasError` subclasses are caught and serialized consistently instead of crashing the request
- Express-style `(req, res, next)` handlers and middleware, error middleware, `:param`/`*wildcard`/`{optional}` paths, and `put`/`patch`/`delete` through a method override
- Response helpers (`res.json`, `res.send`, `res.render`) and template helpers (`include`, `js`, `css`, `html`) for `HtmlService`-based views, with configurable static asset directories/extensions
- Written in TypeScript; ships compiled `.js` plus matching `.d.ts` files, so no build step is required to consume it, TS or not
- No external dependencies beyond built-in Apps Script services and its own peer packages (see [Peer Dependencies](#peer-dependencies))

### Example Usage

```js
const webApp = new GasWebApp({
  logger: gasLogger, // optional — falls back to `console`
});

webApp.use(createLoggingMiddleware(gasLogger));

webApp.use(
  '/api',
  createAuthMiddleware({
    isAuthorized: (email) => AUTHORIZED_EMAILS.includes(email),
  }),
);

webApp.get('/api/users/:id', (req, res) => {
  res.json(usersTable.get(req.params.id));
});

webApp.post('/api/users', (req, res) => {
  res.status(201).json(usersTable.insert(req.body));
});

webApp.get('/', (req, res) => {
  res.render('Home', { layout: 'Layout' });
});

const doGet = webApp.doGet;
const doPost = webApp.doPost;
```

## Requirements

### Peer Dependencies

`gas-webapp` expects the following as globals at runtime — each is a separate gas-\* library, bundled alongside `gas-webapp` by gas-dev-bundle.

| Package                                                | Required | Used for                                                                                                                      |
| ------------------------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| [`gas-error`](https://github.com/yorsh-co/gas-error)   | Yes      | `GasError.handle`, `GasNotFoundError`, `GasForbiddenError`, `GasValidationError`, `GasUnauthorizedError`, `GasRateLimitError` |
| [`gas-logger`](https://github.com/yorsh-co/gas-logger) | No       | Structured request logging via `createLoggingMiddleware`; falls back to `console` if omitted                                  |
| [`gas-lock`](https://github.com/yorsh-co/gas-lock)     | No       | Optional `lockService` for `createRateLimiter`/`createConcurrencyLimiter`; falls back to `LockService` directly if omitted    |

### Deployment

`gas-webapp` must be deployed as an Apps Script **Web App** (Apps Script editor → Deploy → New deployment → Web app), with `doGet`/`doPost` assigned from a `GasWebApp` instance.

If using `createAuthMiddleware`, the deployment's **Execute as** setting must resolve `Session.getActiveUser().getEmail()` to the calling user — typically **Execute as: User accessing the web app**.

### Example `appsscript.json`

```js
{
  "timeZone": "America/Sao_Paulo",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "webapp": {
    "executeAs": "USER_ACCESSING",
    "access": "ANYONE"
  }
}
```

## Quick Start

It is recommended to use `gas-webapp` together with [Google's `clasp` CLI](https://github.com/google/clasp) for local Apps Script development and git-based workflows. See [Setup instructions with `clasp`](#setup-instructions-with-clasp) for more information.

#### 1. Add the library to your Apps Script project

##### Backend: gas-dev-bundle

[gas-dev-bundle](https://github.com/yorsh-co/gas-dev-bundle) resolves version ranges against the libraries' release tags and writes them into one script, in dependency order.

```bash
npm install -D github:yorsh-co/gas-dev-bundle#semver:^1.1.1
```

List the libraries in your `package.json`:

```json
{
  "gasDevBundle": {
    "outFile": "src/lib/gas-libraries.js",
    "libraries": {
      "gas-webapp": "^1.0.0",
      "gas-error": "^1.2.0",
      "gas-logger": "^1.3.0",
      "gas-lock": "^1.2.0"
    }
  }
}
```

```bash
npx gas-dev-bundle
```

- Commit the generated file. Its header records each library's version and commit SHA.
- Re-run the command after changing a range to upgrade.
- List `gas-error` even though it is a peer: gas-dev-bundle treats peers as optional and never adds one on its own, so a bundle without it fails only at runtime. `gas-logger` and `gas-lock` can be left out; see [Peer Dependencies](#peer-dependencies).

See the [gas-dev-bundle README](https://github.com/yorsh-co/gas-dev-bundle) for configuration details.

##### Browser client: git subtree

gas-dev-bundle covers Apps Script code only. The browser client ships on its own `dist-web` branch; `scripts/sync-gas-webapp.sh` adds it, and later pulls updates. Download it once and run it from your project root:

```bash
curl -o scripts/sync-gas-webapp.sh \
    https://raw.githubusercontent.com/yorsh-co/gas-webapp/main/scripts/sync-gas-webapp.sh \
    && chmod +x scripts/sync-gas-webapp.sh \
    && scripts/sync-gas-webapp.sh
```

Or add it directly with git subtree:

```bash
git subtree add \
  --prefix=src/web/public/js/lib/gas-webapp \
  https://github.com/yorsh-co/gas-webapp.git \
  dist-web \
  --squash
```

This creates:

```txt
src/web/public/js/lib/gas-webapp/
```

#### 2. Configure Apps Script deployment

Add the `webapp` execution config to the parent project's `appsscript.json`.

See the [Deployment](#deployment) section above.

#### 3. If needed, move `gas-webapp` files to the start of the execution order

`GasWebApp` extends `GasWebAppRouter`, so the router's file must execute before the class that extends it. See the [Configure the file push order](#6-configure-the-file-push-order) section for details.

> **Note:**
> Using the browser client too? It has its own script-load-order requirement — enforced by `<script>` tag order, a separate concern from `clasp push`'s file push order. See [web/README.md](./web/README.md#load-order).

#### 4. Declare a `GasWebApp` instance and export its entry points

```js
const webApp = new GasWebApp();

webApp.get('/', (req, res) => res.json({ ok: true }));

const doGet = webApp.doGet;
const doPost = webApp.doPost;
```

## Setup instructions with `clasp`

`gas-webapp` works best with [Google's `clasp` CLI](https://github.com/google/clasp) for local Apps Script development and git-based workflows.

#### 1. Install clasp

```bash
npm install -g @google/clasp
```

#### 2. Enable the [Apps Script API](https://script.google.com/home/usersettings)

#### 3. Login to Google Apps Script

```bash
clasp login
```

#### 4. Clone or create your Apps Script project

Clone an existing project:

```bash
clasp clone <script-id>
```

or create a new project:

```bash
clasp create --type webapp
```

#### 5. Import `gas-webapp` and its peer dependencies

Use the [gas-dev-bundle method](#1-add-the-library-to-your-apps-script-project) from the Quick Start for the backend and `gas-error`, `gas-logger` and `gas-lock`, and the same section for the browser client.

#### 6. Configure the file push order

Apps Script executes files by the order in the Apps Script editor, from top to bottom. By default, `clasp push` orders files alphabetically by file name.

`gas-webapp.class.js` declares `class GasWebApp extends GasWebAppRouter`. The `extends` clause is evaluated the moment that file runs — not when `GasWebApp` is later instantiated — so `gas-webapp.router.class.js` must execute first, or `clasp push` will succeed but running the project will throw:

```txt
ReferenceError: GasWebAppRouter is not defined
```

Add a [`filePushOrder`](https://github.com/google/clasp#filepushorder-optional) entry to your project's `.clasp.json`:

```json
{
  "filePushOrder": [
    "dist/lib/gas-logger/module/gas-logger.constants.js",
    "dist/lib/gas-logger/module/gas-logger.class.js",

    "dist/lib/gas-error/gas-error.constants.js",
    "dist/lib/gas-error/gas-error.js",

    "dist/lib/gas-lock/gas-lock.constants.js",
    "dist/lib/gas-lock/gas-lock.js",

    "dist/lib/gas-webapp/gas-webapp.response.js",
    "dist/lib/gas-webapp/gas-webapp.router.class.js",
    "dist/lib/gas-webapp/gas-webapp.constants.js",
    "dist/lib/gas-webapp/gas-webapp.class.js"
  ]
}
```

Alternatively, you can manually move these files to the top of the file list in the Apps Script editor.

> **Note:**
> Middleware factories (`createLoggingMiddleware`, `createAuthMiddleware`, `createRateLimiter`, `createConcurrencyLimiter`) are only referenced inside function bodies, not at file top level, so they have no ordering requirement relative to each other. Any file in your own project that constructs a `GasWebApp` instance (e.g. `const webApp = new GasWebApp()`) must still be pushed _after_ the entries above.

> **Note:**
> This ordering is specific to Apps Script's `clasp push`. The browser client has its own, separate load-order requirement enforced by `<script>` tag order — see [web/README.md](./web/README.md#load-order).

#### 7. Push local files to Apps Script

```bash
clasp push
```

#### 8. Configure Apps Script deployment

Add the `webapp` execution config to the parent project's `appsscript.json`.

See the [Deployment](#deployment) section above.

#### 9. Declare a `GasWebApp` instance and export its entry points

```js
const webApp = new GasWebApp();

webApp.get('/', (req, res) => res.json({ ok: true }));

const doGet = webApp.doGet;
const doPost = webApp.doPost;
```

#### 10. Register routes and middleware

```js
webApp.use(createLoggingMiddleware());

webApp.get('/api/users', (req, res) => res.json(usersTable.find()));
```

## Basic Usage

### Create a `GasWebApp` instance

```js
const webApp = new GasWebApp({
  logger: gasLogger, // optional — falls back to `console`
  static: {
    dirs: {
      html: 'dist/web/views',
      js: 'dist/web/public/js',
      css: 'dist/web/public/css',
    },
    extensions: { html: '.html', js: '.js.html', css: '.css.html' },
  },
});
```

> **Note:**
> All `static` fields shown above are the defaults; pass only the ones you want to override.

### Export the entry points

```js
const doGet = webApp.doGet;
const doPost = webApp.doPost;
```

> **Note:**
> `doGet`/`doPost` are arrow-function class fields, not prototype methods, so they keep their `this` binding once assigned to the global `doGet`/`doPost` Apps Script calls.

### Register a Route

```js
webApp.get('/api/users', (req, res) => res.json(usersTable.find()));
webApp.get('/api/users/:id', (req, res) =>
  res.json(usersTable.get(req.params.id)),
);
webApp.post('/api/users', (req, res) =>
  res.status(201).json(usersTable.insert(req.body)),
);
webApp.put('/api/users/:id', (req, res) =>
  res.json(usersTable.update(req.params.id, req.body)),
);
webApp.delete('/api/users/:id', (req, res) =>
  res.json(usersTable.remove(req.params.id)),
);
```

Handlers are `(req, res, next)` functions. Their return value is ignored: a route responds only through `res`.

Paths follow Express 5: `:name` matches one segment, `*name` the rest of the path including slashes, and `{...}` is optional (`/users{/:id}`). Matching is case-insensitive, a trailing slash is optional, and parameters are URI-decoded. Parameters arrive as strings in `req.params`; the request's other parameters are in `req.query`.

`get`, `post`, `put`, `patch`, `delete` and `all` (every method) take any number of handlers. Registering the same method and path twice stacks the handlers, as in Express: the second runs only if the first calls `next()`.

`req` is an interface, so an app adds fields by declaration merging in global scope:

```ts
interface GasWebAppRequest {
  tenant?: string;
}
```

PUT, PATCH and DELETE reach `doPost` as a POST carrying `_method=PUT|PATCH|DELETE`; `req.method` reports the effective method. Any other `_method` is a 400, and `_method` is ignored on GET.

### Route requests from the client

The target route is resolved per entry point:

| Entry point | Resolution order                     |
| ----------- | ------------------------------------ |
| `doGet`     | `route` parameter, `e.pathInfo`, `/` |
| `doPost`    | `route` parameter, `/`               |

- `google.script.run` callers always send `route`.
- When a GET carries both, `route` wins silently.
- `e.pathInfo` is unreliable on `doPost`, so it is never read there: Express-style links (`/exec/users/42`) work for pages and GET APIs, and HTTP POSTs must use `?route=`. Apps Script delivers `pathInfo` without a leading slash; it is normalised like any other path.

```js
// Real HTTP request
fetch(`${webAppUrl}?route=/api/users`);
fetch(`${webAppUrl}/api/users`); // GET only, through e.pathInfo

// google.script.run
google.script.run
  .withSuccessHandler(onUsers)
  .doGet({ parameter: { route: '/api/users' } });
```

PUT, PATCH and DELETE are POSTs carrying `_method` (`POST ${webAppUrl}?route=/api/users/42&_method=DELETE`).

> **Note:**
> That's the raw shape either transport expects. If you'd rather not hand-roll the promise wrapping, retry, and error parsing yourself, the [browser client](./web/README.md) does this for you: `GasWebApp.api.get('/api/users')`.

### Add Middleware

```js
// applies to every route registered after it
webApp.use(createLoggingMiddleware(gasLogger));

// applies only to paths under /api
webApp.use(
  '/api',
  createAuthMiddleware({
    isAuthorized: (email) => AUTHORIZED_EMAILS.includes(email),
  }),
);

// per-route middleware
webApp.post(
  '/api/users',
  createRateLimiter({
    limit: 5,
    windowSeconds: 60,
    keyFn: (req) => req.user.email,
  }),
  (req, res) => res.json(usersTable.insert(req.body)),
);

// your own
webApp.use((req, res, next) => {
  req.tenant = tenantOf(req.user.email);
  next();
});
```

Middleware calls `next()` to continue, `next(err)` to skip to the error handlers, or `next('route')` to skip the rest of the current route. `next()` is synchronous: it returns once everything downstream has finished, so a middleware can read `res.statusCode` after calling it. There is no async middleware (Apps Script rejects `async`/`await`).

`createLoggingMiddleware(logger, options?)` writes a request line and, once `next()` returns, a response line with the final `res.statusCode`: `info` below 400, `warn` from 400, `error` from 500. Errors are logged once, by `GasError.handle`, not here. Query values are logged with the keys in `options.redact` masked as `[REDACTED]` (exact, case-insensitive; default `token`, `password`, `secret`, `key`, `auth`, `authorization`; passing a list replaces the default). The request body is never logged.

```js
webApp.use(createLoggingMiddleware(gasLogger, { redact: ['token', 'ssn'] }));
```

### Limiter lock scope

Both limiters read and write their counter under a lock, set by `lockScope` (`'user'` by default). The lock must cover the scope of the key: a key shared across users (a per-route or global key) needs `lockScope: 'script'`, because a per-user lock does not exclude other users. `'script'` serialises every request through the limiter behind one script lock, each waiting up to 10 seconds for it, so use it only for keys that need it.

> **Note:**
> When `createRateLimiter` rejects a request for exceeding the window count, the `GasRateLimitError` it throws carries `details.retryAfterSeconds` — the number of seconds until that window rolls over — so callers can back off precisely instead of guessing. Rejections from lock contention (a rare race, not a limit being hit) do not carry this, since a 1-second retry is the reasonable default there. `createConcurrencyLimiter` never sets it either: a concurrency slot frees when some other in-flight execution finishes, which the limiter has no way to estimate.

### Sharing a lock registry

Both limiters take an optional `lockService` — anything exposing `getLock(scope)`:

```js
webApp.use(
  '/api',
  createRateLimiter({
    limit: 100,
    windowSeconds: 60,
    lockScope: 'script',
    lockService: GasLock,
    keyFn: (req) => `route:${req.method}:${req.originalPath}`,
  }),
);
```

Omitted, both resolve `LockService.getScriptLock()`/`getUserLock()` directly — unchanged behavior. Pass [`gas-lock`](https://github.com/yorsh-co/gas-lock) when other services in the same execution (e.g. [`gas-sheetdb`](https://github.com/yorsh-co/gas-sheetdb)) also lock, so every layer resolves through one registry.

> **Note:**
> The limiters use non-blocking `tryLock`, so they fail fast on contention rather than deadlocking — injecting `gas-lock` here is about consistency with the rest of the app's locking, not about fixing a hang. `gas-lock`'s `getLock` is not reentrancy-tracked, since reentrancy only means anything for its callback-scoped `withLock`.

### Delivery Acknowledgement

`google.script.run` calls are occasionally dropped by the Apps Script bridge before they reach `doGet`/`doPost` at all — indistinguishable, from the client's side, from a request that's just slow. `createAckTracker` closes that gap: its middleware records a caller-supplied `callId` the moment a request enters the chain, and its handler reports back which of a set of `callId`s were recorded, using `CacheService` as short-lived storage.

```js
const ackTracker = createAckTracker(); // { ttlSeconds: 60 } by default

// the ack route first, so the middleware registered below does not apply to
// it: it is polled while other requests are in flight, and would otherwise
// consume their rate budget
webApp.get('/ack', ackTracker.handler);

// ahead of auth and rate limiting, so a request that arrives and is then
// rejected (401, 429, etc.) is still acknowledged
webApp.use(ackTracker.middleware);

webApp.use('/api', createAuthMiddleware({ isAuthorized }));
webApp.use(
  '/api',
  createRateLimiter({
    limit: 100,
    windowSeconds: 60,
    lockScope: 'script',
    keyFn: (req) => `route:${req.method}:${req.originalPath}`,
  }),
);
```

`ackTracker.handler` expects a `callIds` parameter (comma-separated) and responds with the subset that were found — each one is deleted from the cache as it's reported, so a given `callId` is only ever reported once.

> **Note:**
> `NOT_DELIVERED` is a strong hint, not proof. A call queued behind Apps Script's per-user concurrent execution limit for longer than the client's `ackDeadlineMs` is reported as dropped and then runs, so the caller sees an error while the write commits. For routes where a double write matters, pair retries with [`createIdempotencyGuard`](#idempotency).

> **Note:**
> `callId` is a correlation token, not a credential. It's never used for authorization, and because it's client-supplied it's validated against a UUID pattern before it's used as a cache key. Treat it as a hint that a request arrived, not proof of anything about who sent it.

### Idempotency

`createIdempotencyGuard` makes a mutating route safe to retry. A request carrying an `idempotencyKey` parameter (a UUID, which the [browser client](./web/README.md) sends for `idempotencyKey: true`) runs once: its success envelope is stored in `CacheService` and replayed to every later request with the same key, and a duplicate arriving while the first is still running is a 409.

```js
webApp.use('/api', createAuthMiddleware({ isAuthorized }));
webApp.use('/api', createIdempotencyGuard()); // { ttlSeconds: 21600, lockService, lockScope: 'user' }
```

- Register it after auth: the key is then scoped to `req.user.email`, so two users' keys cannot collide. Without a user the key is global to the script.
- A failed request (an error status or a thrown error) clears its key, so the retry runs. Only JSON responses are stored; a view or text output clears the key too, as does a response over `CacheService`'s 100 KB value limit.
- The key is checked and marked under the lock (`lockScope`, `'user'` by default), but the handler itself runs outside it. An invalid key is a 400.
- Replay lasts `ttlSeconds`, at most 21600 (6 hours, the `CacheService` maximum). An in-flight marker expires after 7 minutes if its execution died.

### Mount a Sub-Router

```js
const apiRouter = new GasWebAppRouter();

apiRouter.get('/users/:id', (req, res) =>
  res.json(usersTable.get(req.params.id)),
);

webApp.use('/api', apiRouter);
```

Routers are mounted by reference, so routes added to `apiRouter` later are live. Inside a mounted router `req.baseUrl` is the mount path and `req.path` is relative to it; `req.originalPath` is always the full path. `use('/')` or `use(router)` with no path mounts at the root. Each layer sees only its own `req.params`.

### Respond

```js
res.json(usersTable.find()); // { ok: true, status: 200, data }
res.status(201).json(created); // status travels in the envelope
res.send('plain text'); // text over HTTP; the envelope's data over RPC
res.render('Home', { layout: 'Layout', pageTitle: 'Dashboard' });
res.redirect('https://example.com/next'); // HTTP only
```

Apps Script cannot set an HTTP status, so `res.status()` sets the status in the envelope. With a status of 400 or more, `res.json(data)` sends the error envelope, `{ ok: false, status, code, error, details }`: `code` follows the status as in `gas-error` (400 `VALIDATION_ERROR`, 401 `UNAUTHORIZED`, 403 `FORBIDDEN`, 404 `NOT_FOUND`, 409 `CONFLICT`, 429 `RATE_LIMITED`, otherwise `INTERNAL_ERROR`), `error` is `data.message` when that is a string and `Request failed` otherwise, and `data` is `details`. Over `google.script.run` it is thrown, so the browser client rejects it like any other error. A response is sent once: a second `json`, `send`, `render` or `redirect` throws `Response already sent`.

Data for `render` comes from three levels, later ones winning: `webApp.locals` (the whole app), `res.locals` (set in middleware, one request) and the options passed to `render`.

`res.redirect([status,] url)` returns a page that navigates the top window to `url`, with a link as fallback: `HtmlService` serves pages in a sandboxed iframe, so a plain redirect is not possible. The URL must be absolute `http(s)`, anything else is a 400. The optional status is only recorded in `res.statusCode`. Over `google.script.run` it throws `GasForbiddenError`, like `render`.

`render` resolves both the view and the layout through the configured `html` static dir, exactly like `webApp.html()` — `'Home'` becomes `dist/web/views/Home.html` by default — so pass logical names, not full paths. Omit `layout`, or pass `layout: null`, to render the view standalone. Rendering works only over a real HTTP request; over `google.script.run` it throws `GasForbiddenError`.

`req.transport` is **advisory**. It is inferred from the presence of `contextPath` on the event, and a `google.script.run` caller controls the whole event object, so it can claim either value. It selects the output format and the `render`/`redirect` refusals, and must never drive an authentication, authorization or other security decision.

### Template Helpers

Call these from inside an `HtmlService` template via the app's global instance:

```text
<?!= webApp.include('partials/Header'); ?>
<?!= webApp.js('components/UserTable'); ?>
<?!= webApp.css('components/UserTable'); ?>
<?!= webApp.html('partials/Footer'); ?>
```

Each resolves against the configured `static` dirs/extensions — e.g. `webApp.js('components/UserTable')` resolves to `dist/web/public/js/components/UserTable.js.html` by default. A leading `/` is optional.

## Project Details

### Request Lifecycle

1. `doGet`/`doPost` normalizes the raw event into a `req` (`method`, `path`, `query`, `body`, a generated `id`, and the `transport`: a real `'http'` request or a `google.script.run` `'rpc'` call). The route is resolved as in [Route requests from the client](#route-requests-from-the-client). A POST body is parsed by its `postData.type`: `application/json` (parameters such as `; charset=utf-8` allowed) is parsed, and a malformed body is a 400; `application/x-www-form-urlencoded` and `multipart/form-data` leave `req.body` undefined, as their fields are in `req.query`; any other type is passed through as the raw string.
2. The request runs through the router's layer stack in registration order.
3. The response is serialized: real HTTP requests get a `ContentService`/`HtmlService` output; `google.script.run` calls get the plain payload.

A request nothing answers is a 404 reading `Cannot GET /path`, whatever the method (there is no 405). A handler that returns without responding and without calling `next` is a 500 reading `Route did not respond: GET /path`.

### Error Handling

A handler or middleware that throws, or calls `next(err)`, skips to the next error handler: a function with four parameters, as in Express.

```js
webApp.use((err, req, res, next) => {
  if (err instanceof GasConflictError) {
    return res.status(409).json({ conflict: err.message });
  }
  next(err); // pass it on
});
```

While an error is pending, only error handlers run. Without one, the error reaches `GasError.handle` (the `gas-error` peer), which serializes it consistently for both transports: `GasError` subclasses (`GasNotFoundError`, `GasForbiddenError`, `GasValidationError`, `GasUnauthorizedError`, `GasRateLimitError`) keep their status and message, anything else becomes a generic 500. Every failure takes this one path and is logged once, including a malformed request body. Real HTTP requests receive the error envelope as JSON text output; `google.script.run` calls receive an `Error` whose message is that JSON. The user in `req.user`, when auth set one, is logged as the session.

The error is resolved into the response as the stack finishes, before `next()` returns to the middleware above, so a middleware that reads `res.statusCode` after `next()` sees the final status of a failed request, including a 404 for an unmatched route.

To answer page routes with HTML instead of JSON, set an error view:

```js
const webApp = new GasWebApp({ errorView: 'Error' });
```

On an HTTP `GET`, the error is rendered through that view (resolved like `render`, standalone) with `{ error }` (the error envelope) and `webApp.locals`. `google.script.run` calls and other methods keep the JSON envelope, as does a request whose error view itself throws. The error is logged once either way.

`createAuthMiddleware` sets `req.user = { email }`. It rejects with a `GasUnauthorizedError` (401) in two cases, with fixed messages that never echo the email: `Unable to identify the signed-in user` when `Session` throws or returns an empty email (scope declined, or a consumer account under **Execute as: Me**), and `Not authorized` when `isAuthorized` returns false.

### Middleware Execution Order

Layers run in the order they were registered, whatever their kind:

- `use(...handlers)` — applies to every path from this point on.
- `use(prefix, ...handlers)` — applies to paths equal to, or nested under, `prefix`, on segment boundaries (`/api` matches `/api/users` but not `/apiary`).
- `use(prefix, router)` — mounts a `GasWebAppRouter`.
- `get`/`post`/`put`/`patch`/`delete`/`all` — a route; its own handlers run in order.

A route registered before a `use()` is not affected by it, which is how a route such as `/ack` stays out of later middleware.

### Dual Transport

Every route works over both a real HTTP request and `google.script.run`, using the same handler. `res.render` works only over a real HTTP request; over `google.script.run` it throws `GasForbiddenError`.

## Planned features

- Session management for authenticated requests (currently a TODO in `createAuthMiddleware`)
- Additional built-in middleware (e.g. request body validation)

## License

MIT

See the `LICENSE` file for details.

## Support

Issues and feature requests are welcome via GitHub Issues.

Maintained by [yorsh-co](https://github.com/yorsh-co).
