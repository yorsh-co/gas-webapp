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
- Response helpers (`json`, `render`) and template helpers (`include`, `js`, `css`, `html`) for `HtmlService`-based views, with configurable static asset directories/extensions
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

webApp.get('/api/users', (request) => {
  return usersTable.find();
});

webApp.post('/api/users', (request) => {
  return usersTable.insert(request.body);
});

webApp.get('/', (request) => {
  return webApp.render('Home', { layout: 'Layout' });
});

const doGet = webApp.doGet;
const doPost = webApp.doPost;
```

## Requirements

### Peer Dependencies

`gas-webapp` expects the following as globals at runtime — both are separate subtree packages, added the same way as `gas-webapp` itself.

| Package                                                | Required | Used for                                                                                                                   |
| ------------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| [`gas-error`](https://github.com/yorsh-co/gas-error)   | Yes      | `NotFoundError`, `ForbiddenError`, `ValidationError`, `UnauthorizedError`, `RateLimitError`, `errorHandler`                |
| [`gas-logger`](https://github.com/yorsh-co/gas-logger) | No       | Structured request logging via `createLoggingMiddleware`; falls back to `console` if omitted                               |
| [`gas-lock`](https://github.com/yorsh-co/gas-lock)     | No       | Optional `lockService` for `createRateLimiter`/`createConcurrencyLimiter`; falls back to `LockService` directly if omitted |

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

#### 1. Add the library and its peer dependencies

This repository publishes compiled output on two branches — `dist` (backend) and `dist-web` (browser client) — since `git subtree` imports a branch root and has no way to select a subdirectory. `gas-error` (required) and `gas-logger` (optional) are separate repos again. `scripts/sync-gas-webapp.sh` adds all of it in one step; download it once and run it from your project root:

```bash
curl -o scripts/sync-gas-webapp.sh \
    https://raw.githubusercontent.com/yorsh-co/gas-webapp/main/scripts/sync-gas-webapp.sh \
    && chmod +x scripts/sync-gas-webapp.sh \
    && scripts/sync-gas-webapp.sh
```

This creates:

```txt
src/lib/gas-webapp/
src/web/public/js/lib/gas-webapp/
src/lib/gas-error/
src/lib/gas-logger/
```

Keep the downloaded script — running it again later pulls updates for whatever's already present, no separate command to remember. See [Peer Dependencies](#peer-dependencies) for what each of these is for.

> **Note:**
> Only need the backend, with no browser client? `scripts/sync-gas-webapp.sh --backend-only` skips the browser client and still brings in `gas-error`/`gas-logger`. Only need `gas-webapp` itself, with none of this? `git subtree add --prefix=src/lib/gas-webapp https://github.com/yorsh-co/gas-webapp.git dist --squash` works standalone.

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

webApp.get('/', (request) => webApp.json({ ok: true }));

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

`gas-webapp` ships as two subtrees — backend and browser client — and pulls in `gas-error`/`gas-logger` alongside them, all via `scripts/sync-gas-webapp.sh`. Download it once and run it from your project root:

```bash
curl -o scripts/sync-gas-webapp.sh \
    https://raw.githubusercontent.com/yorsh-co/gas-webapp/main/scripts/sync-gas-webapp.sh \
    && chmod +x scripts/sync-gas-webapp.sh \
    && scripts/sync-gas-webapp.sh
```

This creates:

```txt
src/lib/gas-webapp/
src/web/public/js/lib/gas-webapp/
src/lib/gas-error/
src/lib/gas-logger/
```

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

    "dist/lib/gas-error/module/gas-error.class.js",
    "dist/lib/gas-error/module/gas-error.handler.js",

    "dist/lib/gas-webapp/gas-webapp.response.js",
    "dist/lib/gas-webapp/module/gas-webapp.router.class.js",
    "dist/lib/gas-webapp/module/gas-webapp.constants.js",
    "dist/lib/gas-webapp/module/gas-webapp.class.js"
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

webApp.get('/', (request) => webApp.json({ ok: true }));

const doGet = webApp.doGet;
const doPost = webApp.doPost;
```

#### 10. Register routes and middleware

```js
webApp.use(createLoggingMiddleware());

webApp.get('/api/users', (request) => usersTable.find());
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
webApp.get('/api/users', (request) => usersTable.find());
webApp.post('/api/users', (request) => usersTable.insert(request.body));
```

### Route requests from the client

Both transports read the target route from a `route` parameter, since `doPost` has no URL path to inspect:

```js
// Real HTTP request
fetch(`${webAppUrl}?route=/api/users`);

// google.script.run
google.script.run
  .withSuccessHandler(onUsers)
  .doGet({ parameter: { route: '/api/users' } });
```

> **Note:**
> That's the raw shape either transport expects. If you'd rather not hand-roll the promise wrapping, retry, and error parsing yourself, the [browser client](./web/README.md) does this for you: `GasWebApp.api.get('/api/users')`.

### Add Middleware

```js
// applies to every route
webApp.use(createLoggingMiddleware(gasLogger));

// applies only to routes under /api
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
    lockScope: 'user',
    keyFn: (request) => request.email,
  }),
  (request) => usersTable.insert(request.body),
);
```

> **Note:**
> When `createRateLimiter` rejects a request for exceeding the window count, the `RateLimitError` it throws carries `details.retryAfterSeconds` — the number of seconds until that window rolls over — so callers can back off precisely instead of guessing. Rejections from lock contention (a rare race, not a limit being hit) do not carry this, since a 1-second retry is the reasonable default there. `createConcurrencyLimiter` never sets it either: a concurrency slot frees when some other in-flight execution finishes, which the limiter has no way to estimate.

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
    keyFn: (request) => `route:${request.method}:${request.route}`,
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

// first — ahead of auth and rate limiting, so a request that arrives and is
// then rejected (401, 429, etc.) is still acknowledged
webApp.use(ackTracker.middleware);

// outside any rate-limited prefix — this route is polled while other
// requests are in flight, and would otherwise consume their rate budget
webApp.get('/ack', ackTracker.handler);

webApp.use('/api', createAuthMiddleware({ isAuthorized }));
webApp.use(
  '/api',
  createRateLimiter({
    limit: 100,
    windowSeconds: 60,
    lockScope: 'script',
    keyFn: (request) => `route:${request.method}:${request.route}`,
  }),
);
```

`ackTracker.handler` expects a `callIds` parameter (comma-separated) and returns the subset that were found — each one is deleted from the cache as it's reported, so a given `callId` is only ever reported once.

> **Note:**
> `callId` is a correlation token, not a credential. It's never used for authorization, and because it's client-supplied it's validated against a UUID pattern before it's used as a cache key. Treat it as a hint that a request arrived, not proof of anything about who sent it.

### Mount a Sub-Router

```js
const apiRouter = new GasWebAppRouter();

apiRouter.get('/users', (request) => usersTable.find());

webApp.use('/api', apiRouter);
```

### Return JSON

```js
webApp.get('/api/users', (request) => {
  return webApp.json(usersTable.find());
});
```

> **Note:**
> Returning a plain value from a handler is equivalent to wrapping it in `webApp.json(...)` — `GasWebApp` does this automatically for any handler result that isn't already a `json`/`render` response.

### Render a View

```js
webApp.get('/', (request) => {
  return webApp.render('Home', { layout: 'Layout', pageTitle: 'Dashboard' });
});
```

> **Note:**
> Pass `layout: null` to render the view standalone, with no layout.

### Template Helpers

Call these from inside an `HtmlService` template via the app's global instance:

```html
<?!= webApp.include('partials/Header'); ?>
<?!= webApp.js('components/UserTable'); ?> <?!=
webApp.css('components/UserTable'); ?> <?!= webApp.html('partials/Footer'); ?>
```

Each resolves against the configured `static` dirs/extensions — e.g. `webApp.js('components/UserTable')` resolves to `dist/web/public/js/components/UserTable.js.html` by default.

## Project Details

### Request Lifecycle

1. `doGet`/`doPost` normalizes the raw event into a `RouteRequest` (route, method, params, body, a generated `reqId`, and whether it's a real HTTP request or a `google.script.run` call).
2. The request is dispatched through the matched route's middleware chain, then its handler.
3. The result is serialized: real HTTP requests get a `ContentService`/`HtmlService` output; `google.script.run` calls get the plain payload.

### Error Handling

Handlers and middleware can throw any `GasError` subclass (`NotFoundError`, `ForbiddenError`, `ValidationError`, `UnauthorizedError`, `RateLimitError`, from the `gas-error` peer package). `GasWebApp` catches these via `errorHandler` and serializes them consistently instead of letting them crash the request — for both transports.

### Middleware Execution Order

- `use(middleware)` — applies to every route.
- `use(prefix, ...middlewares)` — applies only to routes equal to, or nested under, `prefix`.
- `use(prefix, subRouter)` — mounts a `GasWebAppRouter`'s routes and middleware under `prefix`.
- Middleware registered per-route (as extra arguments to `get`/`post`) runs innermost, after all matching `use()` middleware.

### Dual Transport

Every route works over both a real HTTP request and `google.script.run`, using the same handler. `HtmlResponse` results (from `render`) can only be returned over a real HTTP request — returning one from a `google.script.run` call throws `ForbiddenError`.

## Planned features

- Session management for authenticated requests (currently a TODO in `createAuthMiddleware`)
- Additional built-in middleware (e.g. request body validation)

## License

MIT

See the `LICENSE` file for details.

## Support

Issues and feature requests are welcome via GitHub Issues.

Maintained by [yorsh-co](https://github.com/yorsh-co).
