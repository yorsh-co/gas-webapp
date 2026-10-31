/** Default static-asset layout. Consumers override via GasWebAppConfig.static. */
declare const GAS_WEBAPP_DEFAULT_STATIC_DIRS: Record<StaticFileType, string>;
declare const GAS_WEBAPP_DEFAULT_STATIC_EXTENSIONS: Record<
  StaticFileType,
  string
>;
/** Error codes by status, as `gas-error` derives them; any other status is `INTERNAL_ERROR`. */
declare const GAS_WEBAPP_ERROR_CODES: Record<number, string>;
/** Message of an error-status `res.json()` whose data carries no string `message`. */
declare const GAS_WEBAPP_DEFAULT_ERROR_MESSAGE = 'Request failed';
/** Status at and above which `res.json()` sends the error envelope. */
declare const GAS_WEBAPP_ERROR_STATUS_MIN = 400;
/** Status recorded by `res.redirect()` when none is given. */
declare const GAS_WEBAPP_DEFAULT_REDIRECT_STATUS = 302;
