/**
 * Single entry point for an Apps Script web app. Extends GasWebAppRouter
 * directly (like express() vs express.Router()), so top-level routes and
 * middleware register straight onto it. Sub-routers meant to be mounted
 * (`webApp.use('/api', api)`) stay plain `GasWebAppRouter` instances.
 *
 * Usage:
 *   const webApp = new GasWebApp();
 *   webApp.use('/api/v1', apiRouter);
 *
 *   function doGet(e: GoogleAppsScript.Events.DoGet) {
 *     return webApp.doGet(e);
 *   }
 *   function doPost(e: GoogleAppsScript.Events.DoPost) {
 *     return webApp.doPost(e);
 *   }
 *
 * Declare the entry points as functions: an alias such as
 * `const doGet = webApp.doGet` works over HTTP but fails over
 * `google.script.run`.
 *
 * Templates call helpers via the global instance, e.g.:
 *   <?!= webApp.include('partials/Header'); ?>
 */
declare class GasWebApp extends GasWebAppRouter {
  /** Data merged into every `res.render`, under `res.locals` and the render options. */
  locals: Record<string, unknown>;
  private _logger;
  private _errorView;
  private _staticDirs;
  private _staticExtensions;
  constructor(config?: GasWebAppConfig);
  /** Arrow field (not a prototype method) so `this` stays bound when the method is passed around. */
  doGet: (e: GoogleAppsScript.Events.DoGet) => WebAppResponse;
  /** Arrow field (not a prototype method) so `this` stays bound when the method is passed around. */
  doPost: (e: GoogleAppsScript.Events.DoPost) => WebAppResponse;
  /**
   * Server-side include for HTML Service templates. Call via the app's
   * global instance from within a template, e.g.:
   *   <?!= webApp.include('partials/Header'); ?>
   *   <?!= webApp.include('components/ItemCard', { item }); ?>
   */
  include(filePath: string, data?: Record<string, unknown>): string;
  /** Include a compiled JS partial resolved against the configured `js` static dir. */
  js(filePath: string, data?: Record<string, unknown>): string;
  /** Include a compiled CSS partial resolved against the configured `css` static dir. */
  css(filePath: string, data?: Record<string, unknown>): string;
  /** Include an HTML partial resolved against the configured `html` static dir. */
  html(filePath: string, data?: Record<string, unknown>): string;
  /**
   * Resolve a logical static path to its full file path, per the configured
   * dirs/extensions. Surrounding whitespace and leading slashes are ignored,
   * so `'app'` and `'/app'` resolve alike.
   */
  resolveStaticFilePath(fileType: StaticFileType, path: string): string;
  private _handleRequest;
  private _createResponse;
  /**
   * Runs the router stack. A pending error, or a request nothing answered (a
   * 404), is resolved into `res` as the stack finishes, before control returns
   * through the `next()` calls, so middleware reads the final status. A layer
   * that stops without responding or calling `next` is a 500, thrown to the
   * caller.
   */
  private _dispatch;
  /**
   * A real web app request carries `contextPath`; `google.script.run` calls
   * do not. A `google.script.run` caller controls the whole event, so this is
   * advisory: it selects the output format and refuses `render`/`redirect`
   * over RPC, and must never drive a security decision.
   */
  private _isHttpRequest;
  private _transportOf;
  /**
   * The single error path: logs through `GasError.handle` and records the
   * safe payload on `res`, as an HTML page when `errorView` is set and the
   * request is an HTTP GET. `_serialize` turns it into the response.
   */
  private _resolveError;
  /**
   * @throws {GasValidationError} When the body is malformed JSON, or `_method`
   * is not PUT, PATCH or DELETE.
   */
  private _normalizeRequest;
  /**
   * The route source, on both entry points: the `route` parameter, then
   * `e.pathInfo`, then the root. Empty values count as absent.
   */
  private _resolveRoute;
  /**
   * Applies the `_method` override: a POST carrying PUT, PATCH or DELETE
   * (any case) is dispatched as that method. `_method` is ignored on GET.
   */
  private _resolveMethod;
  /**
   * Parse a POST body by its content type: JSON is parsed, form encodings are
   * left to `e.parameter`, anything else is kept as the raw string.
   *
   * @throws {GasValidationError} When a JSON body is malformed.
   */
  private _parseBody;
  /**
   * @throws {Error} Over `google.script.run`, an error outcome is thrown with
   * the JSON envelope as its message, as `GasError.handle` does.
   */
  private _serialize;
}
