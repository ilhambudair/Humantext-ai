// Server-side configuration. Everything comes from environment variables, read at
// request time. NOTHING in this folder is ever sent to the browser.

const int = (v, d, min, max) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
};

export function getConfig(env = process.env) {
  return {
    apiKey: (env.ANTHROPIC_API_KEY || "").trim(),
    apiUrl: (env.ANTHROPIC_API_URL || "https://api.anthropic.com/v1/messages").trim(),
    apiVersion: (env.ANTHROPIC_VERSION || "2023-06-01").trim(),
    // The frontend asks for a "tier"; the server decides which model that means.
    models: {
      default: (env.ANTHROPIC_MODEL || "claude-sonnet-5").trim(),
      fast: (env.ANTHROPIC_MODEL_FAST || "claude-haiku-4-5-20251001").trim()
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
