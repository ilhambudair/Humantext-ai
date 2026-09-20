// POST /api/ai  — the ONLY place in this project that talks to Anthropic.
//
//   request  (JSON):  { "prompt": "<string>", "tier": "default" | "fast" }
//   response (NDJSON, one JSON object per line):
//       {"type":"delta","text":"..."}      repeated while the model writes
//       {"type":"done","stop":"end_turn"}  or  "max_tokens" when the answer was cut off
//       {"type":"error","code":"..."}      if something breaks after streaming started
//   errors before streaming starts use a normal HTTP status and { "error": { "code": "..." } }
//
// The API key (ANTHROPIC_API_KEY) lives in server environment variables only.
// Prompts and model output are never logged.

import { getConfig } from "./_lib/config.js";
import { readJsonBody, clientIp, rateLimit, originAllowed, safeEqual } from "./_lib/security.js";
import { streamCompletion, UpstreamError } from "./_lib/gemini.js";

const TIERS = new Set(["default", "fast"]);
const STATUS = { rate_limited: 429, prompt_too_large: 413, refused: 422, empty_completion: 502, upstream_error: 502 };

function sendJson(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}
const fail = (res, status, code, headers) => sendJson(res, status, { error: { code } }, headers);

export default async function handler(req, res) {
  if (req.method !== "POST") return fail(res, 405, "method_not_allowed", { Allow: "POST" });

  const cfg = getConfig();
  if (!cfg.apiKey) return fail(res, 503, "not_configured");
  if (!originAllowed(req, cfg.allowedOrigins)) return fail(res, 403, "forbidden_origin");

  if (cfg.accessCode) {
    const sent = req.headers["x-access-code"];
    if (!sent) return fail(res, 401, "access_required");
    if (!safeEqual(sent, cfg.accessCode)) return fail(res, 401, "access_denied");
  }

  const rl = rateLimit(clientIp(req), cfg.rateLimitPerMinute);
  if (!rl.ok) return fail(res, 429, "rate_limited", { "Retry-After": String(rl.retryAfter) });

  let body;
  try { body = await readJsonBody(req, cfg.maxPromptBytes * 3 + 4096); }
  catch (e) { return e && e.code === "payload_too_large" ? fail(res, 413, "prompt_too_large") : fail(res, 400, "bad_request"); }

  const prompt = body && body.prompt;
  const tier = body && body.tier !== undefined ? body.tier : "default";
  if (typeof prompt !== "string" || !prompt.trim() || !TIERS.has(tier)) return fail(res, 400, "bad_request");
  if (Buffer.byteLength(prompt, "utf8") > cfg.maxPromptBytes) return fail(res, 413, "prompt_too_large");

  let started = false;
  const begin = () => {
    if (started) return;
    started = true;
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    if (typeof res.flushHeaders === "function") res.flushHeaders();
  };
  const line = obj => { try { res.write(JSON.stringify(obj) + "\n"); } catch { /* client went away */ } };

  const ctl = new AbortController();
  res.on("close", () => { if (!res.writableFinished) ctl.abort(); });

  try {
    const { stop } = await streamCompletion({
      cfg, model: cfg.models[tier], prompt, signal: ctl.signal,
      onDelta: text => { begin(); line({ type: "delta", text }); }
    });
    begin();
    line({ type: "done", stop });
    res.end();
  } catch (e) {
    const code = e instanceof UpstreamError ? e.code : "upstream_error";
    if (code !== "cancelled") console.error("[api/ai] upstream failure:", code, e && e.status ? "status " + e.status : "", e && e.detail ? "| " + e.detail : "");
    if (!started) return code === "cancelled" ? res.end() : fail(res, STATUS[code] || 502, code);
    line({ type: "error", code });
    res.end();
  }
}
