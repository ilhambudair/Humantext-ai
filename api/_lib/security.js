import { createHash, timingSafeEqual } from "node:crypto";

/** Read a JSON body. Works both with Vercel's pre-parsed `req.body` and with a raw Node request. */
export async function readJsonBody(req, limitBytes) {
  const tooLarge = () => Object.assign(new Error("payload_too_large"), { code: "payload_too_large" });
  const bad = () => Object.assign(new Error("bad_request"), { code: "bad_request" });
  if (req.body !== undefined && req.body !== null) {
    if (Buffer.isBuffer(req.body)) req.body = req.body.toString("utf8");
    if (typeof req.body === "string") {
      if (Buffer.byteLength(req.body) > limitBytes) throw tooLarge();
      try { return JSON.parse(req.body); } catch { throw bad(); }
    }
    return req.body;
  }
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limitBytes) throw tooLarge();
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw bad(); }
}

export function clientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff) return xff.split(",")[0].trim();
  return (req.socket && req.socket.remoteAddress) || "unknown";
}

// Best-effort, in-memory limiter. On serverless each instance has its own memory, so this
// slows abuse but is not a hard guarantee. See README ("Rate limiting") for stronger options.
const buckets = new Map();
export function rateLimit(key, limit, now = Date.now()) {
  const windowMs = 60_000;
  let b = buckets.get(key);
  if (!b || now - b.start >= windowMs) { b = { start: now, count: 0 }; buckets.set(key, b); }
  b.count += 1;
  if (buckets.size > 5000) for (const [k, v] of buckets) if (now - v.start >= windowMs) buckets.delete(k);
  return { ok: b.count <= limit, retryAfter: Math.max(1, Math.ceil((b.start + windowMs - now) / 1000)) };
}
export function resetRateLimits() { buckets.clear(); }

/** Browsers always send Origin on cross-origin POSTs. Reject those unless explicitly allowed. */
export function originAllowed(req, allowedOrigins) {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser client (curl, server-to-server): rate limit + access code still apply
  if (allowedOrigins && allowedOrigins.length) return allowedOrigins.includes(origin);
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

export function safeEqual(a, b) {
  const ha = createHash("sha256").update(String(a)).digest();
  const hb = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}
