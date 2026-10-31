/**
 * Types for GasWebApp.
 *
 * GasWebAppRouter and its request/routing contract (GasWebAppRequest,
 * GasWebAppResponse, GasWebAppHandler) live in this same package — see
 * gas-webapp.router.class.ts and gas-webapp.router.types.ts.
 *
 * Peer dependency (expected as a global from a sibling subtree package,
 * not redeclared here):
 *   - GasError (and its Gas*Error subclasses)        (gas-error)
 *   - GasLogger                                     (gas-logger)
 */
/** File types resolvable to a static asset path. */
type StaticFileType = 'html' | 'css' | 'js';
interface GasWebAppStaticConfig {
  /** Parent directory for each static file type, relative to the project root. */
  dirs?: Partial<Record<StaticFileType, string>>;
  /** File extension appended when resolving each static file type. */
  extensions?: Partial<Record<StaticFileType, string>>;
}
interface GasWebAppConfig {
  /** Passed to GasError.handle for unhandled/operational errors. @default console */
  logger?: GasLogger | typeof console;
  /** Static asset resolution config for res.render()/include()/js()/css()/html(). */
  static?: GasWebAppStaticConfig;
  /**
   * View rendered for errors on HTTP GET requests, named like `res.render`
   * and given `{ error }` (the error payload) plus `app.locals`. RPC and
   * non-GET requests keep the JSON envelope, as does a view that throws.
   */
  errorView?: string;
}
interface RenderOptions {
  /** Layout to inject the view into. Omit or set to null to render standalone. */
  layout?: string | null;
  [key: string]: unknown;
}
/** Anything doGet/doPost can legally return across either transport. */
type WebAppResponse =
  | GoogleAppsScript.HTML.HtmlOutput
  | GoogleAppsScript.Content.TextOutput
  | SuccessPayload;
