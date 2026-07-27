# gas-webapp — browser client

Browser-side counterpart to [`gas-webapp`](../README.md)'s dual-transport router: a small `window.GasWebApp` namespace that wraps every `google.script.run` call in a promise, with timeouts, automatic retry, and delivery acknowledgement built in.

> **Disclaimer:**
> This project and [Yorsh](https://github.com/yorsh-co) are independent and are not affiliated with, endorsed by, or associated with Google LLC.

Ships from the same repository on a separate `dist-web` release branch, since `git subtree` imports a branch root and the backend and browser packages compile against different `lib`s (`google-apps-script` ambient types vs. DOM).

### Features

- `GasWebApp.api.get`/`.post` — promisified wrappers around `google.script.run.doGet`/`doPost`, resolving with the unwrapped response data
- Per-call timeout, since `google.script.run` has no cancel API of its own
- Automatic retry on transient failures (`429`, `5xx`), honoring the server's `details.retryAfterSeconds` when the router's rate limiter supplies one
- Delivery acknowledgement — detects a `google.script.run` call that never reached the server (a silent drop, not a slow response) and fails it distinctly, so it can be retried instead of waiting out the full timeout
- `ServerError`, carrying the router's parsed error payload so callers can branch on `.status`/`.code` directly

### Requirements

This package only makes sense paired with a `gas-webapp` backend deployment — it assumes the same request/response envelope and, for delivery acknowledgement, an `/ack` route registered via that package's `createAckTracker`. Pin both packages to versions released together — `scripts/sync-gas-webapp.sh` does this by default, pulling both branches at the same ref unless you override them separately.

## Add the library to your Apps Script project

Installed together with the backend (and `gas-error`/`gas-logger`) via `scripts/sync-gas-webapp.sh` — see the [backend README's Quick Start](../README.md#quick-start) for the download-and-run command. Running it without `--backend-only` adds this package too:

```txt
src/lib/gas-webapp/
src/web/public/js/lib/gas-webapp/
```

Unlike the backend package, this one ships as TypeScript source rather than compiled output — it's meant to compile alongside the rest of your frontend under your own `tsconfig`, so your build catches a contract mismatch at typecheck time rather than at runtime.

## Load Order

Load these three files, in this order, before anything that calls `configure()` or uses `GasWebApp.api`:

```html
<?!= webApp.js('/lib/gas-webapp/gas-webapp.config'); ?>
<?!= webApp.js('/lib/gas-webapp/gas-webapp.errors'); ?> <?!=
webApp.js('/lib/gas-webapp/gas-webapp.client'); ?>
```

Each file uses the `window.GasWebApp = window.GasWebApp || (...)` idiom and only reaches across the namespace inside function bodies — so nothing breaks if your own scripts load between these three. The ordering requirement is strictly about anything that _calls into_ the namespace (`configure()`, `api.get`, `api.post`) needing to load after all three.

### Reserved namespace keys

`window.GasWebApp.{api, errors, logger}` are owned by this package — don't assign to them from your own code. `configure()` is the one supported entry point for customizing behavior (currently: injecting a logger).

## Configure

```js
window.GasWebApp.configure({
  logger: window.App.log, // any object with debug/info/warn/error(scope, message, context?)
});
```

Optional. Without it, the client logs its own warnings and errors to `console`.

> **Note:**
> If your project keeps its own `window.App`-style namespace and wants `App.api`/`App.errors` to resolve here, alias them once at boot, after this package's scripts load:
>
> ```js
> window.GasWebApp.configure({ logger: window.App.log });
> window.App.api = window.GasWebApp.api;
> window.App.errors = window.GasWebApp.errors;
> ```
>
> This is a convention your project chooses, not something `gas-webapp` requires — page code can equally call `window.GasWebApp.api.get(...)` directly, with no aliasing at all.

## Usage

```js
const users = await window.GasWebApp.api.get('/api/users');

const created = await window.GasWebApp.api.post('/api/users', {
  name: 'Ada',
});
```

```js
try {
  await window.GasWebApp.api.post('/api/users', payload, { retries: 0 });
} catch (err) {
  if (err instanceof window.GasWebApp.errors.ServerError) {
    console.log(err.status, err.code, err.payload.details);
  }
}
```

> **Note:**
> `get` retries transient failures twice by default; `post` does not retry at all, since a timed-out or `5xx` POST may already have committed server-side. Pass `{ retries: n }` to override — only do this for a POST route that's idempotent or carries its own idempotency key.

### Options

| Option      | Default                    | Notes                                                                   |
| ----------- | -------------------------- | ----------------------------------------------------------------------- |
| `params`    | `{}`                       | Merged into the request alongside `route`. Values must be strings.      |
| `body`      | —                          | POST only, JSON-serialized.                                             |
| `timeoutMs` | `30000`                    | Client-side deadline. The server call keeps running past it regardless. |
| `retries`   | `2` for GET, `0` for POST  | Attempts after the first, on `429`/`5xx` responses.                     |
| `scope`     | `` `${method} ${route}` `` | Logger scope for failures.                                              |

## License

MIT

See the `LICENSE` file for details.
