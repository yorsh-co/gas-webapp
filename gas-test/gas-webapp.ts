/** Event shaped like a `google.script.run` call: no `contextPath`. */
const rpcEvent = (route: string): GoogleAppsScript.Events.DoGet =>
  ({ parameter: { route } }) as unknown as GoogleAppsScript.Events.DoGet;

/** Event shaped like a real web app request: `contextPath` is present. */
const httpEvent = (route: string): GoogleAppsScript.Events.DoGet =>
  ({
    parameter: { route },
    contextPath: '',
  }) as unknown as GoogleAppsScript.Events.DoGet;

/** Runs `fn` and returns the error envelope carried by the thrown message. */
const thrownEnvelope = (fn: () => unknown): Record<string, unknown> => {
  try {
    fn();
  } catch (error) {
    return JSON.parse(error instanceof Error ? error.message : String(error));
  }
  throw new Error('expected the call to throw');
};

const createTestApp = (): GasWebApp => {
  const app = new GasWebApp();
  app.get('ping', (_req, res) => res.json({ pong: true }));
  return app;
};

test('bundled peers and gas-webapp load', () => {
  assert(typeof GasError === 'function', 'GasError should be defined');
  assert(
    typeof GasNotFoundError === 'function',
    'GasNotFoundError should be defined',
  );
  assert(typeof GasLock === 'object', 'GasLock should be defined');
  assert(typeof GasLogger === 'function', 'GasLogger should be defined');
  assert(typeof GasWebApp === 'function', 'GasWebApp should be defined');
  assert(
    typeof GasWebAppRouter === 'function',
    'GasWebAppRouter should be defined',
  );
});

test('RPC request returns the success envelope', () => {
  const result = createTestApp().doGet(rpcEvent('ping')) as SuccessPayload;
  assert(
    JSON.stringify(result) ===
      JSON.stringify({ ok: true, status: 200, data: { pong: true } }),
    `unexpected payload: ${JSON.stringify(result)}`,
  );
});

test('RPC request for an unknown route throws the error envelope', () => {
  let message: string | undefined;
  try {
    createTestApp().doGet(rpcEvent('missing'));
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assert(message !== undefined, 'expected the request to throw');

  const envelope = JSON.parse(message);
  assert(envelope.ok === false, 'envelope should have ok: false');
  assert(envelope.status === 404, `expected 404, got ${envelope.status}`);
  assert(
    envelope.code === 'NOT_FOUND',
    `expected NOT_FOUND, got ${envelope.code}`,
  );
});

test('HTTP request returns JSON through ContentService', () => {
  const output = createTestApp().doGet(
    httpEvent('ping'),
  ) as GoogleAppsScript.Content.TextOutput;
  assert(
    output.getMimeType() === ContentService.MimeType.JSON,
    'response should be served as JSON',
  );
  assert(
    JSON.parse(output.getContent()).data.pong === true,
    'body should carry the handler result',
  );
});

const postEvent = (
  contents: string,
  type: string,
  http = true,
): GoogleAppsScript.Events.DoPost =>
  ({
    parameter: { route: 'echo' },
    ...(http ? { contextPath: '' } : {}),
    postData: { contents, type },
  }) as unknown as GoogleAppsScript.Events.DoPost;

const createEchoApp = (): GasWebApp => {
  const app = new GasWebApp();
  app.post('echo', (req, res) => res.json({ body: req.body }));
  return app;
};

test('HTTP request with an invalid JSON body returns a JSON error envelope', () => {
  const output = createEchoApp().doPost(
    postEvent('{oops', 'application/json'),
  ) as GoogleAppsScript.Content.TextOutput;
  assert(
    output.getMimeType() === ContentService.MimeType.JSON,
    'response should be served as JSON',
  );

  const envelope = JSON.parse(output.getContent());
  assert(envelope.ok === false, 'envelope should have ok: false');
  assert(envelope.status === 400, `expected 400, got ${envelope.status}`);
});

test('HTTP request body is parsed by content type', () => {
  const body = (contents: string, type: string): unknown =>
    JSON.parse(
      (
        createEchoApp().doPost(
          postEvent(contents, type),
        ) as GoogleAppsScript.Content.TextOutput
      ).getContent(),
    ).data.body;

  assert(
    body('{"a":1}', 'application/json; charset=utf-8') !== undefined,
    'JSON with parameters should be parsed',
  );
  assert(
    body('a=1', 'application/x-www-form-urlencoded') === undefined,
    'form bodies should be left to e.parameter',
  );
  assert(
    body('plain', 'text/plain') === 'plain',
    'other types should stay raw strings',
  );
});

test('res.render over RPC is rejected, and over HTTP served as HTML', () => {
  const app = new GasWebApp();
  app.get('page', (_req, res) => res.send('<p>x</p>'));
  app.get('view', (_req, res) => res.render('page', { layout: null }));

  let message: string | undefined;
  try {
    app.doGet(rpcEvent('view'));
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assert(message !== undefined, 'expected the RPC request to throw');
  assert(JSON.parse(message).status === 403, 'expected a 403 envelope');

  const output = app.doGet(
    httpEvent('page'),
  ) as GoogleAppsScript.Content.TextOutput;
  assert(output.getContent() === '<p>x</p>', 'HTTP should serve the text');
});

test('resolveStaticFilePath tolerates a missing or extra leading slash', () => {
  const app = new GasWebApp();
  for (const path of ['app', '/app', ' /app ']) {
    const resolved = app.resolveStaticFilePath('js', path);
    assert(
      resolved === 'dist/web/public/js/app.js.html',
      `unexpected path for "${path}": ${resolved}`,
    );
  }
});

test('auth middleware identifies the real signed-in user', () => {
  const run = createAuthMiddleware({ isAuthorized: () => false });
  let message: string | undefined;
  try {
    run({} as GasWebAppRequest, new GasWebAppResponse('rpc', () => ''), () => {
      throw new Error('should not continue');
    });
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assert(
    message === 'Not authorized' ||
      message === 'Unable to identify the signed-in user',
    `unexpected message: ${message}`,
  );
});

test('concurrency limiter releases its slot against the real services', () => {
  const key = `gas-test-${Utilities.getUuid()}`;
  const limiter = createConcurrencyLimiter({
    limit: 1,
    lockScope: 'script',
    keyFn: () => key,
  });
  const req = {} as GasWebAppRequest;
  const res = new GasWebAppResponse('rpc', () => '');
  const calls: string[] = [];

  limiter(req, res, () => calls.push('a'));
  limiter(req, res, () => calls.push('b'));

  assert(calls.join() === 'a,b', 'the slot should have been released');
  CacheService.getScriptCache().remove(`concurrency:${key}`);
});

test('a request runs through nested routers, a path param and error middleware', () => {
  const app = new GasWebApp();
  const users = new GasWebAppRouter();
  const api = new GasWebAppRouter();

  users.get('/:id', (req, res) => {
    if (req.params.id === '0') throw new GasNotFoundError('No such user');
    res.json({ id: req.params.id, base: req.baseUrl, path: req.path });
  });
  api.use('/users', users);
  app.use('/api', api);
  app.use(
    (
      err: unknown,
      _req: GasWebAppRequest,
      res: GasWebAppResponse,
      next: GasWebAppNext,
    ) => {
      if (err instanceof GasNotFoundError) {
        res.status(404).json({ missing: err.message });
        return;
      }
      next(err);
    },
  );

  const found = app.doGet(rpcEvent('/api/users/42')) as SuccessPayload;
  assert(
    JSON.stringify(found) ===
      JSON.stringify({
        ok: true,
        status: 200,
        data: { id: '42', base: '/api/users', path: '/42' },
      }),
    `unexpected payload: ${JSON.stringify(found)}`,
  );

  const missing = thrownEnvelope(() => app.doGet(rpcEvent('/api/users/0')));
  assert(
    missing.status === 404 &&
      JSON.stringify(missing.details) === '{"missing":"No such user"}',
    `error middleware should answer: ${JSON.stringify(missing)}`,
  );

  let message: string | undefined;
  try {
    app.doGet(rpcEvent('/api/users'));
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assert(message !== undefined, 'expected the unmatched request to throw');
  assert(JSON.parse(message).error === 'Cannot GET /api/users', message);
});

test('a POST with _method=DELETE is dispatched as DELETE', () => {
  const app = new GasWebApp();
  app.delete('/items/:id', (req, res) => res.json(req.params.id));

  const result = app.doPost({
    parameter: { route: '/items/7', _method: 'delete' },
  } as unknown as GoogleAppsScript.Events.DoPost) as SuccessPayload;

  assert(result.data === '7', `unexpected payload: ${JSON.stringify(result)}`);
});

test('doGet resolves the route from pathInfo, and route wins when both are present', () => {
  const app = new GasWebApp();
  app.get('/users/:id', (req, res) => res.json(req.params.id));
  app.get('/other', (_req, res) => res.json('other'));

  const event = (
    parameter: Record<string, string>,
    pathInfo?: string,
  ): GoogleAppsScript.Events.DoGet =>
    ({ parameter, pathInfo }) as unknown as GoogleAppsScript.Events.DoGet;

  const fromPath = app.doGet(event({}, 'users/42')) as SuccessPayload;
  assert(fromPath.data === '42', `unexpected: ${JSON.stringify(fromPath)}`);

  const both = app.doGet(
    event({ route: '/other' }, 'users/42'),
  ) as SuccessPayload;
  assert(both.data === 'other', `route should win: ${JSON.stringify(both)}`);

  const post = thrownEnvelope(() =>
    app.doPost({
      parameter: {},
      pathInfo: 'users/42',
    } as unknown as GoogleAppsScript.Events.DoPost),
  );
  assert(post.status === 404, 'doPost must not read pathInfo');
});

test('the idempotency guard runs once, replays, and clears on failure', () => {
  const key = Utilities.getUuid();
  const cacheKey = `idem:${key}`;
  const cache = CacheService.getScriptCache();
  const app = new GasWebApp();
  let runs = 0;
  let fail = true;
  app.use(createIdempotencyGuard({ lockScope: 'script' }));
  app.post('/charge', (_req, res) => {
    runs += 1;
    if (fail) throw new Error('boom');
    res.status(201).json({ runs });
  });

  const call = (): SuccessPayload =>
    app.doPost({
      parameter: { route: '/charge', idempotencyKey: key },
    } as unknown as GoogleAppsScript.Events.DoPost) as SuccessPayload;

  assert(thrownEnvelope(call).status === 500, 'the first call should fail');
  assert(cache.get(cacheKey) === null, 'a failure should clear the marker');

  fail = false;
  const first = call();
  const second = call();
  assert(runs === 2, `the handler should run once more, ran ${runs}`);
  assert(first.status === 201 && first.data !== undefined, 'first call');
  assert(
    JSON.stringify(second) === JSON.stringify(first),
    `replay should match: ${JSON.stringify(second)}`,
  );
  cache.remove(cacheKey);
});

test('the ack middleware records a call that its route then reports once', () => {
  const callId = Utilities.getUuid();
  const ack = createAckTracker({ ttlSeconds: 30 });
  const app = new GasWebApp();
  app.get('/ack', ack.handler);
  app.use(ack.middleware);
  app.get('/work', (_req, res) => res.json('done'));

  app.doGet({
    parameter: { route: '/work', callId },
  } as unknown as GoogleAppsScript.Events.DoGet);

  const poll = (): unknown =>
    (
      app.doGet({
        parameter: { route: '/ack', callIds: callId },
      } as unknown as GoogleAppsScript.Events.DoGet) as SuccessPayload
    ).data;

  assert(JSON.stringify(poll()) === JSON.stringify([callId]), 'not recorded');
  assert(JSON.stringify(poll()) === '[]', 'the id should be forgotten');
});

test('the rate limiter counts in CacheService and rejects with retryAfterSeconds', () => {
  const key = `gas-test-${Utilities.getUuid()}`;
  const app = new GasWebApp();
  app.get(
    '/limited',
    createRateLimiter({
      limit: 1,
      windowSeconds: 30,
      keyFn: () => key,
    }),
    (_req, res) => res.json('ok'),
  );

  const first = app.doGet(rpcEvent('/limited')) as SuccessPayload;
  assert(first.data === 'ok', 'the first request should pass');

  const rejected = thrownEnvelope(() => app.doGet(rpcEvent('/limited')));
  const details = rejected.details as { retryAfterSeconds?: number };
  assert(rejected.status === 429, `expected 429, got ${rejected.status}`);
  assert(
    typeof details.retryAfterSeconds === 'number' &&
      details.retryAfterSeconds >= 1 &&
      details.retryAfterSeconds <= 30,
    `unexpected details: ${JSON.stringify(rejected.details)}`,
  );
});

test('the limiters fail with 429 when their lock cannot be acquired', () => {
  const heldElsewhere = {
    getLock: () =>
      ({
        tryLock: () => false,
        releaseLock: () => {},
      }) as unknown as GoogleAppsScript.Lock.Lock,
  };
  const key = `gas-test-${Utilities.getUuid()}`;
  const app = new GasWebApp();
  const reply: GasWebAppHandler = (_req, res) => res.json('ok');
  app.get(
    '/rate',
    createRateLimiter({
      limit: 10,
      windowSeconds: 30,
      keyFn: () => key,
      lockService: heldElsewhere,
    }),
    reply,
  );
  app.get(
    '/concurrency',
    createConcurrencyLimiter({
      limit: 10,
      keyFn: () => key,
      lockService: heldElsewhere,
    }),
    reply,
  );

  for (const route of ['/rate', '/concurrency']) {
    const envelope = thrownEnvelope(() => app.doGet(rpcEvent(route)));
    assert(envelope.status === 429, `${route}: ${JSON.stringify(envelope)}`);
  }
});

info('a second script lock handle while one is held', () => {
  const first = LockService.getScriptLock();
  first.waitLock(5000);
  try {
    const second = LockService.getScriptLock();
    return `second tryLock: ${second.tryLock(100)}`;
  } finally {
    first.releaseLock();
  }
});

info('Session email availability', () => {
  const active = Session.getActiveUser().getEmail();
  const effective = Session.getEffectiveUser().getEmail();
  return `active: ${active ? 'available' : 'empty'}, effective: ${
    effective ? 'available' : 'empty'
  }`;
});
