import { describe, expect, it, vi } from 'vitest';
import { loadClient } from './client-harness';

const ROUTE = '/client-errors';

const ok = (_event: object, h: { success(v: unknown): void }) =>
  h.success({ ok: true, status: 202, data: { received: true } });

const fail = (_event: object, h: { failure(e: unknown): void }) =>
  h.failure(new Error('boom'));

/** Loads the client with the reporter and an inner logger spy installed. */
function setup(
  behavior: Parameters<typeof loadClient>[0] = ok,
  options: object = {},
) {
  const loaded = loadClient(behavior, undefined, { reporter: true });
  const inner = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  loaded.client.configure({ logger: inner });
  loaded.client.reporter!.install({ route: ROUTE, ...options });
  return { ...loaded, inner, log: () => loaded.client.logger };
}

const bodyOf = (event: object): Record<string, unknown> =>
  JSON.parse(
    (event as { postData: { contents: string } }).postData.contents,
  ) as Record<string, unknown>;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('GasWebApp.reporter', () => {
  it('is absent unless the file is loaded', () => {
    expect(loadClient().client.reporter).toBeUndefined();
  });

  it('posts one report to the route and still calls the inner logger', () => {
    const { client, events, inner } = setup();

    client.logger.error('Scope', 'Failed', { a: 1 });

    expect(inner.error).toHaveBeenCalledWith('Scope', 'Failed', { a: 1 });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ parameter: { route: ROUTE } });
    expect(bodyOf(events[0]!)).toMatchObject({
      kind: 'logged',
      scope: 'Scope',
      message: 'Failed',
      context: { a: 1 },
      url: 'https://app.test/page',
      userAgent: 'test-agent',
    });
    expect(typeof bodyOf(events[0]!).timestamp).toBe('string');
  });

  it('takes the stack from an Error context', () => {
    const { client, events } = setup();
    const err = new Error('bad');

    client.logger.error('Scope', 'Failed', err);

    expect(bodyOf(events[0]!)).toMatchObject({
      stack: err.stack,
      context: { name: 'Error', message: 'bad' },
    });
  });

  it('does not forward server-originated payloads', () => {
    const { client, events, inner } = setup();

    client.logger.error('S', 'm', {
      ok: false,
      code: 'NOT_FOUND',
      status: 404,
    });

    expect(inner.error).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(0);
  });

  it('forwards an INTERNAL_ERROR minted from a non-JSON failure', () => {
    const { client, events } = setup();

    client.errors.logServerError(new Error('Service timed out'), 'S');

    expect(events).toHaveLength(1);
  });

  it('does not forward a parsed server INTERNAL_ERROR payload', () => {
    const { client, events } = setup();
    const payload = {
      ok: false,
      error: 'x',
      status: 500,
      code: 'INTERNAL_ERROR',
    };

    client.errors.logServerError(new Error(JSON.stringify(payload)), 'S');

    expect(events).toHaveLength(0);
  });

  it.each(['CLIENT_TIMEOUT', 'NOT_DELIVERED', 'CLIENT_ERROR'])(
    'forwards a %s payload',
    (code) => {
      const { client, events } = setup();

      client.logger.error('S', 'm', { ok: false, code, status: 0 });

      expect(events).toHaveLength(1);
    },
  );

  it('dedupes an identical report within dedupeMs', async () => {
    const { client, events } = setup(ok, { dedupeMs: 60000 });

    client.logger.error('S', 'same');
    await flush();
    client.logger.error('S', 'same');
    await flush();
    client.logger.error('S', 'other');

    expect(events).toHaveLength(1 + 1);
  });

  it('sends again once dedupeMs has passed', async () => {
    const { client, events } = setup(ok, { dedupeMs: 10 });

    client.logger.error('S', 'same');
    await new Promise((resolve) => setTimeout(resolve, 25));
    client.logger.error('S', 'same');

    expect(events).toHaveLength(2);
  });

  it('stops at maxReports', async () => {
    const { client, events } = setup(ok, { maxReports: 2 });

    for (const n of [1, 2, 3, 4]) {
      client.logger.error('S', `m${n}`);
      await flush();
    }

    expect(events).toHaveLength(2);
  });

  it('ignores errors logged under the reporter scope', () => {
    const { client, events } = setup();

    client.logger.error('Error Reporter', 'x');

    expect(events).toHaveLength(0);
  });

  it('posts distinct errors logged while a send is pending', () => {
    const { client, events } = setup(() => undefined);

    client.logger.error('S', 'first');
    client.logger.error('S', 'second');

    expect(events).toHaveLength(2);
  });

  it('does not recurse when a send fails, and logs at debug', async () => {
    const { client, events, inner } = setup(fail);

    client.logger.error('S', 'm');
    await flush();

    expect(events).toHaveLength(1);
    expect(inner.debug).toHaveBeenCalledTimes(1);
    expect(inner.debug).toHaveBeenCalledWith(
      'Error Reporter',
      'Report failed',
      expect.any(Object),
    );
    // The failed send's own error line reaches the inner logger, not the wire.
    expect(inner.error).toHaveBeenCalledWith(
      'Error Reporter',
      expect.any(String),
      expect.anything(),
    );
  });

  it('registers no global listeners by default', () => {
    const { listeners } = setup();

    expect(listeners).toEqual({});
  });

  it('forwards uncaught errors and rejections with captureGlobal', async () => {
    const { events, listeners } = setup(ok, { captureGlobal: true });
    const err = new Error('oops');

    listeners.error![0]!({ message: 'oops', error: err });
    await flush();
    listeners.unhandledrejection![0]!({ reason: new Error('nope') });

    expect(bodyOf(events[0]!)).toMatchObject({
      kind: 'uncaught',
      message: 'oops',
      stack: err.stack,
    });
    expect(bodyOf(events[1]!)).toMatchObject({
      kind: 'unhandledrejection',
      message: 'nope',
    });
  });

  it('treats a second install as a no-op and warns', () => {
    const { client, events, inner } = setup();

    client.reporter!.install({ route: '/other' });
    client.logger.error('S', 'm');

    expect(inner.warn).toHaveBeenCalledWith(
      'Error Reporter',
      expect.any(String),
      undefined,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ parameter: { route: ROUTE } });
  });

  it('includes the payload of an Error that carries one', () => {
    const { client, events } = setup();
    const err = Object.assign(new Error('bad'), {
      payload: { ok: false, code: 'X' },
    });

    client.logger.error('S', 'm', err);

    expect(bodyOf(events[0]!)).toMatchObject({
      context: { name: 'Error', message: 'bad', payload: { code: 'X' } },
    });
  });

  it('replaces a circular context with a placeholder', () => {
    const { client, events } = setup();
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    client.logger.error('S', 'm', circular);

    expect(bodyOf(events[0]!).context).toBe('[unserializable context]');
  });

  it('reports a non-Error rejection reason as a string', () => {
    const { events, listeners } = setup(ok, { captureGlobal: true });

    listeners.unhandledrejection![0]!({ reason: 'plain' });

    expect(bodyOf(events[0]!)).toMatchObject({
      kind: 'unhandledrejection',
      message: 'plain',
    });
  });

  it('survives an unstringifiable rejection reason', () => {
    const { events, listeners } = setup(ok, { captureGlobal: true });

    listeners.unhandledrejection![0]!({ reason: Object.create(null) });

    expect(bodyOf(events[0]!)).toMatchObject({
      message: '[unstringifiable]',
    });
  });

  it('wraps the console fallback when installed without configure', () => {
    const loaded = loadClient(ok, undefined, { reporter: true });

    loaded.client.reporter!.install({ route: ROUTE });
    loaded.client.logger.error('S', 'm');

    expect(loaded.events).toHaveLength(1);
  });
});
