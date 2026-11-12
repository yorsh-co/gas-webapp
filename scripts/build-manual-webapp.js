/**
 * Assembles the manual web app fixture into `.manual-webapp/`, a folder that
 * `clasp push` can send to a throwaway Apps Script project.
 *
 * Run through `npm run manual:build`, which compiles the library first. The
 * target project is read from MANUAL_WEBAPP_SCRIPT_ID, so no ID is stored in
 * the repository. See manual/README.md.
 */
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from 'gasdev/bundle';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, '.manual-webapp');
const CLIENT_FILES = [
  'gas-webapp.config',
  'gas-webapp.errors',
  'gas-webapp.client',
];

const scriptId = process.env.MANUAL_WEBAPP_SCRIPT_ID;
if (!scriptId) {
  console.error('MANUAL_WEBAPP_SCRIPT_ID is not set (the throwaway project).');
  process.exit(1);
}

const { gasdev } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

/** Writes `content` to `path` under the output folder, creating directories. */
function emit(path, content) {
  const target = join(OUT, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

/**
 * Wraps a compiled client file in a `<script>` block, the shape `webApp.js()`
 * includes. HtmlService evaluates scriptlets in included files and ends the
 * block at `</script`, so a file containing either cannot be embedded as is.
 */
function wrapScript(name) {
  const code = readFileSync(join(ROOT, 'dist/web', `${name}.js`), 'utf8');
  if (code.includes('<?') || /<\/script/i.test(code)) {
    throw new Error(`${name}.js contains a scriptlet or </script tag`);
  }
  return `<script>\n${code}</script>\n`;
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// Peers, bundled from their release tags as a consumer would.
emit(
  'lib/gas-libraries.js',
  bundle({ libraries: gasdev.peers, cwd: ROOT }).code,
);

// The compiled library, one file each, in load order.
const libraryFiles = gasdev.loadOrder.map((file) => {
  const compiled = file.replace(/\.ts$/, '.js');
  const target = `lib/gas-webapp/${compiled}`;
  emit(target, readFileSync(join(ROOT, 'dist', compiled), 'utf8'));
  return target;
});

// The browser client as script partials, included by manual/views/client.html.
for (const name of CLIENT_FILES) {
  emit(`public/${name}.html`, wrapScript(name));
}

cpSync(join(ROOT, 'manual/app.js'), join(OUT, 'app.js'));
cpSync(join(ROOT, 'manual/views'), join(OUT, 'views'), { recursive: true });
cpSync(join(ROOT, 'manual/appsscript.json'), join(OUT, 'appsscript.json'));

emit(
  '.clasp.json',
  `${JSON.stringify(
    {
      scriptId,
      rootDir: '.',
      filePushOrder: ['lib/gas-libraries.js', ...libraryFiles, 'app.js'],
    },
    null,
    2,
  )}\n`,
);

// Apps Script rejects a file that does not parse, but only on push.
for (const file of ['lib/gas-libraries.js', ...libraryFiles, 'app.js']) {
  execFileSync(process.execPath, ['--check', join(OUT, file)]);
}

console.log(`✓ Built ${OUT}\n  Next: cd .manual-webapp && npx clasp push`);
