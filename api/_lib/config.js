// Server-side configuration. Everything comes from environment variables, read at
// request time. NOTHING in this folder is ever sent to the browser.

const int = (v, d, min, max) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
};

export function getConfig(env = process.env) {
  return {
    apiKey: (env.GEMINI_API_KEY || "").trim(),
apiUrl: "https://generativelanguage.googleapis.com",
apiVersion: "v1beta",

models: {
  default: (env.GEMINI_MODEL || "gemini-2.5-flash-lite").trim(),
  fast: (env.GEMINI_MODEL_FAST || "gemini-2.5-flash-lite").trim()
    },
    maxOutputTokens: int(env.MAX_OUTPUT_TOKENS, 4096, 256, 16000),
    maxPromptBytes: int(env.MAX_PROMPT_BYTES, 62000, 1000, 200000),
    rateLimitPerMinute: int(env.RATE_LIMIT_PER_MINUTE, 20, 1, 1000),
    upstreamTimeoutMs: int(env.UPSTREAM_TIMEOUT_MS, 55000, 5000, 300000),
    // Optional shared secret that visitors must type before AI features work.
    accessCode: (env.AI_ACCESS_CODE || "").trim(),
    // Optional comma-separated list of allowed browser origins. Empty = same origin only.
    allowedOrigins: (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean)
  };
}
