# Manual web app checks

Some behaviour only exists in a deployed web app: `e.pathInfo` and `e.contextPath`, the shape of a POST body, the MIME type of a response, and how `HtmlService` serves a page. `clasp run` cannot exercise any of it. This folder holds a small fixture app that exposes all of it from one deployment, and the checklist to run against it.

The fixture is `app.js` and `views/`. `npm run manual:build` assembles it with the bundled peers, the compiled library and the compiled browser client into `.manual-webapp/`, which `clasp` pushes.

> **Warning:**
> The fixture deploys with **access: Anyone, even anonymous**, and **execute as: me**, so that `curl` needs no credentials for `?route=` URLs (GET path URLs need a signed-in user, see below). Use a throwaway Apps Script project, and **delete the deployment** (Deploy, Manage deployments, Archive) when the checks are done.

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

`GET $URL` lists the fixture's routes. Echo routes answer `{ method, path, params, query, body, transport, contentType, event: { pathInfo, contextPath } }`.

### Path URLs

Apps Script handles anything after `/exec` before the script runs:

| URL                            | Signed-in browser                 | Anonymous (`curl`)                                |
| ------------------------------ | --------------------------------- | ------------------------------------------------- |
| `$URL`, `$URL?route=/x`        | Runs the script                   | Runs the script                                   |
| GET `$URL/x` (a path after it) | Runs the script; `e.pathInfo` `x` | Redirected to the Google sign-in page; never runs |
| POST `$URL/x?route=/x`         | Runs the script; `e.pathInfo` `x` | Runs the script; `e.pathInfo` `x`                 |
| POST `$URL/x` (no `route`)     | Runs the script; routed by path   | Runs the script; routed by `e.pathInfo`           |
| `$URL/` (a trailing slash)     | Apps Script 404                   | Apps Script 404                                   |

So `?route=` is the form that works for every caller, and the `curl` GET commands below use it. Checks that need a GET path URL are marked **browser** and run in a browser signed in to the deploying account. Every page check also works anonymously as `$URL?route=/<path>`.

## Checks: routing and bodies

Run each command and compare. In the expected column, `data` is the envelope's data.

| #   | Check                         | Command                                                                       | Expected                                                                                                     |
| --- | ----------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1   | GET with pathInfo             | **browser** `$URL/users/42`                                                   | Envelope `ok: true`; `data.path` `/users/42`, `params` `{ id: "42" }`, `event.pathInfo` `users/42`           |
| 2   | GET with route                | `curl -L "$URL?route=/users/42"`                                              | Same result                                                                                                  |
| 3   | GET with both                 | **browser** `$URL/users/1?route=/users/42`                                    | `route` wins: `data.path` `/users/42`                                                                        |
| 4   | POST with pathInfo            | `curl -L -d x=1 "$URL/echo"`                                                  | Routed to `/echo`; `event.pathInfo` `"echo"`                                                                 |
| 5   | POST with route               | `curl -L -d x=1 "$URL?route=/echo"`                                           | Routed to `/echo`; `query` `{ x: "1" }`                                                                      |
| 6   | POST form body                | `curl -L -d a=1 -d b=2 "$URL?route=/echo"`                                    | `body` absent (undefined), `query` `{ a: "1", b: "2" }`, `contentType` `application/x-www-form-urlencoded`   |
| 7   | POST JSON body                | `curl -L -H 'Content-Type: application/json' -d '{"a":1}' "$URL?route=/echo"` | `body` `{ a: 1 }`                                                                                            |
| 8   | POST text body                | `curl -L -H 'Content-Type: text/plain' -d hello "$URL?route=/echo"`           | `body` `"hello"`                                                                                             |
| 9   | POST malformed JSON           | `curl -L -H 'Content-Type: application/json' -d '{oops' "$URL?route=/echo"`   | 400 error envelope `Invalid JSON body`, served as JSON                                                       |
| 10  | `_method` override            | `curl -L -d '' "$URL?route=/items/7&_method=DELETE"`                          | `data.method` `DELETE`, `params` `{ id: "7" }`, `query` without `_method`                                    |
| 11  | Bad `_method`                 | `curl -L -d '' "$URL?route=/items/7&_method=TRACE"`                           | 400 error envelope `Invalid _method`                                                                         |
| 12  | `_method` on GET              | `curl -L "$URL?route=/users/42&_method=DELETE"`                               | Ignored: `data.method` `GET`                                                                                 |
| 13  | contextPath, MIME             | `curl -L -i "$URL?route=/users/42"`, and the same for any of the POSTs above  | `transport` `http`; the body is JSON text; `event.contextPath` `""`; final `Content-Type` `application/json` |
| 28  | POST with pathInfo, signed in | **browser** or `curl` with a signed-in session: POST `$URL/echo`              | Routed to `/echo` with `event.pathInfo` `"echo"`. Confirmed with an HTML form in a signed-in browser         |

Apps Script answers every request with HTTP 200 (P1), so judge errors by the envelope (`ok: false`, `status`, `code`, `error`), not by curl's status. The `-i` output of check 13 shows the redirect and the final response; record the final `Content-Type`.

### Record the results

Observed on a deployed web app, and recorded in the README's platform notes.

| Observation                                                | Value                                                                                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `event.pathInfo` on signed-in GET `$URL/users/42`          | `"users/42"`; with `?route=/users/42` also present, `route` wins and `pathInfo` is as in the URL                    |
| `event.pathInfo` on anonymous POST `$URL/echo?route=/echo` | `"echo"`                                                                                                            |
| Outcome of anonymous GET `$URL/users/42`                   | Redirected to the Google sign-in page; the script never runs                                                        |
| Outcome of anonymous POST `$URL/echo` (check 4)            | Reaches `doPost`; routed by `pathInfo` since the fix (before it: 404 `Cannot POST /`)                               |
| Outcome of signed-in POST with a path (check 28)           | Runs; routed to `/echo`, `pathInfo` `"echo"`                                                                        |
| Outcome of `$URL/`                                         | Apps Script's own 404 page; the script does not run                                                                 |
| `event.contextPath` on GET and on POST                     | `""`                                                                                                                |
| Final `Content-Type` of a JSON envelope                    | 302 (`application/binary`) to `script.googleusercontent.com/macros/echo...`, then `application/json; charset=utf-8` |
| Final `Content-Type` of an HTML page                       | `text/html; charset=utf-8`, served directly from `script.google.com`; content in the sandboxed iframe               |

## Checks: pages

Open each URL in a browser signed in to the deploying account, or use `$URL?route=/page` and so on to stay anonymous. The page is served inside a sandboxed iframe by `HtmlService`, so view the elements on the page, not the page source.

| #   | Check                   | URL                                              | Expected                                                                                                                                                                                                                        |
| --- | ----------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 14  | `render` with a layout  | `$URL/page`                                      | Header `layout: Page with layout`, the view, and a footer line `layout markers: fromApp=app, fromRes=res, fromOptions=options`                                                                                                  |
| 15  | Locals precedence       | `$URL/page`                                      | In the view: `fromApp` is `app` (app.locals only), `fromRes` is `res` (res.locals over app.locals), `fromOptions` is `options` (render options over res.locals)                                                                 |
| 16  | `render` without layout | `$URL/bare`                                      | The view and the same three markers, with no `layout:` header and no footer                                                                                                                                                     |
| 17  | `res.redirect`          | `$URL/redirect`                                  | A page reading `Redirecting to https://example.com/.`. Observed: automatic navigation is blocked. On Android Firefox the fallback link had to be clicked; Android Chrome showed a "redirect blocked" popup. Desktop is untested |
| 18  | Error view, 404         | `$URL/nope`                                      | Page `404 NOT_FOUND` with `Cannot GET /nope`                                                                                                                                                                                    |
| 19  | Error view, 500         | `$URL/boom`                                      | Page `500 INTERNAL_ERROR` with a generic message: the thrown message `boom` must not appear                                                                                                                                     |
| 20  | Error view only on GET  | `curl -L -d '' "$URL?route=/boom"`               | JSON error envelope, `status` 500, not HTML                                                                                                                                                                                     |
| 21  | Error view that throws  | `$URL/teapot`, or `curl -L "$URL?route=/teapot"` | The error view throws for status 418, so the response is the JSON error envelope (`ok: false`, `status` 418, `error` `I am a teapot`), not a page                                                                               |
| 22  | Error view over curl    | `curl -L "$URL?route=/nope"`                     | A `curl` GET is an HTTP GET too: it receives the HTML of check 18, not JSON                                                                                                                                                     |

`HtmlService` may allow a sandboxed page to navigate the top window only after a user gesture. Check 17 is documented as a caveat (P9): the fallback link is the reliable path. Record the desktop result if you test it.

## Checks: browser client

The client checks need the fixture's entry points to be function declarations, as `google.script.run` fails on `const doGet = webApp.doGet` (fixed in `app.js`). Push the fixture again and create a new version of the deployment before running them.

Open `$URL/client` signed in, or `$URL?route=/client`. It loads the compiled browser client through `app.js(...)` partials, configures a short ack deadline (3 s) and writes every client log line to the panel.

| #   | Check              | Action                             | Expected                                                                                                                                                                   |
| --- | ------------------ | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 23  | `api.get`          | Click `api.get /users/1`           | `get: { method: "GET", path: "/users/1", params: { id: "1" }, transport: "rpc", ... }`, with `event.pathInfo` and `event.contextPath` `null` (no path over RPC)            |
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
