/** What a response holds for `GasWebApp` to serialise. */
type GasWebAppOutcome =
  | { kind: 'json'; payload: SuccessPayload }
  | { kind: 'html'; output: GoogleAppsScript.HTML.HtmlOutput }
  | { kind: 'text'; content: string };

/**
 * The response handed to every handler and middleware. It records the outcome;
 * `GasWebApp` serialises it once the stack has finished. A response is sent at
 * most once.
 */
class GasWebAppResponse {
  /** Status carried in the envelope. Apps Script cannot set an HTTP status. */
  statusCode = 200;
  /** True once `json`, `send` or `render` has run. */
  sent = false;
  /** Merged into the data of every `render`. */
  locals: Record<string, unknown> = {};

  private _outcome?: GasWebAppOutcome;

  constructor(
    private readonly _transport: GasWebAppTransport,
    private readonly _resolveStaticFilePath: (
      fileType: StaticFileType,
      path: string,
    ) => string,
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

  /** Sends `data` in the success envelope. */
  json(data: unknown): void {
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
   * pass `null`, to render the view standalone. `locals` and the options are
   * passed to the templates.
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

    const { layout, ...data } = options;
    const templateData = { ...this.locals, ...data };

    const viewTemplate = HtmlService.createTemplateFromFile(
      this._resolveStaticFilePath('html', viewName),
    );
    Object.assign(viewTemplate, templateData);
    const body = viewTemplate.evaluate().getContent();

    if (layout == null) {
      return this._send({
        kind: 'html',
        output: HtmlService.createHtmlOutput(body),
      });
    }

    const layoutTemplate = HtmlService.createTemplateFromFile(
      this._resolveStaticFilePath('html', layout),
    );
    Object.assign(layoutTemplate, templateData, { body });

    this._send({ kind: 'html', output: layoutTemplate.evaluate() });
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
