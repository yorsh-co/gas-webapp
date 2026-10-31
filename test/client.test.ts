import { describe, expect, it } from 'vitest';
import { loadClient } from './client-harness';

const succeed =
  (value: unknown) => (_event: object, h: { success(v: unknown): void }) =>
    h.success(value);

const payload = (data: unknown) => ({ ok: true, status: 200, data });

describe('GasWebApp.api', () => {
  it('resolves with the unwrapped data', async () => {
    const { client } = loadClient(succeed(payload({ n: 1 })));

    await expect(client.api.get('/x', { ack: false })).resolves.toEqual({
      n: 1,
    });
  });

  it('sends the route and params as the event parameter', async () => {
    const { client, events } = loadClient(succeed(payload(1)));

    await client.api.get('/x', { ack: false, params: { a: '1' } });

    expect(events[0]).toEqual({ parameter: { a: '1', route: '/x' } });
  });

  it.each([null, undefined])(
    'resolves undefined for a %s success value (C1)',
    async (value) => {
      const { client } = loadClient(succeed(value));

      await expect(
        client.api.get('/x', { ack: false }),
      ).resolves.toBeUndefined();
    },
  );

  it('normalises a non-ServerError rejection to CLIENT_ERROR (C2)', async () => {
    const { client } = loadClient(succeed(payload(1)), () => {
      throw new TypeError('crypto unavailable');
    });

    const error = await client.api.get('/x').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(client.errors.ServerError);
    expect(error).toMatchObject({
      payload: { code: 'CLIENT_ERROR', status: 0 },
    });
  });

  it.each(['route', 'callId', '_method', 'idempotencyKey'])(
    'rejects params containing %s without calling the server (C3)',
    async (key) => {
      const { client, events } = loadClient(succeed(payload(1)));

      const error = await client.api
        .get('/x', { ack: false, params: { [key]: 'v' } })
        .catch((e: unknown) => e);

      expect(error).toMatchObject({
        payload: { code: 'CLIENT_ERROR', status: 0 },
      });
      expect((error as Error).message).toContain(key);
      expect(events).toHaveLength(0);
    },
  );

  describe.each([
    ['put', 'PUT'],
    ['patch', 'PATCH'],
  ] as const)('%s', (name, method) => {
    it('posts the body with a _method override', async () => {
      const { client, events, entries } = loadClient(succeed(payload(1)));

      await client.api[name]('/x', { a: 1 }, { ack: false });

      expect(entries).toEqual(['doPost']);
      expect(events[0]).toEqual({
        parameter: { route: '/x', _method: method },
        postData: { contents: '{"a":1}', type: 'application/json' },
      });
    });
  });

  it('delete posts a _method override and no body by default', async () => {
    const { client, events, entries } = loadClient(succeed(payload(1)));

    await client.api.delete('/x/1', { ack: false });

    expect(entries).toEqual(['doPost']);
    expect(events[0]).toEqual({
      parameter: { route: '/x/1', _method: 'DELETE' },
    });
  });

  describe('retries', () => {
    const unavailable = {
      ok: false,
      error: 'down',
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
    };
    const failThenSucceed = (failures: number) => {
      let calls = 0;
      return (
        _event: object,
        h: { success(v: unknown): void; failure(e: unknown): void },
      ) => {
        calls += 1;
        if (calls <= failures)
          h.failure(new Error(JSON.stringify(unavailable)));
        else h.success(payload('ok'));
      };
    };

    it.each(['post', 'put', 'patch', 'delete'] as const)(
      '%s does not retry by default',
      async (name) => {
        const { client, events } = loadClient(failThenSucceed(1));
        client.configure({ retryBaseMs: 1 });

        const call =
          name === 'delete'
            ? client.api.delete('/x', { ack: false })
            : client.api[name]('/x', {}, { ack: false });

        await expect(call).rejects.toMatchObject({ status: 503 });
        expect(events).toHaveLength(1);
      },
    );

    it('retries a POST with an idempotency key, reusing the key', async () => {
      const { client, events } = loadClient(failThenSucceed(2));
      client.configure({ retryBaseMs: 1 });

      await expect(
        client.api.post('/x', {}, { ack: false, idempotencyKey: true }),
      ).resolves.toBe('ok');

      const keys = events.map(
        (e) =>
          (e as { parameter: Record<string, string> }).parameter.idempotencyKey,
      );
      expect(keys).toHaveLength(3);
      expect(keys[0]).toBeTruthy();
      expect(new Set(keys).size).toBe(1);
    });

    it('generates a fresh key per logical request', async () => {
      let n = 0;
      const { client, events } = loadClient(
        succeed(payload(1)),
        () => `key-${++n}`,
      );

      await client.api.post('/x', {}, { ack: false, idempotencyKey: true });
      await client.api.post('/x', {}, { ack: false, idempotencyKey: true });

      expect(
        events.map(
          (e) =>
            (e as { parameter: Record<string, string> }).parameter
              .idempotencyKey,
        ),
      ).toEqual(['key-1', 'key-2']);
    });

    it('sends a caller-supplied key as is', async () => {
      const { client, events } = loadClient(succeed(payload(1)));

      await client.api.delete('/x', { ack: false, idempotencyKey: 'abc' });

      expect(events[0]).toMatchObject({
        parameter: { idempotencyKey: 'abc', _method: 'DELETE' },
      });
    });

    it('lets an explicit retries of 0 win over the key default', async () => {
      const { client, events } = loadClient(failThenSucceed(1));
      client.configure({ retryBaseMs: 1 });

      await expect(
        client.api.put(
          '/x',
          {},
          { ack: false, idempotencyKey: true, retries: 0 },
        ),
      ).rejects.toMatchObject({ status: 503 });
      expect(events).toHaveLength(1);
    });
  });
});
