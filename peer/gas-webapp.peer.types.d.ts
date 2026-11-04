/**
 * Ambient declarations for gas-webapp, consumed as a peer subtree package.
 *
 * gas-webapp is expected as a runtime global (Apps Script has no module
 * system); this file declares its public backend surface so a consuming
 * package can typecheck standalone via `tsc --noEmit` without vendoring the
 * source. The browser client is not covered; it ships its own declarations on
 * the `dist-web` branch.
 *
 * Canonical copy: gas-webapp/peer/gas-webapp.peer.types.d.ts. Do not edit
 * downstream copies — update the canonical file and re-copy, so every peer
 * stays in step with the published surface.
 *
 * Being a `.d.ts`, this file is type-only: it matches a consumer's
 * `include: ["src/**\/*.ts"]` but emits nothing, so no counterpart reaches
 * dist/ or the published package.
 *
 * Peer dependencies (expected as globals, declared by their own peer files):
 *   - GasLogger (gas-logger), for `GasWebAppConfig.logger`
 *
 * Usage: copy into the consuming package as `src/internal/`.
 *
 * @see https://github.com/yorsh-co/gas-webapp
 * @version 1.0.3
 */

// =========================
// CONTRACT
// =========================

/** Success envelope produced by `GasWebAppResponse.json()`. */
interface SuccessPayload<T = unknown> {
  ok: true;
  status: number;
  data: T;
}

/**
 * Error envelope sent by `GasWebAppResponse.json()` for a status of 400 or
 * more, and serialized by `gas-error`'s `GasError.handle`.
 */
interface GasErrorPayload {
  ok: false;
  error: string;
  status: number;
  code: string;
  details?: unknown;
}

/** Anything `doGet`/`doPost` can return across either transport. */
type WebAppResponse =
  | GoogleAppsScript.HTML.HtmlOutput
  | GoogleAppsScript.Content.TextOutput
  | SuccessPayload;

// =========================
// REQUEST AND HANDLERS
// =========================

/** Effective HTTP method of a request, after the `_method` override. */
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** How the request reached the app: a web app request or `google.script.run`. */
type GasWebAppTransport = 'http' | 'rpc';

/**
 * The request handed to every handler and middleware. One object per request,
 * mutated in place. An interface on purpose: consumers add fields in global
 * scope by declaration merging.
 */
interface GasWebAppRequest {
  /** Effective method, after the `_method` override. */
  method: HttpMethod;
  /** Path relative to the current mount, with a leading `/`. */
  path: string;
  /** Full request path, whatever the current mount. */
  originalPath: string;
  /** Path the current router is mounted on; `''` at the top level. */
  baseUrl: string;
  /** Path parameters of the layer being run. */
  params: Record<string, string>;
  /** Request parameters, minus `route` and `_method`. */
  query: Record<string, string>;
  /** Parsed POST body. */
  body: unknown;
  /** Unique id of this request. */
  id: string;
  /**
   * How the request arrived. Advisory: a `google.script.run` caller controls
   * the whole event, so never use it for any security decision.
   */
  transport: GasWebAppTransport;
  /** The event Apps Script passed to `doGet`/`doPost`. */
  raw: GoogleAppsScript.Events.DoGet | GoogleAppsScript.Events.DoPost;
  /** Set by `createAuthMiddleware`. */
  user?: { email: string };
}

/**
 * Passes control on. `next()` runs the next layer, `next(err)` skips to the
 * next error handler, and `next('route')` skips the rest of the current route.
 */
type GasWebAppNext = (err?: unknown) => void;

/** Return values are ignored; respond through `res`. */
type GasWebAppHandler = (
  req: GasWebAppRequest,
  res: GasWebAppResponse,
  next: GasWebAppNext,
) => void;

/** Recognised by its four parameters, as in Express. */
type GasWebAppErrorHandler = (
  err: unknown,
  req: GasWebAppRequest,
  res: GasWebAppResponse,
  next: GasWebAppNext,
) => void;

/** What `use` accepts: handlers, mounted routers, or arrays of either. */
type GasWebAppUseHandler =
  GasWebAppHandler | GasWebAppRouter | readonly GasWebAppUseHandler[];

// =========================
// RESPONSE
// =========================

interface RenderOptions {
  /** Layout to inject the view into. Omit or set to null to render standalone. */
  layout?: string | null;
  [key: string]: unknown;
}

/**
 * The response handed to every handler and middleware. A response is sent at
 * most once.
 */
declare class GasWebAppResponse {
  /** Status carried in the envelope. Apps Script cannot set an HTTP status. */
  statusCode: number;
  /** True once `json`, `send`, `render` or `redirect` has run. */
  sent: boolean;
  /** Merged into the data of every `render`, over `app.locals`. */
  locals: Record<string, unknown>;

  /** Sets the status carried in the envelope. */
  status(code: number): this;
  /**
   * Sends `data` in the success envelope; with a status of 400 or more, sends
   * the error envelope instead.
   */
  json(data: unknown): void;
  /**
   * Sends a string as text over HTTP, or as the envelope's data over RPC;
   * anything else is sent as JSON.
   */
  send(body: unknown): void;
  /** Renders a view, optionally inside a layout. */
  render(viewName: string, options?: RenderOptions): void;
  /**
   * Sends a "Continue to <host>" page linking to an absolute http(s) URL;
   * browsers block automatic navigation from the sandbox, so the user follows
   * the link. HTTP only: throws `GasForbiddenError` over `google.script.run`.
   */
  redirect(statusOrUrl: number | string, url?: string): void;
}

// =========================
// ROUTER AND APP
// =========================

/**
 * An ordered stack of layers, like an Express router. Mount sub-routers with
 * `use`; paths use the Express 5 syntax.
 */
declare class GasWebAppRouter {
  use(...handlers: GasWebAppUseHandler[]): this;
  use(...handlers: GasWebAppErrorHandler[]): this;
  use(path: string, ...handlers: GasWebAppUseHandler[]): this;
  use(path: string, ...handlers: GasWebAppErrorHandler[]): this;

  /** Registers handlers for GET requests to `path`. */
  get(path: string, ...handlers: GasWebAppUseHandler[]): this;
  /** Registers handlers for POST requests to `path`. */
  post(path: string, ...handlers: GasWebAppUseHandler[]): this;
  /** Registers handlers for PUT requests (a POST with `_method=PUT`). */
  put(path: string, ...handlers: GasWebAppUseHandler[]): this;
  /** Registers handlers for PATCH requests (a POST with `_method=PATCH`). */
  patch(path: string, ...handlers: GasWebAppUseHandler[]): this;
  /** Registers handlers for DELETE requests (a POST with `_method=DELETE`). */
  delete(path: string, ...handlers: GasWebAppUseHandler[]): this;
  /** Registers handlers for every method on `path`. */
  all(path: string, ...handlers: GasWebAppUseHandler[]): this;

  /**
   * Runs the stack for a request, starting with `err` pending when given.
   * `done` is called with the pending error, if any, once the stack is
   * exhausted.
   */
  handle(
    req: GasWebAppRequest,
    res: GasWebAppResponse,
    done: GasWebAppNext,
    err?: unknown,
  ): void;
}

/** File types resolvable to a static asset path. */
type StaticFileType = 'html' | 'css' | 'js';

interface GasWebAppStaticConfig {
  /** Parent directory for each static file type, relative to the project root. */
  dirs?: Partial<Record<StaticFileType, string>>;
  /** File extension appended when resolving each static file type. */
  extensions?: Partial<Record<StaticFileType, string>>;
}

interface GasWebAppConfig {
  /** Passed to GasError.handle for unhandled/operational errors. @default console */
  logger?: GasLogger | typeof console;
  /** Static asset resolution config for res.render()/include()/js()/css()/html(). */
  static?: GasWebAppStaticConfig;
  /**
   * View rendered for errors on HTTP GET requests, given `{ error }` plus
   * `app.locals`. RPC and non-GET requests keep the JSON envelope.
   */
  errorView?: string;
}

/**
 * Single entry point for an Apps Script web app.
 *
 *   const webApp = new GasWebApp();
 *
 *   function doGet(e: GoogleAppsScript.Events.DoGet) {
 *     return webApp.doGet(e);
 *   }
 *   function doPost(e: GoogleAppsScript.Events.DoPost) {
 *     return webApp.doPost(e);
 *   }
 *
 * Declare the entry points as functions: `google.script.run` fails on an
 * alias such as `const doGet = webApp.doGet`, although HTTP accepts it.
 */
declare class GasWebApp extends GasWebAppRouter {
  /** Data merged into every `res.render`, under `res.locals` and the render options. */
  locals: Record<string, unknown>;

  constructor(config?: GasWebAppConfig);

  /** Arrow field, so `this` stays bound when the method is passed around. */
  doGet: (e: GoogleAppsScript.Events.DoGet) => WebAppResponse;
  /** Arrow field, so `this` stays bound when the method is passed around. */
  doPost: (e: GoogleAppsScript.Events.DoPost) => WebAppResponse;

  /** Server-side include for HTML Service templates. */
  include(filePath: string, data?: Record<string, unknown>): string;
  /** Include a compiled JS partial resolved against the configured `js` static dir. */
  js(filePath: string, data?: Record<string, unknown>): string;
  /** Include a compiled CSS partial resolved against the configured `css` static dir. */
  css(filePath: string, data?: Record<string, unknown>): string;
  /** Include an HTML partial resolved against the configured `html` static dir. */
  html(filePath: string, data?: Record<string, unknown>): string;
  /** Resolve a logical static path to its full file path. */
  resolveStaticFilePath(fileType: StaticFileType, path: string): string;
}

// =========================
// MIDDLEWARE
// =========================

type LockScope = 'user' | 'script';

/** Minimal lock-resolver shape the limiters need; `GasLock` satisfies it. */
interface GasWebAppLockService {
  getLock(scope: LockScope): GoogleAppsScript.Lock.Lock | null;
}

interface AuthMiddlewareConfig {
  /** Return true if the given email is allowed to proceed. */
  isAuthorized: (email: string) => boolean;
}

interface RateLimitConfig {
  limit: number;
  windowSeconds: number;
  /** @default 'user' */
  lockScope?: LockScope;
  keyFn: (req: GasWebAppRequest) => string;
  /** @default resolves LockService.get{Script,User}Lock() directly */
  lockService?: GasWebAppLockService;
}

interface ConcurrencyLimitConfig {
  limit: number;
  /** @default 'user' */
  lockScope?: LockScope;
  keyFn: (req: GasWebAppRequest) => string;
  /** @default resolves LockService.get{Script,User}Lock() directly */
  lockService?: GasWebAppLockService;
}

interface GasWebAppLoggingConfig {
  /**
   * Query keys whose values are logged as `[REDACTED]`, matched exactly and
   * case-insensitively. Replaces the default list.
   */
  redact?: string[];
}

interface GasWebAppAckConfig {
  /** How long an acknowledgement stays readable, in seconds. @default 60 */
  ttlSeconds?: number;
}

interface GasWebAppAckTracker {
  /** Records the caller's `callId`. Register first, before auth and limiters. */
  middleware: GasWebAppHandler;
  /** Handler for the ack route. Responds with the `callId`s that arrived. */
  handler: GasWebAppHandler;
}

interface GasWebAppIdempotencyConfig {
  /** Seconds a completed response stays replayable (max 21600). @default 21600 */
  ttlSeconds?: number;
  /** @default resolves LockService.get{Script,User}Lock() directly */
  lockService?: GasWebAppLockService;
  /** @default 'user' */
  lockScope?: LockScope;
}

/** Identifies the signed-in user and sets `req.user`. Throws `GasUnauthorizedError`. */
declare const createAuthMiddleware: (
  config: AuthMiddlewareConfig,
) => GasWebAppHandler;

/** Fixed-window rate limiter; throws `GasRateLimitError` over the limit. */
declare const createRateLimiter: (config: RateLimitConfig) => GasWebAppHandler;

/** Caps in-flight requests per key; throws `GasRateLimitError` over the limit. */
declare const createConcurrencyLimiter: (
  config: ConcurrencyLimitConfig,
) => GasWebAppHandler;

/** Request logging with query redaction. */
declare const createLoggingMiddleware: (
  logger?: GasLogger | typeof console,
  options?: GasWebAppLoggingConfig,
) => GasWebAppHandler;

/** Delivery acknowledgement for `google.script.run` callers. */
declare const createAckTracker: (
  config?: GasWebAppAckConfig,
) => GasWebAppAckTracker;

/** Replays the stored response for a repeated idempotency key. */
declare const createIdempotencyGuard: (
  config?: GasWebAppIdempotencyConfig,
) => GasWebAppHandler;
