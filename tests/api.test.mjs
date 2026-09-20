// Backend tests: run with `npm test` (Node >= 20, no dependencies).
// They start a fake Anthropic server and the real dev server (which mounts the real api/ handlers).
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createDevServer, ROOT } from "../scripts/dev-server.mjs";
import { createMockAnthropic } from "./mock-anthropic.mjs";
import { resetRateLimits } from "../api/_lib/security.js";

const KEY = "sk-ant-test-SECRET-DO-NOT-LEAK-123456";
let mock, mockPort, app, base;
const ENV_KEYS = ["ANTHROPIC_API_KEY", "ANTHROPIC_API_URL", "AI_ACCESS_CODE", "ALLOWED_ORIGINS", "RATE_LIMIT_PER_MINUTE", "MAX_PROMPT_BYTES", "ANTHROPIC_MODEL", "MAX_OUTPUT_TOKENS"];

const ai = (body, headers = {}, method = "POST") => fetch(base + "/api/ai", { method, headers: { "content-type": "application/json", ...headers }, body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined });
const readLines = async res => (await res.text()).split("\n").filter(Boolean).map(l => JSON.parse(l));
const setMode = m => fetch(`http://127.0.0.1:${mockPort}/__mode?set=${m}`);
const mockState = async () => (await fetch(`http://127.0.0.1:${mockPort}/__state`)).json();

before(async () => {
  mock = createMockAnthropic(); mockPort = await mock.listen(0);
  app = createDevServer();
  await new Promise(r => app.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${app.address().port}`;
});
after(async () => { await mock.close(); app.closeAllConnections?.(); await new Promise(r => app.close(r)); });
beforeEach(async () => {
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.ANTHROPIC_API_KEY = KEY;
  process.env.ANTHROPIC_API_URL = `http://127.0.0.1:${mockPort}/v1/messages`;
  resetRateLimits(); await setMode("normal");
});

test("health: reports configuration as booleans only", async () => {
  let j = await (await fetch(base + "/api/health")).json();
  assert.deepEqual(j, { ok: true, ai: { configured: true, accessCodeRequired: false } });
  delete process.env.ANTHROPIC_API_KEY; process.env.AI_ACCESS_CODE = "x";
  j = await (await fetch(base + "/api/health")).json();
  assert.deepEqual(j.ai, { configured: false, accessCodeRequired: true });
  assert.ok(!JSON.stringify(j).includes(KEY));
});

test("ai: 405 for GET, 503 not_configured without a key", async () => {
  assert.equal((await ai(null, {}, "GET")).status, 405);
  delete process.env.ANTHROPIC_API_KEY;
  const r = await ai({ prompt: "hello" });
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error.code, "not_configured");
});

test("ai: streams deltas + done, sends the key only to Anthropic, uses the configured model", async () => {
  process.env.ANTHROPIC_MODEL = "test-model-x"; process.env.MAX_OUTPUT_TOKENS = "1234";
  const r = await ai({ prompt: "You are editing a piece of writing on behalf of its own author.\n---BEGIN TEXT---\nhello world\n---END TEXT---", tier: "default" });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /ndjson/);
  const raw = await r.clone().text();
  const lines = await readLines(r);
  assert.ok(lines.filter(l => l.type === "delta").length >= 2, "should stream several deltas");
  assert.equal(lines.at(-1).type, "done");
  assert.equal(lines.at(-1).stop, "end_turn");
  assert.equal(lines.filter(l => l.type === "delta").map(l => l.text).join(""), "Natural: hello world");
  assert.ok(!raw.includes(KEY), "API key must never appear in a response");
  const st = await mockState();
  assert.equal(st.headers["x-api-key"], KEY);
  assert.equal(st.headers["anthropic-version"], "2023-06-01");
  assert.deepEqual(st.body, { model: "test-model-x", max_tokens: 1234, stream: true });
});

test("ai: tier 'fast' maps to the fast model; unknown tier is rejected", async () => {
  process.env.ANTHROPIC_MODEL_FAST = "fast-model-y";
  assert.equal((await ai({ prompt: "hi", tier: "fast" })).status, 200);
  assert.equal((await mockState()).body.model, "fast-model-y");
  assert.equal((await ai({ prompt: "hi", tier: "opus-please" })).status, 400);
});

test("ai: bad requests → 400, oversized → 413", async () => {
  for (const b of [{}, { prompt: "" }, { prompt: "   " }, { prompt: 42 }, "not json", "[1,2]"]) {
    const r = await ai(b); assert.equal(r.status, 400, JSON.stringify(b));
    assert.equal((await r.json()).error.code, "bad_request");
  }
  process.env.MAX_PROMPT_BYTES = "2000";
  const r = await ai({ prompt: "é".repeat(1500) }); // 3000 bytes
  assert.equal(r.status, 413); assert.equal((await r.json()).error.code, "prompt_too_large");
});

test("access code: required, wrong, right", async () => {
  process.env.AI_ACCESS_CODE = "letmein";
  const callsBefore = (await mockState()).calls;
  let r = await ai({ prompt: "hi" }); assert.equal(r.status, 401); assert.equal((await r.json()).error.code, "access_required");
  r = await ai({ prompt: "hi" }, { "x-access-code": "nope" }); assert.equal(r.status, 401); assert.equal((await r.json()).error.code, "access_denied");
  r = await ai({ prompt: "hi" }, { "x-access-code": "letmein" }); assert.equal(r.status, 200);
  assert.equal((await mockState()).calls - callsBefore, 1, "rejected requests must not reach Anthropic");
});

test("origin: cross-origin browsers are refused, same-origin and no-origin are allowed", async () => {
  let r = await ai({ prompt: "hi" }, { origin: "https://evil.example" }); assert.equal(r.status, 403);
  assert.equal((await r.json()).error.code, "forbidden_origin");
  r = await ai({ prompt: "hi" }, { origin: base }); assert.equal(r.status, 200);
  r = await ai({ prompt: "hi" }); assert.equal(r.status, 200);
  process.env.ALLOWED_ORIGINS = "https://www.mysite.com";
  r = await ai({ prompt: "hi" }, { origin: "https://www.mysite.com" }); assert.equal(r.status, 200);
  r = await ai({ prompt: "hi" }, { origin: base }); assert.equal(r.status, 403);
});

test("rate limit: 429 with Retry-After after the limit", async () => {
  process.env.RATE_LIMIT_PER_MINUTE = "2";
  assert.equal((await ai({ prompt: "1" })).status, 200);
  assert.equal((await ai({ prompt: "2" })).status, 200);
  const r = await ai({ prompt: "3" });
  assert.equal(r.status, 429); assert.equal((await r.json()).error.code, "rate_limited");
  assert.ok(Number(r.headers.get("retry-after")) >= 1);
});

test("upstream failures are mapped to safe codes and never leak details", async () => {
  const expect = async (mode, status, code) => {
    await setMode(mode); resetRateLimits();
    const r = await ai({ prompt: "hi" });
    assert.equal(r.status, status, mode);
    const t = await r.text();
    assert.equal(JSON.parse(t).error.code, code, mode);
    assert.ok(!t.includes("x-api-key") && !t.includes(KEY) && !/invalid|boom|Overloaded/.test(t), "no upstream detail in " + mode);
  };
  await expect("429", 429, "rate_limited");
  await expect("401", 502, "upstream_error");   // bad server key is the operator's problem, not the visitor's
  await expect("500", 502, "upstream_error");
  await expect("overloaded", 502, "upstream_error");
  await expect("toolong", 413, "prompt_too_large");
  await expect("refuse", 422, "refused");
  await expect("empty", 502, "empty_completion");
});

test("upstream error after streaming started → error line in the stream; truncation is reported", async () => {
  await setMode("error_mid");
  let lines = await readLines(await ai({ prompt: "hi" }));
  assert.equal(lines.at(-1).type, "error"); assert.equal(lines.at(-1).code, "upstream_error");
  assert.ok(lines.some(l => l.type === "delta"), "partial text is delivered before the error");
  await setMode("truncate"); resetRateLimits();
  lines = await readLines(await ai({ prompt: "hi" }));
  assert.equal(lines.at(-1).stop, "max_tokens");
});

test("static: index served with security headers; traversal and unknown paths blocked; no secrets in public/", async () => {
  const r = await fetch(base + "/");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-security-policy"), /script-src 'self'/);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("x-frame-options"), "DENY");
  assert.ok((await r.text()).includes("HumanText AI"));
  assert.equal((await fetch(base + "/js/core.js")).status, 200);
  assert.equal((await fetch(base + "/..%2f..%2fpackage.json")).status, 403);
  // fetch() normalizes "%2e%2e" itself, so also send raw, un-normalized paths over a plain socket
  for (const raw of ["/../package.json", "/..%2fpackage.json", "/%2e%2e/%2e%2e/etc/passwd", "/js/..%2f..%2f..%2fpackage.json"]) {
    const { status, body } = await new Promise((resolve, reject) => {
      http.get({ host: "127.0.0.1", port: app.address().port, path: raw }, res => { let b = ""; res.on("data", d => b += d); res.on("end", () => resolve({ status: res.statusCode, body: b })); }).on("error", reject);
    });
    assert.ok(status === 403 || status === 404, `${raw} -> ${status}`);
    assert.ok(!body.includes('"name": "humantext-ai"') && !body.includes("root:"), `${raw} must not expose files outside public/`);
  }
  assert.equal((await fetch(base + "/.env")).status, 404);
  assert.equal((await fetch(base + "/api/_lib/config.js")).status, 404);
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  for (const f of walk(path.join(ROOT, "public"))) assert.ok(!/sk-ant-|ANTHROPIC_API_KEY/.test(fs.readFileSync(f, "utf8")), "secret-like text in " + f);
});
