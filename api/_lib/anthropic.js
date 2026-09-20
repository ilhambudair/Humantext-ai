// Thin client for Anthropic's Messages API (streaming). No SDK, no dependencies.
// The API key is only ever used here, on the server.

export class UpstreamError extends Error {
  constructor(code, status = 0, detail = "") {
    super(code);
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

function codeForStatus(status, detail) {
  if (status === 429) return "rate_limited";
  if (status === 413) return "prompt_too_large";
  if (status === 400 && /too long|too many tokens|context (window|length)|maximum/i.test(detail)) return "prompt_too_large";
  return "upstream_error"; // includes 401/403 (bad key), 5xx and 529 (overloaded); details are logged server-side only
}
function codeForErrorType(type) {
  if (type === "rate_limit_error") return "rate_limited";
  return "upstream_error";
}

/**
 * Streams a completion. Calls onDelta(text) for every text chunk and resolves with { stop }.
 * Rejects with UpstreamError (codes: rate_limited, prompt_too_large, refused, empty_completion,
 * upstream_error, cancelled).
 */
export async function streamCompletion({ cfg, model, prompt, signal, onDelta }) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), cfg.upstreamTimeoutMs);
  const onAbort = () => ctl.abort();
  if (signal) { if (signal.aborted) ctl.abort(); else signal.addEventListener("abort", onAbort, { once: true }); }
  const cleanup = () => { clearTimeout(timer); if (signal) signal.removeEventListener("abort", onAbort); };

  let resp;
  try {
    resp = await fetch(cfg.apiUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": cfg.apiKey,
        "anthropic-version": cfg.apiVersion
      },
      body: JSON.stringify({
        model,
        max_tokens: cfg.maxOutputTokens,
        stream: true,
        messages: [{ role: "user", content: prompt }]
      }),
      signal: ctl.signal
    });
  } catch {
    cleanup();
    throw new UpstreamError(signal && signal.aborted ? "cancelled" : "upstream_error");
  }

  if (!resp.ok) {
    let detail = "";
    try { const j = await resp.json(); detail = (j && j.error && j.error.message) || ""; } catch { /* ignore */ }
    cleanup();
    throw new UpstreamError(codeForStatus(resp.status, detail), resp.status, detail);
  }

  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = "", stop = null, got = false;

  const handleBlock = block => {
    for (const raw of block.split("\n")) {
      if (!raw.startsWith("data:")) continue;
      let ev;
      try { ev = JSON.parse(raw.slice(5).trim()); } catch { continue; }
      if (ev.type === "content_block_delta" && ev.delta && ev.delta.type === "text_delta" && ev.delta.text) {
        got = true; onDelta(ev.delta.text);
      } else if (ev.type === "message_delta" && ev.delta && ev.delta.stop_reason) {
        stop = ev.delta.stop_reason;
      } else if (ev.type === "error") {
        throw new UpstreamError(codeForErrorType(ev.error && ev.error.type), 0, (ev.error && ev.error.message) || "");
      }
    }
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) { const block = buf.slice(0, i); buf = buf.slice(i + 2); handleBlock(block); }
    }
    if (buf.trim()) handleBlock(buf);
  } catch (e) {
    if (e instanceof UpstreamError) throw e;
    throw new UpstreamError(signal && signal.aborted ? "cancelled" : "upstream_error");
  } finally {
    cleanup();
    try { await reader.cancel(); } catch { /* ignore */ }
  }

  if (stop === "refusal") throw new UpstreamError("refused");
  if (!got) throw new UpstreamError("empty_completion");
  return { stop };
}
