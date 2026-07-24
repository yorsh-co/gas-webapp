#!/usr/bin/env node

import pkg from '../package.json' with { type: 'json' };

const KEEP_FIELDS = [
  'name',
  'version',
  'description',
  'license',
  'author',
  'repository',
  'homepage',
];

const releasePkg = Object.fromEntries(
  KEEP_FIELDS.filter((field) => field in pkg).map((field) => [
    field,
    pkg[field],
  ]),
);

process.stdout.write(`${JSON.stringify(releasePkg, null, 2)}\n`);
