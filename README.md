# gas-webapp

[![Built with Google Apps Script](https://img.shields.io/badge/Built%20with-Google%20Apps%20Script-4285F4?logo=google&logoColor=white)](https://developers.google.com/apps-script)

## Express-style router and middleware for Google Apps Script web apps.

> The goal of this project is to give Apps Script web apps a single `doGet`/`doPost` entry point with Express-like routing and middleware, instead of hand-rolled `if`/`switch` dispatch scattered across a project.

`gas-webapp` provides a `GasWebApp` class that registers routes and middleware, dispatches incoming requests, and serializes the result back to either a real HTTP response or a plain payload for `google.script.run` callers — using the same route table and middleware chain for both.

Handlers and middleware are Express's `(req, res, next)`, error middleware is `(err, req, res, next)`, and routers mount with `use('/api', router)`, mirroring `express()` vs `express.Router()`. Where Apps Script cannot do what Express does, the difference is documented in [Express differences](#express-differences) and [Platform limitations](#platform-limitations).

> **Disclaimer:**
> This project and [Yorsh](https://github.com/yorsh-co) are independent and are not affiliated with, endorsed by, or associated with Google LLC.

> **Browser client:**
> A companion package wraps `google.script.run` calls for you — promises, timeouts, retry, idempotency keys and delivery acknowledgement instead of hand-rolled `withSuccessHandler`/`withFailureHandler` callbacks. It ships from this same repository on a separate [`dist-web`](https://github.com/yorsh-co/gas-webapp/tree/dist-web) branch.

> **Upgrading from 0.x?**
> The middleware signature, request shape and response helpers changed. See the [migration guide](https://github.com/yorsh-co/gas-webapp/blob/main/docs/migration-1.0.md).

### Features

- Single `doGet`/`doPost` entry point handling both real HTTP requests and `google.script.run` calls through the same route table
- Express-style `get`/`post`/`put`/`patch`/`delete`/`all`/`use`, with `:param`, `*wildcard` and `{optional}` paths (Express 5 syntax), mountable sub-routers, and layers that run in registration order
- `(req, res, next)` handlers, `(err, req, res, next)` error middleware, and `next()`, `next(err)` and `next('route')`
- `put`, `patch` and `delete` through a `_method` override on `doPost`
- `res.json`, `res.send`, `res.render` (layouts, `app.locals`, `res.locals`) and `res.redirect`, plus template helpers (`include`, `js`, `css`, `html`) for `HtmlService` views, and an optional HTML error view
- Built-in middleware: delivery acknowledgement, an injectable-policy auth check, rate and concurrency limiters, an idempotency guard, and request logging with redaction
- Centralized error handling through `gas-error`: thrown `GasError` subclasses are serialized consistently instead of crashing the request
- Written in TypeScript; ships compiled `.js` plus matching `.d.ts` files, so no build step is required to consume it, TS or not
- No external dependencies beyond built-in Apps Script services and its own peer packages (see [Peer Dependencies](#peer-dependencies))

### Example Usage

```js
const app = new GasWebApp({ logger: gasLogger }); // logger is optional

app.use(createLoggingMiddleware(gasLogger));

const api = new GasWebAppRouter();

api.get('/users/:id', (req, res) => {
  res.json(usersTable.get(req.params.id));
});

api.post('/users', (req, res) => {
  res.status(201).json(usersTable.insert(req.body));
});

app.use(
  '/api',
  createAuthMiddleware({
    isAuthorized: (email) => AUTHORIZED_EMAILS.includes(email),
  }),
  api,
);

app.get('/', (req, res) => res.render('Home', { layout: 'Layout' }));

function doGet(e: GoogleAppsScript.Events.DoGet) {
  return app.doGet(e);
}

function doPost(e: GoogleAppsScript.Events.DoPost) {
  return app.doPost(e);
}
```

## Requirements

### Peer Dependencies

`gas-webapp` expects the following as globals at runtime — each is a separate gas-\* library, bundled alongside `gas-webapp` by gasdev bundle.

| Package                                                | Required | Used for                                                                                                           |
| ------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------ |
| [`gas-error`](https://github.com/yorsh-co/gas-error)   | Yes      | `GasError.handle` and the `Gas*Error` classes, for every failed request                                            |
| [`gas-logger`](https://github.com/yorsh-co/gas-logger) | No       | Structured logging through the `logger` option and `createLoggingMiddleware`; falls back to `console` if omitted   |
| [`gas-lock`](https://github.com/yorsh-co/gas-lock)     | No       | Optional `lockService` for the limiters and the idempotency guard; falls back to `LockService` directly if omitted |

### Deployment

`gas-webapp` must be deployed as an Apps Script **Web App** (Apps Script editor → Deploy → New deployment → Web app), with top-level `doGet`/`doPost` functions that delegate to a `GasWebApp` instance.

`createAuthMiddleware` needs `Session.getActiveUser().getEmail()` to return the calling user: **Execute as: User accessing the web app**, with the `https://www.googleapis.com/auth/userinfo.email` scope granted. Under **Execute as: Me**, consumer accounts and callers outside your domain have a blank email and are rejected with a 401.

### Example `appsscript.json`

```json
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

##### Backend: gasdev bundle

[gasdev bundle](https://github.com/yorsh-co/gasdev#bundle) resolves version ranges against the libraries' release tags and writes them into one script, in dependency order.

```bash
npm install -D github:yorsh-co/gasdev#semver:^3.0.0
```

List the libraries in your `package.json`:

```json
{
  "gasdev": {
    "bundle": {
      "outFile": "src/lib/gas-libraries.js",
      "libraries": {
        "gas-webapp": "^1.0.0",
        "gas-error": "^1.2.2",
        "gas-logger": "^2.0.1",
        "gas-lock": "^1.2.1"
      }
    }
  }
}
```

```bash
npx gasdev bundle
```

- Commit the generated file. Its header records each library's version and commit SHA.
- Re-run the command after changing a range to upgrade.
- List `gas-error` even though it is a peer: gasdev bundle treats peers as optional and never adds one on its own, so a bundle without it fails only at runtime (P7). `gas-logger` and `gas-lock` can be left out; see [Peer Dependencies](#peer-dependencies).

See the [gasdev bundle documentation](https://github.com/yorsh-co/gasdev#bundle) for configuration details.

##### Backend, this library only: git subtree

The backend also ships on its own `dist` branch. Without gasdev bundle, add it and each peer you use with git subtree:

```bash
git subtree add \
  --prefix=src/lib/gas-webapp \
  https://github.com/yorsh-co/gas-webapp.git \
  dist \
  --squash
```

You then own the [file push order](#5-configure-the-file-push-order) of the peers and `gas-webapp`.

##### Browser client: git subtree

gasdev bundle covers Apps Script code only (P6). The browser client ships on its own `dist-web` branch; `scripts/sync-gas-webapp.sh` adds it, and later pulls updates. Download it once and run it from your project root:

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

Add the `webapp` execution config to the parent project's `appsscript.json`. See [Deployment](#deployment).

#### 3. Make the bundle load first

Apps Script executes files in the order of the project, and `GasWebApp` is constructed when your file runs. Put the bundle ahead of your own files. See [Configure the file push order](#5-configure-the-file-push-order).

> **Note:**
> Using the browser client too? It has its own script-load-order requirement — enforced by `<script>` tag order, a separate concern from `clasp push`'s file push order. See the [browser client README](https://github.com/yorsh-co/gas-webapp/tree/dist-web#load-order).

#### 4. Declare a `GasWebApp` instance and export its entry points

```js
const app = new GasWebApp();

app.get('/', (req, res) => res.json({ ok: true }));

function doGet(e: GoogleAppsScript.Events.DoGet) {
  return app.doGet(e);
}

function doPost(e: GoogleAppsScript.Events.DoPost) {
  return app.doPost(e);
}
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

<a id="5-configure-the-file-push-order"></a>

#### 5. Configure the file push order

Apps Script executes files by the order in the Apps Script editor, from top to bottom. By default, `clasp push` orders files alphabetically by file name.

`class GasWebApp extends GasWebAppRouter` evaluates the `extends` clause when its file runs, and your own `new GasWebApp()` runs when your file does. If either runs before the library, `clasp push` succeeds but running the project throws:

```txt
ReferenceError: GasWebAppRouter is not defined
```

With gasdev bundle the library and its peers are one file, so a single [`filePushOrder`](https://github.com/google/clasp#filepushorder-optional) entry in `.clasp.json` is enough:

```json
{
  "filePushOrder": ["src/lib/gas-libraries.js"]
}
```

Alternatively, you can manually move the file to the top of the file list in the Apps Script editor.

With the git subtree method, list the files yourself, peers first. For `gas-webapp` the order is:

```json
{
  "filePushOrder": [
    "src/lib/gas-webapp/gas-webapp.response.js",
    "src/lib/gas-webapp/gas-webapp.router.class.js",
    "src/lib/gas-webapp/gas-webapp.constants.js",
    "src/lib/gas-webapp/gas-webapp.class.js"
  ]
}
```

> **Note:**
> The middleware factories (`createAuthMiddleware`, `createRateLimiter` and the rest) are only referenced inside function bodies, so they have no ordering requirement. Any file in your own project that constructs a `GasWebApp` at the top level must be pushed _after_ the entries above.

#### 6. Push local files to Apps Script

```bash
clasp push
```

## Basic Usage

### Create a `GasWebApp` instance

```js
const app = new GasWebApp({
  logger: gasLogger, // optional — falls back to `console`
  errorView: 'Error', // optional — see "Error views"
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

```ts
function doGet(e: GoogleAppsScript.Events.DoGet) {
  return app.doGet(e);
}

function doPost(e: GoogleAppsScript.Events.DoPost) {
  return app.doPost(e);
}
```

> **Note:**
> Declare `doGet` and `doPost` as functions. An alias such as `const doGet = app.doGet` works over HTTP but fails over `google.script.run`, where every call is rejected with `chained.doGet is not a function`.
>
> `app.doGet`/`app.doPost` are arrow-function class fields, not prototype methods, so they keep their `this` binding when passed around.

### Register routes

```js
app.get('/api/users', (req, res) => res.json(usersTable.find()));
app.get('/api/users/:id', (req, res) =>
  res.json(usersTable.get(req.params.id)),
);
app.post('/api/users', (req, res) =>
  res.status(201).json(usersTable.insert(req.body)),
);
app.put('/api/users/:id', (req, res) =>
  res.json(usersTable.update(req.params.id, req.body)),
);
app.delete('/api/users/:id', (req, res) =>
  res.json(usersTable.remove(req.params.id)),
);
```

Handlers are `(req, res, next)` functions. Their return value is ignored: a route responds only through `res`.

Paths follow Express 5 (path-to-regexp v8):

| Pattern                 | Matches                         | `req.params`            |
| ----------------------- | ------------------------------- | ----------------------- |
| `/users/:id`            | `/users/42`                     | `{ id: '42' }`          |
| `/users{/:id}`          | `/users` and `/users/42`        | `{}` and `{ id: '42' }` |
| `/files/*path`          | `/files/a/b.txt` (rest of path) | `{ path: 'a/b.txt' }`   |
| `/users/:id/posts/:pid` | `/users/1/posts/2`              | `{ id: '1', pid: '2' }` |

The Express 4 forms `/*`, `:id?` and inline regular expressions are not supported and throw at registration. Matching is case-insensitive, a trailing slash is optional, and parameters are URI-decoded strings.

`get`, `post`, `put`, `patch`, `delete` and `all` (every method) take any number of handlers, or arrays of them. Registering the same method and path twice stacks the handlers, as in Express: the second runs only if the first calls `next()`.

`req` is an interface, so an app adds fields by declaration merging in global scope:

```ts
interface GasWebAppRequest {
  tenant?: string;
}
```

### Route resolution and method override

The target route is resolved the same way for both entry points:

| Entry point       | Resolution order                     |
| ----------------- | ------------------------------------ |
| `doGet`, `doPost` | `route` parameter, `e.pathInfo`, `/` |

- `google.script.run` callers always send `route`.
- When a request carries both, `route` wins silently. Empty values count as absent.
- Apps Script delivers `pathInfo` without a leading slash; it is normalised like any other path.
- An anonymous GET with a path after `/exec` is redirected to the Google sign-in page and never reaches the script (P4). Express-style links (`/exec/users/42`) therefore work only for signed-in callers; `?route=` is the form that works for every caller.

```js
// Real HTTP request
fetch(`${webAppUrl}?route=/api/users`);
fetch(`${webAppUrl}/api/users`); // through e.pathInfo; signed-in callers only

// google.script.run
google.script.run
  .withSuccessHandler(onUsers)
  .doGet({ parameter: { route: '/api/users' } });
```

Apps Script exposes only `doGet` and `doPost`, so PUT, PATCH and DELETE are POSTs carrying `_method=PUT|PATCH|DELETE` in the request parameters:

```bash
curl -L -H 'Content-Type: application/json' -d '{}' "$URL?route=/api/users/42&_method=DELETE"
```

`req.method` reports the effective method. Any other `_method` is a 400, and `_method` is ignored on GET.

### CSRF protection

A web app deployed to run as the user accessing it acts with that user's Google session, so a page on another site could otherwise submit a form to it as the victim. An HTTP `doPost` is therefore refused with a 403 (`FORBIDDEN`) before routing when its body has a type a cross-site page can send without a CORS preflight: `application/x-www-form-urlencoded`, `multipart/form-data`, `text/plain`, `text/ping`, `application/octet-stream`, or no type at all (a bodyless POST). Send HTTP POSTs as `application/json` or another type that needs a preflight.

`google.script.run` calls are not affected: they can only come from the app's own pages. This does not cover GET: handlers registered with `get`, `all` or `use` run on cross-site links and must not change state.

> **Note:**
> That's the raw shape either transport expects. If you'd rather not hand-roll the promise wrapping, retry, and error parsing yourself, the [browser client](https://github.com/yorsh-co/gas-webapp/tree/dist-web) does this for you: `GasWebApp.api.get('/api/users')`.

### Add middleware

```js
// applies to every request from here on
app.use(createLoggingMiddleware(gasLogger));

// applies only to paths under /api
app.use(
  '/api',
  createAuthMiddleware({
    isAuthorized: (email) => AUTHORIZED_EMAILS.includes(email),
  }),
);

// per-route middleware
app.post(
  '/api/users',
  createRateLimiter({
    limit: 5,
    windowSeconds: 60,
    keyFn: (req) => req.user.email,
  }),
  (req, res) => res.json(usersTable.insert(req.body)),
);

// your own
app.use((req, res, next) => {
  req.tenant = tenantOf(req.user.email);
  next();
});
```

Middleware calls `next()` to continue, `next(err)` to skip to the error handlers, or `next('route')` to skip the rest of the current route. `next()` is synchronous: it returns once everything downstream has finished, so a middleware can read `res.statusCode` after calling it (this is how the logging middleware reports the final status). There is no async middleware (P8).

#### Middleware order

Layers run in the order they were registered, whatever their kind:

- `use(...handlers)` — applies to every path from this point on.
- `use(prefix, ...handlers)` — applies to paths equal to, or nested under, `prefix`, on segment boundaries (`/api` matches `/api/users` but not `/apiary`). `use('/')` is the same as `use()`.
- `use(prefix, router)` — mounts a `GasWebAppRouter`.
- `get`/`post`/`put`/`patch`/`delete`/`all` — a route; its own handlers run in order.

A route registered before a `use()` is not affected by it, which is how a route such as `/ack` stays out of later middleware. A typical order:

```js
app.get('/ack', ack.handler); // before the limiters, so they do not apply
app.use(ack.middleware); // first: a rejected request is still acknowledged
app.use(createLoggingMiddleware(gasLogger));
app.use('/api', auth, limiter); // auth sets req.user for what follows
app.use('/api', api);
```

### Mount a router

```js
const api = new GasWebAppRouter();

api.get('/users/:id', (req, res) => res.json(usersTable.get(req.params.id)));

app.use('/api', api);
```

Routers are mounted by reference, so routes added to `api` later are live, and routers nest. Inside a mounted router `req.baseUrl` is the mount path and `req.path` is relative to it; `req.originalPath` is always the full path. `use(router)` with no path mounts at the root. Each layer sees only its own `req.params`.

### Request and response reference

`req` is one object per request, mutated in place, so a field set by middleware reaches everything downstream and the error handlers.

| `req`          | Type                             | Notes                                                                                                                                                                                        |
| -------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `method`       | `'GET' \| 'POST' \| 'PUT' \| …`  | Effective method, after the `_method` override                                                                                                                                               |
| `path`         | `string`                         | Relative to the current mount, with a leading `/`                                                                                                                                            |
| `originalPath` | `string`                         | The full request path                                                                                                                                                                        |
| `baseUrl`      | `string`                         | Path the current router is mounted on; `''` at the top level                                                                                                                                 |
| `params`       | `Record<string, string>`         | Path parameters of the current layer                                                                                                                                                         |
| `query`        | `Record<string, string>`         | Request parameters, minus `route` and `_method`; the first value of a repeated key (P3)                                                                                                      |
| `body`         | `unknown`                        | Parsed by content type: JSON is parsed, form encodings leave it `undefined` (fields are in `query`), anything else is the string. HTTP form and text POSTs are refused (see CSRF protection) |
| `id`           | `string`                         | Unique id of the request                                                                                                                                                                     |
| `transport`    | `'http' \| 'rpc'`                | How the request arrived. Advisory, see [Transport](#transport)                                                                                                                               |
| `raw`          | `Events.DoGet \| Events.DoPost`  | The event Apps Script passed in                                                                                                                                                              |
| `user`         | `{ email: string } \| undefined` | Set by `createAuthMiddleware`                                                                                                                                                                |

| `res`                     | Notes                                                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `status(n)`               | Sets the status carried in the envelope; chainable                                                                   |
| `json(data)`              | Sends `{ ok: true, status, data }`; with a status of 400 or more, the [error envelope](#error-handling) instead      |
| `send(body)`              | A string is sent as text over HTTP and as the envelope's data over RPC; anything else is `json`                      |
| `render(view, options?)`  | Renders an `HtmlService` template, optionally in a layout. HTTP only                                                 |
| `redirect([status,] url)` | Navigates the top window to an absolute `http(s)` URL. HTTP only                                                     |
| `locals`                  | Per-request data merged into `render`                                                                                |
| `statusCode`              | The current status                                                                                                   |
| `sent`                    | True once the response has been sent. A second `json`, `send`, `render` or `redirect` throws `Response already sent` |

Over a real HTTP request the output is a `ContentService` text output holding the JSON envelope, or an `HtmlService` output. Over `google.script.run` the success envelope is the call's return value.

### Render views

```js
app.get('/', (req, res) =>
  res.render('pages/Home', { layout: 'layouts/Main', pageTitle: 'Dashboard' }),
);
```

`render` resolves the view and the layout through the configured `html` static dir, exactly like `app.html()` — `'Home'` becomes `dist/web/views/Home.html` by default — so pass logical names, not full paths. The view is evaluated first; its output is passed to the layout as `body`:

```text
<!doctype html>
<html>
  <body>
    <?!= body ?>
  </body>
</html>
```

Omit `layout`, or pass `layout: null`, to render the view standalone.

Template data comes from three levels, later ones winning: `app.locals` (the whole app), `res.locals` (set in middleware, one request) and the options passed to `render`.

```js
app.locals.siteName = 'Acme';
app.use((req, res, next) => {
  res.locals.user = req.user;
  next();
});
```

`res.redirect([status,] url)` returns a page with a "Continue to &lt;host&gt;" link to `url`, plus a script that navigates the top window where the browser allows it. `HtmlService` serves pages in a sandboxed iframe, so there is no HTTP redirect (P2), and browsers block the automatic navigation without a click (P9): in practice the user follows the link. The host shown is the one the link really leads to, with any `user@` credentials dropped. The URL must be absolute `http(s)`, anything else is a 400. The optional status is only recorded in `res.statusCode`.

Over `google.script.run`, `render` and `redirect` throw `GasForbiddenError`.

#### Template helpers

Call these from inside an `HtmlService` template via the app's global instance:

```text
<?!= app.include('partials/Header'); ?>
<?!= app.js('components/UserTable'); ?>
<?!= app.css('components/UserTable'); ?>
<?!= app.html('partials/Footer'); ?>
```

Each resolves against the configured `static` dirs and extensions — `app.js('components/UserTable')` resolves to `dist/web/public/js/components/UserTable.js.html` by default. A leading `/` is optional. `app.include(path, data?)` takes a full file name and an optional data object; `app.resolveStaticFilePath(type, path)` returns the resolved name.

The templates run in global scope, so the instance must be a global (`const app = new GasWebApp()` at the top level of a file) and is whatever name you gave it.

### Error handling

A handler or middleware that throws, or calls `next(err)`, skips to the next error handler: a function with four parameters, as in Express.

```js
app.use((err, req, res, next) => {
  if (err instanceof GasConflictError) {
    return res.status(409).json({ message: err.message });
  }
  next(err); // pass it on
});
```

While an error is pending, only error handlers run. Without one, the error reaches `GasError.handle` (the `gas-error` peer), which serializes it consistently for both transports: `GasError` subclasses (`GasNotFoundError`, `GasForbiddenError`, `GasValidationError`, `GasUnauthorizedError`, `GasConflictError`, `GasRateLimitError`) keep their status and message, anything else becomes a generic 500. Every failure takes this one path and is logged once, including a malformed request body. The user in `req.user`, when auth set one, is logged as the session.

The error envelope is `{ ok: false, status, code, error, details? }`. Real HTTP requests receive it as JSON text output; `google.script.run` calls receive an `Error` whose message is that JSON, which the browser client parses into a `ServerError`.

`res.status(code).json(data)` with a `code` of 400 or more sends the same envelope: `code` follows the status as in `gas-error` (400 `VALIDATION_ERROR`, 401 `UNAUTHORIZED`, 403 `FORBIDDEN`, 404 `NOT_FOUND`, 409 `CONFLICT`, 429 `RATE_LIMITED`, otherwise `INTERNAL_ERROR`), `error` is `data.message` when that is a string and `Request failed` otherwise, and `data` is `details`. Over `google.script.run` it is thrown, so the client rejects it like any other error.

A request nothing answers is a 404 reading `Cannot GET /path`, whatever the method (there is no 405). A handler that returns without responding and without calling `next` is a 500 reading `Route did not respond: GET /path`.

The error is resolved into the response as the stack finishes, before `next()` returns to the middleware above, so a middleware that reads `res.statusCode` after `next()` sees the final status of a failed request, including a 404 for an unmatched route.

#### Error views

To answer page routes with HTML instead of JSON, set an error view:

```js
const app = new GasWebApp({ errorView: 'Error' });
```

```text
<h1><?= error.status ?> <?= error.code ?></h1>
<p><?= error.error ?></p>
```

On an HTTP `GET`, the error is rendered through that view (resolved like `render`, standalone) with `{ error }` (the error envelope) plus `app.locals`. `google.script.run` calls and other methods keep the JSON envelope, as does a request whose error view itself throws. The error is logged once either way.

### Transport

Every route works over both a real HTTP request and `google.script.run`, using the same handler. `req.transport` is **advisory**: it is inferred from the presence of `contextPath` on the event, and a `google.script.run` caller controls the whole event object, so it can claim either value. It selects the output format and the `render`/`redirect` refusals, and must never drive an authentication, authorization or other security decision. Nothing in the library does.

## Built-in middleware

### Auth

`createAuthMiddleware({ isAuthorized })` resolves the active user's email from `Session`, calls your policy with it, and sets `req.user = { email }`. It rejects with a `GasUnauthorizedError` (401) in two cases, with fixed messages that never echo the email: `Unable to identify the signed-in user` when `Session` throws or returns an empty email (scope declined, or a consumer account under **Execute as: Me**), and `Not authorized` when `isAuthorized` returns false.

### Rate and concurrency limiters

`createRateLimiter` is a fixed-window counter backed by `CacheService`; `createConcurrencyLimiter` caps simultaneous in-flight requests. Both take a `keyFn(req)` and a `limit`; the rate limiter also takes `windowSeconds`.

```js
app.use(
  '/api',
  createRateLimiter({
    limit: 100,
    windowSeconds: 60,
    keyFn: (req) => `session:${req.user.email}`,
  }),
  createConcurrencyLimiter({
    limit: 20,
    keyFn: (req) => `user:${req.user.email}`,
  }),
);
```

Both read and write their counter under a lock, set by `lockScope` (`'user'` by default). **The lock must cover the scope of the key**: a key shared across users (a per-route or global key) needs `lockScope: 'script'`, because a per-user lock does not exclude other users. `'script'` serialises every request through the limiter behind one script lock, each waiting up to 10 seconds for it, so use it only for keys that need it.

When the rate limiter rejects a request for exceeding the window count, the `GasRateLimitError` it throws carries `details.retryAfterSeconds`, which the browser client honors. Lock contention and the concurrency limiter do not carry it. A concurrency slot is released when the request finishes, and the counter expires after 7 minutes, covering the 6-minute execution limit, if an execution dies.

Both limiters take an optional `lockService` — anything exposing `getLock(scope)`. Pass [`gas-lock`](https://github.com/yorsh-co/gas-lock) when other services in the same execution (e.g. [`gas-sheetdb`](https://github.com/yorsh-co/gas-sheetdb)) also lock, so every layer resolves through one registry:

```js
createRateLimiter({
  limit: 100,
  windowSeconds: 60,
  lockScope: 'script',
  lockService: GasLock,
  keyFn: (req) => `route:${req.method}:${req.originalPath}`,
});
```

Omitted, they resolve `LockService.getScriptLock()`/`getUserLock()` directly. They use non-blocking `tryLock`, so they fail fast on contention rather than deadlocking.

### Delivery acknowledgement

`google.script.run` calls are occasionally dropped by the Apps Script bridge before they reach `doGet`/`doPost` at all — indistinguishable, from the client's side, from a request that's just slow. `createAckTracker` closes that gap: its middleware records a caller-supplied `callId` the moment a request enters the chain, and its handler reports back which of a set of `callId`s were recorded, using `CacheService` as short-lived storage (P5).

```js
const ack = createAckTracker(); // { ttlSeconds: 60 } by default

// the ack route first, so the middleware registered below does not apply to
// it: it is polled while other requests are in flight, and would otherwise
// consume their rate budget
app.get('/ack', ack.handler);

// ahead of auth and rate limiting, so a request that arrives and is then
// rejected (401, 429, etc.) is still acknowledged
app.use(ack.middleware);
```

`ack.handler` expects a `callIds` parameter (comma-separated) and responds with the subset that were found — each one is deleted from the cache as it's reported, so a given `callId` is only ever reported once. Mount it where the client's `ackRoute` points (`/ack` by default).

> **Note:**
> `NOT_DELIVERED` is a strong hint, not proof. A call queued behind Apps Script's per-user concurrent execution limit for longer than the client's `ackDeadlineMs` is reported as dropped and then runs, so the caller sees an error while the write commits. For routes where a double write matters, pair retries with the idempotency guard.

> **Note:**
> `callId` is a correlation token, not a credential. It's never used for authorization, and because it's client-supplied it's validated against a UUID pattern before it's used as a cache key.

### Idempotency

`createIdempotencyGuard` makes a mutating route safe to retry. A request carrying an `idempotencyKey` parameter (a UUID, which the browser client sends for `idempotencyKey: true`) runs once: its success envelope is stored in `CacheService` and replayed to every later request with the same key, and a duplicate arriving while the first is still running is a 409.

```js
app.use('/api', createAuthMiddleware({ isAuthorized }));
app.use('/api', createIdempotencyGuard()); // { ttlSeconds: 21600, lockService, lockScope: 'user' }
```

- Register it after auth: the key is then scoped to `req.user.email`, so two users' keys cannot collide. Without a user the key is global to the script.
- A failed request (an error status or a thrown error) clears its key, so the retry runs. Only JSON responses are stored; a view or text output clears the key too, as does a response over `CacheService`'s 100 KB value limit.
- The key is checked and marked under the lock (`lockScope`, `'user'` by default), but the handler itself runs outside it. An invalid key is a 400.
- Replay lasts `ttlSeconds`, at most 21600 (6 hours, the `CacheService` maximum). An in-flight marker expires after 7 minutes if its execution died.

### Logging

`createLoggingMiddleware(logger, options?)` writes a request line and, once `next()` returns, a response line with the final `res.statusCode` and duration: `info` below 400, `warn` from 400, `error` from 500. Errors are logged once, by `GasError.handle`, not here.

Query values are logged with the keys in `options.redact` masked as `[REDACTED]` (exact, case-insensitive; default `token`, `password`, `secret`, `key`, `auth`, `authorization`; passing a list replaces the default). The request body is never logged. `logger` is a `gas-logger` instance, or `console` (the default).

```js
app.use(createLoggingMiddleware(gasLogger, { redact: ['token', 'ssn'] }));
```

### Client error reporting

`createClientErrorHandler(logger?, config?)` is a route handler, not middleware. It receives error reports from the browser client's optional [reporter](src/web/README.md#error-reporting), validates them, and writes one `logger.error` line per report. `logger` is a `gas-logger` instance, or `console` (the default). Pair it with [`gas-chat`](https://github.com/yorsh-co/gas-chat) to turn each line into a Google Chat alert:

```ts
const chat = new GasChat({
  appName: 'My App',
  webhookUrl: () =>
    PropertiesService.getScriptProperties().getProperty('CHAT_WEBHOOK'),
});
const log = chat.logger(
  new GasLogger({
    sheetConfig: { spreadsheet: () => SpreadsheetApp.openById(ID) },
  }),
);

webApp.post(
  '/client-errors',
  createRateLimiter({
    limit: 20,
    windowSeconds: 60,
    keyFn: (req) => `client-errors:${req.user?.email ?? 'anon'}`,
  }),
  createClientErrorHandler(log),
);
```

The handler keeps no throttling state, so mount a rate limiter in front of it. Key it per user as above. A deployment that allows anonymous access has no `req.user`, so every visitor shares the `anon` bucket; Apps Script exposes no client IP, so use a coarser key and a higher limit there.

The body must be a plain object with a non-empty string `message` and a `kind` of `logged`, `uncaught` or `unhandledrejection`; anything else is a `GasValidationError` (400). Unknown keys are dropped and every field is truncated. Override the caps with `createClientErrorHandler(log, { limits: { stack: 8000 } })`:

| Limit       | Default | Applies to                                                                       |
| ----------- | ------- | -------------------------------------------------------------------------------- |
| `message`   | `1000`  | `message`                                                                        |
| `stack`     | `4000`  | `stack`                                                                          |
| `scope`     | `100`   | `scope`                                                                          |
| `url`       | `500`   | `url`                                                                            |
| `userAgent` | `300`   | `userAgent`                                                                      |
| `context`   | `2000`  | JSON-serialized `context`; over the cap, or unserializable, a marker replaces it |

A valid report is answered with `202 { received: true }` and logged as `logger.error('Client error: <scope>', { kind, message, stack, url, userAgent, clientTimestamp, context, user, reqId })`, where `user` is `req.user` and `reqId` is `req.id`. The handler then calls `logger.flush()` when the logger has one.

> **Note:**
> `gas-chat` suppresses identical alerts for `throttleSeconds` (300 by default), and posting to the webhook needs the `https://www.googleapis.com/auth/script.external_request` scope in `appsscript.json`. `gas-webapp` adds neither; both stay your choice.

## Express differences

`gas-webapp` follows Express where Apps Script allows. These are the differences, all forced by the platform or the wire contract:

- **Response envelope.** `res.json(data)` sends `{ ok: true, status, data }` rather than the raw body. Apps Script cannot set an HTTP status, so the status travels in the body, and the browser client and `gas-error`'s envelope depend on the shape.
- **Synchronous only.** Apps Script rejects `async` and `await` on push (P8), and `doGet`/`doPost` must return synchronously. `next()` is a plain synchronous call, and there is no async middleware. The browser client runs in the browser and keeps its `async`/`await`.
- **Always HTTP 200.** The status exists only in the envelope (P1). Clients must read `ok`/`status`, not the HTTP status.
- **No headers or cookies.** There is no `res.set`, `res.cookie` or `req.headers`, and `Content-Type` is chosen by the output type (P2).
- **`render` and `redirect` are HTTP-only.** `google.script.run` cannot carry HTML or navigate, so both throw `GasForbiddenError` over RPC. `redirect` is a top-window navigation of an HTML page, not an HTTP redirect, and browsers block the automatic navigation, so the user has to click its link (P9).
- **A wrong method is a 404,** not a 405: `gas-error` has no 405.
- **Return values are ignored.** A route responds only through `res`.
- **PUT, PATCH and DELETE are POSTs** with `_method`.
- **No body parser middleware.** The body is parsed by content type before routing; form fields arrive in `req.query`, and a repeated key keeps its first value (P3).
- **No HTML form POSTs over HTTP.** Form, `text/plain` and bodyless POSTs are refused with a 403 as a CSRF defense; use JSON or `google.script.run`.
- **`req.transport` is advisory,** and `req.params` holds only path parameters; `req.query` holds the request parameters.
- **No view engine.** Views are `HtmlService` templates resolved through the `static` config.

## Platform limitations

These are Apps Script constraints. They are documented, not fixed.

| ID  | Limitation                                                                                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Every HTTP response is a 200; the status exists only in the envelope.                                                                                                                                       |
| P2  | No response headers, cookies or HTTP redirects. `res.redirect` is an HTML navigation of the top window, HTTP-only.                                                                                          |
| P3  | `e.parameter` keeps only the first value of a repeated key; `e.parameters` holds them all.                                                                                                                  |
| P4  | An anonymous GET with a path after `/exec` is redirected to the Google sign-in page and never runs the script, so `?route=` is the form that works for every caller.                                        |
| P5  | Delivery acknowledgement costs one `CacheService` write per request plus polling while calls are in flight.                                                                                                 |
| P6  | gasdev bundle covers Apps Script code only. The browser client stays on `git subtree`, and your build wraps it into `.js.html` for `HtmlService`.                                                           |
| P7  | `gasLibrary.peers` are optional by definition, so a project bundled without gas-error fails only at runtime.                                                                                                |
| P8  | The push-time parser rejects `async` and `await`, so backend code has no async functions at all. The `gas` ESLint preset of `gasdev` forbids them in Apps Script sources.                                   |
| P9  | `res.redirect` relies on navigating the top window from `HtmlService`'s sandboxed iframe, which every tested browser blocks without a click. The user follows the page's "Continue to &lt;host&gt;" link.   |
| P10 | An entry-point alias such as `const doGet = app.doGet` works over HTTP but fails over `google.script.run`; declare `doGet`/`doPost` as functions (see [Export the entry points](#export-the-entry-points)). |

### Platform notes

Observed on a deployed web app (`manual/` fixture):

- **`e.pathInfo`.** A signed-in GET to `/exec/users/42` runs with `pathInfo` `"users/42"`; with `?route=/users/42` also present, `route` wins. An anonymous GET with a path never reaches the script. An anonymous POST to `/exec/echo?route=/echo` runs with `pathInfo` `"echo"`, and an anonymous POST to `/exec/echo` reaches `doPost`. A signed-in POST (an HTML form) to `/exec/echo` runs with `pathInfo` `"echo"`, so path URLs reach `doPost` whether or not the caller is signed in.
- **`google.script.run`.** The event the client sends carries no `pathInfo` or `contextPath`, and `undefined` values (such as `body` on a GET) arrive in the browser as `null`. The `callId` the client adds for delivery acknowledgement appears in `req.query`.
- **Trailing slash.** `/exec/` is answered by Apps Script's own 404 page; the script does not run.
- **`e.contextPath`** is `""` on GET and POST.
- **Response types.** A JSON response is a 302 (`application/binary`) to `script.googleusercontent.com/macros/echo...`, then a 200 `application/json; charset=utf-8`. An `HtmlService` response is a 200 `text/html; charset=utf-8` served directly from `script.google.com`, with the page content inside `HtmlService`'s sandboxed iframe.
- **`res.redirect`.** Automatic top-window navigation from `HtmlService`'s sandbox is blocked in every browser tested: desktop Firefox (Zen) and Chromium (Helium), and Android Firefox all needed the link to be clicked, and Android Chrome showed a "redirect blocked" popup. Treat the page's link as the redirect.
- **Entry points.** `const doGet = app.doGet` works for HTTP but not for `google.script.run`.

## Development

The source is TypeScript, compiled to ES2020 because Apps Script's push-time parser rejects newer syntax.

```bash
npm run check        # format, lint, typecheck, unit tests, gasdev check
npm run test:gas     # Apps Script tests on a dedicated project (GAS_TEST_SCRIPT_ID)
npm run manual:build # the fixture for the manual web app checks
```

- Unit tests (Vitest) run against fakes of the Apps Script services and the released peers.
- `npm run test:gas` pushes the library to a dedicated test project with clasp and runs checks against the real `HtmlService`, `ContentService`, `CacheService`, `LockService` and `Session`. Its contents are replaced on every run, and its ID stays out of the repository.
- The behaviour of a deployed web app, which `clasp run` cannot exercise, is checked by hand with the fixture in [`manual/`](https://github.com/yorsh-co/gas-webapp/tree/main/manual).

## License

MIT

See the `LICENSE` file for details.

## Support

Issues and feature requests are welcome via GitHub Issues.

Maintained by [yorsh-co](https://github.com/yorsh-co).

---

> [!TIP]
> Found `gas-webapp` useful?
> Find more Google Apps Script libraries at [github.com/yorsh-co](https://github.com/yorsh-co).
