/** Event shaped like a `google.script.run` call: no `contextPath`. */
const rpcEvent = (route: string): GoogleAppsScript.Events.DoGet =>
  ({ parameter: { route } }) as unknown as GoogleAppsScript.Events.DoGet;

/** Event shaped like a real web app request: `contextPath` is present. */
const httpEvent = (route: string): GoogleAppsScript.Events.DoGet =>
  ({
    parameter: { route },
    contextPath: '',
  }) as unknown as GoogleAppsScript.Events.DoGet;

const createTestApp = (): GasWebApp => {
  const app = new GasWebApp();
  app.get('ping', () => ({ pong: true }));
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
  app.post('echo', (request) => ({ body: request.body }));
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

test('an HtmlResponse over RPC is rejected, and over HTTP served as HTML', () => {
  const app = new GasWebApp();
  app.get(
    'page',
    () => new HtmlResponse(HtmlService.createHtmlOutput('<p>x</p>')),
  );

  let message: string | undefined;
  try {
    app.doGet(rpcEvent('page'));
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assert(message !== undefined, 'expected the RPC request to throw');
  assert(JSON.parse(message).status === 403, 'expected a 403 envelope');

  const output = app.doGet(
    httpEvent('page'),
  ) as GoogleAppsScript.HTML.HtmlOutput;
  assert(output.getContent() === '<p>x</p>', 'HTTP should serve the HTML');
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
  const run = createAuthMiddleware({ isAuthorized: () => false })(() => 'ok');
  let message: string | undefined;
  try {
    run({} as RouteRequest);
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
  const request = {} as RouteRequest;

  assert(limiter(() => 'a')(request) === 'a', 'first call should pass');
  assert(limiter(() => 'b')(request) === 'b', 'slot should have been released');
  CacheService.getScriptCache().remove(`concurrency:${key}`);
});
