'use strict';
const GAS_WEBAPP_PARAM_NAME = /^[A-Za-z_$][\w$]*/;
const GAS_WEBAPP_RESERVED_PATH_CHARS = '()[]?+!';
/** Normalises a request path: leading `/`, no repeated or trailing slashes. */
const gasWebAppNormalizePath = (path) =>
  `/${path.split('/').filter(Boolean).join('/')}`;
/**
 * Compiles a path pattern to a case-insensitive matcher. Syntax follows
 * Express 5 (path-to-regexp v8): `:name` matches one segment, `*name` the rest
 * of the path including slashes, and `{...}` is optional. A trailing slash is
 * optional. With `end: false` the pattern matches a prefix, on segment
 * boundaries.
 *
 * Matching has the semantics of the regexp `^…/?$` (or `^…(?=/|$)` for a
 * prefix) with `:name` as `([^/]+)`, `*name` as `(.+)` and `{…}` as `(?:…)?`,
 * and explores alternatives in the same order. Each (instruction, position)
 * pair is tried at most once, since a pair that failed fails again, so the
 * time is linear in the path length however many parameters share a segment.
 *
 * @throws {TypeError} When the pattern is malformed or uses unsupported syntax.
 */
const gasWebAppCompilePath = (pattern, end) => {
  const source = gasWebAppNormalizePath(pattern);
  const names = [];
  const ops = [];
  let text = '';
  let index = 0;
  const flushText = () => {
    if (!text) return;
    ops.push({
      type: 'text',
      regexp: new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'iy'),
      length: text.length,
    });
    text = '';
  };
  const readName = () => {
    const name = GAS_WEBAPP_PARAM_NAME.exec(source.slice(index + 1))?.[0];
    if (!name) {
      throw new TypeError(`Missing parameter name at ${index} in "${pattern}"`);
    }
    index += name.length + 1;
    return name;
  };
  const parse = (inGroup) => {
    while (index < source.length) {
      const char = source[index];
      if (char === '}') {
        if (!inGroup) {
          throw new TypeError(`Unexpected "}" at ${index} in "${pattern}"`);
        }
        return;
      }
      if (char === '{') {
        flushText();
        const split = {
          type: 'split',
          first: ops.length + 1,
          second: 0,
        };
        ops.push(split);
        index += 1;
        parse(true);
        if (source[index] !== '}') {
          throw new TypeError(`Unterminated "{" in "${pattern}"`);
        }
        index += 1;
        flushText();
        split.second = ops.length;
      } else if (char === ':' || char === '*') {
        flushText();
        const slot = names.push(readName()) * 2 - 2;
        const loop = ops.length + 1;
        ops.push(
          { type: 'save', slot },
          { type: 'char', wildcard: char === '*' },
          { type: 'split', first: loop, second: loop + 2 },
          { type: 'save', slot: slot + 1 },
        );
      } else if (GAS_WEBAPP_RESERVED_PATH_CHARS.includes(char)) {
        throw new TypeError(
          `Unsupported "${char}" at ${index} in "${pattern}"`,
        );
      } else {
        text += char === '\\' ? (source[++index] ?? '') : char;
        index += 1;
      }
    }
    if (inGroup) throw new TypeError(`Unterminated "{" in "${pattern}"`);
  };
  parse(false);
  // The root pattern compiles to no instructions, so `/` itself is optional.
  if (ops.length === 0 && text === '/') text = '';
  flushText();
  /** Whether the pattern may end at `at`: the whole path or a segment boundary. */
  const accepts = (path, at) =>
    end
      ? at === path.length || (at === path.length - 1 && path[at] === '/')
      : at === path.length || path[at] === '/';
  /**
   * Runs the instructions depth-first, preferred alternative first, and
   * returns the match length with the captures left in `slots`, or -1.
   */
  const run = (path, slots) => {
    const width = ops.length + 1;
    const visited = new Uint32Array(
      Math.ceil((width * (path.length + 1)) / 32),
    );
    // (instruction, position) pairs to resume from, most preferred last. A
    // negative instruction `-n - 1` restores slot n to the position instead.
    const stack = [0, 0];
    while (stack.length > 0) {
      let at = stack.pop();
      let pc = stack.pop();
      if (pc < 0) {
        slots[-pc - 1] = at;
        continue;
      }
      for (;;) {
        const state = at * width + pc;
        const word = Math.floor(state / 32);
        const bit = 1 << (state % 32);
        if (visited[word] & bit) break;
        visited[word] = visited[word] | bit;
        const op = ops[pc];
        if (!op) {
          if (accepts(path, at)) return end ? path.length : at;
          break;
        }
        if (op.type === 'text') {
          op.regexp.lastIndex = at;
          if (!op.regexp.test(path)) break;
          at += op.length;
          pc += 1;
        } else if (op.type === 'char') {
          const code = path.charCodeAt(at);
          const allowed = op.wildcard
            ? code !== 0x0a &&
              code !== 0x0d &&
              code !== 0x2028 &&
              code !== 0x2029
            : code !== 0x2f;
          if (at >= path.length || !allowed) break;
          at += 1;
          pc += 1;
        } else if (op.type === 'split') {
          stack.push(op.second, at);
          pc = op.first;
        } else {
          stack.push(-op.slot - 1, slots[op.slot]);
          slots[op.slot] = at;
          pc += 1;
        }
      }
    }
    return -1;
  };
  return {
    match(path) {
      const slots = names.flatMap(() => [-1, -1]);
      const length = run(path, slots);
      if (length < 0) return null;
      const params = {};
      names.forEach((name, i) => {
        const start = slots[2 * i];
        if (start < 0) return;
        try {
          params[name] = decodeURIComponent(
            path.slice(start, slots[2 * i + 1]),
          );
        } catch {
          throw new GasValidationError(
            `Invalid encoding in parameter "${name}"`,
          );
        }
      });
      return { params, length };
    },
  };
};
/**
 * An ordered stack of layers, like an Express router. `use`, `get`, `post`,
 * `put`, `patch`, `delete` and `all` interleave in registration order, and
 * `next()` walks the stack synchronously. Mounted routers are held by
 * reference, so routes added to them later are live.
 *
 * Paths use the Express 5 syntax: `/users/:id`, `/files/*path` and optional
 * groups such as `/users{/:id}`. Wildcard and named parameters arrive as
 * strings.
 *
 *   const api = new GasWebAppRouter();
 *   api.get('/users{/:id}', (req, res) => res.json(users.find(req.params.id)));
 *   app.use('/api', api);
 */
class GasWebAppRouter {
  constructor() {
    this._layers = [];
  }
  use(...args) {
    const path = typeof args[0] === 'string' ? args.shift() : '/';
    for (const fn of this._flatten(args)) {
      this._layers.push({
        method: null,
        matcher: gasWebAppCompilePath(path, false),
        isRoute: false,
        fns: [fn],
      });
    }
    return this;
  }
  /** Registers handlers for GET requests to `path`. */
  get(path, ...handlers) {
    return this._route('GET', path, handlers);
  }
  /** Registers handlers for POST requests to `path`. */
  post(path, ...handlers) {
    return this._route('POST', path, handlers);
  }
  /** Registers handlers for PUT requests (a POST with `_method=PUT`). */
  put(path, ...handlers) {
    return this._route('PUT', path, handlers);
  }
  /** Registers handlers for PATCH requests (a POST with `_method=PATCH`). */
  patch(path, ...handlers) {
    return this._route('PATCH', path, handlers);
  }
  /** Registers handlers for DELETE requests (a POST with `_method=DELETE`). */
  delete(path, ...handlers) {
    return this._route('DELETE', path, handlers);
  }
  /** Registers handlers for every method on `path`. */
  all(path, ...handlers) {
    return this._route(null, path, handlers);
  }
  /**
   * Runs the stack for a request, starting with `err` pending when given.
   * `done` is called with the pending error, if any, once the stack is
   * exhausted; it is not called when a layer responds without calling `next`.
   */
  handle(req, res, done, err) {
    const { baseUrl, path, params } = req;
    const restore = () => {
      req.baseUrl = baseUrl;
      req.path = path;
      req.params = params;
    };
    let index = 0;
    const next = (signal) => {
      restore();
      const pending = signal === 'route' ? undefined : signal;
      const hasError = pending !== undefined && pending !== null;
      while (index < this._layers.length) {
        const layer = this._layers[index++];
        if (layer.isRoute && hasError) continue;
        if (layer.method && layer.method !== req.method) continue;
        let match;
        try {
          match = layer.matcher.match(path);
        } catch (matchError) {
          return next(matchError);
        }
        if (!match) continue;
        req.params = match.params;
        if (!layer.isRoute) {
          req.baseUrl = baseUrl + path.slice(0, match.length);
          req.path = path.slice(match.length) || '/';
        }
        this._run(layer, req, res, hasError, pending, next);
        restore();
        return;
      }
      done(hasError ? pending : undefined);
    };
    next(err);
  }
  _route(method, path, handlers) {
    this._layers.push({
      method,
      matcher: gasWebAppCompilePath(path, true),
      isRoute: true,
      fns: this._flatten(handlers),
    });
    return this;
  }
  _flatten(items) {
    return items.flatMap((item) => {
      if (Array.isArray(item)) return this._flatten(item);
      if (typeof item === 'function' || item instanceof GasWebAppRouter) {
        return [item];
      }
      throw new TypeError('Handlers must be functions or routers');
    });
  }
  /**
   * Runs the functions of one layer in order. A route's functions share one
   * `next`: `next('route')` leaves the route, `next(err)` leaves it with an
   * error. A throw is passed on as `next(err)`. Error handlers run only while
   * an error is pending; mounted routers run either way.
   */
  _run(layer, req, res, initialHasError, initialError, exit) {
    let index = 0;
    const run = (hasError, err) => {
      while (index < layer.fns.length) {
        const fn = layer.fns[index++];
        const isRouter = fn instanceof GasWebAppRouter;
        const isErrorHandler = !isRouter && fn.length === 4;
        if (!isRouter && hasError !== isErrorHandler) continue;
        try {
          if (isRouter) {
            fn.handle(req, res, step, hasError ? err : undefined);
          } else if (isErrorHandler) {
            fn(err, req, res, step);
          } else {
            fn(req, res, step);
          }
        } catch (thrown) {
          step(thrown);
        }
        return;
      }
      exit(hasError ? err : undefined);
    };
    const step = (signal) => {
      if (signal === 'route') return exit();
      run(signal !== undefined && signal !== null, signal);
    };
    run(initialHasError, initialError);
  }
}
