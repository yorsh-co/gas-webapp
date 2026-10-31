/* Error handlers are detected by arity, so tests declare unused parameters. */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, expect, it } from 'vitest';
import {
  loadGasWebApp,
  type GasWebAppInstance,
  type TestNext,
  type TestRequest,
  type TestResponse,
} from './harness';

interface Output {
  getContent(): string;
  getMimeType?(): string | undefined;
}

const setup = (
  options: Parameters<typeof loadGasWebApp>[0] = {},
  config: object = {},
) => {
  const { lib, mocks, peers } = loadGasWebApp(options);
  const app = new lib.GasWebApp({ logger: mocks.console, ...config });
  return { app, mocks, lib, peers };
};

const http = (route: string, parameter: object = {}) => ({
  parameter: { route, ...parameter },
  contextPath: '',
});

const httpGet = (app: GasWebAppInstance, route: string): Output =>
  app.doGet(http(route)) as Output;

const envelopeOf = (output: Output): Record<string, unknown> =>
  JSON.parse(output.getContent());

/** Runs `fn` and returns the parsed error envelope from the thrown message. */
const thrownEnvelope = (fn: () => unknown): Record<string, unknown> => {
  try {
    fn();
  } catch (error) {
    return JSON.parse((error as Error).message);
  }
  throw new Error('expected the call to throw');
};

const logged = (mocks: ReturnType<typeof setup>['mocks']): number =>
  mocks.console.warn.mock.calls.length + mocks.console.error.mock.calls.length;

describe('res.status(>= 400).json (error envelope)', () => {
  it.each([
    [400, 'VALIDATION_ERROR'],
    [401, 'UNAUTHORIZED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [409, 'CONFLICT'],
    [429, 'RATE_LIMITED'],
    [418, 'INTERNAL_ERROR'],
    [500, 'INTERNAL_ERROR'],
  ])('maps %i to %s', (status, code) => {
    const { app } = setup();
    app.get('/x', (_req: TestRequest, res: TestResponse) =>
      res.status(status).json({ message: 'nope', extra: 1 }),
    );

    expect(envelopeOf(httpGet(app, '/x'))).toEqual({
      ok: false,
      status,
      code,
      error: 'nope',
      details: { message: 'nope', extra: 1 },
    });
  });

  it('uses a generic message when data has no string message', () => {
    const { app } = setup();
    app.get('/x', (_req: TestRequest, res: TestResponse) =>
      res.status(409).json({ message: 5 }),
    );
    app.get('/y', (_req: TestRequest, res: TestResponse) =>
      res.status(409).json('plain'),
    );

    expect(envelopeOf(httpGet(app, '/x')).error).toBe('Request failed');
    expect(envelopeOf(httpGet(app, '/y'))).toMatchObject({
      error: 'Request failed',
      details: 'plain',
    });
  });

  it('is thrown over RPC so the client rejects it', () => {
    const { app } = setup();
    app.get('/x', (_req: TestRequest, res: TestResponse) =>
      res.status(404).json({ message: 'gone' }),
    );

    expect(
      thrownEnvelope(() => app.doGet({ parameter: { route: '/x' } })),
    ).toMatchObject({
      ok: false,
      status: 404,
      code: 'NOT_FOUND',
      error: 'gone',
    });
  });

  it('keeps the success envelope below 400', () => {
    const { app } = setup();
    app.get('/x', (_req: TestRequest, res: TestResponse) =>
      res.status(302).json({ a: 1 }),
    );

    expect(envelopeOf(httpGet(app, '/x'))).toEqual({
      ok: true,
      status: 302,
      data: { a: 1 },
    });
  });

  it('does not log a response the handler chose to send', () => {
    const { app, mocks } = setup();
    app.get('/x', (_req: TestRequest, res: TestResponse) =>
      res.status(404).json({ message: 'gone' }),
    );

    httpGet(app, '/x');

    expect(logged(mocks)).toBe(0);
  });
});

describe('error resolution inside the stack (M3)', () => {
  const observe = (app: GasWebAppInstance) => {
    const seen: number[] = [];
    app.use((_req: TestRequest, res: TestResponse, next: TestNext) => {
      next();
      seen.push(res.statusCode);
    });
    return seen;
  };

  it('shows a thrown GasError status to middleware after next()', () => {
    const { app, peers } = setup();
    const seen = observe(app);
    app.get('/x', () => {
      throw new (peers.GasConflictError as new (m: string) => Error)('dup');
    });

    const output = httpGet(app, '/x');

    expect(seen).toEqual([409]);
    expect(envelopeOf(output)).toMatchObject({ status: 409, code: 'CONFLICT' });
  });

  it('shows an unexpected error as 500', () => {
    const { app } = setup();
    const seen = observe(app);
    app.get('/x', () => {
      throw new Error('boom');
    });

    httpGet(app, '/x');

    expect(seen).toEqual([500]);
  });

  it('shows an unmatched route as 404', () => {
    const { app } = setup();
    const seen = observe(app);

    httpGet(app, '/missing');

    expect(seen).toEqual([404]);
  });

  it('logs the error once and throws the envelope over RPC', () => {
    const { app, mocks } = setup();
    const seen = observe(app);
    app.get('/x', () => {
      throw new Error('boom');
    });

    const envelope = thrownEnvelope(() =>
      app.doGet({ parameter: { route: '/x' } }),
    );

    expect(envelope).toMatchObject({ ok: false, status: 500 });
    expect(seen).toEqual([500]);
    expect(logged(mocks)).toBe(1);
  });

  it('logs a request nobody answered once, as a 500', () => {
    const { app, mocks } = setup();
    app.get('/x', () => {});

    const output = httpGet(app, '/x');

    expect(envelopeOf(output)).toMatchObject({ status: 500 });
    expect(logged(mocks)).toBe(1);
  });

  it('still answers when error middleware handles the error', () => {
    const { app, mocks } = setup();
    const seen = observe(app);
    app.get('/x', () => {
      throw new Error('boom');
    });
    app.use(
      (_err: unknown, _req: TestRequest, res: TestResponse, _next: TestNext) =>
        res.status(418).json({ message: 'teapot' }),
    );

    const output = httpGet(app, '/x');

    expect(seen).toEqual([418]);
    expect(envelopeOf(output)).toMatchObject({ status: 418 });
    expect(logged(mocks)).toBe(0);
  });
});

describe('app.locals', () => {
  it('merges app.locals < res.locals < render options', () => {
    const { app, mocks } = setup({ views: { 'dist/web/views/home.html': '' } });
    app.locals.title = 'app';
    app.locals.site = 'site';
    app.locals.user = 'app-user';
    app.use((_req: TestRequest, res: TestResponse, next: TestNext) => {
      res.locals.title = 'res';
      res.locals.user = 'res-user';
      next();
    });
    app.get('/', (_req: TestRequest, res: TestResponse) =>
      res.render('home', { user: 'option' }),
    );

    httpGet(app, '/');

    expect(
      mocks.HtmlService.createTemplateFromFile.mock.results[0]?.value,
    ).toMatchObject({ title: 'res', site: 'site', user: 'option' });
  });

  it('starts empty and is shared across requests', () => {
    const { app } = setup();

    expect(app.locals).toEqual({});
    app.locals.a = 1;
    expect(app.locals.a).toBe(1);
  });
});

describe('res.redirect', () => {
  const redirectApp = (target: string, status?: number) => {
    const { app, mocks } = setup();
    app.get('/go', (_req: TestRequest, res: TestResponse) =>
      status === undefined
        ? res.redirect(target)
        : res.redirect(status, target),
    );
    return { app, mocks };
  };

  it('navigates the top window with a fallback link', () => {
    const { app } = redirectApp('https://example.com/a?b=1&c=2');

    const html = httpGet(app, '/go').getContent();

    expect(html).toContain(
      'window.top.location.href = "https://example.com/a?b=1&c=2";',
    );
    expect(html).toContain('href="https://example.com/a?b=1&amp;c=2"');
  });

  it('escapes the URL in both contexts', () => {
    const { app } = redirectApp('https://e.com/"</script><b>\u2028');

    const html = httpGet(app, '/go').getContent();

    expect(html).not.toContain('</script><b>');
    expect(html).toContain('\\u003c/script>');
    expect(html).toContain('\\u2028');
    expect(html).toContain('&quot;&lt;/script&gt;&lt;b&gt;');
  });

  it('records the status, defaulting to 302', () => {
    const seen: number[] = [];
    const { app } = setup();
    app.use((_req: TestRequest, res: TestResponse, next: TestNext) => {
      next();
      seen.push(res.statusCode);
    });
    app.get('/a', (_req: TestRequest, res: TestResponse) =>
      res.redirect('https://e.com'),
    );
    app.get('/b', (_req: TestRequest, res: TestResponse) =>
      res.redirect(301, 'https://e.com'),
    );

    httpGet(app, '/a');
    httpGet(app, '/b');

    expect(seen).toEqual([302, 301]);
  });

  it('is rejected over RPC with a 403', () => {
    const { app } = redirectApp('https://e.com');

    expect(
      thrownEnvelope(() => app.doGet({ parameter: { route: '/go' } })),
    ).toMatchObject({ status: 403 });
  });

  it.each(['javascript:alert(1)', 'data:text/html,x', '/relative', ''])(
    'rejects %j as a redirect target',
    (target) => {
      const { app } = redirectApp(target);

      expect(envelopeOf(httpGet(app, '/go'))).toMatchObject({
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    },
  );
});

describe('errorView', () => {
  const ERROR_VIEW = 'dist/web/views/error.html';

  const viewApp = (
    views: Record<string, string> = { [ERROR_VIEW]: '<b>e</b>' },
  ) => {
    const ctx = setup({ views }, { errorView: 'error' });
    ctx.app.locals.site = 'site';
    ctx.app.get('/x', () => {
      throw new Error('boom');
    });
    ctx.app.post('/x', () => {
      throw new Error('boom');
    });
    return ctx;
  };

  it('renders an HTTP GET error through the view with the payload', () => {
    const { app, mocks } = viewApp();

    const output = httpGet(app, '/x');

    expect(output.getContent()).toBe('<b>e</b>');
    expect(
      mocks.HtmlService.createTemplateFromFile.mock.results[0]?.value,
    ).toMatchObject({
      site: 'site',
      error: { ok: false, status: 500, code: 'INTERNAL_ERROR' },
    });
    expect(logged(mocks)).toBe(1);
  });

  it('renders a 404 for an unmatched page', () => {
    const { app, mocks } = viewApp();

    httpGet(app, '/missing');

    expect(
      mocks.HtmlService.createTemplateFromFile.mock.results[0]?.value,
    ).toMatchObject({ error: { status: 404 } });
  });

  it('keeps the JSON envelope for RPC and non-GET requests', () => {
    const { app } = viewApp();

    expect(
      thrownEnvelope(() => app.doGet({ parameter: { route: '/x' } })),
    ).toMatchObject({ status: 500 });
    const post = app.doPost(http('/x')) as Output;
    expect(envelopeOf(post)).toMatchObject({ ok: false, status: 500 });
  });

  it('falls back to JSON, logging the request error once, if the view throws', () => {
    const { app, mocks } = viewApp();
    mocks.HtmlService.createTemplateFromFile.mockImplementation(() => {
      throw new Error('no such file');
    });

    const output = httpGet(app, '/x');

    expect(envelopeOf(output)).toMatchObject({ ok: false, status: 500 });
    expect(logged(mocks)).toBe(1);
  });

  it('is off unless configured', () => {
    const { app, mocks } = setup();
    app.get('/x', () => {
      throw new Error('boom');
    });

    expect(envelopeOf(httpGet(app, '/x'))).toMatchObject({ ok: false });
    expect(mocks.HtmlService.createTemplateFromFile).not.toHaveBeenCalled();
  });
});
