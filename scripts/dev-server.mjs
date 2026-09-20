// Local development server. Serves public/ and mounts the same api/ handlers Vercel runs,
// so `npm run dev` behaves like production (including the security headers from vercel.json).
//
//   npm run dev        real Anthropic API (needs ANTHROPIC_API_KEY in .env)
//   npm run dev:mock   fake Anthropic upstream with canned answers: free, offline, NOT real AI
//   PORT=4000 npm run dev
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8", ".png": "image/png", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json"
};

export function loadDotEnv(file = path.join(ROOT, ".env")) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = raw.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || raw.trim().startsWith("#")) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

export function createDevServer({ root = ROOT } = {}) {
  const pub = path.join(root, "public");
  const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  const globalHeaders = ((vercel.headers || []).find(h => h.source === "/(.*)") || {}).headers || [];
  const routes = {
    "/api/ai": () => import(pathToFileURL(path.join(root, "api", "ai.js")).href),
    "/api/health": () => import(pathToFileURL(path.join(root, "api", "health.js")).href)
  };

  return http.createServer(async (req, res) => {
    for (const { key, value } of globalHeaders) res.setHeader(key, value);
    let url;
    try { url = new URL(req.url, "http://localhost"); } catch { res.statusCode = 400; return res.end("Bad request"); }

    if (routes[url.pathname]) {
      try { const mod = await routes[url.pathname](); await mod.default(req, res); }
      catch (e) {
        console.error("[dev-server] handler crashed:", e && e.message);
        if (!res.headersSent) { res.statusCode = 500; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ error: { code: "server_error" } })); }
        else res.end();
      }
      return;
    }
    if (url.pathname.startsWith("/api/")) { res.statusCode = 404; return res.end("Not found"); }

    if (req.method !== "GET" && req.method !== "HEAD") { res.statusCode = 405; return res.end(); }
    let rel;
    try { rel = decodeURIComponent(url.pathname); } catch { res.statusCode = 400; return res.end("Bad request"); }
    if (rel.endsWith("/")) rel += "index.html";
    const file = path.normalize(path.join(pub, rel));
    if (!file.startsWith(pub + path.sep)) { res.statusCode = 403; return res.end("Forbidden"); }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.statusCode = 404; res.setHeader("Content-Type", "text/plain; charset=utf-8"); return res.end("Not found"); }
      res.statusCode = 200;
      res.setHeader("Content-Type", MIME[path.extname(file).toLowerCase()] || "application/octet-stream");
      res.setHeader("Cache-Control", "no-cache");
      if (req.method === "HEAD") return res.end();
      fs.createReadStream(file).pipe(res);
    });
  });
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  loadDotEnv();
  const useMock = process.argv.includes("--mock");
  if (useMock) {
    const { createMockAnthropic } = await import("../tests/mock-anthropic.mjs");
    const mock = createMockAnthropic();
    const mockPort = Number(process.env.MOCK_PORT || 8788);
    await mock.listen(mockPort);
    process.env.ANTHROPIC_API_URL = `http://127.0.0.1:${mockPort}/v1/messages`;
    process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "mock-key-not-real";
    console.log(`\n  MOCK MODE: AI answers are canned test data from a fake Anthropic server on :${mockPort}.\n  This is NOT real AI. Use it to try the UI without an API key.\n`);
  }
  const port = Number(process.env.PORT || 3000);
  const server = createDevServer();
  server.listen(port, () => {
    const ai = process.env.ANTHROPIC_API_KEY ? (useMock ? "mock" : "configured") : "NOT configured (set ANTHROPIC_API_KEY in .env, or run `npm run dev:mock`)";
    console.log(`  HumanText AI running at http://localhost:${port}\n  AI backend: ${ai}\n`);
  });
}
