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
