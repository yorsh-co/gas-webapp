'use strict';
class GasWebAppRouter {
  constructor() {
    this._routes = new Map();
    this._useEntries = [];
  }
  /** gather middleware under `_useEntries` */
  use(pathOrMiddleware, ...rest) {
    if (typeof pathOrMiddleware !== 'string') {
      this._useEntries.push({ prefix: null, middleware: pathOrMiddleware });
      return;
    }
    const prefix = this._normalize(pathOrMiddleware);
    for (const item of rest) {
      if (item instanceof GasWebAppRouter) {
        this._mount(prefix, item);
      } else {
        this._useEntries.push({ prefix, middleware: item });
      }
    }
  }
  get(route, ...fns) {
    this._register('GET', route, fns);
  }
  post(route, ...fns) {
    this._register('POST', route, fns);
  }
  _register(method, route, fns) {
    const handler = fns.pop();
    this._routes.set(`${method} ${this._normalize(route)}`, {
      middlewares: fns,
      handler,
    });
  }
  _mount(prefix, subRouter) {
    for (const [key, entry] of subRouter._routes) {
      const spaceIndex = key.indexOf(' ');
      const method = key.slice(0, spaceIndex);
      const route = key.slice(spaceIndex + 1);
      this._routes.set(`${method} ${this._joinPaths(prefix, route)}`, entry);
    }
    for (const useEntry of subRouter._useEntries) {
      const joinedPrefix =
        useEntry.prefix === null
          ? prefix
          : this._joinPaths(prefix, useEntry.prefix);
      this._useEntries.push({
        prefix: joinedPrefix,
        middleware: useEntry.middleware,
      });
    }
  }
  _normalize(path) {
    return path.replace(/^\/+|\/+$/g, '');
  }
  _joinPaths(prefix, route) {
    return route ? `${prefix}/${route}` : prefix;
  }
  _matchesPrefix(route, prefix) {
    return route === prefix || route.startsWith(`${prefix}/`);
  }
  dispatch(request) {
    const normalizedRoute = this._normalize(request.route);
    const entry = this._routes.get(`${request.method} ${normalizedRoute}`);
    if (!entry) {
      throw new NotFoundError(
        `No route registered for ${request.method} ${normalizedRoute}`,
      );
    }
    const matchedUse = this._useEntries
      .filter(
        (u) =>
          u.prefix === null || this._matchesPrefix(normalizedRoute, u.prefix),
      )
      .map((u) => u.middleware);
    const chain = [...matchedUse, ...entry.middlewares];
    const composed = chain.reduceRight((next, mw) => mw(next), entry.handler);
    return composed(request);
  }
}
