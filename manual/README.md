# Manual web app checks

Some behaviour only exists in a deployed web app: `e.pathInfo` and `e.contextPath`, the shape of a POST body, the MIME type of a response, and how `HtmlService` serves a page. `clasp run` cannot exercise any of it. This folder holds a small fixture app that exposes all of it from one deployment, and the checklist to run against it.

The fixture is `app.js` and `views/`. `npm run manual:build` assembles it with the bundled peers, the compiled library and the compiled browser client into `.manual-webapp/`, which `clasp` pushes.

> **Warning:**
> The fixture deploys with **access: Anyone, even anonymous**, and **execute as: me**, so that `curl` needs no credentials. Use a throwaway Apps Script project, and **delete the deployment** (Deploy, Manage deployments, Archive) when the checks are done.

## Setup

1. Create a throwaway Apps Script project (script.google.com, New project) and copy its script ID.
2. Log in to clasp and enable the Apps Script API, once: `npx clasp login`.
3. Build the fixture. The script ID stays in your environment and is never written to the repository:

   ```bash
   export MANUAL_WEBAPP_SCRIPT_ID=<script id>
   npm run manual:build
   ```

4. Push it, from the generated folder:

   ```bash
   cd .manual-webapp
   npx clasp push --force
   ```

5. In the Apps Script editor, Deploy, New deployment, Web app. Execute as: **Me**. Who has access: **Anyone**. Authorize the scopes when asked, then copy the `/exec` URL.

   After a later push, create a new version of the deployment (Deploy, Manage deployments, edit, New version) to serve it; the URL stays the same.

6. Set the URL for the commands below:

   ```bash
   export URL='https://script.google.com/macros/s/<deployment id>/exec'
   ```

`curl -L` is required throughout, as Apps Script answers with a redirect to the content. For a POST, use `-d` and not `-X POST`: with `-L`, `-X POST` makes curl replay the POST on the redirect, which the content host rejects, while `-d` lets curl follow it with a GET. An empty body is `-d ''`.

`GET $URL/` lists the fixture's routes. Echo routes answer `{ method, path, params, query, body, transport, contentType, event: { pathInfo, contextPath } }`.

## Checks: routing and bodies

Run each command and compare. In the expected column, `data` is the envelope's data.

| #   | Check               | Command                                                                       | Expected                                                                                                   |
| --- | ------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1   | GET with pathInfo   | `curl -L "$URL/users/42"`                                                     | Envelope `ok: true`; `data.path` `/users/42`, `params` `{ id: "42" }`, `transport` `http`                  |
| 2   | GET with route      | `curl -L "$URL?route=/users/42"`                                              | Same result                                                                                                |
| 3   | GET with both       | `curl -L "$URL/users/1?route=/users/42"`                                      | `route` wins: `data.path` `/users/42`                                                                      |
| 4   | POST with pathInfo  | `curl -L -d x=1 "$URL/echo"`                                                  | 404 error envelope `Cannot POST /`: pathInfo is not read on `doPost`                                       |
| 5   | POST with route     | `curl -L -d x=1 "$URL?route=/echo"`                                           | Routed to `/echo`; `query` `{ x: "1" }`. Record whether `event.pathInfo` was set on the POST               |
| 6   | POST form body      | `curl -L -d a=1 -d b=2 "$URL?route=/echo"`                                    | `body` absent (undefined), `query` `{ a: "1", b: "2" }`, `contentType` `application/x-www-form-urlencoded` |
| 7   | POST JSON body      | `curl -L -H 'Content-Type: application/json' -d '{"a":1}' "$URL?route=/echo"` | `body` `{ a: 1 }`                                                                                          |
| 8   | POST text body      | `curl -L -H 'Content-Type: text/plain' -d hello "$URL?route=/echo"`           | `body` `"hello"`                                                                                           |
| 9   | POST malformed JSON | `curl -L -H 'Content-Type: application/json' -d '{oops' "$URL?route=/echo"`   | 400 error envelope `Invalid JSON body`, served as JSON                                                     |
| 10  | `_method` override  | `curl -L -d '' "$URL?route=/items/7&_method=DELETE"`                          | `data.method` `DELETE`, `params` `{ id: "7" }`, `query` without `_method`                                  |
| 11  | Bad `_method`       | `curl -L -d '' "$URL?route=/items/7&_method=TRACE"`                           | 400 error envelope `Invalid _method`                                                                       |
| 12  | `_method` on GET    | `curl -L "$URL?route=/users/42&_method=DELETE"`                               | Ignored: `data.method` `GET`                                                                               |
| 13  | contextPath, MIME   | `curl -L -i "$URL/users/42"`, and the same for any of the POSTs above         | `transport` `http`; the body is JSON text. Record `event.contextPath` and the final `Content-Type`         |

Apps Script answers every request with HTTP 200 (P1), so judge errors by the envelope (`ok: false`, `status`, `code`, `error`), not by curl's status. The `-i` output of check 13 shows the redirect and the final response; record the final `Content-Type`.

### Record the results

Copy the observed values into the README's platform notes, and fill in the gaps below.

| Observation                                 | Value |
| ------------------------------------------- | ----- |
| `event.pathInfo` on GET `$URL/users/42`     |       |
| `event.pathInfo` on POST `$URL?route=/echo` |       |
| `event.pathInfo` on POST `$URL/echo`        |       |
| `event.contextPath` on GET and on POST      |       |
| Final `Content-Type` of a JSON envelope     |       |
| Final `Content-Type` of an HTML page        |       |

## Checks: pages

Open each URL in a browser. The page is served inside a sandboxed iframe by `HtmlService`, so view the elements on the page, not the page source.

| #   | Check                   | URL                                       | Expected                                                                                                                                                        |
| --- | ----------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 14  | `render` with a layout  | `$URL/page`                               | Header `layout: Page with layout`, the view, and a footer line `layout markers: fromApp=app, fromRes=res, fromOptions=options`                                  |
| 15  | Locals precedence       | `$URL/page`                               | In the view: `fromApp` is `app` (app.locals only), `fromRes` is `res` (res.locals over app.locals), `fromOptions` is `options` (render options over res.locals) |
| 16  | `render` without layout | `$URL/bare`                               | The view and the same three markers, with no `layout:` header and no footer                                                                                     |
| 17  | `res.redirect`          | `$URL/redirect`                           | A page reading `Redirecting to https://example.com/.`. Either the top window navigates to example.com by itself, or clicking the link does. **Record which**    |
| 18  | Error view, 404         | `$URL/nope`                               | Page `404 NOT_FOUND` with `Cannot GET /nope`                                                                                                                    |
| 19  | Error view, 500         | `$URL/boom`                               | Page `500 INTERNAL_ERROR` with a generic message: the thrown message `boom` must not appear                                                                     |
| 20  | Error view only on GET  | `curl -L -d '' "$URL?route=/boom"`        | JSON error envelope, `status` 500, not HTML                                                                                                                     |
| 21  | Error view that throws  | `$URL/teapot`, or `curl -L "$URL/teapot"` | The error view throws for status 418, so the response is the JSON error envelope (`ok: false`, `status` 418, `error` `I am a teapot`), not a page               |
| 22  | Error view over curl    | `curl -L "$URL/nope"`                     | A `curl` GET is an HTTP GET too: it receives the HTML of check 18, not JSON                                                                                     |

`HtmlService` may allow a sandboxed page to navigate the top window only after a user gesture. If check 17 does not navigate by itself, click the link; if neither works, record the browser and the console error, as `res.redirect` needs a documented caveat then.

## Checks: browser client

Open `$URL/client`. It loads the compiled browser client through `app.js(...)` partials, configures a short ack deadline (3 s) and writes every client log line to the panel.

| #   | Check              | Action                             | Expected                                                                                                                                                                   |
| --- | ------------------ | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 23  | `api.get`          | Click `api.get /users/1`           | `get: { method: "GET", path: "/users/1", params: { id: "1" }, transport: "rpc", ... }`, with no `pathInfo` or `contextPath` in `event`                                     |
| 24  | `api.delete`       | Click `api.delete /items/7`        | `delete: { method: "DELETE", path: "/items/7", ... }`: the `_method` override works over `google.script.run`                                                               |
| 25  | `api.post`         | Click `api.post /echo`             | `post: { method: "POST", body: { a: 1 }, ... }`                                                                                                                            |
| 26  | Server error       | Click `api.get /nope (expect 404)` | `missing rejected: { status: 404, code: "NOT_FOUND" }`                                                                                                                     |
| 27  | Ack on a slow call | Click `api.get /slow`, wait 5 s    | `slow: { slept: 5000 }`, with no `NOT_DELIVERED`: the call outlived the 3 s ack deadline and was acknowledged. Debug lines `Poll failed` mean the ack route is unreachable |

To check the ack route over HTTP:

```bash
ID=$(uuidgen)
curl -L "$URL?route=/ack&callIds=$ID"                  # data: []
curl -L "$URL?route=/users/42&callId=$ID" > /dev/null  # records the id
curl -L "$URL?route=/ack&callIds=$ID"                  # data: ["<id>"]
curl -L "$URL?route=/ack&callIds=$ID"                  # data: [] (reported once)
```

## After the checks

1. Record the results in the README's platform notes, and the redirect outcome of check 17.
2. Delete the deployment (Deploy, Manage deployments, Archive), or delete the project.
3. `rm -rf .manual-webapp`, and unset `MANUAL_WEBAPP_SCRIPT_ID`.
