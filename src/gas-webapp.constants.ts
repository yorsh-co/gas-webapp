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
