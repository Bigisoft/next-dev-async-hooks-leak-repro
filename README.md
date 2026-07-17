# next dev renderer memory leak repro

Repro for https://github.com/vercel/next.js/issues/95898

`next dev` (Turbopack, Next 16.2.6) retains ~134KB of heap PER REQUEST post-GC, linearly and
without plateau. On larger apps with a browser tab attached, the same mechanism grows the
renderer heap ~5MB/s at idle until a fatal V8 OOM (observed at 7.2GB after ~27 minutes).

Cause: the compiled dev flight runtime (`next/dist/compiled/next-server/app-page*.runtime.dev.js`)
installs an `async_hooks.createHook` at module scope, unconditionally enabled, that allocates a
WeakRef + tracking object (and often a parsed `Error()` stack) for every promise in the process.
Turbopack's per-chunk `project.hmrEvents()` subscriptions churn promises continuously while a
browser is connected. No next.config flag gates the hook.

## Reproduce (per-request variant, no browser needed)

```bash
npm install
npm run dev          # NODE_OPTIONS=--inspect: CLI on 9229, renderer on 9230

# in a second terminal - warm the route, then baseline
curl -s http://localhost:3000/ok > /dev/null
npm run measure      # baseline post-GC heap

for i in $(seq 1 300); do curl -s -o /dev/null http://localhost:3000/ok; done
npm run measure      # ~+40MB

for i in $(seq 1 300); do curl -s -o /dev/null http://localhost:3000/ok; done
npm run measure      # ~+40MB more, linear, no plateau
```

Measured here (Node 24.17.0, Linux x64): 163MB baseline, 204MB after 300 requests, 251MB after
600, 298MB after 900. Post-GC (the script forces GC twice before reading). `/boom` (a throwing
page) leaks slightly faster (~155KB/request).

## Idle variant (the severe one)

On an 18-route production app, opening the app in a browser tab and leaving it IDLE (zero
requests in the dev log) grows the renderer heap at a constant ~4.7MB/s post-GC until OOM.
A 60s allocation sampling profile attributes ~370 of 403 MB/min to:

```
(anon) @ next/dist/server/dev/hot-reloader-turbopack.js:123   <- per-chunk hmrEvents subscriptions
  next / createIterator @ next/build/swc/index.js:501
  promiseInitHookWithDestroyTracking @ node:internal/async_hooks:334
  init @ next/dist/compiled/next-server/app-page-turbo.runtime.dev.js:52  (+ WeakRef)
```

A heap snapshot after ~900 requests contains 1,334,204 WeakRefs and 1,476,905 plain Objects
(~1,400 WeakRefs per request).

## Workarounds

- `experimental: { reactDebugChannel: false }` + `logging: { serverFunctions: false }` remove
  the per-request portion only.
- The idle leak stops only by neutralizing the hook before the runtime loads (a `--require`
  preload that makes `async_hooks.createHook` a no-op when called from
  `next/dist/compiled/next-server/*runtime.dev.js`). With it the renderer sits flat.
