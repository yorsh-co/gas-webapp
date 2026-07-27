/**
 * Types for GasWebApp.
 *
 * GasWebAppRouter and its request/routing contract (RouteRequest, HttpMethod,
 * Handler, Middleware) live in this same package — see gas-router.class.ts
 * and request.types.ts.
 *
 * Peer dependency (expected as a global from a sibling subtree package,
 * not redeclared here):
 *   - GasError, NotFoundError, ForbiddenError,
 *     ValidationError, errorHandler                 (gas-error)
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
  /** Passed to errorHandler for unhandled/operational errors. @default console */
  logger?: GasLogger | typeof console;
  /** Static asset resolution config for render()/include()/js()/css()/html(). */
  static?: GasWebAppStaticConfig;
}

interface RenderOptions {
  /** Set to null to render the view standalone with no layout. */
  layout: string | null;
  [key: string]: unknown;
}

/** Anything doGet/doPost can legally return across either transport. */
type WebAppResponse =
  | GoogleAppsScript.HTML.HtmlOutput
  | GoogleAppsScript.Content.TextOutput
  | SuccessPayload;

type AppResponse = JsonResponse | HtmlResponse;
