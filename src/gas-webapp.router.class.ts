class GasWebAppRouter {
  private _routes = new Map<
    string,
    { middlewares: Middleware[]; handler: Handler }
  >();
  private _useEntries: { prefix: string | null; middleware: Middleware }[] = [];

  /** applies to every route */
  use(middleware: Middleware): void;
  /** applies only to routes equal to, or nested under, pathPrefix */
  use(pathPrefix: string, ...middlewares: Middleware[]): void;
  /** applies subroutes */
  use(pathPrefix: string, subRouter: GasWebAppRouter): void;

  /** gather middleware under `_useEntries` */
  use(
    pathOrMiddleware: string | Middleware,
    ...rest: (Middleware | GasWebAppRouter)[]
  ): void {
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

  get(route: string, ...fns: [...Middleware[], Handler]): void {
    this._register('GET', route, fns);
  }

  post(route: string, ...fns: [...Middleware[], Handler]): void {
    this._register('POST', route, fns);
  }

  private _register(
    method: HttpMethod,
    route: string,
    fns: (Middleware | Handler)[],
  ): void {
    const handler = fns.pop() as Handler;

    this._routes.set(`${method} ${this._normalize(route)}`, {
      middlewares: fns as Middleware[],
      handler,
    });
  }

  private _mount(prefix: string, subRouter: GasWebAppRouter): void {
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

  private _normalize(path: string): string {
    return path.replace(/^\/+|\/+$/g, '');
  }

  private _joinPaths(prefix: string, route: string): string {
    return route ? `${prefix}/${route}` : prefix;
  }

  private _matchesPrefix(route: string, prefix: string): boolean {
    return route === prefix || route.startsWith(`${prefix}/`);
  }

  dispatch(request: RouteRequest): unknown {
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
