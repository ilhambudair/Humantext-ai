"use strict";
/* ============================================================
   RUNTIME ADAPTER — the seam between the UI and the AI backend
   ============================================================
   The app code (ai.js, answer.js, references.js, coach.js) only ever calls two things:

     sample(prompt, { signal, modelTier, onText })  ->  Promise<{ text, truncated }>
     downloads.save({ filename, data })             ->  Promise

   In the Claude Artifact version those came from `window.claude.use("sample")` and
   `window.claude.use("downloads")`. Here they are implemented with:
     - sample    -> POST /api/ai (our own serverless proxy; the API key stays on the server)
     - downloads -> a normal browser download (Blob + <a download>)

   Errors are thrown as { code, text? } objects. `text` carries whatever streamed in before the
   failure so the UI can show partial output. Codes understood by ai.js:
     cancelled, rate_limited, prompt_too_large, refused, empty_completion, upstream_error,
     not_configured, access_denied
*/
const HT_RUNTIME = (() => {
  const cfg = () => Object.assign({ aiEndpoint: "/api/ai", healthEndpoint: "/api/health", useArtifactRuntime: false }, window.HT_CONFIG || {});
  const ACCESS_KEY = "humantext.access";
  let reason = null; // null | "not_configured" | "unreachable"

  const store = {
    get() { try { return sessionStorage.getItem(ACCESS_KEY) || ""; } catch (e) { return ""; } },
    set(v) { try { sessionStorage.setItem(ACCESS_KEY, v); } catch (e) { } },
    clear() { try { sessionStorage.removeItem(ACCESS_KEY); } catch (e) { } }
  };

  const CODE_BY_STATUS = { 401: "access_denied", 413: "prompt_too_large", 429: "rate_limited", 503: "not_configured" };

  async function post(body, signal, attempt = 0) {
    const headers = { "Content-Type": "application/json" };
    const code = store.get();
    if (code) headers["x-access-code"] = code;
    const res = await fetch(cfg().aiEndpoint, { method: "POST", headers, body: JSON.stringify(body), signal });
    if (res.status === 401 && attempt === 0 && typeof modal === "function") {
      // The server has AI_ACCESS_CODE set. Ask the visitor once, keep it for this tab only.
      store.clear();
      const entered = await modal({
        title: "Access code required",
        message: "This site limits its AI features to people with an access code.",
        value: "", okLabel: "Continue"
      });
      if (entered) { store.set(entered); return post(body, signal, 1); }
      throw { code: "access_denied" };
    }
    return res;
  }

  async function sample(prompt, opts = {}) {
    const { signal, onText, modelTier } = opts;
    let res;
    try { res = await post({ prompt, tier: modelTier === "fast" ? "fast" : "default" }, signal); }
    catch (e) {
      if ((e && e.name === "AbortError") || (signal && signal.aborted)) throw { code: "cancelled" };
      if (e && typeof e.code === "string") throw e; // our own { code } (access prompt cancelled)
      throw { code: "upstream_error" };
    }
    if (!res.ok) {
      let code = null;
      try { const j = await res.json(); code = j && j.error && j.error.code; } catch (e) { }
      if (code === "access_denied" || code === "access_required") store.clear();
      throw { code: code === "access_required" ? "access_denied" : (code || CODE_BY_STATUS[res.status] || "upstream_error") };
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let acc = "", buf = "", stop = null;
    const handle = ev => {
      if (ev.type === "delta" && typeof ev.text === "string") {
        acc += ev.text;
        if (onText) onText({ text: acc, delta: ev.text });
      } else if (ev.type === "done") stop = ev.stop || "end_turn";
      else if (ev.type === "error") throw { code: ev.code || "upstream_error", text: acc };
    };
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (line) { let ev; try { ev = JSON.parse(line); } catch (e) { continue; } handle(ev); }
        }
      }
    } catch (e) {
      // note: a DOMException AbortError has a numeric .code, so test the name first
      if ((e && e.name === "AbortError") || (signal && signal.aborted)) throw { code: "cancelled", text: acc };
      if (e && typeof e.code === "string") throw e; // { code, text } thrown by handle()
      throw { code: "upstream_error", text: acc };
    }
    if (stop === null) throw { code: "upstream_error", text: acc };
    if (!acc) throw { code: "empty_completion" };
    return { text: acc, truncated: stop === "max_tokens" };
  }

  const downloads = {
    async save({ filename, data }) {
      const type = /\.json$/i.test(filename) ? "application/json" : "text/plain";
      const url = URL.createObjectURL(new Blob([data], { type: type + ";charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.style.display = "none";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return {};
    }
  };

  async function init() {
    // [ARTIFACT-RUNTIME] optional legacy path, off by default (see runtime-artifact.js)
    if (cfg().useArtifactRuntime && window.HT_ARTIFACT_RUNTIME) {
      try { return await window.HT_ARTIFACT_RUNTIME.init(); } catch (e) { /* fall through to the server */ }
    }
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 6000);
      const res = await fetch(cfg().healthEndpoint, { cache: "no-store", signal: ctl.signal });
      clearTimeout(t);
      const j = res.ok ? await res.json() : null;
      if (j && j.ai && j.ai.configured) return { sample, downloads };
      reason = j ? "not_configured" : "unreachable";
    } catch (e) { reason = "unreachable"; }
    return { sample: null, downloads };
  }

  const reasonText = () =>
    reason === "not_configured"
      ? "AI features are not set up on this site yet. The analyzer, answer check, coach and citation check still work because they run in your browser."
      : "AI features could not be reached right now. Reload the page to try again. Everything that runs in your browser still works.";

  return { init, reasonText };
})();
