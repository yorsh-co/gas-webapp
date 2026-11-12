# Migrating to gas-webapp 1.0

gas-webapp 1.0 replaces the `(next) => (request) => result` composition with Express's `(req, res, next)`, and makes registration order real. The wire contract (the `{ ok, status, data }` envelope) and the browser client's `get`/`post` calls are unchanged.

The worked example is magb.kpis, the last consumer of the 0.x API: its `app.ts`, routes and middleware, before and after.

## Checklist

| Before (0.x)                                                | After (1.0)                                                                            |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `(request) => webApp.json(data)`                            | `(req, res) => res.json(data)`. Return values are ignored                              |
| `webApp.json(data, status)`                                 | `res.status(status).json(data)`                                                        |
| `webApp.render(view, options)`                              | `res.render(view, options)`                                                            |
| `webApp.render(webApp.resolveStaticFilePath('html', v), …)` | `res.render('v', { layout: 'layouts/main', … })`: views and layouts resolve themselves |
| `(next) => (request) => next(request)`                      | `(req, res, next) => next()`                                                           |
| `Middleware`, `Handler`, `RouteRequest<T>`                  | `GasWebAppHandler`, `GasWebAppRequest`; `HtmlResponse` and `JsonResponse` are removed  |
| `request.route`                                             | `req.originalPath` (full) or `req.path` (relative to the mount)                        |
| `request.params`                                            | `req.query`. `req.params` now holds path parameters (`/users/:id`)                     |
| `request.email`, `request.session`                          | `req.user?.email`                                                                      |
| `request.reqId`                                             | `req.id`                                                                               |
| `request.isHttpRequest`                                     | `req.transport === 'http'`. Advisory, never for security                               |
| `request.body` always parsed as JSON                        | Parsed by content type; form fields are in `req.query`                                 |
| `NotFoundError`, `ValidationError`, …                       | `GasNotFoundError`, `GasValidationError`, …                                            |
| `errorHandler(err)`                                         | `GasError.handle(err)` (needs `gas-error` >= 1.2)                                      |
| Subtree for the backend and each peer                       | [gasdev bundle](https://github.com/yorsh-co/gasdev#bundle)                             |
| `scripts/sync-gas-webapp.sh` installed both halves          | The script installs the browser client only                                            |

Behaviour that changes without a type error:

- **Registration order is real.** In 0.x every `use()` ran before every route, wherever it was registered. Now layers run in registration order, so a route registered above a `use()` is not affected by it, and a `use()` below a route does not apply to it.
- **`use('/', mw)` matches every path.** In 0.x it matched the root route only.
- **Unmatched requests run the middleware** before the 404, which now reads `Cannot GET /path`. A wrong method is also a 404.
- **A handler that does not respond** (no `res` call and no `next()`) is a 500: `Route did not respond: GET /path`.
- **The same method and path registered twice** stacks the handlers. In 0.x the second silently replaced the first.
- **`createAuthMiddleware`** sets `req.user = { email }`, and rejects an empty email or a failing `Session` with a 401. It no longer echoes the email in the message.
- **`createLoggingMiddleware`** logs the final status after `next()` returns, logs `req.query` with `token`, `password`, `secret`, `key`, `auth` and `authorization` redacted, and no longer logs errors itself.
- **Limiters** default to `lockScope: 'user'`. A key shared across users needs `lockScope: 'script'`.
- **`res.status(>= 400).json(data)`** sends the error envelope (`ok: false`), and over `google.script.run` it is thrown.
- **`render` resolves through the `html` static dir** and works without a `layout`.
- **`put`, `patch`, `delete`, `all`**, `:param`/`*wildcard`/`{optional}` paths, error middleware, `res.redirect`, `errorView`, `app.locals`/`res.locals`, `createIdempotencyGuard` and the client's `put`/`patch`/`delete` are new.

## Worked example: `app.ts`

### Before

```ts
const webApp = new GasWebApp({
  logger: webappLogger,
});

const doGet = (e: GoogleAppsScript.Events.DoGet) => webApp.doGet(e);
const doPost = (e: GoogleAppsScript.Events.DoPost) => webApp.doPost(e);

// Delivery acknowledged — first, so a request that arrived and was then
// rejected is still acknowledged and the client doesn't retry it as a drop.
webApp.get('/ack', withQuietLog, withAckRateLimit, ackHandler);

webApp.use(withAck);

// Auth
webApp.use(withAuth);

webApp.get(
  '/reports/status',
  withQuietLog,
  withReportsStatusRateLimit,
  reportsStatusHandler,
);

webApp.use(
  '/api/v1',
  withLog,
  withGlobalRouteRateLimit,
  withSessionRateLimit,
  withSessionRouteRateLimit,
  withUserConcurrencyLimiter,
);

webApp.use(
  '/',
  withLog,
  withGlobalRouteRateLimit,
  withSessionRateLimit,
  withSessionRouteRateLimit,
  withUserConcurrencyLimiter,
);

webApp.use('/api/v1', apiRouter);
webApp.use('/', webRouter);
```

The comments describe Express ordering, but 0.x did not honor it:

- `withAck` and `withAuth` ran on `/ack` and `/reports/status` however early or late they were registered, because every `use()` ran before every route.
- The limiters were registered on `'/api/v1'` and on `'/'` to cover the API and the home page, because `'/'` matched only the root route.
- Logging was scoped alongside the limiters so that `/ack` and `/reports/status` kept their quieter loggers, which only worked because the prefixes did not match them.

### After

```ts
const app = new GasWebApp({
  logger: webappLogger,
});

function doGet(e: GoogleAppsScript.Events.DoGet) {
  return app.doGet(e);
}

function doPost(e: GoogleAppsScript.Events.DoPost) {
  return app.doPost(e);
}

// Delivery acknowledged — first, so a request that arrived and was then
// rejected is still acknowledged and the client doesn't retry it as a drop.
app.use(withAck);

// Auth, for everything below, so req.user is set on the routes that follow.
app.use(withAuth);

// Registered above the limiters, so only their own limiter and quiet logger
// apply. These routes are polled while requests are in flight.
app.get('/ack', withQuietLog, withAckRateLimit, ackHandler);
app.get(
  '/reports/status',
  withQuietLog,
  withReportsStatusRateLimit,
  reportsStatusHandler,
);

// Once, for every path: '/' now matches everything.
app.use(
  withLog,
  withGlobalRouteRateLimit,
  withSessionRateLimit,
  withSessionRouteRateLimit,
  withUserConcurrencyLimiter,
);

app.use('/api/v1', apiRouter);
app.use('/', webRouter);
```

Declare `doGet` and `doPost` as functions, as the 0.x wrapper did. An alias such as `const doGet = app.doGet` works over HTTP but fails over `google.script.run`, where every call is rejected with `chained.doGet is not a function`.

Three things to check when moving to ordered layers:

1. **Do not keep both limiter registrations.** With `'/'` matching every path, the `'/api/v1'` and `'/'` blocks above would both apply to an API request: every counter is incremented twice, the per-route limit is hit at half its value, and the request is logged twice. Register the chain once.
2. **Mind where `/ack` sits relative to auth.** In 0.x `withAuth` always ran before the route's own middleware, so `withAckRateLimit` saw the user's email. With real ordering, a route registered above `withAuth` has no `req.user`. The key `ack:${request.email}` would then be `ack:undefined` for every caller and share one budget between all users. Either register `/ack` below `withAuth`, as above, or key it without a user. A key that is shared across users also needs `lockScope: 'script'`.
3. **Keep the order the comments promise.** `withAck` first (a rejected request is still acknowledged), then `withAuth`, then the routes that skip the limiters, then the limiters. The 404 for an unmatched path is now logged and limited like any other request.

## Worked example: middleware

The factories keep their names and options. The `keyFn` receives the new request, and the hand-written guards for an unset email are no longer needed when the middleware runs after `withAuth`.

```ts
// Before
const withAuth: Middleware = createAuthMiddleware({
  isAuthorized: (email) => true,
});
const withLog: Middleware = createLoggingMiddleware(webappLogger);

const withSessionRouteRateLimit = createRateLimiter({
  limit: 10,
  windowSeconds: 60,
  lockScope: 'user',
  lockService: GasLock,
  keyFn: (request) => {
    if (!request.email) {
      throw new Error(
        'withSessionRouteRateLimit must run after withAuth in the middleware chain',
      );
    }
    return `session:${request.email}:${request.method}:${request.route}`;
  },
});

const withUserConcurrencyLimiter = createConcurrencyLimiter({
  limit: 20,
  lockScope: 'user',
  lockService: GasLock,
  keyFn: (request) => `user:${request.email}`,
});
```

```ts
// After
const withAuth: GasWebAppHandler = createAuthMiddleware({
  isAuthorized: (email) => true,
});
const withLog: GasWebAppHandler = createLoggingMiddleware(webappLogger);

const withSessionRouteRateLimit = createRateLimiter({
  limit: 10,
  windowSeconds: 60,
  lockScope: 'user',
  lockService: GasLock,
  keyFn: (req) =>
    `session:${req.user?.email}:${req.method}:${req.originalPath}`,
});

const withUserConcurrencyLimiter = createConcurrencyLimiter({
  limit: 20,
  lockScope: 'user',
  lockService: GasLock, // now honored: it was ignored before
  keyFn: (req) => `user:${req.user?.email}`,
});
```

- `GasLock` passed to `createConcurrencyLimiter` was ignored in 0.x and is used now. The two limiters share one lock registry with the rest of the app, as intended.
- `withGlobalRouteRateLimit` keeps `lockScope: 'script'`: its key is shared across users. Every request now takes a script lock for up to 10 seconds, on every path, since the chain applies everywhere. Narrow it with a prefix if that matters.
- `withAck`, `ackHandler` and `createAckTracker()` are unchanged. The ack middleware reads `req.query.callId`.

## Worked example: routes

```ts
// Before: src/api/api.routes.ts
apiRouter.get('/healthcheck', () =>
  webApp.json({ time: new Date().toISOString() }),
);

// Before: src/api/reports/reports.routes.ts
reportsRouter.post('', (request: RouteRequest) => {
  const upload = reportsService.parse(request.body);

  return webApp.json(reportsService.store(upload, request.email ?? ''));
});

const reportsStatusHandler = (request: RouteRequest) => {
  const uploadId = request.params.uploadId ?? '';
  // …
  return webApp.json(status);
};

// Before: src/web/routes
webRouter.get('', () =>
  webApp.render(
    webApp.resolveStaticFilePath('html', '/pages/reports/uploader'),
    {
      layout: webApp.resolveStaticFilePath('html', '/layouts/main'),
      title: 'MAGB KPIs',
      // …
    },
  ),
);
```

```ts
// After
apiRouter.get('/healthcheck', (req, res) =>
  res.json({ time: new Date().toISOString() }),
);

reportsRouter.post('/', (req, res) => {
  const upload = reportsService.parse(req.body);

  res.json(reportsService.store(upload, req.user?.email ?? ''));
});

const reportsStatusHandler: GasWebAppHandler = (req, res) => {
  const uploadId = req.query.uploadId ?? '';
  // …
  res.json(status);
};

webRouter.get('/', (req, res) =>
  res.render('pages/reports/uploader', {
    layout: 'layouts/main',
    title: 'MAGB KPIs',
    // …
  }),
);
```

- Handlers respond through `res`; a returned `webApp.json(...)` is ignored and the request becomes a 500.
- `request.params` held the query string; that is `req.query` now. In `/reports/status?uploadId=…`, `uploadId` is in `req.query`.
- `render` resolves both names through the `html` static dir (`dist/web/views` by default), so the `resolveStaticFilePath` wrappers must go: left in, the path is resolved twice and the template is not found. The leading `/` is optional.
- `''` and `'/'` are the same route. The `''` routes of 0.x work unchanged.

## Installation

- Replace the subtrees of the backend and of `gas-error`, `gas-logger` and `gas-lock` with [gasdev bundle](https://github.com/yorsh-co/gasdev#bundle): list the four libraries under `gasdev.bundle.libraries`, run `npx gasdev bundle`, commit the generated file and point `filePushOrder` at it. `gas-error` must be listed explicitly, as gasdev bundle treats peers as optional. This also removes the vendored `gas-error.handler.js`: `gas-error` >= 1.2 replaces `errorHandler` with `GasError.handle`, and 1.0 requires it.
- Keep the browser client on `git subtree`. `scripts/sync-gas-webapp.sh` now installs the client only (`dist-web`).
- The client's `api.get` and `api.post` calls are unchanged. `put`, `patch`, `delete` and `idempotencyKey` are new; see the [client README](https://github.com/yorsh-co/gas-webapp/tree/dist-web).
- Declare any custom request fields by merging into `GasWebAppRequest`:

```ts
interface GasWebAppRequest {
  tenant?: string;
}
```

## Error handling

Replace any use of `errorHandler` and the old class names:

| Before              | After                  |
| ------------------- | ---------------------- |
| `errorHandler`      | `GasError.handle`      |
| `NotFoundError`     | `GasNotFoundError`     |
| `ValidationError`   | `GasValidationError`   |
| `ForbiddenError`    | `GasForbiddenError`    |
| `UnauthorizedError` | `GasUnauthorizedError` |
| `RateLimitError`    | `GasRateLimitError`    |

You no longer call the error handler yourself: a thrown error, or `next(err)`, reaches `GasError.handle` through the router. To customize, register error middleware, a function with four parameters, after the routes it should cover. See the [README](https://github.com/yorsh-co/gas-webapp#error-handling).
