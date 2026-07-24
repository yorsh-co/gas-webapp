interface AuthMiddlewareConfig {
  /** Return true if the given email is allowed to proceed. */
  isAuthorized: (email: string) => boolean;
}
