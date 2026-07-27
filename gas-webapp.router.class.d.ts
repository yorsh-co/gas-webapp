declare class GasWebAppRouter {
  private _routes;
  private _useEntries;
  /** applies to every route */
  use(middleware: Middleware): void;
  /** applies only to routes equal to, or nested under, pathPrefix */
  use(pathPrefix: string, ...middlewares: Middleware[]): void;
  /** applies subroutes */
  use(pathPrefix: string, subRouter: GasWebAppRouter): void;
  get(route: string, ...fns: [...Middleware[], Handler]): void;
  post(route: string, ...fns: [...Middleware[], Handler]): void;
  private _register;
  private _mount;
  private _normalize;
  private _joinPaths;
  private _matchesPrefix;
  dispatch(request: RouteRequest): unknown;
}
