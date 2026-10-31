'use strict';
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
class GasWebApp extends GasWebAppRouter {
  constructor(config = {}) {
    super();
    /** Data merged into every `res.render`, under `res.locals` and the render options. */
    this.locals = {};
    // =========================
    // ENTRY POINTS
    // =========================
    /** Arrow field (not a prototype method) so `this` stays bound when the method is passed around. */
    this.doGet = (e) => {
      return this._handleRequest(e, 'GET');
    };
    /** Arrow field (not a prototype method) so `this` stays bound when the method is passed around. */
    this.doPost = (e) => {
      return this._handleRequest(e, 'POST');
    };
    this._logger = config.logger || console;
    this._errorView = config.errorView;
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
  // TEMPLATE HELPERS
  // =========================
  /**
   * Server-side include for HTML Service templates. Call via the app's
   * global instance from within a template, e.g.:
   *   <?!= webApp.include('partials/Header'); ?>
   *   <?!= webApp.include('components/ItemCard', { item }); ?>
   */
  include(filePath, data) {
    const template = HtmlService.createTemplateFromFile(filePath);
    if (data) {
      Object.assign(template, data);
    }
    return template.evaluate().getContent();
  }
  /** Include a compiled JS partial resolved against the configured `js` static dir. */
  js(filePath, data) {
    return this.include(this.resolveStaticFilePath('js', filePath), data);
  }
  /** Include a compiled CSS partial resolved against the configured `css` static dir. */
  css(filePath, data) {
    return this.include(this.resolveStaticFilePath('css', filePath), data);
  }
  /** Include an HTML partial resolved against the configured `html` static dir. */
  html(filePath, data) {
    return this.include(this.resolveStaticFilePath('html', filePath), data);
  }
  /**
   * Resolve a logical static path to its full file path, per the configured
   * dirs/extensions. Surrounding whitespace and leading slashes are ignored,
   * so `'app'` and `'/app'` resolve alike.
   */
  resolveStaticFilePath(fileType, path) {
    const cleanPath = path.trim().replace(/^\/+/, '');
    return `${this._staticDirs[fileType]}/${cleanPath}${this._staticExtensions[fileType]}`;
  }
  // =========================
  // REQUEST LIFECYCLE
  // =========================
  _handleRequest(e, entryMethod) {
    let req;
    let res;
    try {
      req = this._normalizeRequest(e, entryMethod);
      res = this._createResponse(req.transport);
      this._dispatch(req, res);
    } catch (err) {
      res ?? (res = this._createResponse(this._transportOf(e)));
      this._resolveError(err, e, entryMethod, req, res);
    }
    return this._serialize(res, this._transportOf(e));
  }
  _createResponse(transport) {
    return new GasWebAppResponse(
      transport,
      (type, path) => this.resolveStaticFilePath(type, path),
      this.locals,
    );
  }
  /**
   * Runs the router stack. A pending error, or a request nothing answered (a
   * 404), is resolved into `res` as the stack finishes, before control returns
   * through the `next()` calls, so middleware reads the final status. A layer
   * that stops without responding or calling `next` is a 500, thrown to the
   * caller.
   */
  _dispatch(req, res) {
    this.handle(req, res, (err) => {
      if (err !== undefined && err !== null) {
        this._resolveError(err, req.raw, req.method, req, res);
      } else if (!res.sent) {
        const target = `${req.method} ${req.originalPath}`;
        this._resolveError(
          new GasNotFoundError(`Cannot ${target}`),
          req.raw,
          req.method,
          req,
          res,
        );
      }
    });
    if (res.sent) return;
    throw new GasError(
      `Route did not respond: ${req.method} ${req.originalPath}`,
      { statusCode: 500 },
    );
  }
  /**
   * A real web app request carries `contextPath`; `google.script.run` calls
   * do not. A `google.script.run` caller controls the whole event, so this is
   * advisory: it selects the output format and refuses `render`/`redirect`
   * over RPC, and must never drive a security decision.
   */
  _isHttpRequest(e) {
    return e !== undefined && e !== null && e.contextPath !== undefined;
  }
  _transportOf(e) {
    return this._isHttpRequest(e) ? 'http' : 'rpc';
  }
  /**
   * The single error path: logs through `GasError.handle` and records the
   * safe payload on `res`, as an HTML page when `errorView` is set and the
   * request is an HTTP GET. `_serialize` turns it into the response.
   */
  _resolveError(err, e, entryMethod, req, res) {
    const payload = GasError.handle(err, {
      logger: this._logger,
      method: req?.method ?? entryMethod,
      path: req?.originalPath ?? e?.parameter?.route ?? '',
      sessionId: req?.user?.email ?? '',
      rethrow: false,
    });
    const asPage =
      this._errorView !== undefined &&
      this._transportOf(e) === 'http' &&
      (req?.method ?? entryMethod) === 'GET';
    res.fail(payload, asPage ? this._errorView : undefined);
  }
  /**
   * @throws {GasValidationError} When the body is malformed JSON, or `_method`
   * is not PUT, PATCH or DELETE.
   */
  _normalizeRequest(e, entryMethod) {
    const parameter = (e && e.parameter) || {};
    const { route, _method, ...query } = parameter;
    const path = gasWebAppNormalizePath(this._resolveRoute(route, e));
    return {
      method: this._resolveMethod(entryMethod, _method),
      path,
      originalPath: path,
      baseUrl: '',
      params: {},
      query,
      body: entryMethod === 'POST' ? this._parseBody(e.postData) : undefined,
      id: Utilities.getUuid(),
      transport: this._isHttpRequest(e) ? 'http' : 'rpc',
      raw: e,
    };
  }
  /**
   * The route source, on both entry points: the `route` parameter, then
   * `e.pathInfo`, then the root. Empty values count as absent.
   */
  _resolveRoute(route, e) {
    return route || e?.pathInfo || '/';
  }
  /**
   * Applies the `_method` override: a POST carrying PUT, PATCH or DELETE
   * (any case) is dispatched as that method. `_method` is ignored on GET.
   */
  _resolveMethod(entryMethod, override) {
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
  _parseBody(postData) {
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
  /**
   * @throws {Error} Over `google.script.run`, an error outcome is thrown with
   * the JSON envelope as its message, as `GasError.handle` does.
   */
  _serialize(res, transport) {
    const outcome = res.outcome;
    if (outcome.kind === 'html') return outcome.output;
    if (outcome.kind === 'text') {
      return ContentService.createTextOutput(outcome.content).setMimeType(
        ContentService.MimeType.TEXT,
      );
    }
    if (transport === 'rpc') {
      if (outcome.kind === 'error') {
        throw new Error(JSON.stringify(outcome.payload));
      }
      return outcome.payload;
    }
    return ContentService.createTextOutput(
      JSON.stringify(outcome.payload),
    ).setMimeType(ContentService.MimeType.JSON);
  }
}
