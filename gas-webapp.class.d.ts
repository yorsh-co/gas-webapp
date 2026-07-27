/**
 * Single entry point for an Apps Script web app. Extends GasWebAppRouter directly
 * (like express() vs express.Router()) — GasWebApp IS a router, so top-level
 * routes/middleware register straight onto it via the inherited .get()/
 * .post()/.use(). Sub-routers meant to be mounted (`webApp.use('/api', x)`)
 * should stay plain `GasWebAppRouter` instances — they don't need the response/
 * template layer this class adds on top.
 *
 * Usage:
 *   const webApp = new GasWebApp();
 *   webApp.use('/api/v1', apiRouter);
 *   const doGet = webApp.doGet;
 *   const doPost = webApp.doPost;
 *
 * Templates call helpers via the global instance, e.g.:
 *   <?!= webApp.include('partials/Header'); ?>
 */
declare class GasWebApp extends GasWebAppRouter {
  private _logger;
  private _staticDirs;
  private _staticExtensions;
  constructor(config?: GasWebAppConfig);
  /** Arrow field (not a prototype method) so `this` survives being assigned to the global `doGet`. */
  doGet: (e: GoogleAppsScript.Events.DoGet) => WebAppResponse;
  /** Arrow field (not a prototype method) so `this` survives being assigned to the global `doPost`. */
  doPost: (e: GoogleAppsScript.Events.DoPost) => WebAppResponse;
  /** Wrap data in the standard success payload. */
  json(data: unknown, status?: number): JsonResponse;
  /**
   * Render a view, optionally injected into a layout.
   * Pass `layout: null` to render the view standalone.
   */
  render(viewName: string, options?: RenderOptions): HtmlResponse;
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
  /** Resolve a logical static path to its full file path, per the configured dirs/extensions. */
  resolveStaticFilePath(fileType: StaticFileType, path: string): string;
  private _handleRequest;
  private _normalizeRequest;
  private _dispatch;
  private _serialize;
}
