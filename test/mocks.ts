import { vi, type Mock } from 'vitest';

/** Email returned by the `Session` fake unless a test overrides it. */
export const DEFAULT_EMAIL = 'user@example.com';

/** Content type `ContentService.MimeType.JSON` resolves to. */
export const JSON_MIME_TYPE = 'JSON';

/** Content type `ContentService.MimeType.TEXT` resolves to. */
export const TEXT_MIME_TYPE = 'TEXT';

type Scope = 'script' | 'user';

/** Lock handle returned by the fake, with spies on every method. */
export interface MockLock {
  waitLock: Mock<(timeoutMs: number) => void>;
  tryLock: Mock<(timeoutMs: number) => boolean>;
  releaseLock: Mock<() => void>;
  hasLock: Mock<() => boolean>;
}

/** Test switches for the Apps Script service fakes. */
export interface MockOptions {
  /** Views by name, mapped to the markup their template evaluates to. */
  views?: Record<string, string>;
  /** Scopes held by another execution: `tryLock` fails. */
  contended?: Scope[];
  /** Email returned by `Session.getActiveUser().getEmail()`. */
  email?: string;
}

/** Fake `HtmlOutput`: holds the markup it was created with. */
export interface MockHtmlOutput {
  getContent: Mock<() => string>;
}

/** Fake `TextOutput` with the chainable setters the library calls. */
export interface MockTextOutput {
  setMimeType: Mock<(mimeType: string) => MockTextOutput>;
  getMimeType: Mock<() => string | undefined>;
  getContent: Mock<() => string>;
}

/** Fake template: properties assigned by the caller are kept on the object. */
export interface MockHtmlTemplate {
  evaluate: Mock<() => MockHtmlOutput>;
  [key: string]: unknown;
}

const createHtmlOutput = (content: string): MockHtmlOutput => ({
  getContent: vi.fn(() => content),
});

const createTextOutput = (content: string): MockTextOutput => {
  let mimeType: string | undefined;
  const output: MockTextOutput = {
    setMimeType: vi.fn((value: string) => {
      mimeType = value;
      return output;
    }),
    getMimeType: vi.fn(() => mimeType),
    getContent: vi.fn(() => content),
  };
  return output;
};

/**
 * Fresh set of Apps Script service fakes. `CacheService` is backed by a `Map`
 * shared by every `getScriptCache()` call, and `LockService` follows the
 * per-execution ownership rules of Apps Script: every handle for a scope shares
 * one "held" flag.
 */
export function createMocks(options: MockOptions = {}) {
  const views = options.views ?? {};
  const contended = new Set(options.contended);
  const cacheStore = new Map<string, string>();
  const heldScopes = new Set<Scope>();
  let uuidCounter = 0;

  const createLock = (scope: Scope): MockLock => {
    let acquired = false;
    const acquire = (): boolean => {
      if (!heldScopes.has(scope)) {
        if (contended.has(scope)) return false;
        heldScopes.add(scope);
      }
      acquired = true;
      return true;
    };

    return {
      waitLock: vi.fn(() => {
        if (!acquire()) throw new Error('Lock timeout');
      }),
      tryLock: vi.fn(() => acquire()),
      releaseLock: vi.fn(() => {
        if (!acquired) return;
        acquired = false;
        heldScopes.delete(scope);
      }),
      hasLock: vi.fn(() => heldScopes.has(scope)),
    };
  };

  const cache = {
    get: vi.fn((key: string): string | null => cacheStore.get(key) ?? null),
    put: vi.fn((key: string, value: string, ...ttl: number[]) => {
      void ttl;
      cacheStore.set(key, value);
    }),
    getAll: vi.fn((keys: string[]): Record<string, string> => {
      const found: Record<string, string> = {};
      for (const key of keys) {
        const value = cacheStore.get(key);
        if (value !== undefined) found[key] = value;
      }
      return found;
    }),
    removeAll: vi.fn((keys: string[]) => {
      for (const key of keys) cacheStore.delete(key);
    }),
  };

  const getEmail = vi.fn((): string => options.email ?? DEFAULT_EMAIL);

  return {
    /** Configure with `mockReturnValue('')` or `mockImplementation(() => { throw ... })`. */
    getEmail,
    /** Entries of the fake script cache, for assertions. */
    cacheStore,
    HtmlService: {
      createHtmlOutput: vi.fn(createHtmlOutput),
      createTemplateFromFile: vi.fn((name: string): MockHtmlTemplate => {
        if (typeof name !== 'string') {
          throw new Error('Template file name must be a string');
        }
        const template: MockHtmlTemplate = {
          evaluate: vi.fn(() => createHtmlOutput(views[name] ?? '')),
        };
        return template;
      }),
    },
    ContentService: {
      MimeType: { JSON: JSON_MIME_TYPE, TEXT: TEXT_MIME_TYPE },
      createTextOutput: vi.fn(createTextOutput),
    },
    CacheService: { getScriptCache: vi.fn(() => cache) },
    LockService: {
      getScriptLock: vi.fn(() => createLock('script')),
      getUserLock: vi.fn(() => createLock('user')),
    },
    Session: { getActiveUser: vi.fn(() => ({ getEmail })) },
    Utilities: {
      getUuid: vi.fn(() => `uuid-${++uuidCounter}`),
    },
    console: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      log: vi.fn(),
    },
  };
}

export type Mocks = ReturnType<typeof createMocks>;
