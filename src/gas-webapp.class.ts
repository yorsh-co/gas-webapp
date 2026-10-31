/**
 * Single entry point for an Apps Script web app. Extends GasWebAppRouter
 * directly (like express() vs express.Router()), so top-level routes and
 * middleware register straight onto it. Sub-routers meant to be mounted
 * (`webApp.use('/api', api)`) stay plain `GasWebAppRouter` instances.
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

  /**
   * Resolve a logical static path to its full file path, per the configured
   * dirs/extensions. Surrounding whitespace and leading slashes are ignored,
   * so `'app'` and `'/app'` resolve alike.
   */
  resolveStaticFilePath(fileType: StaticFileType, path: string): string {
    const cleanPath = path.trim().replace(/^\/+/, '');

    return `${this._staticDirs[fileType]}/${cleanPath}${this._staticExtensions[fileType]}`;
  }

  // =========================
  // REQUEST LIFECYCLE
  // =========================

  private _handleRequest(
    e: GoogleAppsScript.Events.DoGet | GoogleAppsScript.Events.DoPost,
    entryMethod: 'GET' | 'POST',
  ): WebAppResponse {
    let req: GasWebAppRequest | undefined;

    try {
      req = this._normalizeRequest(e, entryMethod);
      const res = new GasWebAppResponse(req.transport, (type, path) =>
        this.resolveStaticFilePath(type, path),
      );
      this._dispatch(req, res);
      return this._serialize(res, req);
    } catch (err) {
      return this._fail(err, e, entryMethod, req);
    }
  }

  /**
   * Runs the router stack, then the final handler: a pending error is thrown
   * to `_fail`, and a request nothing answered is a 404, or a 500 when a
   * layer stopped without responding or calling `next`.
   */
  private _dispatch(req: GasWebAppRequest, res: GasWebAppResponse): void {
    let exhausted = false;
    let pending: unknown;

    this.handle(req, res, (err) => {
      exhausted = true;
      pending = err;
    });

    if (exhausted && pending !== undefined && pending !== null) throw pending;
    if (res.sent) return;

    const target = `${req.method} ${req.originalPath}`;
    if (exhausted) throw new GasNotFoundError(`Cannot ${target}`);

    throw new GasError(`Route did not respond: ${target}`, { statusCode: 500 });
  }

  /** A real web app request carries `contextPath`; `google.script.run` calls do not. */
  private _isHttpRequest(
    e: GoogleAppsScript.Events.DoGet | GoogleAppsScript.Events.DoPost,
  ): boolean {
    return (
      e !== undefined &&
      e !== null &&
      (e as GoogleAppsScript.Events.DoGet).contextPath !== undefined
    );
  }

  /**
   * The single error path: logs through `GasError.handle`, then rethrows the
   * JSON envelope to RPC callers or returns it as JSON text output to HTTP
   * callers.
   */
  private _fail(
    err: unknown,
    e: GoogleAppsScript.Events.DoGet | GoogleAppsScript.Events.DoPost,
    entryMethod: 'GET' | 'POST',
    req?: GasWebAppRequest,
  ): WebAppResponse {
    const context = {
      logger: this._logger,
      method: req?.method ?? entryMethod,
      path: req?.originalPath ?? e?.parameter?.route ?? '',
      sessionId: req?.user?.email ?? '',
    };

    if (!this._isHttpRequest(e)) return GasError.handle(err, context);

    const payload = GasError.handle(err, { ...context, rethrow: false });

    return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
      ContentService.MimeType.JSON,
    );
  }

  /**
   * @throws {GasValidationError} When the body is malformed JSON, or `_method`
   * is not PUT, PATCH or DELETE.
   */
  private _normalizeRequest(
    e: GoogleAppsScript.Events.DoGet | GoogleAppsScript.Events.DoPost,
    entryMethod: 'GET' | 'POST',
  ): GasWebAppRequest {
    const parameter = (e && e.parameter) || {};
    const { route, _method, ...query } = parameter;
    const path = gasWebAppNormalizePath(route || '/');

    return {
      method: this._resolveMethod(entryMethod, _method),
      path,
      originalPath: path,
      baseUrl: '',
      params: {},
      query,
      body:
        entryMethod === 'POST'
          ? this._parseBody((e as GoogleAppsScript.Events.DoPost).postData)
          : undefined,
      id: Utilities.getUuid(),
      transport: this._isHttpRequest(e) ? 'http' : 'rpc',
      raw: e,
    };
  }

  /**
   * Applies the `_method` override: a POST carrying PUT, PATCH or DELETE
   * (any case) is dispatched as that method. `_method` is ignored on GET.
   */
  private _resolveMethod(
    entryMethod: 'GET' | 'POST',
    override: string | undefined,
  ): HttpMethod {
    if (entryMethod === 'GET' || override === undefined) return entryMethod;

    const method = override.toUpperCase();
    if (method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
      return method;
    }
    throw new GasValidationError('Invalid _method');
  }

  /**
   * Parse a POST body by its content type: JSON is parsed, form encodings are
   * left to `e.parameter`, anything else is kept as the raw string.
   *
   * @throws {GasValidationError} When a JSON body is malformed.
   */
  private _parseBody(
    postData: GoogleAppsScript.Events.DoPost['postData'] | undefined,
  ): unknown {
    if (!postData || !postData.contents) return undefined;

    const type = (postData.type || '').split(';')[0]?.trim().toLowerCase();

    if (type === 'application/json') {
      try {
        return JSON.parse(postData.contents);
      } catch {
        throw new GasValidationError('Invalid JSON body');
      }
    }

    if (
      type === 'application/x-www-form-urlencoded' ||
      type === 'multipart/form-data'
    ) {
      return undefined;
    }

    return postData.contents;
  }

  private _serialize(
    res: GasWebAppResponse,
    req: GasWebAppRequest,
  ): WebAppResponse {
    const outcome = res.outcome as GasWebAppOutcome;

    if (outcome.kind === 'html') return outcome.output;

    if (outcome.kind === 'text') {
      return ContentService.createTextOutput(outcome.content).setMimeType(
        ContentService.MimeType.TEXT,
      );
    }

    return req.transport === 'http'
      ? ContentService.createTextOutput(
          JSON.stringify(outcome.payload),
        ).setMimeType(ContentService.MimeType.JSON)
      : outcome.payload;
  }
}
