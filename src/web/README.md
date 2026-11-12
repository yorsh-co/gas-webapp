# gas-webapp — browser client

Browser-side counterpart to [`gas-webapp`](https://github.com/yorsh-co/gas-webapp)'s dual-transport router: a small `window.GasWebApp` namespace that wraps every `google.script.run` call in a promise, with timeouts, automatic retry, and delivery acknowledgement built in.

> **Disclaimer:**
> This project and [Yorsh](https://github.com/yorsh-co) are independent and are not affiliated with, endorsed by, or associated with Google LLC.

Ships from the same repository on a separate `dist-web` release branch, since `git subtree` imports a branch root and the backend and browser packages compile against different `lib`s (`google-apps-script` ambient types vs. DOM).

### Features

- `GasWebApp.api.get`/`.post`/`.put`/`.patch`/`.delete` — promisified wrappers around `google.script.run.doGet`/`doPost`, resolving with the unwrapped response data. PUT, PATCH and DELETE travel as a POST carrying `_method`
- Optional idempotency keys, so a write can be retried safely against the backend's `createIdempotencyGuard`
- Per-call timeout, since `google.script.run` has no cancel API of its own
- Automatic retry on transient failures (`429`, `5xx`), honoring the server's `details.retryAfterSeconds` when the router's rate limiter supplies one
- Delivery acknowledgement — detects a `google.script.run` call that never reached the server (a silent drop, not a slow response) and fails it distinctly, so it can be retried instead of waiting out the full timeout
- `ServerError`, carrying the router's parsed error payload so callers can branch on `.status`/`.code` directly

### Requirements

This package only makes sense paired with a `gas-webapp` backend deployment — it assumes the same request/response envelope and, for delivery acknowledgement, an `/ack` route registered via that package's `createAckTracker`. Pin both packages to versions released together: the `gas-webapp` range in `gasdev.bundle.libraries` and the `dist-web` ref you subtree.

## Install

The backend and its peers are installed with gasdev bundle, see the [backend README's Quick Start](https://github.com/yorsh-co/gas-webapp#quick-start). gasdev bundle covers Apps Script code only, so the client is installed separately, with git subtree. Either download and run the sync script from your project root, which adds the client the first time and pulls updates after that:

```bash
curl -o scripts/sync-gas-webapp.sh \
    https://raw.githubusercontent.com/yorsh-co/gas-webapp/main/scripts/sync-gas-webapp.sh \
    && chmod +x scripts/sync-gas-webapp.sh \
    && scripts/sync-gas-webapp.sh
```

or add it directly:

```bash
git subtree add \
  --prefix=src/web/public/js/lib/gas-webapp \
  https://github.com/yorsh-co/gas-webapp.git \
  dist-web \
  --squash
```

The prefix, ref and remote of the script can be overridden with `GAS_WEBAPP_FRONTEND_PREFIX`, `GAS_WEBAPP_FRONTEND_REF` (e.g. `dist-web/v1.0.0`) and `GAS_WEBAPP_REMOTE`. The client lands in:

```txt
src/web/public/js/lib/gas-webapp/
```

Like the backend package, this one ships compiled: `.js` files plus matching `.d.ts` declarations on the `dist-web` branch. The browser cannot load them directly from Apps Script, so your build wraps each `.js` file into a `.js.html` partial (a `<script>` block) that `app.js(...)` includes; the `.d.ts` files give your own TypeScript the typed `window.GasWebApp` contract.

## Load Order

Load these three files, in this order, before anything that calls `configure()` or uses `GasWebApp.api`:

```text
<?!= app.js('/lib/gas-webapp/gas-webapp.config'); ?>
<?!= app.js('/lib/gas-webapp/gas-webapp.errors'); ?>
<?!= app.js('/lib/gas-webapp/gas-webapp.client'); ?>
```

Each file uses the `window.GasWebApp = window.GasWebApp || (...)` idiom and only reaches across the namespace inside function bodies — so nothing breaks if your own scripts load between these three. The ordering requirement is strictly about anything that _calls into_ the namespace (`configure()`, `api.get`, `api.post`) needing to load after all three.

An optional fourth file, `gas-webapp.reporter`, enables [error reporting](#error-reporting). Load it after `gas-webapp.client`; without it, nothing changes:

```text
<?!= app.js('/lib/gas-webapp/gas-webapp.reporter'); ?>
```

### Reserved namespace keys

`window.GasWebApp.{api, errors, logger, config, reporter}` are owned by this package — don't assign to them from your own code. `configure()` is the one supported entry point for customizing behavior.

## Configure

```js
window.GasWebApp.configure({
  logger: window.App.log, // any object with debug/info/warn/error(scope, message, context?)
  ackRoute: '/ack', // must match where the backend mounts ack.handler
});
```

Optional, and every field is. Without it, the client logs its own warnings and errors to `console` and runs on the defaults below.

| Option              | Default                     | Purpose                                                                     |
| ------------------- | --------------------------- | --------------------------------------------------------------------------- |
| `logger`            | `console` (warn and above)  | Where the client sends its own diagnostics                                  |
| `timeoutMs`         | `30000`                     | Per-call deadline, unless overridden per request                            |
| `getRetries`        | `2`                         | Retries after the first attempt; GET, or a request with an `idempotencyKey` |
| `retryBaseMs`       | `400`                       | First backoff window; doubles each attempt                                  |
| `maxRetryDelayMs`   | `15000`                     | Past this, the retry is abandoned                                           |
| `retryableStatuses` | `[429, 500, 502, 503, 504]` | Statuses worth a second attempt                                             |
| `ackRoute`          | `'/ack'`                    | Where the backend mounts `ack.handler`                                      |
| `ackPollIntervalMs` | `2000`                      | Gap between ack polls                                                       |
| `ackPollTimeoutMs`  | `5000`                      | Deadline for the ack poll itself                                            |
| `ackDeadlineMs`     | `15000`                     | Unacknowledged past this, a call counts as undelivered                      |
| `ackScope`          | `'Ack Watcher'`             | Logger scope for ack diagnostics                                            |

Call it once at boot. Values are read live on each request, so it only has to run before the first call.

## Usage

Every call goes through `google.script.run.doGet`/`doPost` and resolves with the unwrapped `data` of the backend's success envelope, or rejects with a `ServerError`.

| Method                                 | Sent as                        | Retries by default |
| -------------------------------------- | ------------------------------ | ------------------ |
| `api.get(route, options?)`             | `doGet`                        | `getRetries`       |
| `api.post(route, body?, options?)`     | `doPost`                       | none               |
| `api.put(route, body?, options?)`      | `doPost` with `_method=PUT`    | none               |
| `api.patch(route, body?, options?)`    | `doPost` with `_method=PATCH`  | none               |
| `api.delete(route, options?)`          | `doPost` with `_method=DELETE` | none               |
| `api.request(method, route, options?)` | any of the above               | by method          |

```js
const users = await window.GasWebApp.api.get('/api/users');

const created = await window.GasWebApp.api.post('/api/users', {
  name: 'Ada',
});

await window.GasWebApp.api.put('/api/users/42', { name: 'Ada' });
await window.GasWebApp.api.patch('/api/users/42', { name: 'Ada' });
await window.GasWebApp.api.delete('/api/users/42');
```

`get` retries transient failures (`429`, `5xx`) twice by default; writes do not retry at all, since a timed-out or `5xx` write may already have committed server-side. Pass `{ retries: n }` to override — only do this for a route that is idempotent or carries its own idempotency key.

### Options

| Option           | Default                                         | Notes                                                                                                                                                             |
| ---------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `params`         | `{}`                                            | Merged into the request alongside `route`. Values must be strings. `route`, `callId`, `_method` and `idempotencyKey` are reserved and reject with `CLIENT_ERROR`. |
| `body`           | —                                               | Not sent on GET, JSON-serialized.                                                                                                                                 |
| `timeoutMs`      | `30000`                                         | Client-side deadline. The server call keeps running past it regardless.                                                                                           |
| `retries`        | `2` for GET or with a key, `0` for other writes | Attempts after the first, on `429`/`5xx` responses.                                                                                                               |
| `idempotencyKey` | —                                               | `true` for a generated UUID, reused across retries, or your own UUID string.                                                                                      |
| `ack`            | `true`                                          | Watch for delivery confirmation. Only the ack poll itself sets this to `false`.                                                                                   |
| `scope`          | `` `${method} ${route}` ``                      | Logger scope for failures.                                                                                                                                        |

### Errors

Every rejection is a `ServerError`, carrying the backend's error envelope:

```js
try {
  await window.GasWebApp.api.post('/api/users', payload);
} catch (err) {
  if (err instanceof window.GasWebApp.errors.ServerError) {
    console.log(err.status, err.code, err.payload.details);
  }
}
```

A failed call rejects with the backend's `status`, `code` and `details`, including a handler's `res.status(404).json(...)`. Three failures have no server counterpart and are synthesized here:

| `code`           | `status` | Meaning                                                                                      |
| ---------------- | -------- | -------------------------------------------------------------------------------------------- |
| `CLIENT_TIMEOUT` | `504`    | The deadline passed. The server call keeps running.                                          |
| `NOT_DELIVERED`  | `503`    | The call was never acknowledged, so it most likely never arrived. Retryable.                 |
| `CLIENT_ERROR`   | `0`      | The request could not be sent: a malformed body, a reserved `params` key, or the RPC failing |

### Idempotency keys

```js
await window.GasWebApp.api.post('/api/orders', order, { idempotencyKey: true });
```

`idempotencyKey: true` generates one UUID per logical request and reuses it on every retry attempt; pass a UUID string to supply your own. The key is sent as the reserved `idempotencyKey` parameter, which the backend's [`createIdempotencyGuard`](https://github.com/yorsh-co/gas-webapp#idempotency) turns into run-once, replay-after semantics. A request with a key retries like a GET (`getRetries`) unless `retries` is set.

### Delivery acknowledgement

Each call carries a `callId`. The backend's `createAckTracker` records it as the request enters, and the client polls the `ackRoute` for the ids still pending, in one request per `ackPollIntervalMs` however many calls are in flight. A call that is neither answered nor acknowledged within `ackDeadlineMs` rejects with `NOT_DELIVERED`, instead of waiting out the full timeout.

> **Note:**
> `NOT_DELIVERED` can be a false negative. A call queued behind Apps Script's per-user concurrent execution limit for longer than `ackDeadlineMs` is reported as never delivered, and then runs. A retry without an idempotency key would commit the write twice. Use a key on every write you retry.

The ack route must be mounted on the backend, ahead of the limiters, at the path `ackRoute` names.

## Error reporting

Optional. With `gas-webapp.reporter` loaded, `reporter.install()` forwards the client's `logger.error` calls, and optionally uncaught errors, to a route backed by the server's `createClientErrorHandler` (see the [main README](../../README.md#client-error-reporting)).

```js
window.GasWebApp.configure({ logger: window.App.log });
window.GasWebApp.reporter.install({
  route: '/client-errors',
  captureGlobal: true,
});
```

Call `install` after `configure({ logger })`: it wraps the current logger, and a later `configure({ logger })` replaces the wrapper and turns forwarding off. A second `install` is a no-op that logs a warning.

| Option          | Default | Purpose                                                                      |
| --------------- | ------- | ---------------------------------------------------------------------------- |
| `route`         | —       | Required. Where the backend mounts the handler                               |
| `captureGlobal` | `false` | Also report `error` and `unhandledrejection` events from the app's own frame |
| `maxReports`    | `10`    | Reports sent per page load                                                   |
| `dedupeMs`      | `60000` | Window in which an identical `kind`, scope and message is sent once          |

Every `logger.error` call is forwarded except one whose `context` is a server-originated error payload (`ok === false` with a `code` other than `CLIENT_TIMEOUT`, `NOT_DELIVERED` or `CLIENT_ERROR`): the server already logged it, and forwarding would alert twice. Errors under the `'Error Reporter'` scope are never forwarded, so a failing send cannot loop; it is logged at `debug` on the original logger and dropped. Reports are sent without retries or delivery acknowledgement.

## License

MIT

See the `LICENSE` file for details.
