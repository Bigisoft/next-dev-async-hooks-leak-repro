// Force full GC on the next dev RENDERER isolate and print post-GC heap usage.
// The renderer is the child process of the CLI: with NODE_OPTIONS=--inspect the CLI takes
// port 9229 and the renderer takes 9230, so run: node scripts/heap.mjs 9230
const port = process.argv[2] || "9230";
const res = await fetch(`http://127.0.0.1:${port}/json/list`);
const target = (await res.json())[0];
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
  }
});
const send = (method, params = {}) => {
  const i = ++id;
  return new Promise((resolve, reject) => {
    pending.set(i, { resolve, reject });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
};
ws.addEventListener("open", async () => {
  await send("HeapProfiler.enable");
  await send("HeapProfiler.collectGarbage");
  await send("HeapProfiler.collectGarbage");
  const u = await send("Runtime.getHeapUsage");
  const mb = (n) => (n / 1048576).toFixed(1);
  console.log(`post-GC heapUsed=${mb(u.usedSize)}MB heapTotal=${mb(u.totalSize)}MB`);
  ws.close();
  process.exit(0);
});
setTimeout(() => {
  console.error("timeout connecting to inspector");
  process.exit(2);
}, 20000);
