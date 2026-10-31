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

  it.each(['route', 'callId'])(
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
});
