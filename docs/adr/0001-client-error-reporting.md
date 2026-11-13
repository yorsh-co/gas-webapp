# ADR 0001: Client error reporting

- Status: Accepted
- Date: 2026-11-12

## Context

The browser client logs its own errors to a `GasWebAppLogger` that defaults to `console`. Inside an HtmlService iframe nobody reads that console, so the deployer never learns about client failures. The reports must be bounded, because the route is reachable by any user, and alerting must not pull a new dependency or OAuth scope into `gas-webapp`.

## Decision

- A route handler, `createClientErrorHandler(logger, config)`, validates a report, truncates every field, logs one `logger.error` line and answers 202. It accepts `GasLogger | typeof console`, the same shape as `createLoggingMiddleware`.
- Alerting is delegated to the logger. The documented composition is `gas-chat`'s `chat.logger(new GasLogger(...))`, which posts a Chat alert for error-level lines and throttles duplicates. `gas-webapp` has no alert transport of its own.
- The consumer mounts the route with `createRateLimiter`. The handler keeps no throttling state.
- The wire contract lives in `src/shared/`, so both release branches carry it.
- The browser side is a separate optional file, `gas-webapp.reporter`, activated by `reporter.install()`. It wraps the logger, skips errors the server already logged, dedupes, enforces a per-page budget, and never forwards its own errors.

## Consequences

- No new runtime peer and no new OAuth scope in `gas-webapp`; `script.external_request` stays with the consumer who adds `gas-chat`.
- Reports are untrusted input; the field caps and the rate limiter are the abuse controls, and sheet formula injection is escaped by `gas-logger`.
- Anonymous deployments share one rate-limit bucket, since Apps Script exposes no client IP.
- A later `configure({ logger })` replaces the reporter's wrapper and silently disables forwarding; this is documented rather than worked around.

## Alternatives considered

- **Built-in `MailApp` sink.** Needs the `script.send_mail` scope, has a daily quota, and offers no throttling. Rejected: it widens the scope for every consumer.
- **Hard `gas-chat` peer.** Would give turnkey alerts, but forces a peer and a webhook secret on consumers who only want a sheet or console log. Rejected in favor of injecting any logger.
