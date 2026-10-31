/**
 * TODO:
 * Auth middleware factory.
 *
 * Resolves the active user's email via Session, rejecting the request with a
 * 401 when it cannot be determined (scope declined, or an anonymous or
 * consumer account), then defers the actual
 * authorization decision to the injected `isAuthorized` check — same
 * pattern as `keyFn` on the rate limiters: the mechanism is generic, the
 * app-specific policy (an allow-list, a Sheet lookup, etc.) is supplied
 * by the consumer.
 *
 * Usage:
 *   webApp.use(createAuthMiddleware({
 *     isAuthorized: (email) => AUTHORIZED_EMAILS.includes(email),
 *   }));
 *
 * Peer dependency: GasUnauthorizedError (gas-error).
 */
const createAuthMiddleware =
  (config: AuthMiddlewareConfig): Middleware =>
  (next: Handler): Handler =>
  (request) => {
    let email = '';
    try {
      email = Session.getActiveUser().getEmail();
    } catch {
      // Scope declined or unavailable; handled as an unidentified user below.
    }

    if (!email) {
      throw new GasUnauthorizedError('Unable to identify the signed-in user');
    }

    if (!config.isAuthorized(email)) {
      throw new GasUnauthorizedError('Not authorized');
    }

    // TODO: add optional session management using gas-webapp.session (still to be constructed)

    return next({ ...request, email, session: { email } });
  };
