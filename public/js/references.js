"use strict";
/* HumanText AI — Reference Assistant (AI formatting + local citation-consistency check). */
/* ============================================================
   REFERENCE ASSISTANT
   ============================================================ */
let refStyle = "APA 7", refState = null, refCtl = null;
function syncRefStyle() { $$("[data-refstyle]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.refstyle === refStyle))); }
$$("[data-refstyle]").forEach(b => b.onclick = () => { refStyle = b.dataset.refstyle; syncRefStyle(); });
$("#refSrc").addEventListener("input", saveDrafts);
$("#refText").addEventListener("input", saveDrafts);
$("#refList").addEventListener("input", saveDrafts);
$("#refSample").onclick = () => { $("#refSrc").value = REF_SAMPLE; saveDrafts(); toast("Sample loaded — these are fictional sources for demonstration."); };
$("#refClear").onclick = () => { $("#refSrc").value = ""; refState = null; $("#refOut").innerHTML = ""; saveDrafts(); };

function refPrompt(src) {
  const order = refStyle === "IEEE" ? "Number entries [1], [2], … in the order given." : "Sort entries alphabetically by the first author's surname.";
  return [
    "You format reference list entries for a student. Citation style: " + refStyle + ".",
    "",
    "Rules:",
    "- Use ONLY the details the user gave. Never invent or guess authors, years, titles, journals, volumes, pages, DOIs or URLs.",
    "- If a required element is missing, keep the entry as complete as possible and put a marker such as [year missing] where that element belongs.",
    "- Do not add sources that were not provided. One entry per source.",
    "- " + order,
    "- You cannot show italics, so wrap the parts that should be italic (book titles, journal names, as the style requires) in *asterisks*.",
    "- Keep names and titles in their original language.",
    "",
    "Output format, exactly: the reference list only, one entry per line, no blank lines and no commentary; then a line containing only ===NOTES===; then lines starting with '-' that say what is missing or ambiguous, per entry, in " + fbName() + ". If nothing is missing write '- No missing details spotted.'",
    "",
    "---BEGIN SOURCES---", src, "---END SOURCES---"
  ].join("\n");
}
function parseRefOut(text) {
  const [list, notes = ""] = String(text).split(/\n?[ \t]*===NOTES===[ \t]*\n?/);
  return { entries: list.split("\n").map(s => s.trim()).filter(Boolean), notes: notes.split("\n").map(x => x.replace(/^\s*[-•*]\s*/, "").trim()).filter(Boolean) };
}
const refItalics = s => esc(s).replace(/\*([^*\n]+)\*/g, "<em>$1</em>").replace(/\[([^\]]*missing[^\]]*)\]/gi, "<mark>[$1]</mark>");
const refPlain = entries => entries.map(e => e.replace(/\*/g, "")).join("\n\n");

function renderRefOut() {
  const el = $("#refOut"), r = refState;
  if (!r) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="panel"><h2 class="panel-title">${esc(r.style)} reference list</h2>
    ${r.busy ? `<div class="thinking" style="margin-bottom:.8rem"><span class="spin"></span> Formatting… <button class="btn btn-sm" id="refStop">Stop</button></div>` : `<p class="panel-sub">Check every entry against your sources. Missing details are marked in the list.</p>`}
    <div class="ref-out" id="refOutList">${r.entries.map(e => `<p>${refItalics(e)}</p>`).join("")}</div>
    ${!r.busy && r.notes.length ? `<div class="subtle-h">${tr("Notes", "Catatan")}</div><ul class="bullets">${r.notes.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    ${!r.busy && r.entries.length ? `<div class="btn-row" style="margin-top:1rem"><button class="btn" id="refCopy">Copy Result</button><button class="btn" id="refToCheck">Use in consistency check</button>
      <button class="btn" id="refTry">Try Again</button><button class="btn" id="refDl">Download</button><button class="btn btn-quiet" id="refClr">Clear</button></div>` : ""}
  </div>`;
  if (r.busy) { $("#refStop").onclick = () => { if (refCtl) refCtl.abort(); }; return; }
  if (!r.entries.length) return;
  $("#refCopy").onclick = () => copy(refPlain(r.entries), "References");
  $("#refToCheck").onclick = () => { $("#refList").value = refPlain(r.entries); saveDrafts(); toast("Reference list copied into the consistency check."); $("#refList").scrollIntoView({ behavior: "smooth", block: "center" }); };
  $("#refTry").onclick = doFormatRefs;
  $("#refDl").onclick = () => download("references.txt", refPlain(r.entries));
  $("#refClr").onclick = () => { refState = null; renderRefOut(); };
}
async function doFormatRefs() {
  const src = $("#refSrc").value.trim();
  if (!src) { $("#refOut").innerHTML = `<div class="notice warn" role="alert">${MSG.empty}</div>`; return; }
  if (!aiGate()) return;
  setFb(src);
  refState = { style: refStyle, entries: [], notes: [], busy: true };
  renderRefOut();
  refCtl = new AbortController();
  await withBusy($("#refFormat"), "Formatting…", async () => {
    try {
      const r = await askAI(refPrompt(src), { signal: refCtl.signal, onText: ({ text }) => { const p = parseRefOut(text); refState.entries = p.entries; renderRefOut(); } });
      const p = parseRefOut(r.text);
      refState = { style: refState.style, entries: p.entries, notes: p.notes, busy: false };
      if (!p.entries.length) refState = null;
      if (!refState) $("#refOut").innerHTML = `<div class="notice warn">${ERR.empty_completion}</div>`; else renderRefOut();
    } catch (e) {
      const code = (e && e.code) || "upstream_error";
      if (code === "cancelled") { refState = refState && refState.entries.length ? { ...refState, busy: false } : null; renderRefOut(); }
      else { const m = handleAIError(e); refState = null; $("#refOut").innerHTML = `<div class="notice err" role="alert">${esc(m)}</div>`; }
    } finally { refCtl = null; }
  });
}
$("#refFormat").onclick = doFormatRefs;

/* ---- citation consistency (runs locally) ---- */
const SUR = "\\p{Lu}[\\p{L}'’-]+";
const NOT_SUR = new Set(["figure", "fig", "table", "tabel", "gambar", "chapter", "bab", "section", "eq", "equation", "appendix", "lampiran", "page", "halaman", "hlm", "pp", "no", "vol", "see", "lihat"]);
function extractCitations(text) {
  const out = [];
  const t = text.replace(/\[(\d+)\]\s*[–-]\s*\[(\d+)\]/g, (m, a, b) => `[${a}-${b}]`);
  let m;
  const numRe = /\[(\d+(?:\s*[-–,]\s*\d+)*)\]/g;
  while ((m = numRe.exec(t))) {
    m[1].split(",").forEach(part => {
      const r = part.trim().split(/\s*[-–]\s*/).map(x => parseInt(x, 10));
      if (r.length === 2 && r[1] >= r[0] && r[1] - r[0] < 60) { for (let k = r[0]; k <= r[1]; k++) out.push({ kind: "num", num: k }); }
      else if (Number.isFinite(r[0])) out.push({ kind: "num", num: r[0] });
    });
  }
  const yearRe = /((?:19|20)\d{2}[a-z]?|n\.d\.)/;
  const surRe = new RegExp("(" + SUR + ")", "u");
  const mlaRe = new RegExp("^(" + SUR + ")(?:\\s+(?:and|&|dan)\\s+" + SUR + "|\\s+et\\s+al\\.?)?\\s+(\\d+(?:\\s*[-–]\\s*\\d+)?)$", "u");
  const parRe = /\(([^()]{2,240})\)/g;
  while ((m = parRe.exec(t))) {
    m[1].split(";").forEach(part => {
      const p = part.trim().replace(/^(?:see also|see|cf\.?|e\.g\.,?|lihat juga|lihat|misalnya)\s+/i, "");
      const ym = p.match(yearRe);
      if (ym) {
        const before = p.slice(0, ym.index), sm = before.match(surRe);
        if (!sm || NOT_SUR.has(sm[1].toLowerCase())) return;
        const rest = before.slice(sm.index + sm[1].length).replace(/\s*(?:&|and|dan|et\s+al\.?)\s*/gi, " ");
        if (!/^[\s,]*(?:\p{Lu}[\p{L}'’.-]*[\s,]*)*$/u.test(rest)) return;
        out.push({ kind: "ay", sur: sm[1], year: ym[1] });
      } else {
        const mm = p.match(mlaRe);
        if (mm && !NOT_SUR.has(mm[1].toLowerCase())) out.push({ kind: "mla", sur: mm[1], year: null });
      }
    });
  }
  const narRe = new RegExp("(" + SUR + ")(?:\\s+(?:and|&|dan)\\s+" + SUR + "|\\s+et\\s+al\\.?)?\\s*\\(((?:19|20)\\d{2}[a-z]?|n\\.d\\.)[^)]*\\)", "gu");
  while ((m = narRe.exec(t))) { if (!NOT_SUR.has(m[1].toLowerCase())) out.push({ kind: "ay", sur: m[1], year: m[2] }); }
  return out;
}
function parseRefs(list) {
  const lines = list.replace(/\r/g, "").split("\n");
  const numRx = /^\s*(?:\[(\d+)\]|(\d+)[.)])\s+\S/;
  const numbered = lines.filter(l => numRx.test(l)).length >= 2;
  let entries = [];
  if (numbered) lines.forEach(l => { if (numRx.test(l)) entries.push(l.trim()); else if (l.trim() && entries.length) entries[entries.length - 1] += " " + l.trim(); });
  else if (/\n\s*\n/.test(list.trim())) entries = list.trim().split(/\n\s*\n/).map(s => s.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);
  else entries = lines.map(s => s.trim()).filter(Boolean);
  return entries.map((t, i) => {
    const mn = t.match(/^\s*(?:\[(\d+)\]|(\d+)[.)])\s+/);
    const num = mn ? parseInt(mn[1] || mn[2], 10) : null;
    const body = mn ? t.slice(mn[0].length) : t;
    const ym = body.match(/\b((?:19|20)\d{2}[a-z]?)\b|\bn\.d\./);
    const region = ym && ym.index > 0 && ym.index < 160 ? body.slice(0, ym.index) : body.slice(0, 100);
    const surnames = new Set((region.match(/\p{Lu}[\p{L}'’-]{1,}/gu) || []).map(s => s.toLowerCase()));
    return { text: t, num, idx: i + 1, year: ym ? (ym[1] || "n.d.") : null, surnames };
  });
}
function checkConsistency(text, list) {
  const cites = extractCitations(text), refs = parseRefs(list);
  const res = { cites: cites.length, refs: refs.length, missing: [], uncited: [], yearMismatch: [], matched: [], notes: [] };
  const numCites = cites.filter(c => c.kind === "num"), ayCites = cites.filter(c => c.kind !== "num");
  if (numCites.length) {
    const refNums = new Map(refs.map((r, i) => [r.num != null ? r.num : i + 1, r]));
    const seen = new Map();
    numCites.forEach(c => seen.set(c.num, (seen.get(c.num) || 0) + 1));
    seen.forEach((cnt, n) => { if (refNums.has(n)) res.matched.push({ label: "[" + n + "]", ref: refNums.get(n).text, count: cnt }); else res.missing.push({ label: "[" + n + "]", count: cnt }); });
    refs.forEach((r, i) => { const n = r.num != null ? r.num : i + 1; if (!seen.has(n)) res.uncited.push({ label: "[" + n + "]", ref: r.text }); });
    const order = [...seen.keys()].filter(n => refNums.has(n));
    for (let i = 1; i < order.length; i++) if (order[i] < order[i - 1]) { res.notes.push(`Numbered styles usually follow the order sources are first cited. Here [${order[i]}] is first cited after [${order[i - 1]}].`); break; }
  }
  if (ayCites.length) {
    const groups = new Map();
    ayCites.forEach(c => {
      const k = c.sur.toLowerCase() + "|" + (c.year || "");
      const g = groups.get(k) || { sur: c.sur, year: c.year, count: 0 }; g.count++; groups.set(k, g);
    });
    const used = new Set();
    const norm = y => (y || "").toLowerCase().replace(/[a-z]$/, "");
    groups.forEach(g => {
      const label = g.year ? `${g.sur}, ${g.year}` : g.sur;
      const cands = refs.filter(r => r.surnames.has(g.sur.toLowerCase()));
      if (!cands.length) { res.missing.push({ label, count: g.count }); return; }
      if (!g.year) { cands.forEach(r => used.add(r)); res.matched.push({ label, ref: cands[0].text, count: g.count }); return; }
      const exact = cands.filter(r => r.year && r.year.toLowerCase() === g.year.toLowerCase());
      const loose = exact.length ? exact : cands.filter(r => norm(r.year) === norm(g.year));
      if (loose.length) { loose.forEach(r => used.add(r)); res.matched.push({ label, ref: loose[0].text, count: g.count }); }
      else { cands.forEach(r => used.add(r)); res.yearMismatch.push({ label, refYears: cands.map(r => r.year || "no year"), ref: cands[0].text, count: g.count }); }
    });
    refs.forEach(r => { if (!used.has(r)) res.uncited.push({ label: r.text.slice(0, 70) + (r.text.length > 70 ? "…" : ""), ref: r.text }); });
  }
  return res;
}
function renderConsistency(res) {
  const el = $("#refCheckOut");
  if (!res.cites) { el.innerHTML = `<div class="notice warn" role="alert">No in-text citations were found. Supported forms: (Author, 2020), Author (2020), [1] and (Author 45).</div>`; return; }
  const ok = !res.missing.length && !res.uncited.length && !res.yearMismatch.length;
  const sect = (title, sub, items, fmt) => items.length ? `<div class="subtle-h">${title} (${items.length})</div><p class="panel-sub" style="margin-bottom:.4rem">${sub}</p><ul class="bullets">${items.map(fmt).join("")}</ul>` : "";
  el.innerHTML = `<div class="panel"><h2 class="panel-title">Citation consistency</h2>
    <p class="panel-sub">${res.cites} citation${res.cites === 1 ? "" : "s"} in the text, ${res.refs} entr${res.refs === 1 ? "y" : "ies"} in the reference list.</p>
    ${ok ? `<div class="notice" style="border-left-color:var(--green)"><strong>Everything lines up.</strong> Every citation has a matching entry and every listed source is cited.</div>` : ""}
    ${sect("Cited but missing from the reference list", "No entry in your list matches these citations.", res.missing, m => `<li><b>${esc(m.label)}</b> (cited ${m.count}×)</li>`)}
    ${sect("Year does not match", "The author is in your list, but with a different year.", res.yearMismatch, m => `<li><b>${esc(m.label)}</b>: the list has ${esc(m.refYears.join(", "))}</li>`)}
    ${sect("In the reference list but never cited", "Add an in-text citation or remove the entry if it is not used.", res.uncited, m => `<li>${esc(m.label)}</li>`)}
    ${res.notes.length ? `<div class="subtle-h">Notes</div><ul class="bullets">${res.notes.map(n => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
    ${res.matched.length ? `<details class="faq"><summary>Matched (${res.matched.length})</summary><ul class="bullets" style="margin-top:.7rem">${res.matched.map(m => `<li><b>${esc(m.label)}</b> → ${esc(m.ref.slice(0, 110))}${m.ref.length > 110 ? "…" : ""}</li>`).join("")}</ul></details>` : ""}
    <div class="notice" style="margin-top:1rem">This compares only what you pasted, and matching is approximate. It cannot check that a source exists or that its details are correct.</div>
  </div>`;
}
$("#refCheck").onclick = () => {
  const t = $("#refText").value.trim(), l = $("#refList").value.trim();
  if (!t) { $("#refCheckOut").innerHTML = `<div class="notice warn" role="alert">${MSG.empty}</div>`; return; }
  if (!l) { $("#refCheckOut").innerHTML = `<div class="notice warn" role="alert">Add your reference list first, or use the formatted references above.</div>`; return; }
  try { renderConsistency(checkConsistency(t, l)); }
  catch (e) { console.warn(e); $("#refCheckOut").innerHTML = `<div class="notice err">${MSG.generic}</div>`; }
};
$("#refUse").onclick = () => {
  if (!refState || !refState.entries.length) return toast("Format some references above first.");
  $("#refList").value = refPlain(refState.entries); saveDrafts(); toast("Reference list filled in.");
};
