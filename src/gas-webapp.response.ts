/** What a response holds for `GasWebApp` to serialise. */
type GasWebAppOutcome =
  | { kind: 'json'; payload: SuccessPayload }
  | { kind: 'error'; payload: GasErrorPayload }
  | { kind: 'html'; output: GoogleAppsScript.HTML.HtmlOutput }
  | { kind: 'text'; content: string };

/** Escapes text for HTML element content and quoted attribute values. */
const gasWebAppEscapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * The response handed to every handler and middleware. It records the outcome;
 * `GasWebApp` serialises it once the stack has finished. A response is sent at
 * most once.
 */
class GasWebAppResponse {
  /** Status carried in the envelope. Apps Script cannot set an HTTP status. */
  statusCode = 200;
  /** True once `json`, `send`, `render` or `redirect` has run. */
  sent = false;
  /** Merged into the data of every `render`, over `app.locals`. */
  locals: Record<string, unknown> = {};

  private _outcome?: GasWebAppOutcome;

  constructor(
    private readonly _transport: GasWebAppTransport,
    private readonly _resolveStaticFilePath: (
      fileType: StaticFileType,
      path: string,
    ) => string,
    private readonly _appLocals: Record<string, unknown> = {},
  ) {}

  /** What was sent, if anything. Read by `GasWebApp` to serialise. */
  get outcome(): GasWebAppOutcome | undefined {
    return this._outcome;
  }

  /** Sets the status carried in the envelope. */
  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  /**
   * Sends `data` in the success envelope. With a status of 400 or more it
   * sends the error envelope instead (`code` derived from the status, `error`
   * from `data.message` when it is a string, `data` as `details`), which
   * `google.script.run` callers receive as a thrown error.
   */
  json(data: unknown): void {
    if (this.statusCode >= GAS_WEBAPP_ERROR_STATUS_MIN) {
      return this._send({
        kind: 'error',
        payload: this._errorPayload(this.statusCode, data),
      });
    }

    this._send({
      kind: 'json',
      payload: { ok: true, status: this.statusCode, data },
    });
  }

  /**
   * Sends a string as text over HTTP, or as the envelope's data over RPC.
   * Anything else is sent as JSON.
   */
  send(body: unknown): void {
    if (typeof body !== 'string') return this.json(body);

    if (this._transport === 'rpc') return this.json(body);

    this._send({ kind: 'text', content: body });
  }

  /**
   * Renders a view, optionally injected into a layout. Both names are resolved
   * against the configured `html` static dir, like `html()`. Omit `layout`, or
   * pass `null`, to render the view standalone. `app.locals`, `res.locals` and
   * the options, in increasing precedence, are passed to the templates.
   *
   * @throws {GasForbiddenError} Over `google.script.run`, which cannot carry HTML.
   */
  render(viewName: string, options: RenderOptions = {}): void {
    if (this._transport === 'rpc') {
      throw new GasForbiddenError(
        'Views cannot be rendered over google.script.run',
      );
    }
    this._assertUnsent();

    this._send({ kind: 'html', output: this._compose(viewName, options) });
  }

  /**
   * Sends a page that leads to `url`: a "Continue to <host>" link, plus a
   * script that navigates the top window where the browser allows it.
   * HtmlService serves pages in a sandboxed iframe, and browsers block that
   * navigation without a click, so the link is the redirect in practice.
   * Only `http` and `https` URLs are accepted. Express's optional status is
   * recorded in `statusCode` and otherwise ignored.
   *
   * @throws {GasForbiddenError} Over `google.script.run`, which cannot navigate.
   * @throws {GasValidationError} When `url` is not an absolute http(s) URL.
   */
  redirect(statusOrUrl: number | string, url?: string): void {
    if (this._transport === 'rpc') {
      throw new GasForbiddenError(
        'Redirects are not available over google.script.run',
      );
    }
    this._assertUnsent();

    const status =
      typeof statusOrUrl === 'number'
        ? statusOrUrl
        : GAS_WEBAPP_DEFAULT_REDIRECT_STATUS;
    const target = typeof statusOrUrl === 'string' ? statusOrUrl : url;
    if (typeof target !== 'string' || !/^https?:\/\//i.test(target)) {
      throw new GasValidationError('Redirect URL must be an http(s) URL');
    }

    const script = JSON.stringify(target)
      .replace(/</g, '\\u003c')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
    const href = gasWebAppEscapeHtml(target);
    // Apps Script has no URL global. Credentials before `@` are dropped so the
    // page names the host the link really leads to.
    const authority = /^https?:\/\/([^/?#]*)/i.exec(target)?.[1] ?? '';
    const host = gasWebAppEscapeHtml(
      authority.slice(authority.lastIndexOf('@') + 1),
    );

    this.statusCode = status;
    this._send({
      kind: 'html',
      output: HtmlService.createHtmlOutput(
        '<!DOCTYPE html><html><head><base target="_top">' +
          '<meta name="viewport" content="width=device-width, initial-scale=1">' +
          `<title>Continue to ${host}</title>` +
          '<style>body{font-family:system-ui,sans-serif;margin:3rem 1rem;text-align:center}' +
          'a.continue{display:inline-block;padding:.75rem 1.5rem;border-radius:.5rem;' +
          'background:#1a73e8;color:#fff;text-decoration:none;font-weight:600}' +
          'p.url{color:#5f6368;font-size:.875rem;word-break:break-all}</style></head>' +
          `<body><a class="continue" href="${href}" target="_top">Continue to ${host}</a>` +
          `<p class="url">${href}</p>` +
          `<script>window.top.location.href = ${script};</script></body></html>`,
      ),
    });
  }

  /**
   * Records `payload` as the outcome of a failed request, replacing anything
   * already sent. With `errorView`, the error is rendered through that view
   * instead, falling back to the payload if the view throws. Called by
   * `GasWebApp`, once per failed request.
   */
  fail(payload: GasErrorPayload, errorView?: string): void {
    this.statusCode = payload.status;
    this.sent = true;
    this._outcome = { kind: 'error', payload };

    if (errorView === undefined) return;
    try {
      this._outcome = {
        kind: 'html',
        output: this._compose(errorView, { layout: null, error: payload }),
      };
    } catch {
      // The payload stays the outcome.
    }
  }

  private _errorPayload(status: number, data: unknown): GasErrorPayload {
    const message = (data as { message?: unknown } | null | undefined)?.message;

    return {
      ok: false,
      status,
      code: GAS_WEBAPP_ERROR_CODES[status] ?? 'INTERNAL_ERROR',
      error:
        typeof data === 'object' && typeof message === 'string'
          ? message
          : GAS_WEBAPP_DEFAULT_ERROR_MESSAGE,
      details: data,
    };
  }

  /** Evaluates a view, and its layout when given, with `app.locals` < `locals` < options. */
  private _compose(
    viewName: string,
    options: RenderOptions,
  ): GoogleAppsScript.HTML.HtmlOutput {
    const { layout, ...data } = options;
    const templateData = { ...this._appLocals, ...this.locals, ...data };

    const viewTemplate = HtmlService.createTemplateFromFile(
      this._resolveStaticFilePath('html', viewName),
    );
    Object.assign(viewTemplate, templateData);
    const body = viewTemplate.evaluate().getContent();

    if (layout == null) return HtmlService.createHtmlOutput(body);

    const layoutTemplate = HtmlService.createTemplateFromFile(
      this._resolveStaticFilePath('html', layout),
    );
    Object.assign(layoutTemplate, templateData, { body });

    return layoutTemplate.evaluate();
  }

  private _assertUnsent(): void {
    if (this.sent) throw new Error('Response already sent');
  }

  private _send(outcome: GasWebAppOutcome): void {
    this._assertUnsent();
    this.sent = true;
    this._outcome = outcome;
  }
}
