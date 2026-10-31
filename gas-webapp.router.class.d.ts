/** Result of matching a path against a compiled pattern. */
interface GasWebAppPathMatch {
  params: Record<string, string>;
  /** Length of the matched prefix of the path. */
  length: number;
}
/** A path pattern compiled once, at registration. */
interface GasWebAppPathMatcher {
  match(path: string): GasWebAppPathMatch | null;
}
/** One entry of a router's stack. */
interface GasWebAppLayer {
  /** `null` matches every method. */
  method: HttpMethod | null;
  matcher: GasWebAppPathMatcher;
  /** A route (`get`, `all`, ...) matches the whole path; `use` a prefix. */
  isRoute: boolean;
  fns: (GasWebAppHandler | GasWebAppErrorHandler | GasWebAppRouter)[];
}
declare const GAS_WEBAPP_PARAM_NAME: RegExp;
declare const GAS_WEBAPP_RESERVED_PATH_CHARS = '()[]?+!';
/** Normalises a request path: leading `/`, no repeated or trailing slashes. */
declare const gasWebAppNormalizePath: (path: string) => string;
/**
 * Compiles a path pattern to a case-insensitive matcher. Syntax follows
 * Express 5 (path-to-regexp v8): `:name` matches one segment, `*name` the rest
 * of the path including slashes, and `{...}` is optional. A trailing slash is
 * optional. With `end: false` the pattern matches a prefix, on segment
 * boundaries.
 *
 * @throws {TypeError} When the pattern is malformed or uses unsupported syntax.
 */
declare const gasWebAppCompilePath: (
  pattern: string,
  end: boolean,
) => GasWebAppPathMatcher;
/**
 * An ordered stack of layers, like an Express router. `use`, `get`, `post`,
 * `put`, `patch`, `delete` and `all` interleave in registration order, and
 * `next()` walks the stack synchronously. Mounted routers are held by
 * reference, so routes added to them later are live.
 *
 * Paths use the Express 5 syntax: `/users/:id`, `/files/*path` and optional
 * groups such as `/users{/:id}`. Wildcard and named parameters arrive as
 * strings.
 *
 *   const api = new GasWebAppRouter();
 *   api.get('/users{/:id}', (req, res) => res.json(users.find(req.params.id)));
 *   app.use('/api', api);
 */
declare class GasWebAppRouter {
  private _layers;
  /** Runs the handlers on every request, or on those under a path prefix. */
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
   * exhausted; it is not called when a layer responds without calling `next`.
   */
  handle(
    req: GasWebAppRequest,
    res: GasWebAppResponse,
    done: GasWebAppNext,
    err?: unknown,
  ): void;
  private _route;
  private _flatten;
  /**
   * Runs the functions of one layer in order. A route's functions share one
   * `next`: `next('route')` leaves the route, `next(err)` leaves it with an
   * error. A throw is passed on as `next(err)`. Error handlers run only while
   * an error is pending; mounted routers run either way.
   */
  private _run;
}
