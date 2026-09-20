// A tiny fake of Anthropic's streaming Messages API. Used by `npm run dev:mock` and the tests.
// The answers are CANNED — they exist to exercise the UI and the proxy, not to be good writing.
import http from "node:http";

const between = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b); return i >= 0 && j > i ? s.slice(i + a.length, j).trim() : ""; };

export function kindOf(p) {
  if (p.includes("reviewing a student")) return "review";
  if (p.includes("clarify and tidy THEIR OWN")) return "improve";
  if (p.includes("format reference list entries")) return "refs";
  if (p.includes("writing coach")) return "coach";
  if (p.includes("editing a piece of writing")) return "rewrite";
  return "other";
}

export function respond(prompt) {
  switch (kindOf(prompt)) {
    case "review": return JSON.stringify({
      coverage: 70, structure: 60, clarity: 80, relevance: 75,
      checks: [
        { id: "answers", status: "ok", comment: "AI: answers partly." }, { id: "unexplained", status: "needs_work", comment: "AI: example is missing." },
        { id: "argument", status: "ok", comment: "AI arg" }, { id: "structure", status: "good", comment: "AI structure" },
        { id: "repetition", status: "needs_work", comment: "AI repetition" }, { id: "generic", status: "needs_work", comment: "AI generic" },
        { id: "example", status: "needs_work", comment: "AI example" }, { id: "references", status: "na", comment: "AI refs" }],
      missing: ["Give one concrete example from your own study experience"], strengths: ["Clear position on motivation"] });
    case "improve": return "IMPROVED: " + between(prompt, "---BEGIN ANSWER---", "---END ANSWER---") + "\n===NOTES===\nCHANGES\n- Tightened the opening\n- Merged repeated sentences\nSTILL MISSING\n- A concrete example";
    case "refs": return "[1] Rahman, A., & Sari, P. (2021). Pembelajaran daring. *Jurnal Teknologi Pendidikan*, 12(3), 45-60.\n[2] Widodo, B. (2019). *Motivasi belajar mahasiswa* [publisher missing].\n===NOTES===\n- Entry 2: publisher missing";
    case "coach": return JSON.stringify({ main_idea: { clear: "yes", comment: "Your main idea is clear." }, strengths: ["Good flow"], suggestions: [{ where: "Paragraph 1", comment: "This paragraph could use an example." }], questions: ["Who is this for?"] });
    case "rewrite": return "Natural: " + between(prompt, "---BEGIN TEXT---", "---END TEXT---");
    default: return "ok";
  }
}

export function createMockAnthropic() {
  const state = { mode: "normal", last: {}, calls: 0, lastHeaders: null, lastBody: null };
  const json = (res, status, obj) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/__mode") { state.mode = url.searchParams.get("set") || "normal"; return json(res, 200, { mode: state.mode }); }
    if (url.pathname === "/__last") return json(res, 200, { prompt: state.last[url.searchParams.get("kind")] || null });
    if (url.pathname === "/__state") return json(res, 200, { mode: state.mode, calls: state.calls, headers: state.lastHeaders, body: state.lastBody && { model: state.lastBody.model, max_tokens: state.lastBody.max_tokens, stream: state.lastBody.stream } });
    if (req.method !== "POST" || url.pathname !== "/v1/messages") return json(res, 404, { type: "error", error: { type: "not_found_error", message: "not found" } });

    const chunks = []; for await (const c of req) chunks.push(c);
    let body; try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return json(res, 400, { type: "error", error: { type: "invalid_request_error", message: "bad json" } }); }
    state.calls++;
    state.lastHeaders = { "x-api-key": req.headers["x-api-key"], "anthropic-version": req.headers["anthropic-version"], "content-type": req.headers["content-type"] };
    state.lastBody = body;
    const prompt = body.messages && body.messages[0] && body.messages[0].content || "";
    state.last[kindOf(prompt)] = prompt;

    if (state.mode === "401") return json(res, 401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
    if (state.mode === "429") return json(res, 429, { type: "error", error: { type: "rate_limit_error", message: "rate limited" } });
    if (state.mode === "500") return json(res, 500, { type: "error", error: { type: "api_error", message: "boom" } });
    if (state.mode === "overloaded") return json(res, 529, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } });
    if (state.mode === "toolong") return json(res, 400, { type: "error", error: { type: "invalid_request_error", message: "prompt is too long: 250000 tokens > 200000 maximum" } });

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream");
    const ev = (name, data) => res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    let closed = false; res.on("close", () => { closed = true; });

    ev("message_start", { type: "message_start", message: { id: "msg_mock", type: "message", role: "assistant", content: [], model: body.model } });
    ev("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });

    if (state.mode === "slow") {
      ev("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "PARTIAL ANSWER text here. more" } });
      for (let i = 0; i < 50 && !closed; i++) await sleep(100);
      return res.end();
    }
    if (state.mode === "empty") { ev("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" } }); ev("message_stop", { type: "message_stop" }); return res.end(); }
    if (state.mode === "refuse") { ev("message_delta", { type: "message_delta", delta: { stop_reason: "refusal" } }); ev("message_stop", { type: "message_stop" }); return res.end(); }

    const out = respond(prompt);
    const n = Math.max(1, Math.ceil(out.length / 3)), pieces = [out.slice(0, n), out.slice(n, 2 * n), out.slice(2 * n)].filter(Boolean);
    for (const p of pieces) {
      ev("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: p } });
      await sleep(15);
      if (state.mode === "error_mid") { ev("error", { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }); return res.end(); }
    }
    ev("content_block_stop", { type: "content_block_stop", index: 0 });
    ev("message_delta", { type: "message_delta", delta: { stop_reason: state.mode === "truncate" ? "max_tokens" : "end_turn" } });
    ev("message_stop", { type: "message_stop" });
    res.end();
  });

  return {
    server, state,
    listen: (port = 0) => new Promise(resolve => server.listen(port, "127.0.0.1", () => resolve(server.address().port))),
    close: () => new Promise(resolve => { server.closeAllConnections && server.closeAllConnections(); server.close(() => resolve()); })
  };
}
