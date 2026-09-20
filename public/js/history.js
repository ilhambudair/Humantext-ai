"use strict";
/* HumanText AI — History (localStorage only). */
/* ============================================================
   HISTORY
   ============================================================ */
const KIND_LABEL = { analysis: "Analysis", rewrite: "Rewrite", answer: "Answer" };
function renderHistory() {
  const el = $("#historyBody");
  if (!history.length) {
    el.innerHTML = `<div class="empty"><strong>Nothing saved yet</strong>
      Analyses, rewrites and improved answers you run will be listed here, on this device only. You can switch this off in Settings.</div>`;
    return;
  }
  el.innerHTML = `<div class="panel"><ul class="hist">${history.map(h => {
    const an = h.analysis;
    return `<li>
      <div style="min-width:0">
        <span class="hist-title">${esc(histTitle(h))}</span>
        <span class="hist-prev">${esc(h.preview || "(text not stored)")}</span>
        <div class="hist-meta">
          <span>${KIND_LABEL[h.kind] || "Entry"}</span>
          <span>${fmtDate(h.at)}</span>
          <span>${(h.words || 0).toLocaleString()} words</span>
          ${h.kind === "analysis" ? `<span class="pill ${h.band}">AI-like ${h.ai} · ${bandShort(h.band)}</span>${an ? `<span>Natural ${an.naturalness}</span><span>Readability ${an.readability}</span>` : ""}` : `<span>${esc(h.style || "")}</span>`}
          ${h.text ? "" : "<span>text not stored</span>"}
        </div>
      </div>
      <div class="btn-row">
        ${h.text || h.rewrite ? `<button class="btn btn-sm" data-open="${h.id}">Open</button>` : ""}
        <button class="btn btn-sm" data-rename="${h.id}">Rename</button>
        ${h.text || h.rewrite || h.preview ? `<button class="btn btn-sm" data-cp="${h.id}">Copy</button>` : ""}
        <button class="btn btn-sm btn-quiet" data-del="${h.id}">Delete</button>
      </div>
    </li>`; }).join("")}</ul>
    <div class="btn-row" style="margin-top:1.1rem">
      <button class="btn btn-sm" id="clearHist2">Clear history</button>
      <span style="font-size:.82rem;color:var(--ink-3)">${history.length} entr${history.length === 1 ? "y" : "ies"}, stored in this browser and never sent to a server</span>
    </div></div>`;

  $$("[data-open]").forEach(b => b.onclick = () => {
    const h = history.find(x => x.id === b.dataset.open);
    if (!h) return;
    if (h.kind === "answer") {
      $("#ansQ").value = h.question || ""; $("#ansA").value = h.text || ""; ansCounts();
      ans.improve = h.rewrite ? { res: { original: h.text || "", out: h.rewrite, done: true }, notes: null } : null;
      go("answer"); $("#ansAnalysis").innerHTML = ""; paintImprove(ansGetO, false);
    } else if (h.kind === "rewrite" && h.rewrite && h.text) {
      state.paraCtx = null; updateCtxBar();
      editor.value = h.text; updateCounts();
      state.rewrite = { original: h.text, out: h.rewrite, done: true, style: curStyle };
      go("rewriter"); renderCompare();
    } else {
      state.paraCtx = null; updateCtxBar();
      editor.value = h.text || h.rewrite || ""; updateCounts();
      go("detector"); runAnalysis();
    }
  });
  $$("[data-rename]").forEach(b => b.onclick = async () => {
    const h = history.find(x => x.id === b.dataset.rename);
    if (!h) return;
    const v = await askText("Rename entry", histTitle(h));
    if (v === null) return;
    h.title = v || titleFrom(h.preview || h.text || ""); saveHistory(); renderHistory(); toast("Renamed.");
  });
  $$("[data-cp]").forEach(b => b.onclick = () => {
    const h = history.find(x => x.id === b.dataset.cp);
    if (h) copy(h.rewrite || h.text || h.preview || "", h.rewrite ? "Rewritten text" : "Text");
  });
  $$("[data-del]").forEach(b => b.onclick = () => {
    history = history.filter(x => x.id !== b.dataset.del); saveHistory(); renderHistory();
  });
  $("#clearHist2").onclick = clearHistory;
}
async function clearHistory() {
  if (!history.length) return toast("History is already empty.");
  if (!(await askConfirm("Clear local history?", "Delete all " + history.length + " saved entries? This cannot be undone.", "Delete all"))) return;
  history = []; saveHistory(); renderHistory(); toast("History cleared.");
}
