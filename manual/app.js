/**
 * Fixture app for the manual web app checks in manual/README.md.
 *
 * Pushed by `npm run manual:build` after the bundled peers and the compiled
 * library, as a global-scope Apps Script file. It uses the README's own
 * pattern, `const doGet = webApp.doGet`, so a deployment also checks that.
 */
const webApp = new GasWebApp({
  logger: console,
  errorView: 'error',
  static: {
    dirs: { html: 'views', js: 'public' },
    extensions: { html: '.html', js: '.html' },
  },
});

// app.locals < res.locals < render options: each marker is set at one more
// level than the last, so the page shows which level won.
webApp.locals.fromApp = 'app';
webApp.locals.fromRes = 'app';
webApp.locals.fromOptions = 'app';

/** What the echo routes return: the request as the handlers saw it. */
const describeRequest = (req) => ({
  method: req.method,
  path: req.originalPath,
  params: req.params,
  query: req.query,
  body: req.body,
  transport: req.transport,
  contentType: req.raw.postData ? req.raw.postData.type : null,
  event: {
    pathInfo: req.raw.pathInfo,
    contextPath: req.raw.contextPath,
  },
});

const echo = (req, res) => res.json(describeRequest(req));

// The ack route goes first so the middleware below does not apply to it.
const ack = createAckTracker();
webApp.get('/ack', ack.handler);
webApp.use(ack.middleware);
webApp.use(createLoggingMiddleware(console));

webApp.use((req, res, next) => {
  res.locals.fromRes = 'res';
  res.locals.fromOptions = 'res';
  next();
});

// API routes
webApp.get('/', (req, res) =>
  res.json({
    fixture: 'gas-webapp manual checks',
    routes: [
      'GET /users/:id',
      'POST /echo',
      'DELETE /items/:id',
      'GET /page',
      'GET /bare',
      'GET /client',
      'GET /redirect',
      'GET /boom',
      'POST /boom',
      'GET /teapot',
      'GET /slow',
    ],
  }),
);
webApp.get('/users/:id', echo);
webApp.post('/echo', echo);
webApp.delete('/items/:id', echo);
webApp.get('/slow', (req, res) => {
  Utilities.sleep(5000);
  res.json({ slept: 5000 });
});

// Pages
webApp.get('/page', (req, res) =>
  res.render('home', {
    layout: 'layout',
    title: 'Page with layout',
    fromOptions: 'options',
  }),
);
webApp.get('/bare', (req, res) =>
  res.render('home', { title: 'Page without layout', fromOptions: 'options' }),
);
webApp.get('/client', (req, res) =>
  res.render('client', { layout: 'layout', title: 'Browser client' }),
);
webApp.get('/redirect', (req, res) => res.redirect('https://example.com/'));

// Errors: GET renders the error view, POST keeps the JSON envelope, and the
// error view throws for status 418, which falls back to the JSON envelope.
webApp.get('/boom', () => {
  throw new Error('boom');
});
webApp.post('/boom', () => {
  throw new Error('boom');
});
webApp.get('/teapot', () => {
  throw new GasError('I am a teapot', { statusCode: 418 });
});

const doGet = webApp.doGet;
const doPost = webApp.doPost;
