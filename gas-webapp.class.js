'use strict';
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
  constructor(config = {}) {
    super();
    // =========================
    // ENTRY POINTS
    // =========================
    /** Arrow field (not a prototype method) so `this` survives being assigned to the global `doGet`. */
    this.doGet = (e) => {
      return this._handleRequest(e, 'GET');
    };
    /** Arrow field (not a prototype method) so `this` survives being assigned to the global `doPost`. */
    this.doPost = (e) => {
      return this._handleRequest(e, 'POST');
    };
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
  // RESPONSE HELPERS
  // =========================
  /** Wrap data in the standard success payload. */
  json(data, status = 200) {
    return new JsonResponse({ ok: true, status, data });
  }
  /**
   * Render a view, optionally injected into a layout.
   * Pass `layout: null` to render the view standalone.
   */
  render(viewName, options = {}) {
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
  /** Resolve a logical static path to its full file path, per the configured dirs/extensions. */
  resolveStaticFilePath(fileType, path) {
    let cleanPath = path.trim();
    cleanPath += cleanPath.startsWith('/') ? '' : '/';
    return (
      this._staticDirs[fileType] + cleanPath + this._staticExtensions[fileType]
    );
  }
  // =========================
  // REQUEST LIFECYCLE
  // =========================
  _handleRequest(e, method) {
    const request = this._normalizeRequest(e, method);
    try {
      const response = this._dispatch(request);
      return this._serialize(response, request.isHttpRequest);
    } catch (err) {
      if (!request.isHttpRequest) throw err;
      return ContentService.createTextOutput(err.message).setMimeType(
        ContentService.MimeType.JSON,
      );
    }
  }
  _normalizeRequest(e, method) {
    const params = (e && e.parameter) || {};
    let body;
    if (method === 'POST') {
      const postData = e.postData;
      if (postData && postData.contents) {
        try {
          body = JSON.parse(postData.contents);
        } catch {
          throw new ValidationError('Invalid JSON body');
        }
      }
    }
    const isHttpRequest = e && e.contextPath !== undefined;
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
  _dispatch(request) {
    try {
      const result = super.dispatch(request);
      if (result instanceof JsonResponse || result instanceof HtmlResponse) {
        return result;
      }
      return this.json(result);
    } catch (err) {
      return errorHandler(err, {
        logger: this._logger,
        method: request.method,
        path: request.route || '',
        sessionId: request.email || '',
      });
    }
  }
  _serialize(response, isHttpRequest) {
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
      : response.payload;
  }
}
