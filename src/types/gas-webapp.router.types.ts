type HttpMethod = 'GET' | 'POST';

interface RouteRequest<TBody = unknown> {
  route: string;
  method: HttpMethod;
  isHttpRequest: boolean;
  params: Record<string, string>;
  reqId: string;
  body?: TBody;
  email?: string; // populated by an auth middleware, if the consumer adds one
  session?: Record<string, string>; // populated by an auth middleware, if the consumer adds one
  raw: GoogleAppsScript.Events.DoGet | GoogleAppsScript.Events.DoPost;
}

type Handler<T = unknown> = (request: RouteRequest) => T;

type Middleware = (next: Handler) => Handler;
