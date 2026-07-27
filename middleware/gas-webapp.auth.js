'use strict';
/**
 * TODO:
 * Auth middleware factory.
 *
 * Resolves the active user's email via Session, then defers the actual
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
 * Peer dependency: UnauthorizedError (gas-error).
 */
const createAuthMiddleware = (config) => (next) => (request) => {
  const email = Session.getActiveUser().getEmail();
  if (!config.isAuthorized(email)) {
    throw new UnauthorizedError(`${email} is not authorized`);
  }
  // TODO: add optional session management using gas-webapp.session (still to be constructed)
  return next({ ...request, email, session: { email } });
};
