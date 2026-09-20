// GET /api/health — tells the frontend whether AI features are available.
// Reveals only booleans. Never returns keys, model names or any secret.
import { getConfig } from "./_lib/config.js";

export default function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405; res.setHeader("Allow", "GET, HEAD"); return res.end();
  }
  const cfg = getConfig();
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify({ ok: true, ai: { configured: Boolean(cfg.apiKey), accessCodeRequired: Boolean(cfg.accessCode) } }));
}
