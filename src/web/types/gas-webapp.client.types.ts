/**
 * Client-side declarations for the `dist-web` package.
 *
 * `interface Window` is augmented rather than redefined, so a consuming app can
 * declare its own `window.App` in a separate ambient file and the two merge.
 */

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
