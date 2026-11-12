import { fileURLToPath } from 'node:url';
import { vi } from 'vitest';
import { createGasLoader } from 'gasdev/test';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Loose, test-side view of the browser client namespace. */
export interface ClientNamespace {
  configure(options: object): void;
  logger: Record<
    'debug' | 'info' | 'warn' | 'error',
    (...args: unknown[]) => void
  >;
  api: {
    get(route: string, options?: object): Promise<unknown>;
    post(route: string, body?: unknown, options?: object): Promise<unknown>;
    put(route: string, body?: unknown, options?: object): Promise<unknown>;
    patch(route: string, body?: unknown, options?: object): Promise<unknown>;
    delete(route: string, options?: object): Promise<unknown>;
  };
  errors: { ServerError: new (payload: object) => Error };
  reporter?: { install(options: object): void };
}

/** What a fake `google.script.run` call does once the event is dispatched. */
export type RunBehavior = (
  event: object,
  handlers: { success(value: unknown): void; failure(error: unknown): void },
) => void;

const CLIENT_FILES = [
  'src/web/gas-webapp.config.ts',
  'src/web/gas-webapp.errors.ts',
  'src/web/gas-webapp.client.ts',
];

const createLoader = (files: string[]) =>
  createGasLoader<{ window: { GasWebApp: ClientNamespace } }>({
    files,
    exports: ['window'],
    root: ROOT,
  });

const load = createLoader(CLIENT_FILES);
const loadWithReporter = createLoader([
  ...CLIENT_FILES,
  'src/web/gas-webapp.reporter.ts',
]);

/** Listener registry behind the fake `window.addEventListener`. */
export type FakeListeners = Record<string, ((event: object) => void)[]>;

/**
 * Evaluates the three browser files in load order against a fake `window`.
 * `google.script.run` is a fresh chainable builder per access that hands each
 * dispatched event to `behavior`; `events` records every event sent.
 */
export function loadClient(
  behavior: RunBehavior = () => undefined,
  randomUUID: () => string = () => crypto.randomUUID(),
  { reporter = false }: { reporter?: boolean } = {},
) {
  const events: object[] = [];
  const entries: string[] = [];
  const dispatch =
    (
      success: (v: unknown) => void,
      failure: (e: unknown) => void,
      entry: string,
    ) =>
    (event: object) => {
      events.push(event);
      entries.push(entry);
      behavior(event, { success, failure });
    };

  const listeners: FakeListeners = {};

  const fakeWindow: Record<string, unknown> = {
    addEventListener: (type: string, fn: (event: object) => void) => {
      (listeners[type] ||= []).push(fn);
    },
    get google() {
      let success: (v: unknown) => void = () => undefined;
      let failure: (e: unknown) => void = () => undefined;
      const run = {
        withSuccessHandler: (fn: typeof success) => ((success = fn), run),
        withFailureHandler: (fn: typeof failure) => ((failure = fn), run),
        doGet: (event: object) => dispatch(success, failure, 'doGet')(event),
        doPost: (event: object) => dispatch(success, failure, 'doPost')(event),
      };
      return { script: { run } };
    },
  };

  const { window } = (reporter ? loadWithReporter : load)({
    window: fakeWindow,
    setTimeout,
    clearTimeout,
    crypto: { randomUUID },
    console: { warn: vi.fn(), error: vi.fn() },
    Error,
    location: { href: 'https://app.test/page' },
    navigator: { userAgent: 'test-agent' },
  });

  return { client: window.GasWebApp, events, entries, listeners };
}
