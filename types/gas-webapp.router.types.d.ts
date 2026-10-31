/** Effective HTTP method of a request, after the `_method` override. */
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
/** How the request reached the app: a web app request or `google.script.run`. */
type GasWebAppTransport = 'http' | 'rpc';
/**
 * The request handed to every handler and middleware. One object per request,
 * mutated in place, so fields set by middleware (`user`) reach everything
 * downstream and the final error handler.
 *
 * An interface on purpose: consumers add fields in global scope by declaration
 * merging.
 *
 *   interface GasWebAppRequest {
 *     tenant?: string;
 *   }
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
  /** Parsed POST body; see the request lifecycle. */
  body: unknown;
  /** Unique id of this request. */
  id: string;
  /**
   * How the request arrived, inferred from the presence of `contextPath` on
   * the event. Advisory: a `google.script.run` caller controls the whole
   * event and can claim either value, so never use it for authentication,
   * authorization or any other security decision.
   */
  transport: GasWebAppTransport;
  /** The event Apps Script passed to `doGet`/`doPost`. */
  raw: GoogleAppsScript.Events.DoGet | GoogleAppsScript.Events.DoPost;
  /** Set by `createAuthMiddleware`. */
  user?: {
    email: string;
  };
}
/**
 * Passes control on. `next()` runs the next layer, `next(err)` skips to the
 * next error handler, and `next('route')` skips the rest of the current route.
 * Synchronous: it returns once everything downstream has finished.
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
