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
class GasWebApp extends GasWebAppRouter {
  private _logger: GasLogger | typeof console;
  private _staticDirs: Record<StaticFileType, string>;
  private _staticExtensions: Record<StaticFileType, string>;

  constructor(config: GasWebAppConfig = {}) {
    super();

    this._logger = config.logger || console;
    this._staticDirs = {
      ...GAS_WEBAPP_DEFAULT_STATIC_DIRS,
      ...config.static?.dirs,
    };
    this._staticExtensions = {
      ...GAS_WEBAPP_DEFAULT_STATIC_EXTENSIONS,
      ...config.static?.extensions,
    };
  }

  // =========================
  // ENTRY POINTS
  // =========================

  /** Arrow field (not a prototype method) so `this` survives being assigned to the global `doGet`. */
  doGet = (e: GoogleAppsScript.Events.DoGet): WebAppResponse => {
    return this._handleRequest(e, 'GET');
  };

  /** Arrow field (not a prototype method) so `this` survives being assigned to the global `doPost`. */
  doPost = (e: GoogleAppsScript.Events.DoPost): WebAppResponse => {
    return this._handleRequest(e, 'POST');
  };

  // =========================
  // RESPONSE HELPERS
  // =========================

  /** Wrap data in the standard success payload. */
  json(data: unknown, status = 200): JsonResponse {
    return new JsonResponse({ ok: true, status, data });
  }

  /**
   * Render a view, optionally injected into a layout.
   * Pass `layout: null` to render the view standalone.
   */
  render(
    viewName: string,
    options: RenderOptions = {} as RenderOptions,
  ): HtmlResponse {
    const { layout, ...data } = options;

    const viewTemplate = HtmlService.createTemplateFromFile(viewName);
    Object.assign(viewTemplate, data);
    const body = viewTemplate.evaluate().getContent();

    if (layout === null) {
      return new HtmlResponse(HtmlService.createHtmlOutput(body));
    }

    const layoutTemplate = HtmlService.createTemplateFromFile(layout);
    Object.assign(layoutTemplate, data, { body });

    return new HtmlResponse(layoutTemplate.evaluate());
  }

  // =========================
  // TEMPLATE HELPERS
  // =========================

  /**
   * Server-side include for HTML Service templates. Call via the app's
   * global instance from within a template, e.g.:
   *   <?!= webApp.include('partials/Header'); ?>
   *   <?!= webApp.include('components/ItemCard', { item }); ?>
   */
  include(filePath: string, data?: Record<string, unknown>): string {
    const template = HtmlService.createTemplateFromFile(filePath);
    if (data) {
      Object.assign(template, data);
    }

    return template.evaluate().getContent();
  }

  /** Include a compiled JS partial resolved against the configured `js` static dir. */
  js(filePath: string, data?: Record<string, unknown>): string {
    return this.include(this.resolveStaticFilePath('js', filePath), data);
  }

  /** Include a compiled CSS partial resolved against the configured `css` static dir. */
  css(filePath: string, data?: Record<string, unknown>): string {
    return this.include(this.resolveStaticFilePath('css', filePath), data);
  }

  /** Include an HTML partial resolved against the configured `html` static dir. */
  html(filePath: string, data?: Record<string, unknown>): string {
    return this.include(this.resolveStaticFilePath('html', filePath), data);
  }

  /** Resolve a logical static path to its full file path, per the configured dirs/extensions. */
  resolveStaticFilePath(fileType: StaticFileType, path: string): string {
    let cleanPath = path.trim();
    cleanPath += cleanPath.startsWith('/') ? '' : '/';

    return (
      this._staticDirs[fileType] + cleanPath + this._staticExtensions[fileType]
    );
  }

  // =========================
  // REQUEST LIFECYCLE
  // =========================

  private _handleRequest(
    e: GoogleAppsScript.Events.DoGet | GoogleAppsScript.Events.DoPost,
    method: HttpMethod,
  ): WebAppResponse {
    const request = this._normalizeRequest(e, method);

    try {
      const response = this._dispatch(request);
      return this._serialize(response, request.isHttpRequest);
    } catch (err) {
      if (!request.isHttpRequest) throw err;

      return ContentService.createTextOutput(
        (err as Error).message,
      ).setMimeType(ContentService.MimeType.JSON);
    }
  }

  private _normalizeRequest(
    e: GoogleAppsScript.Events.DoGet | GoogleAppsScript.Events.DoPost,
    method: HttpMethod,
  ): RouteRequest {
    const params = (e && e.parameter) || {};
    let body: unknown;

    if (method === 'POST') {
      const postData = (e as GoogleAppsScript.Events.DoPost).postData;

      if (postData && postData.contents) {
        try {
          body = JSON.parse(postData.contents);
        } catch {
          throw new ValidationError('Invalid JSON body');
        }
      }
    }

    const isHttpRequest =
      e && (e as GoogleAppsScript.Events.DoGet).contextPath !== undefined;

    const normalized = {
      route: params.route || '/',
      method,
      isHttpRequest,
      reqId: Utilities.getUuid(),
      params,
      body,
      raw: e,
    };

    return normalized;
  }

  private _dispatch(request: RouteRequest): AppResponse {
    try {
      const result = super.dispatch(request);

      if (result instanceof JsonResponse || result instanceof HtmlResponse) {
        return result;
      }

      return this.json(result);
    } catch (err) {
      return errorHandler(err as Error, {
        logger: this._logger,
        method: request.method,
        path: request.route || '',
        sessionId: request.email || '',
      });
    }
  }

  private _serialize(
    response: AppResponse,
    isHttpRequest: boolean,
  ): WebAppResponse {
    if (response instanceof HtmlResponse) {
      if (!isHttpRequest) {
        throw new ForbiddenError(
          'HtmlResponse cannot be returned over google.script.run',
        );
      }
      return response.output;
    }

    return isHttpRequest
      ? ContentService.createTextOutput(
          JSON.stringify(response.payload),
        ).setMimeType(ContentService.MimeType.JSON)
      : (response as JsonResponse).payload;
  }
}
