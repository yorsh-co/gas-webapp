/* Error handlers are detected by arity, so tests declare unused parameters. */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, expect, it, vi } from 'vitest';
import {
  loadGasWebApp,
  type GasWebAppInstance,
  type TestNext,
  type TestRequest,
  type TestResponse,
} from './harness';

type Handler = (req: TestRequest, res: TestResponse, next: TestNext) => void;

const setup = (options: Parameters<typeof loadGasWebApp>[0] = {}) => {
  const { lib, mocks, peers } = loadGasWebApp(options);
  const app = new lib.GasWebApp({ logger: mocks.console });
  const router = () => new lib.GasWebAppRouter();
  return { app, mocks, router, lib, peers };
};

/** Runs `fn` and returns the parsed error envelope from the thrown message. */
const thrownEnvelope = (fn: () => unknown): Record<string, unknown> => {
  try {
    fn();
  } catch (error) {
    return JSON.parse((error as Error).message);
  }
  throw new Error('expected the call to throw');
};

/** `google.script.run` GET: returns the envelope data or throws the error. */
const call = (
  app: GasWebAppInstance,
  route: string,
  parameter: object = {},
) => {
  const result = app.doGet({ parameter: { route, ...parameter } }) as {
    data: unknown;
  };
  return result.data;
};

const fail = (app: GasWebAppInstance, route: string, parameter: object = {}) =>
  thrownEnvelope(() => call(app, route, parameter));

/** Records its name in `trail`, then continues. */
const mark =
  (trail: string[], name: string): Handler =>
  (_req, _res, next) => {
    trail.push(name);
    next();
  };

const reply: Handler = (_req, res) => res.json('ok');

describe('registration order (X1)', () => {
  it('runs use() only for routes registered after it', () => {
    const { app } = setup();
    const trail: string[] = [];
    app.get('/early', mark(trail, 'route'), reply);
    app.use(mark(trail, 'mw'));
    app.get('/late', reply);

    call(app, '/early');
    expect(trail).toEqual(['route']);

    call(app, '/late');
    expect(trail).toEqual(['route', 'mw']);
  });

  it('interleaves use, verbs and all in registration order', () => {
    const { app } = setup();
    const trail: string[] = [];
    app.use(mark(trail, 'use1'));
    app.all('/x', mark(trail, 'all'));
    app.get('/x', mark(trail, 'get'));
    app.use('/x', mark(trail, 'use2'));
    app.get('/x', reply);

    call(app, '/x');

    expect(trail).toEqual(['use1', 'all', 'get', 'use2']);
  });

  it('stacks handlers registered twice on the same method and path (R4)', () => {
    const { app } = setup();
    const trail: string[] = [];
    app.get('/x', mark(trail, 'first'));
    app.get('/x', (_req: TestRequest, res: TestResponse) => res.json('second'));

    expect(call(app, '/x')).toBe('second');
    expect(trail).toEqual(['first']);
  });

  it('does not run the second registration once the first responds', () => {
    const { app } = setup();
    const second = vi.fn();
    app.get('/x', reply);
    app.get('/x', second);

    call(app, '/x');

    expect(second).not.toHaveBeenCalled();
  });

  it('lets a route stay outside middleware registered after it (ack case)', () => {
    const { app } = setup();
    const limiter = vi.fn((_req, _res, next: TestNext) => next());
    app.get('/ack', reply);
    app.use(limiter);
    app.get('/api', reply);

    call(app, '/ack');
    expect(limiter).not.toHaveBeenCalled();

    call(app, '/api');
    expect(limiter).toHaveBeenCalledOnce();
  });
});

describe('path matching (X3)', () => {
  const params = (pattern: string, route: string) => {
    const { app } = setup();
    app.get(pattern, (req: TestRequest, res: TestResponse) =>
      res.json(req.params),
    );
    return call(app, route);
  };

  it('captures named parameters', () => {
    expect(params('/users/:id/posts/:post', '/users/7/posts/9')).toEqual({
      id: '7',
      post: '9',
    });
  });

  it('decodes parameters', () => {
    expect(params('/users/:id', '/users/a%20b%2Fc')).toEqual({ id: 'a b/c' });
  });

  it('rejects a malformed encoding with a 400', () => {
    const { app } = setup();
    app.get('/users/:id', reply);

    expect(fail(app, '/users/%E0%A4%A')).toMatchObject({ status: 400 });
  });

  it('captures a wildcard across slashes', () => {
    expect(params('/files/*path', '/files/a/b/c.txt')).toEqual({
      path: 'a/b/c.txt',
    });
  });

  it('requires at least one character for a wildcard', () => {
    const { app } = setup();
    app.get('/files/*path', reply);

    expect(fail(app, '/files')).toMatchObject({ status: 404 });
  });

  it('supports optional groups', () => {
    const { app } = setup();
    app.get('/users{/:id}', (req: TestRequest, res: TestResponse) =>
      res.json(req.params),
    );

    expect(call(app, '/users')).toEqual({});
    expect(call(app, '/users/5')).toEqual({ id: '5' });
  });

  it('ignores case and a trailing slash', () => {
    const { app } = setup();
    app.get('/Users/', reply);

    expect(call(app, '/users')).toBe('ok');
    expect(call(app, '/USERS/')).toBe('ok');
  });

  it('matches routes written with or without a leading slash', () => {
    const { app } = setup();
    app.get('ping', reply);

    expect(call(app, 'ping')).toBe('ok');
    expect(call(app, '/ping')).toBe('ok');
  });

  it('matches the whole path, not a prefix, for routes', () => {
    const { app } = setup();
    app.get('/users', reply);

    expect(fail(app, '/users/5')).toMatchObject({ status: 404 });
  });

  it('matches the root route', () => {
    const { app } = setup();
    app.get('/', reply);

    expect(call(app, '/')).toBe('ok');
    expect(call(app, '')).toBe('ok');
  });

  it.each(['/a(b)', '/a?', '/a+', '/a[b]', '/:', '/*', '/a{b'])(
    'rejects the unsupported pattern %s at registration',
    (pattern) => {
      const { app } = setup();

      expect(() => app.get(pattern, reply)).toThrow(
        /Unsupported|Missing|Unterminated|Handlers must/,
      );
    },
  );

  it('rejects a handler that is not a function', () => {
    const { app } = setup();

    expect(() => app.get('/x', 'nope')).toThrow(
      /Unsupported|Missing|Unterminated|Handlers must/,
    );
  });
});

describe('use() prefixes (R1, R2)', () => {
  it('matches a prefix on segment boundaries only', () => {
    const { app } = setup();
    const mw = vi.fn((_req, _res, next: TestNext) => next());
    app.use('/api', mw);
    app.get('/api/users', reply);

    call(app, '/api/users');
    expect(fail(app, '/apiary')).toMatchObject({ status: 404 });
    expect(mw).toHaveBeenCalledTimes(1);
  });

  it('applies to every route with no path or "/"', () => {
    const { app } = setup();
    const trail: string[] = [];
    app.use(mark(trail, 'none'));
    app.use('/', mark(trail, 'root'));
    app.get('/', reply);
    app.get('/deep/er', reply);

    call(app, '/');
    call(app, '/deep/er');

    expect(trail).toEqual(['none', 'root', 'none', 'root']);
  });

  it('accepts arrays of middleware', () => {
    const { app } = setup();
    const trail: string[] = [];
    app.use([mark(trail, 'a'), [mark(trail, 'b')]]);
    app.get('/x', reply);

    call(app, '/x');

    expect(trail).toEqual(['a', 'b']);
  });

  it('supports parameters in a prefix', () => {
    const { app, router } = setup();
    const seen: unknown[] = [];
    app.use(
      '/orgs/:org',
      (req: TestRequest, _res: TestResponse, next: TestNext) => {
        seen.push(req.params);
        next();
      },
    );
    const orgs = router();
    orgs.get('/', reply);
    app.use('/orgs/:org', orgs);

    call(app, '/orgs/acme');

    expect(seen).toEqual([{ org: 'acme' }]);
  });
});

describe('mounted routers (R1, R3)', () => {
  it('mounts by reference, so routes added later are live', () => {
    const { app, router } = setup();
    const api = router();
    app.use('/api', api);
    api.get('/late', reply);

    expect(call(app, '/api/late')).toBe('ok');
  });

  it('picks up routers mounted into a sub-router after the fact', () => {
    const { app, router } = setup();
    const api = router();
    const v1 = router();
    app.use('/api', api);
    api.use('/v1', v1);
    v1.get('/ping', reply);

    expect(call(app, '/api/v1/ping')).toBe('ok');
  });

  it('strips the mount from req.path and grows req.baseUrl', () => {
    const { app, router } = setup();
    const api = router();
    const v1 = router();
    const seen: unknown[] = [];
    const spy: Handler = (req, res) => {
      seen.push([req.baseUrl, req.path, req.originalPath]);
      res.json(null);
    };
    app.use('/api', api);
    api.use('/v1', v1);
    v1.get('/ping', spy);

    call(app, '/api/v1/ping');

    expect(seen).toEqual([['/api/v1', '/ping', '/api/v1/ping']]);
  });

  it('restores path, baseUrl and params when leaving a router', () => {
    const { app, router } = setup();
    const api = router();
    const seen: unknown[] = [];
    api.use((_req: TestRequest, _res: TestResponse, next: TestNext) => next());
    app.use('/api', api);
    app.use((req: TestRequest, _res: TestResponse, next: TestNext) => {
      seen.push([req.baseUrl, req.path, req.params]);
      next();
    });
    app.get('/api/:id', reply);

    call(app, '/api/7');

    expect(seen).toEqual([['', '/api/7', {}]]);
  });

  it('restores the request after a router responds (middleware reads it after next)', () => {
    const { app, router } = setup();
    const api = router();
    const after: unknown[] = [];
    api.get('/x', reply);
    app.use((req: TestRequest, _res: TestResponse, next: TestNext) => {
      next();
      after.push([req.baseUrl, req.path]);
    });
    app.use('/api', api);

    call(app, '/api/x');

    expect(after).toEqual([['', '/api/x']]);
  });

  it('gives each layer its own params (no mergeParams)', () => {
    const { app, router } = setup();
    const posts = router();
    posts.get('/:post', (req: TestRequest, res: TestResponse) =>
      res.json(req.params),
    );
    app.use('/users/:id', posts);

    expect(call(app, '/users/1/9')).toEqual({ post: '9' });
  });

  it('mounts at the root', () => {
    const { app, router } = setup();
    const web = router();
    web.get('/', reply);
    web.get('/about', reply);
    app.use('/', web);

    expect(call(app, '/')).toBe('ok');
    expect(call(app, '/about')).toBe('ok');
  });

  it('mounts a router with no path', () => {
    const { app, router } = setup();
    const web = router();
    web.get('/about', reply);
    app.use(web);

    expect(call(app, '/about')).toBe('ok');
  });

  it('falls through a router that does not match', () => {
    const { app, router } = setup();
    const api = router();
    api.get('/a', reply);
    app.use('/api', api);
    app.get('/api/b', (_req: TestRequest, res: TestResponse) => res.json('b'));

    expect(call(app, '/api/b')).toBe('b');
  });
});

describe('next() (X5)', () => {
  it("skips the rest of a route with next('route')", () => {
    const { app } = setup();
    const trail: string[] = [];
    app.get(
      '/x',
      (_req: TestRequest, _res: TestResponse, next: TestNext) => next('route'),
      mark(trail, 'skipped'),
    );
    app.get('/x', (_req: TestRequest, res: TestResponse) => res.json('next'));

    expect(call(app, '/x')).toBe('next');
    expect(trail).toEqual([]);
  });

  it("does not treat next('route') as an error", () => {
    const { app } = setup();
    app.get('/x', (_req: TestRequest, _res: TestResponse, next: TestNext) =>
      next('route'),
    );

    expect(fail(app, '/x')).toMatchObject({ status: 404 });
  });

  it('ignores return values (A3)', () => {
    const { app } = setup();
    app.get('/x', () => ({ value: 1 }));

    expect(fail(app, '/x')).toMatchObject({ status: 500 });
  });
});

describe('error handling', () => {
  it('passes a thrown error to error middleware', () => {
    const { app } = setup();
    app.get('/x', () => {
      throw new Error('boom');
    });
    app.use(
      (err: Error, _req: TestRequest, res: TestResponse, _next: TestNext) =>
        res.status(500).json(err.message),
    );

    const result = app.doGet({ parameter: { route: '/x' } });

    expect(result).toEqual({ ok: true, status: 500, data: 'boom' });
  });

  it('passes next(err) to error middleware', () => {
    const { app } = setup();
    app.get('/x', (_req: TestRequest, _res: TestResponse, next: TestNext) =>
      next('bad'),
    );
    app.use(
      (err: unknown, _req: TestRequest, res: TestResponse, _next: TestNext) =>
        res.json(`caught ${String(err)}`),
    );

    expect(call(app, '/x')).toBe('caught bad');
  });

  it('skips normal middleware and routes while an error is pending', () => {
    const { app } = setup();
    const skipped = vi.fn();
    app.get('/x', () => {
      throw new Error('boom');
    });
    app.use(skipped);
    app.get('/x', skipped);
    app.use(
      (_err: unknown, _req: TestRequest, res: TestResponse, _next: TestNext) =>
        res.json('handled'),
    );

    expect(call(app, '/x')).toBe('handled');
    expect(skipped).not.toHaveBeenCalled();
  });

  it('lets error middleware pass the error on', () => {
    const { app } = setup();
    const trail: string[] = [];
    app.get('/x', () => {
      throw new Error('boom');
    });
    app.use(
      (err: unknown, _req: TestRequest, _res: TestResponse, next: TestNext) => {
        trail.push('first');
        next(err);
      },
    );
    app.use(
      (err: Error, _req: TestRequest, res: TestResponse, _next: TestNext) => {
        trail.push('second');
        res.json(err.message);
      },
    );

    expect(call(app, '/x')).toBe('boom');
    expect(trail).toEqual(['first', 'second']);
  });

  it('lets error middleware swap the error', () => {
    const { app, peers } = setup();
    const { GasForbiddenError } = peers as {
      GasForbiddenError: new (message: string) => Error;
    };
    app.get('/x', () => {
      throw new Error('boom');
    });
    app.use(
      (_err: unknown, _req: TestRequest, _res: TestResponse, next: TestNext) =>
        next(new GasForbiddenError('no')),
    );

    expect(fail(app, '/x')).toMatchObject({ status: 403 });
  });

  it('skips error middleware when there is no error', () => {
    const { app } = setup();
    const onError = vi.fn();
    app.use(
      (err: unknown, _req: TestRequest, _res: TestResponse, _next: TestNext) =>
        onError(err),
    );
    app.get('/x', reply);

    expect(call(app, '/x')).toBe('ok');
    expect(onError).not.toHaveBeenCalled();
  });

  it('handles errors raised in a mounted router in app-level error middleware', () => {
    const { app, router } = setup();
    const api = router();
    api.get('/x', () => {
      throw new Error('inner');
    });
    app.use('/api', api);
    app.use(
      (err: Error, _req: TestRequest, res: TestResponse, _next: TestNext) =>
        res.json(err.message),
    );

    expect(call(app, '/api/x')).toBe('inner');
  });

  it('runs error middleware inside a mounted router first', () => {
    const { app, router } = setup();
    const api = router();
    api.get('/x', () => {
      throw new Error('inner');
    });
    api.use(
      (_err: unknown, _req: TestRequest, res: TestResponse, _next: TestNext) =>
        res.json('router handled'),
    );
    app.use('/api', api);

    expect(call(app, '/api/x')).toBe('router handled');
  });

  it('runs error middleware within a route', () => {
    const { app } = setup();
    app.get(
      '/x',
      () => {
        throw new Error('boom');
      },
      (_err: unknown, _req: TestRequest, res: TestResponse, _next: TestNext) =>
        res.json('route handled'),
    );

    expect(call(app, '/x')).toBe('route handled');
  });

  it('turns an error thrown by error middleware into the pending error', () => {
    const { app } = setup();
    app.get('/x', () => {
      throw new Error('first');
    });
    app.use(() => undefined);
    app.use(
      (
        _err: unknown,
        _req: TestRequest,
        _res: TestResponse,
        _next: TestNext,
      ) => {
        throw new Error('second');
      },
    );

    expect(fail(app, '/x')).toMatchObject({ status: 500 });
  });

  it('defaults to the gas-error envelope for GasError', () => {
    const { app, peers } = setup();
    const { GasForbiddenError } = peers as {
      GasForbiddenError: new (message: string) => Error;
    };
    app.get('/x', () => {
      throw new GasForbiddenError('nope');
    });

    expect(fail(app, '/x')).toMatchObject({
      ok: false,
      status: 403,
      code: 'FORBIDDEN',
    });
  });
});

describe('final handler (R5)', () => {
  it('answers an unmatched path with Express wording', () => {
    const { app } = setup();

    expect(fail(app, '/missing')).toMatchObject({
      status: 404,
      error: 'Cannot GET /missing',
    });
  });

  it('answers a wrong method with a 404, not a 405', () => {
    const { app } = setup();
    app.get('/x', reply);

    expect(
      thrownEnvelope(() => app.doPost({ parameter: { route: '/x' } })),
    ).toMatchObject({ status: 404, error: 'Cannot POST /x' });
  });

  it('reports the full path for a request that fell through a router', () => {
    const { app, router } = setup();
    app.use('/api', router());

    expect(fail(app, '/api/nope')).toMatchObject({
      error: 'Cannot GET /api/nope',
    });
  });

  it('lets middleware see an unmatched request (R5)', () => {
    const { app } = setup();
    const seen = vi.fn((_req, _res, next: TestNext) => next());
    app.use(seen);

    fail(app, '/missing');

    expect(seen).toHaveBeenCalledOnce();
  });

  it('lets error middleware replace the 404', () => {
    const { app } = setup();
    app.use((_req: TestRequest, _res: TestResponse, next: TestNext) => next());

    expect(fail(app, '/missing')).toMatchObject({ status: 404 });
  });

  it('answers a handler that neither responds nor calls next with a 500', () => {
    const { app } = setup();
    app.get('/x', () => undefined);

    expect(fail(app, '/x')).toMatchObject({
      status: 500,
      error: 'Route did not respond: GET /x',
    });
  });

  it('accepts a handler that responds and also calls next', () => {
    const { app } = setup();
    app.get('/x', (_req: TestRequest, res: TestResponse, next: TestNext) => {
      res.json('ok');
      next();
    });

    expect(call(app, '/x')).toBe('ok');
  });
});

describe('response', () => {
  it('throws on a second response', () => {
    const { app } = setup();
    let second: unknown;
    app.get('/x', (_req: TestRequest, res: TestResponse) => {
      res.json(1);
      try {
        res.json(2);
      } catch (error) {
        second = error;
      }
    });

    expect(call(app, '/x')).toBe(1);
    expect((second as Error).message).toBe('Response already sent');
  });

  it('treats send after json as a second response', () => {
    const { app } = setup();
    app.get('/x', (_req: TestRequest, res: TestResponse) => {
      res.json(1);
      res.send('late');
    });

    expect(fail(app, '/x')).toMatchObject({ status: 500 });
  });

  it('carries status() in the envelope', () => {
    const { app } = setup();
    app.post('/x', (_req: TestRequest, res: TestResponse) =>
      res.status(201).json({ id: 1 }),
    );

    expect(app.doPost({ parameter: { route: '/x' } })).toEqual({
      ok: true,
      status: 201,
      data: { id: 1 },
    });
  });

  it('sends a string as text over HTTP', () => {
    const { app, mocks } = setup();
    app.get('/x', (_req: TestRequest, res: TestResponse) => res.send('hello'));

    const output = app.doGet({
      parameter: { route: '/x' },
      contextPath: '',
    }) as { getContent(): string; getMimeType(): string };

    expect(output.getContent()).toBe('hello');
    expect(output.getMimeType()).toBe('TEXT');
    expect(mocks.ContentService.createTextOutput).toHaveBeenCalledWith('hello');
  });

  it('sends a string as envelope data over RPC', () => {
    const { app } = setup();
    app.get('/x', (_req: TestRequest, res: TestResponse) => res.send('hello'));

    expect(app.doGet({ parameter: { route: '/x' } })).toEqual({
      ok: true,
      status: 200,
      data: 'hello',
    });
  });

  it('sends a non-string as JSON', () => {
    const { app } = setup();
    app.get('/x', (_req: TestRequest, res: TestResponse) => res.send({ a: 1 }));

    expect(call(app, '/x')).toEqual({ a: 1 });
  });

  it('merges res.locals into render data', () => {
    const { app, mocks } = setup({ views: { 'dist/web/views/home.html': '' } });
    app.use((_req: TestRequest, res: TestResponse, next: TestNext) => {
      res.locals.title = 'From locals';
      res.locals.keep = 'kept';
      next();
    });
    app.get('/', (_req: TestRequest, res: TestResponse) =>
      res.render('home', { title: 'From options' }),
    );

    app.doGet({ parameter: { route: '/' }, contextPath: '' });

    const template =
      mocks.HtmlService.createTemplateFromFile.mock.results[0]?.value;
    expect(template).toMatchObject({ title: 'From options', keep: 'kept' });
  });
});

describe('request', () => {
  const requestOf = (
    event: object,
    entry: 'doGet' | 'doPost' = 'doGet',
  ): TestRequest => {
    const { app } = setup();
    let seen!: TestRequest;
    app.all('/x', (req: TestRequest, res: TestResponse) => {
      seen = req;
      res.json(null);
    });
    app[entry](event);
    return seen;
  };

  it('describes an RPC request', () => {
    const req = requestOf({ parameter: { route: '/x/', a: '1' } });

    expect(req).toMatchObject({
      method: 'GET',
      path: '/x',
      originalPath: '/x',
      baseUrl: '',
      query: { a: '1' },
      transport: 'rpc',
      id: 'uuid-1',
    });
  });

  it('describes an HTTP request', () => {
    const req = requestOf({ parameter: { route: '/x' }, contextPath: '' });

    expect(req.transport).toBe('http');
  });

  it('defaults the path to the root', () => {
    const { app } = setup();
    app.get('/', (req: TestRequest, res: TestResponse) => res.json(req.path));

    expect(app.doGet({ parameter: {} })).toMatchObject({ data: '/' });
  });

  it('exposes the raw event', () => {
    const event = { parameter: { route: '/x' } };

    expect(requestOf(event).raw).toBe(event);
  });

  it('keeps `route` and `_method` out of the query', () => {
    const req = requestOf(
      { parameter: { route: '/x', _method: 'put', q: 'v' } },
      'doPost',
    );

    expect(req.query).toEqual({ q: 'v' });
  });
});

describe('method override (X6)', () => {
  const methodOf = (
    entry: 'doGet' | 'doPost',
    parameter: object,
    contextPath?: string,
  ): unknown => {
    const { app } = setup();
    app.all('/x', (req: TestRequest, res: TestResponse) =>
      res.json(req.method),
    );
    const event = { parameter: { route: '/x', ...parameter }, contextPath };
    return (app[entry](event) as { data: unknown }).data;
  };

  it.each(['PUT', 'PATCH', 'DELETE', 'put', 'Delete'])(
    'dispatches a POST with _method=%s as that method',
    (value) => {
      expect(methodOf('doPost', { _method: value })).toBe(value.toUpperCase());
    },
  );

  it('routes the overridden method', () => {
    const { app } = setup();
    app.put('/x', (_req: TestRequest, res: TestResponse) => res.json('put'));
    app.delete('/x', (_req: TestRequest, res: TestResponse) =>
      res.json('delete'),
    );
    app.patch('/x', (_req: TestRequest, res: TestResponse) =>
      res.json('patch'),
    );

    const send = (method: string) =>
      (
        app.doPost({
          parameter: { route: '/x', _method: method },
        }) as { data: string }
      ).data;

    expect([send('PUT'), send('DELETE'), send('PATCH')]).toEqual([
      'put',
      'delete',
      'patch',
    ]);
  });

  it('leaves a POST without _method as POST', () => {
    expect(methodOf('doPost', {})).toBe('POST');
  });

  it.each(['GET', 'POST', 'TRACE', ''])(
    'rejects _method=%j with a 400',
    (value) => {
      const { app } = setup();
      app.all('/x', reply);

      expect(
        thrownEnvelope(() =>
          app.doPost({ parameter: { route: '/x', _method: value } }),
        ),
      ).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    },
  );

  it('ignores _method on GET, even an invalid one', () => {
    expect(methodOf('doGet', { _method: 'DELETE' })).toBe('GET');
    expect(methodOf('doGet', { _method: 'bogus' })).toBe('GET');
  });

  it('works over HTTP', () => {
    const { app } = setup();
    app.put('/x', (_req: TestRequest, res: TestResponse) => res.json('put'));

    const output = app.doPost({
      parameter: { route: '/x', _method: 'PUT' },
      contextPath: '',
    }) as { getContent(): string };

    expect(JSON.parse(output.getContent()).data).toBe('put');
  });

  it('answers an invalid override over HTTP with a 400 envelope', () => {
    const { app } = setup();

    const output = app.doPost({
      parameter: { route: '/x', _method: 'x' },
      contextPath: '',
    }) as { getContent(): string };

    expect(JSON.parse(output.getContent())).toMatchObject({ status: 400 });
  });
});

describe('session id (L4)', () => {
  it('passes req.user.email set by middleware to the error handler', () => {
    const { app, mocks } = setup();
    app.use((req: TestRequest, _res: TestResponse, next: TestNext) => {
      req.user = { email: 'a@b.c' };
      next();
    });
    app.get('/x', () => {
      throw new Error('boom');
    });

    fail(app, '/x');

    expect(mocks.console.error.mock.calls[0]?.[1]).toMatchObject({
      sessionId: 'a@b.c',
    });
  });
});
