/**
 * Ambient declarations for gas-logger, consumed as a peer subtree package.
 *
 * gas-logger is expected as a runtime global (Apps Script has no module
 * system); this file declares its public surface so a consuming package can
 * typecheck standalone via `tsc --noEmit` without vendoring the source.
 *
 * Canonical copy: gas-logger/peer/gas-logger.peer.types.d.ts. Do not edit
 * downstream copies — update the canonical file and re-copy, so every peer
 * stays in step with the published surface.
 *
 * Being a `.d.ts`, this file is type-only: it matches a consumer's
 * `include: ["src/**\/*.ts"]` but emits nothing, so no counterpart reaches
 * dist/ or the published package.
 *
 * Usage: copy into the consuming package as `src/internal/`.
 *
 * @see https://github.com/yorsh-co/gas-logger
 * @version 1.2.0
 */

type GasLoggerLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

type GasLoggerMeta = Record<string, unknown>;

interface GasLoggerSheetConfig {
  spreadsheet?: GoogleAppsScript.Spreadsheet.Spreadsheet;
  spreadsheetUrl?: string;
  spreadsheetId?: string;
  /** Default when no spreadsheet configuration is provided */
  useActiveSpreadsheet?: boolean;
  /** Name of the target sheet */
  sheetName?: string;
}

/**
 * Lock service the logger takes the script lock through. Anything exposing
 * `withLock` fits, e.g. `GasLock`. `withLock` runs `callback` while holding
 * the lock and throws if the lock can't be acquired within `timeoutMs`.
 */
interface GasLoggerLockService {
  withLock<T>(
    scope: 'script',
    callback: () => T,
    options?: { timeoutMs?: number },
  ): T;
}

interface GasLoggerOptions {
  /** Minimum level to emit to the console/execution log. @default 'info' */
  level?: GasLoggerLevel;
  /** Minimum level to write to the sheet. @default the `level` value */
  sheetLevel?: GasLoggerLevel;
  sheetConfig?: GasLoggerSheetConfig;
  /** Fields merged into the meta of every log call made by this logger (and its children). */
  bindings?: GasLoggerMeta;
  /** Rows to accumulate before auto-flushing to the sheet. If omitted, rows are appended individually (no buffering). */
  flushThreshold?: number;
  /** Levels that skip the buffer and are appended to the sheet immediately. */
  bypassBufferLevels?: GasLoggerLevel[];
  /**
   * Service the script lock is taken through, for sheet creation and
   * buffered flushes. Pass `GasLock` when the caller holds the script lock
   * itself, so logging inside that section doesn't end it early. Defaults to
   * the `GasLock` global when loaded, else Apps Script's `LockService`.
   */
  lockService?: GasLoggerLockService;
}

/** Per-child threshold overrides accepted by `GasLogger.child()`. */
interface GasLoggerChildOverrides {
  level?: GasLoggerLevel;
  sheetLevel?: GasLoggerLevel;
}

/**
 * Structured logger for Apps Script. Writes to the execution log and,
 * optionally, to a Google Sheet.
 */
declare class GasLogger {
  constructor(options?: GasLoggerOptions);

  /**
   * Creates a child logger that merges `bindings` into the meta of every
   * subsequent call. Reuses the parent's resolved sheet and buffer; the
   * returned logger is a full `GasLogger` and can itself be nested.
   */
  child(
    bindings?: GasLoggerMeta,
    overrides?: GasLoggerChildOverrides,
  ): GasLogger;

  trace(msg: string, meta?: GasLoggerMeta): void;
  debug(msg: string, meta?: GasLoggerMeta): void;
  info(msg: string, meta?: GasLoggerMeta): void;
  warn(msg: string, meta?: GasLoggerMeta): void;
  error(msg: string, meta?: GasLoggerMeta): void;
  fatal(msg: string, meta?: GasLoggerMeta): void;

  /**
   * Flushes buffered rows to the sheet. No-op when no sheet is configured or
   * the buffer is empty. Call from a `finally` block so buffered rows are
   * written before the execution ends.
   */
  flush(): void;
}
