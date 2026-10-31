import { describe, expect, it } from 'vitest';
import { loadGasWebApp, type TestRequest, type TestResponse } from './harness';

/** Event shaped like a real web app request: `contextPath` is present. */
const httpEvent = (route: string, extra: object = {}) => ({
  parameter: { route },
  contextPath: '',
  ...extra,
});

/** Event shaped like a `google.script.run` call: no `contextPath`. */
const rpcEvent = (route: string, extra: object = {}) => ({
  parameter: { route },
  ...extra,
});

const postData = (body: unknown) => ({
  postData: { contents: JSON.stringify(body), type: 'application/json' },
});

/** Runs `fn` and returns the parsed error envelope from the thrown message. */
const thrownEnvelope = (fn: () => unknown): Record<string, unknown> => {
  try {
    fn();
  } catch (error) {
    return JSON.parse((error as Error).message);
  }
  throw new Error('expected the call to throw');
};

const setup = () => {
  const { lib, mocks } = loadGasWebApp();
  const app = new lib.GasWebApp({ logger: mocks.console });

  app.get('ping', (_req: TestRequest, res: TestResponse) =>
    res.json({ pong: true }),
  );
  app.post('echo', (req: TestRequest, res: TestResponse) => res.json(req.body));
  return { app, mocks };
};

describe.each([
  ['doGet', 'GET'],
  ['doPost', 'POST'],
] as const)('%s', (entry, method) => {
  const call = (
    app: ReturnType<typeof setup>['app'],
    event: object,
  ): unknown => (entry === 'doGet' ? app.doGet(event) : app.doPost(event));
  const register = method === 'GET' ? 'ping' : 'echo';
  const extra = method === 'POST' ? postData({ pong: true }) : {};

  describe('over HTTP', () => {
    it('returns the success envelope as JSON text output', () => {
      const { app, mocks } = setup();

      const output = call(app, httpEvent(register, extra)) as {
        getContent(): string;
      };

      expect(JSON.parse(output.getContent())).toEqual({
        ok: true,
        status: 200,
        data: { pong: true },
      });
      expect(mocks.ContentService.createTextOutput).toHaveBeenCalledOnce();
    });

    it('returns the error envelope as JSON text output', () => {
      const { app } = setup();

      const output = call(app, httpEvent('missing', extra)) as {
        getContent(): string;
      };

      expect(JSON.parse(output.getContent())).toMatchObject({
        ok: false,
        status: 404,
        code: 'NOT_FOUND',
      });
    });
  });

  describe('over RPC', () => {
    it('returns the success payload', () => {
      const { app } = setup();

      expect(call(app, rpcEvent(register, extra))).toEqual({
        ok: true,
        status: 200,
        data: { pong: true },
      });
    });

    it('throws an Error whose message is the error envelope', () => {
      const { app } = setup();

      expect(
        thrownEnvelope(() => call(app, rpcEvent('missing', extra))),
      ).toMatchObject({ ok: false, status: 404, code: 'NOT_FOUND' });
    });
  });
});
