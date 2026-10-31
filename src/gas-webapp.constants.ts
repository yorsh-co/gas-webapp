/** Default static-asset layout. Consumers override via GasWebAppConfig.static. */
const GAS_WEBAPP_DEFAULT_STATIC_DIRS: Record<StaticFileType, string> = {
  html: 'dist/web/views',
  js: 'dist/web/public/js',
  css: 'dist/web/public/css',
};

const GAS_WEBAPP_DEFAULT_STATIC_EXTENSIONS: Record<StaticFileType, string> = {
  html: '.html',
  js: '.js.html',
  css: '.css.html',
};

/** Error codes by status, as `gas-error` derives them; any other status is `INTERNAL_ERROR`. */
const GAS_WEBAPP_ERROR_CODES: Record<number, string> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'RATE_LIMITED',
};

/** Message of an error-status `res.json()` whose data carries no string `message`. */
const GAS_WEBAPP_DEFAULT_ERROR_MESSAGE = 'Request failed';

/** Status at and above which `res.json()` sends the error envelope. */
const GAS_WEBAPP_ERROR_STATUS_MIN = 400;

/** Status recorded by `res.redirect()` when none is given. */
const GAS_WEBAPP_DEFAULT_REDIRECT_STATUS = 302;
