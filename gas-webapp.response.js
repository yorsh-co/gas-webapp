'use strict';
/**
 * Types for GasWebApp.
 *
 * GasWebAppRouter and its request/routing contract (RouteRequest, HttpMethod,
 * Handler, Middleware) live in this same package — see gas-router.class.ts
 * and request.types.ts.
 *
 * Peer dependency (expected as a global from a sibling subtree package,
 * not redeclared here):
 *   - GasError, NotFoundError, ForbiddenError,
 *     ValidationError, errorHandler                 (gas-error)
 *   - GasLogger                                     (gas-logger)
 */
class JsonResponse {
  constructor(payload) {
    this.payload = payload;
  }
}
class HtmlResponse {
  constructor(output) {
    this.output = output;
  }
}
