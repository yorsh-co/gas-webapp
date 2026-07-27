/**
 * Client-side declarations for the `dist-web` package.
 *
 * `interface Window` is augmented rather than redefined, so a consuming app can
 * declare its own `window.App` in a separate ambient file and the two merge.
 */

type ApiMethod = 'GET' | 'POST';

interface ApiRequestOptions {
  /** Merged into `e.parameter` alongside `route`. Values must be strings. */
  params?: Record<string, string>;
  /** POST only — JSON-serialized into `e.postData.contents`. */
  body?: unknown;
  /** Client-side deadline. The server keeps running past it. @default 30000 */
  timeoutMs?: number;
  /** Retries after the first attempt. @default 2 for GET, 0 for POST */
  retries?: number;
  /** Logger scope for failures. @default `${method} ${route}` */
  scope?: string;
}

/** The single rejection type every `GasWebApp.api` call produces. */
interface IServerError extends Error {
  readonly payload: GasErrorPayload;
  readonly status: number;
  readonly code: string;
}

/**
 * Structural logger contract. Any object with these four methods works —
 * `window.App.log` in a consuming app satisfies it as-is.
 */
interface GasWebAppLogger {
  debug(scope: string, message: string, context?: unknown): void;
  info(scope: string, message: string, context?: unknown): void;
  warn(scope: string, message: string, context?: unknown): void;
  error(scope: string, message: string, context?: unknown): void;
}

interface GasWebAppOptions {
  /** Where the client sends its own diagnostics. @default console */
  logger?: GasWebAppLogger;
}

interface GasWebAppNamespace {
  configure(options: GasWebAppOptions): void;
  /** @internal Resolved logger. Assign through `configure()`. */
  logger: GasWebAppLogger;
  api: GasWebAppApi;
  errors: GasWebAppErrors;
}

interface Window {
  GasWebApp: GasWebAppNamespace;
  google?: {
    script?: {
      run: GoogleScriptRun;
    };
  };
}
