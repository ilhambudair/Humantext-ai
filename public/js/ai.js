"use strict";
/* HumanText AI — AI plumbing (runtime bootstrap, error mapping, prompts), Natural Rewriter, before/after view. */
/* ---------- runtime capabilities ---------- */
// [ARTIFACT-RUNTIME -> replaced] In the Claude Artifact version this block called
// window.claude.use("sample") and window.claude.use("downloads"). Both now come from HT_RUNTIME
// (js/runtime.js): sample -> POST /api/ai (server-side proxy, API key never in the browser),
// downloads -> a normal browser download. The original integration is preserved in
// js/runtime-artifact.js (optional, not loaded by default).
let sampleFn = null, dlFn = null, capsResolved = false, rewriteBlocked = null;
async function initRuntime() {
  try {
    const rt = await HT_RUNTIME.init();
    sampleFn = rt.sample; dlFn = rt.downloads;
  } catch (e) { }
  capsResolved = true;
  renderRewriteStatus();
  renderCompare();
  refreshAiNotes();
}

const ERR = {
  not_configured: "AI features are not set up on this site yet. Everything that runs in your browser still works.",
  access_denied: "That access code did not work. Try again.",
  // [ARTIFACT-RUNTIME] the next five codes only occur when running inside Claude Artifact (js/runtime-artifact.js)
  not_granted: "This page has not been allowed to use Claude, so AI features are unavailable here.",
  sampling_disabled: "Claude is not available on this account, so AI features are unavailable here.",
  not_declared: "AI features are not available in this view.",
  capability_disabled: "AI features are not available in this view.",
  capability_removed: "AI features are not available in this view.",
  rate_limited: "Too many requests, or a usage limit was reached. Wait a moment, then try again.",
  session_expired: "Your session expired. Sign in again and retry.",
  refused: "Claude could not help with this request. Change what you are asking for and try again.",
  empty_completion: "Nothing came back. Try a shorter passage.",
  prompt_too_large: "The text is too long for one request. Try a few paragraphs at a time.",
  upstream_error: "The connection dropped. Please try again."
};
const PERMANENT = ["not_configured", "not_granted", "sampling_disabled", "not_declared", "capability_disabled", "capability_removed"];
const errText = code => ERR[code] || MSG.generic;

function aiProblem() {
  if (!capsResolved) return null;
  if (rewriteBlocked) return rewriteBlocked;
  if (!sampleFn) return HT_RUNTIME.reasonText();
  return null;
}
function refreshAiNotes() {
  const p = aiProblem();
  $$("[data-ainote]").forEach(el => { el.innerHTML = p ? `<div class="notice warn">${esc(p)}</div>` : ""; });
  $$("[data-ai]").forEach(b => { if (!b.dataset.busy) b.disabled = !!p; });
  renderRewriteStatus();
}
function aiGate() {
  if (!capsResolved) { toast("Still connecting to the AI service — give it a moment and try again."); return false; }
  const p = aiProblem();
  if (p) { toast(p); return false; }
  return true;
}
function handleAIError(e) {
  const code = (e && e.code) || "upstream_error";
  if (PERMANENT.includes(code)) { rewriteBlocked = ERR[code]; sampleFn = null; refreshAiNotes(); }
  return errText(code);
}
function parseLooseJSON(t) {
  const s = String(t || "").trim();
  try { return JSON.parse(s); } catch (e) { }
  const f = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (f) { try { return JSON.parse(f[1]); } catch (e) { } }
  const a = s.search(/[\[{]/), b = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { } }
  throw { code: "invalid_json" };
}
async function askAI(prompt, { json = false, onText, signal, tier = "default" } = {}) {
  if (new TextEncoder().encode(prompt).length > 62000) throw { code: "prompt_too_large" };
  const o = { modelTier: tier, cache: false };
  if (signal) o.signal = signal;
  if (onText) o.onText = onText;
  if (json && typeof sampleFn.json === "function") return sampleFn.json(prompt, o);
  const r = await sampleFn(prompt, o);
  return json ? parseLooseJSON(r.text) : r;
}
async function withBusy(btn, label, fn) {
  if (!btn) return fn();
  const html = btn.innerHTML;
  btn.dataset.busy = "1"; btn.disabled = true; btn.innerHTML = `<span class="spin"></span> ${esc(label)}`;
  try { return await fn(); }
  finally { delete btn.dataset.busy; btn.innerHTML = html; btn.disabled = false; refreshAiNotes(); }
}

/* ---------- style picker ---------- */
let curStyle = "student", curLang = "same";
function renderStyles() {
  $("#stylePicker").innerHTML = STYLES.map(s => `
    <label class="style-opt"><input type="radio" name="style" value="${s.id}" ${s.id === curStyle ? "checked" : ""}>
      <strong>${s.name}</strong><small>${s.desc}</small></label>`).join("");
  const mark = () => $$('input[name="style"]').forEach(x => x.closest(".style-opt").classList.toggle("is-sel", x.checked));
  $$('input[name="style"]').forEach(r => r.onchange = () => {
    curStyle = r.value; mark();
    $("#customWrap").style.display = curStyle === "custom" ? "block" : "none";
  });
  mark();
  $("#customWrap").style.display = curStyle === "custom" ? "block" : "none";
}
$("#langSel").onchange = e => { curLang = e.target.value; };

function toneLine(v) {
  return v <= 20 ? "Tone: clearly formal." : v <= 40 ? "Tone: leaning formal." : v <= 60 ? "Tone: neutral, with no strong lean either way."
    : v <= 80 ? "Tone: leaning casual and conversational." : "Tone: clearly casual and conversational, while staying correct and clear.";
}
function lengthLine(v) {
  return v <= 20 ? "Length: noticeably shorter, about 25–30% fewer words, by cutting filler and repetition, never facts, figures or citations."
    : v <= 40 ? "Length: somewhat shorter, about 10–15% fewer words, by trimming filler and repetition."
    : v <= 60 ? "Length: about the same as the original, within 10%."
    : v <= 80 ? "Length: somewhat fuller, up to about 15% longer, by spelling out reasoning already implicit in the text. Add no new facts."
    : "Length: detailed, up to about 30% longer, by clarifying reasoning and connections already in the text. Add no new facts, examples, data or sources.";
}
const PERS = {
  Neutral: "Personality: neutral and unobtrusive.",
  Personal: "Personality: warm and personal; first person is fine where the original already implies the author's own view.",
  Student: "Personality: a thoughtful student explaining what they understood, in their own words.",
  Professional: "Personality: composed, competent and direct."
};

function buildPrompt(text) {
  const s = STYLES.find(x => x.id === curStyle);
  const brief = curStyle === "custom"
    ? ($("#customInstr").value.trim() || "Make the text read more naturally and clearly.")
    : s.prompt;
  return [
    "You are editing a piece of writing on behalf of its own author. Rewrite the text between the markers.",
    "",
    "Rules:",
    "- Preserve the meaning and every factual claim, number, date, name, quotation, citation and reference exactly as given.",
    "- Never invent facts, data, sources or citations that are not already in the text.",
    "- Keep specialised terminology and the order of the argument.",
    "- Vary sentence length and structure the way a real writer does; drop formulaic connectors and template phrasing.",
    "- Do not introduce grammatical errors, typos or awkward phrasing on purpose, and do not imitate mistakes.",
    "- Do not claim or imply anything about who or what wrote the text, and never mention AI detectors.",
    "- " + lengthLine(+$("#lenRange").value),
    "- " + toneLine(+$("#toneRange").value),
    "- " + (PERS[$("#persSel").value] || PERS.Neutral),
    "- Keep the existing paragraph breaks unless merging or splitting clearly helps the reader.",
    curLang === "same" ? "- Write in the same language as the original text." : "- Write in " + curLang + ".",
    "- Reply with the rewritten text only: no preamble, no title, no commentary, no markdown fences.",
    "",
    "Style brief: " + brief,
    "",
    "---BEGIN TEXT---", text, "---END TEXT---"
  ].join("\n");
}

function renderRewriteStatus(msg, kind) {
  const el = $("#rewriteStatus"), btn = $("#rewriteBtn");
  if (!el || !btn) return;
  if (msg) { el.innerHTML = `<div class="notice ${kind || ""}" role="alert">${esc(msg)}</div>`; return; }
  const p = aiProblem();
  if (p) {
    el.innerHTML = `<div class="notice warn"><strong>Rewriting is unavailable right now.</strong> ${esc(p)} The analyzer still works — it runs entirely in your browser.</div>`;
    btn.disabled = true;
  } else { el.innerHTML = ""; if (!state.streaming) btn.disabled = false; }
}

/* ---------- rewriting ---------- */
let ctl = null;
async function doRewrite() {
  const text = editor.value.trim();
  if (page !== "rewriter") go("rewriter");
  if (!text) { renderRewriteStatus(MSG.empty, "warn"); editor.focus(); return; }
  if (wordsOf(text).length < 5) { renderRewriteStatus(MSG.short, "warn"); return; }
  if (!capsResolved) { renderRewriteStatus("Still connecting to the AI service — give it a moment and press the button again."); return; }
  if (aiProblem()) { renderRewriteStatus(); return; }
  const prompt = buildPrompt(text);
  if (new TextEncoder().encode(prompt).length > 62000) {
    renderRewriteStatus("That text is too long for a single request. Rewrite it a few paragraphs at a time.", "warn"); return;
  }

  state.rewrite = { original: text, out: "", done: false, style: curStyle, truncated: false };
  state.streaming = true;
  $("#rewriteBtn").disabled = true;
  $("#rewriteBtn").innerHTML = '<span class="spin"></span> Thinking…';
  $("#stopBtn").style.display = "";
  renderRewriteStatus();
  renderCompare();

  ctl = new AbortController();
  try {
    const res = await sampleFn(prompt, {
      signal: ctl.signal, modelTier: "default", cache: false,
      onText: ({ text: t }) => {
        state.rewrite.out = t;
        streamInto($("#compareWrap"), t);
        $("#rewriteBtn").innerHTML = '<span class="spin"></span> Writing…';
      }
    });
    state.rewrite.out = res.text.trim();
    state.rewrite.truncated = res.truncated;
    state.rewrite.done = true;
    pushHistory({
      kind: "rewrite", title: titleFrom(text), words: wordsOf(state.rewrite.out).length, style: STYLES.find(s => s.id === curStyle).name,
      preview: state.rewrite.out.slice(0, 160),
      text: settings.storeText ? text : null,
      rewrite: settings.storeRewrite ? state.rewrite.out : null
    });
  } catch (e) {
    const code = (e && e.code) || "upstream_error";
    if (code === "cancelled") {
      if (state.rewrite.out) { state.rewrite.done = true; renderRewriteStatus("Stopped. What arrived before you stopped is shown on the right.", ""); }
      else { state.rewrite = null; renderRewriteStatus(); }
    } else {
      if (e && e.text) { state.rewrite.out = e.text; state.rewrite.done = true; state.rewrite.interrupted = true; }
      else state.rewrite = null;
      const m = handleAIError(e);
      renderRewriteStatus(m, PERMANENT.includes(code) ? "warn" : "err");
    }
  } finally {
    state.streaming = false; ctl = null;
    $("#rewriteBtn").disabled = !!aiProblem();
    $("#rewriteBtn").textContent = "Make more natural";
    $("#stopBtn").style.display = "none";
    renderCompare();
  }
}
$("#rewriteBtn").onclick = doRewrite;
$("#stopBtn").onclick = () => { if (ctl) ctl.abort(); };

/* ---------- before / after comparison ---------- */
function paint(diff, side, show) {
  if (!show) return esc(side === "L" ? diff.map(d => d.t !== "ins" ? d.v : "").join("") : diff.map(d => d.t !== "del" ? d.v : "").join(""));
  return diff.map(d => {
    if (d.t === "eq") return esc(d.v);
    if (d.t === "del") return side === "L" ? `<del class="del">${esc(d.v)}</del>` : "";
    return side === "R" ? `<mark class="ins">${esc(d.v)}</mark>` : "";
  }).join("");
}
function streamInto(host, text) {
  const d = host && host.querySelector('[data-role="R"]');
  if (d) d.textContent = text;
}
/* r = {original, out, done, truncated, interrupted}; cfg = {busy, busyText, leftTitle, rightTitle, onStop, buttons:[{label, cls, fn}], note, after} */
function compareView(host, r, cfg) {
  const done = !!r.done && !cfg.busy;
  let diff = null, added = 0, removed = 0;
  if (done && r.out) {
    diff = diffTexts(r.original, r.out);
    diff.forEach(d => { const n = (d.v.match(/[\p{L}\p{N}]+/gu) || []).length; if (d.t === "ins") added += n; if (d.t === "del") removed += n; });
  }
  const lw = wordsOf(r.original).length, rw = wordsOf(r.out || "").length;
  const btns = done ? (cfg.buttons || []) : [];
  host.innerHTML = `
  <div class="panel" style="display:flex;flex-wrap:wrap;gap:1rem;align-items:center;justify-content:space-between;padding:.85rem 1.35rem">
    <div class="diff-legend">
      ${done ? `<span><span class="swatch" style="background:var(--blue-soft);box-shadow:inset 0 -1px 0 var(--blue)"></span>changed</span>
      <span><span class="swatch" style="background:var(--red-soft);box-shadow:inset 0 -1px 0 var(--red)"></span>removed</span>
      <span>${added} words in, ${removed} out</span>` : `<span><span class="spin"></span> ${esc(cfg.busyText || "Writing the natural version…")}</span>${cfg.onStop ? ` <button class="btn btn-sm" data-role="stop">Stop</button>` : ""}`}
    </div>
    ${done ? `<label style="display:flex;gap:.45rem;align-items:center;font-size:.85rem;cursor:pointer">
      <input type="checkbox" data-role="diff" ${state.showDiff ? "checked" : ""} style="accent-color:var(--blue)"> Highlight changes</label>` : ""}
  </div>

  <div class="compare has-vs">
    <div class="col"><div class="col-head"><h3>${esc(cfg.leftTitle || "Original")}</h3><small>${lw} words</small></div>
      <div class="doc" data-role="L">${done ? paint(diff, "L", state.showDiff) : esc(r.original)}</div></div>
    <div class="vs" aria-hidden="true">vs</div>
    <div class="col"><div class="col-head"><h3>${esc(cfg.rightTitle || "Natural version")}</h3><small>${rw ? rw + " words" : "…"}</small></div>
      <div class="doc" data-role="R">${done ? paint(diff, "R", state.showDiff) : esc(r.out || "")}</div></div>
  </div>

  ${r.truncated ? `<div class="notice warn" style="margin-top:1rem">The answer was cut short at the length limit. Use a shorter passage for a complete version.</div>` : ""}
  ${r.interrupted ? `<div class="notice err" style="margin-top:1rem">The connection dropped part way. What arrived is shown above — try again for a complete version.</div>` : ""}

  ${done && btns.length ? `<div class="panel" style="margin-top:1rem">
    <div class="btn-row">${btns.map((b, i) => `<button class="btn ${b.cls || ""}" data-act="${i}">${esc(b.label)}</button>`).join("")}</div>
    ${cfg.note ? `<p style="font-size:.84rem;color:var(--ink-3);margin:.9rem 0 0">${esc(cfg.note)}</p>` : ""}
  </div>` : ""}
  ${done ? (cfg.after || "") : ""}`;

  const dt = host.querySelector('[data-role="diff"]');
  if (dt) dt.onchange = e => { state.showDiff = e.target.checked; compareView(host, r, cfg); };
  const st = host.querySelector('[data-role="stop"]');
  if (st) st.onclick = cfg.onStop;
  host.querySelectorAll("[data-act]").forEach(b => b.onclick = () => btns[+b.dataset.act].fn());
}

function replaceOriginal() {
  const r = state.rewrite;
  if (!r || !r.out) return;
  const ctx = state.paraCtx;
  if (ctx) {
    const i = ctx.full.indexOf(ctx.para);
    if (i < 0) { toast("Could not place the paragraph automatically — use Copy Result instead."); return; }
    editor.value = ctx.full.slice(0, i) + r.out + ctx.full.slice(i + ctx.para.length);
    state.paraCtx = null; updateCtxBar(); state.rewrite = null; renderCompare();
    toast("Paragraph replaced in your full draft.");
  } else {
    editor.value = r.out; toast("Editor replaced with the natural version.");
  }
  updateCounts(); state.analysis = null; renderDetector(); saveDrafts();
}

function renderCompare() {
  const w = $("#compareWrap");
  const r = state.rewrite;
  if (!r) {
    w.innerHTML = `<div class="empty"><strong>No rewrite yet</strong>
      Paste your text above, pick a style, and press “Make more natural”. Your original is kept side by side so you can decide, sentence by sentence, what to accept.</div>`;
    return;
  }
  compareView(w, r, {
    busy: state.streaming, busyText: "Writing the natural version…",
    leftTitle: "Original", rightTitle: "Natural version",
    buttons: [
      { label: "Copy Result", fn: () => copy(r.out, "Natural version") },
      { label: "Replace Original", fn: replaceOriginal },
      { label: "Try Again", fn: doRewrite },
      { label: "Clear", fn: () => { state.rewrite = null; renderCompare(); } },
      { label: "Download", fn: () => download("natural-version.txt", r.out) },
      { label: "Analyze the new version", cls: "btn-quiet", fn: () => { editor.value = r.out; updateCounts(); go("detector"); runAnalysis(); } }
    ],
    note: "Read the changes before you accept them. Facts, figures and citations were kept as written, but only you can tell whether each new sentence still says what you meant."
  });
}
