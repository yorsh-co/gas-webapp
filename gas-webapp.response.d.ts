/** What a response holds for `GasWebApp` to serialise. */
type GasWebAppOutcome =
  | {
      kind: 'json';
      payload: SuccessPayload;
    }
  | {
      kind: 'error';
      payload: GasErrorPayload;
    }
  | {
      kind: 'html';
      output: GoogleAppsScript.HTML.HtmlOutput;
    }
  | {
      kind: 'text';
      content: string;
    };
/** Escapes text for HTML element content and quoted attribute values. */
declare const gasWebAppEscapeHtml: (text: string) => string;
/**
 * The response handed to every handler and middleware. It records the outcome;
 * `GasWebApp` serialises it once the stack has finished. A response is sent at
 * most once.
 */
declare class GasWebAppResponse {
  private readonly _transport;
  private readonly _resolveStaticFilePath;
  private readonly _appLocals;
  /** Status carried in the envelope. Apps Script cannot set an HTTP status. */
  statusCode: number;
  /** True once `json`, `send`, `render` or `redirect` has run. */
  sent: boolean;
  /** Merged into the data of every `render`, over `app.locals`. */
  locals: Record<string, unknown>;
  private _outcome?;
  constructor(
    _transport: GasWebAppTransport,
    _resolveStaticFilePath: (fileType: StaticFileType, path: string) => string,
    _appLocals?: Record<string, unknown>,
  );
  /** What was sent, if anything. Read by `GasWebApp` to serialise. */
  get outcome(): GasWebAppOutcome | undefined;
  /** Sets the status carried in the envelope. */
  status(code: number): this;
  /**
   * Sends `data` in the success envelope. With a status of 400 or more it
   * sends the error envelope instead (`code` derived from the status, `error`
   * from `data.message` when it is a string, `data` as `details`), which
   * `google.script.run` callers receive as a thrown error.
   */
  json(data: unknown): void;
  /**
   * Sends a string as text over HTTP, or as the envelope's data over RPC.
   * Anything else is sent as JSON.
   */
  send(body: unknown): void;
  /**
   * Renders a view, optionally injected into a layout. Both names are resolved
   * against the configured `html` static dir, like `html()`. Omit `layout`, or
   * pass `null`, to render the view standalone. `app.locals`, `res.locals` and
   * the options, in increasing precedence, are passed to the templates.
   *
   * @throws {GasForbiddenError} Over `google.script.run`, which cannot carry HTML.
   */
  render(viewName: string, options?: RenderOptions): void;
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
  redirect(statusOrUrl: number | string, url?: string): void;
  /**
   * Records `payload` as the outcome of a failed request, replacing anything
   * already sent. With `errorView`, the error is rendered through that view
   * instead, falling back to the payload if the view throws. Called by
   * `GasWebApp`, once per failed request.
   */
  fail(payload: GasErrorPayload, errorView?: string): void;
  private _errorPayload;
  /** Evaluates a view, and its layout when given, with `app.locals` < `locals` < options. */
  private _compose;
  private _assertUnsent;
  private _send;
}
