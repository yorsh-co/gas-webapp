import { describe, expect, it } from 'vitest';
import { loadGasWebApp, type TestRequest, type TestResponse } from './harness';

interface Output {
  getContent(): string;
}

const httpPost = (postData: object, parameter: object = { route: 'echo' }) => ({
  parameter,
  contextPath: '',
  postData,
});

const rpcPost = (postData: object) => ({
  parameter: { route: 'echo' },
  postData,
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

const setup = (views: Record<string, string> = {}) => {
  const { lib, mocks } = loadGasWebApp({ views });
  const app = new lib.GasWebApp({ logger: mocks.console });
  app.post('echo', (req: TestRequest, res: TestResponse) =>
    res.json({ body: req.body }),
  );
  return { app, mocks };
};

const logged = (mocks: ReturnType<typeof setup>['mocks']): number =>
  mocks.console.warn.mock.calls.length + mocks.console.error.mock.calls.length;

describe('request normalisation (L1)', () => {
  it('answers an invalid JSON body over HTTP with a 400 envelope', () => {
    const { app } = setup();

    const output = app.doPost(
      httpPost({ contents: '{oops', type: 'application/json' }),
    ) as Output;

    expect(JSON.parse(output.getContent())).toMatchObject({
      ok: false,
      status: 400,
      code: 'VALIDATION_ERROR',
    });
  });

  it('throws the 400 envelope for an invalid JSON body over RPC', () => {
    const { app } = setup();

    expect(
      thrownEnvelope(() =>
        app.doPost(rpcPost({ contents: '{oops', type: 'application/json' })),
      ),
    ).toMatchObject({ ok: false, status: 400, code: 'VALIDATION_ERROR' });
  });

  it('logs a normalisation error once', () => {
    const { app, mocks } = setup();

    app.doPost(httpPost({ contents: '{oops', type: 'application/json' }));

    expect(logged(mocks)).toBe(1);
  });
});

describe('body parsing by content type (L2)', () => {
  const body = (postData: object): unknown => {
    const { app } = setup();
    const output = app.doPost(httpPost(postData)) as Output;
    return JSON.parse(output.getContent());
  };

  it('parses application/json', () => {
    expect(
      body({ contents: '{"a":1}', type: 'application/json' }),
    ).toMatchObject({ ok: true, data: { body: { a: 1 } } });
  });

  it('parses application/json with parameters', () => {
    expect(
      body({ contents: '{"a":1}', type: 'application/json; charset=utf-8' }),
    ).toMatchObject({ ok: true, data: { body: { a: 1 } } });
  });

  it.each(['application/x-www-form-urlencoded', 'multipart/form-data'])(
    'leaves %s to e.parameter',
    (type) => {
      expect(body({ contents: 'a=1&b=2', type })).toEqual({
        ok: true,
        status: 200,
        data: {},
      });
    },
  );

  it('keeps any other type as the raw string', () => {
    expect(body({ contents: 'plain text', type: 'text/plain' })).toMatchObject({
      ok: true,
      data: { body: 'plain text' },
    });
  });
});

describe('error path (L3)', () => {
  it('logs the render-over-RPC rejection once and throws its envelope', () => {
    const { app, mocks } = setup();
    app.get('page', (_req: TestRequest, res: TestResponse) =>
      res.render('home', { layout: null }),
    );

    const envelope = thrownEnvelope(() =>
      app.doGet({ parameter: { route: 'page' } }),
    );

    expect(envelope).toMatchObject({ ok: false, status: 403 });
    expect(logged(mocks)).toBe(1);
  });

  it('answers an unexpected handler error over HTTP as valid JSON', () => {
    const { app, mocks } = setup();
    app.get('boom', () => {
      throw new Error('boom');
    });

    const output = app.doGet({
      parameter: { route: 'boom' },
      contextPath: '',
    }) as Output;

    expect(JSON.parse(output.getContent())).toMatchObject({
      ok: false,
      status: 500,
    });
    expect(logged(mocks)).toBe(1);
  });
});

/** Renders `view` through `res.render` on a real HTTP request. */
const renderOver = (
  app: ReturnType<typeof setup>['app'],
  view: string,
  options?: object,
): Output => {
  app.get('render', (_req: TestRequest, res: TestResponse) =>
    res.render(view, options),
  );
  return app.doGet({
    parameter: { route: 'render' },
    contextPath: '',
  }) as Output;
};

describe('render and static paths (L5, L6, L7)', () => {
  const VIEW = 'dist/web/views/home.html';
  const LAYOUT = 'dist/web/views/layouts/main.html';

  it.each([
    ['no options', undefined],
    ['empty options', {}],
    ['null layout', { layout: null }],
  ])('renders standalone with %s (L5)', (_name, options) => {
    const { app, mocks } = setup({ [VIEW]: '<p>home</p>' });

    renderOver(app, 'home', options);

    expect(
      mocks.HtmlService.createTemplateFromFile.mock.calls.map(([n]) => n),
    ).toEqual([VIEW]);
  });

  it('resolves the view and layout through the static dirs (L7)', () => {
    const { app, mocks } = setup({ [VIEW]: '<p>home</p>' });

    renderOver(app, 'home', { layout: 'layouts/main', title: 'Hi' });

    expect(
      mocks.HtmlService.createTemplateFromFile.mock.calls.map(([n]) => n),
    ).toEqual([VIEW, LAYOUT]);
  });

  it.each(['app', '/app', '  /app ', '//app'])(
    'resolves %j to the same js file (L6)',
    (path) => {
      const { app } = setup();

      expect(app.resolveStaticFilePath('js', path)).toBe(
        'dist/web/public/js/app.js.html',
      );
    },
  );
});
