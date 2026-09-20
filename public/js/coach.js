"use strict";
/* HumanText AI — Writing Coach. */
/* ============================================================
   WRITING COACH
   ============================================================ */
function coachLocal(t) {
  setFb(t);
  const paras = getParas(t), out = { good: [], improve: [] };
  const a = analyze(t);
  const G = s => out.good.push(s), I = (p, s) => out.improve.push({ p, s });
  paras.forEach((p, pi) => {
    const ss = splitSentences(p);
    ss.forEach((s, si) => {
      const n = wordsOf(s).length;
      if (n > 35 && out.improve.filter(x => x.kind === "long").length < 3) { I(pi + 1, tr(`Sentence ${si + 1} runs ${n} words. Consider splitting it so each sentence carries one idea.`, `Kalimat ${si + 1} sepanjang ${n} kata. Coba pecah agar tiap kalimat memuat satu gagasan.`)); out.improve[out.improve.length - 1].kind = "long"; }
    });
    const sets = ss.map(contentStems);
    for (let i = 0; i + 1 < ss.length; i++) {
      const A = sets[i], B = sets[i + 1];
      if (A.size < 4 || B.size < 4) continue;
      let inter = 0; A.forEach(x => { if (B.has(x)) inter++; });
      if (inter / (A.size + B.size - inter) >= 0.5) { I(pi + 1, tr(`Sentences ${i + 1} and ${i + 2} seem to repeat the same idea. Keep the stronger one or say what the second adds.`, `Kalimat ${i + 1} dan ${i + 2} tampak mengulang gagasan yang sama. Pertahankan yang lebih kuat atau jelaskan tambahan dari yang kedua.`)); break; }
    }
  });
  let withEx = 0, checked = 0;
  paras.forEach((p, pi) => {
    if (wordsOf(p).length < 55) return;
    checked++;
    if (EXAMPLE_RE.test(p) || /["“”]/.test(p)) withEx++;
    else I(pi + 1, tr("This paragraph could use an example.", "Paragraf ini bisa diperkuat dengan contoh."));
    if (!REASON_RE.test(p.toLowerCase())) I(pi + 1, tr("Consider explaining why this point matters.", "Pertimbangkan menjelaskan mengapa poin ini penting."));
  });
  if (paras.length >= 2) {
    let k = 0;
    paras.forEach((p, pi) => {
      const m = p.replace(/^[^\p{L}]+/u, "").match(CONN_START);
      if (m && k < 3) { k++; I(pi + 1, tr(`This paragraph opens with “${m[0]}”. A direct first sentence often reads better.`, `Paragraf ini dibuka dengan “${m[0]}”. Kalimat pembuka yang langsung ke inti sering terbaca lebih enak.`)); }
    });
  }
  out.improve.sort((x, y) => x.p - y.p);
  if (a.variation >= 55 && a.sentences >= 5) G(tr("Your sentence lengths vary naturally, which gives the text a good rhythm.", "Panjang kalimatmu bervariasi secara alami, sehingga ritme tulisan enak dibaca."));
  if (a.diversity >= 60) G(tr("Your vocabulary is varied and doesn't keep circling the same words.", "Kosakatamu beragam dan tidak berputar di kata yang sama."));
  if (checked >= 2 && withEx / checked >= 0.5) G(tr("You back up your points with examples or specifics.", "Kamu mendukung poin dengan contoh atau hal yang spesifik."));
  if (a.repetition <= 25 && a.words >= 80) G(tr("Little repetition: each sentence mostly adds something new.", "Hampir tidak ada pengulangan: tiap kalimat umumnya menambah hal baru."));
  if (a.readability >= 70) G(tr("Easy to read: sentences are a comfortable length.", "Mudah dibaca: panjang kalimatnya nyaman."));
  const first = splitSentences(paras[0] || "")[0] || "", fn = wordsOf(first).length;
  if (fn >= 6 && fn <= 35) {
    const cnt = new Map();
    wordsOf(t).filter(w => w.length > 3 && !STOP.has(w)).forEach(w => { const s = stemOf(w); cnt.set(s, (cnt.get(s) || 0) + 1); });
    const top = [...cnt.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(x => x[0]);
    if ([...contentStems(first)].some(s => top.includes(s))) G(tr("Your opening sentence introduces the topic the rest of the text keeps returning to.", "Kalimat pembukamu memperkenalkan topik yang terus dibahas di sisa tulisan."));
  }
  return out;
}
function coachPrompt(t) {
  return [
    "You are a kind, precise writing coach. Give feedback that helps the writer learn. Do NOT rewrite the text and do not supply new content.",
    "Write all feedback in " + fbName() + ".",
    "Reply with ONLY a JSON object of exactly this shape:",
    '{"main_idea":{"clear":"yes|partly|no","comment":"..."},"strengths":["..."],"suggestions":[{"where":"Overall or Paragraph 2","comment":"..."}],"questions":["..."]}',
    "Rules: 2 to 4 strengths, 3 to 6 suggestions, 1 to 3 questions for the writer to think about. Each item under 30 words. Be concrete and tie each point to the writer's actual text. Typical tone: 'Your main idea is clear.', 'This paragraph could use an example.', 'These two sentences repeat the same idea.', 'Consider explaining why this point matters.' Do not judge whether facts are true. Do not mention AI detectors or authorship.",
    "",
    "---BEGIN TEXT---", t, "---END TEXT---"
  ].join("\n");
}
let coachToken = null;
async function runCoach() {
  const t = editor.value.trim();
  if (!t) { renderCoach(MSG.empty); editor.focus(); return; }
  if (wordsOf(t).length < MIN_WORDS) { renderCoach(MSG.short); return; }
  let local;
  try { local = coachLocal(t); } catch (e) { console.warn(e); renderCoach(MSG.generic); return; }
  const token = uid(); coachToken = token;
  const canAI = capsResolved && !aiProblem();
  state.coach = { text: t, local, ai: null, aiState: canAI ? "loading" : "off", aiMsg: "" };
  renderCoach();
  if (!canAI) return;
  try {
    const j = await askAI(coachPrompt(t), { json: true });
    if (coachToken !== token) return;
    state.coach.ai = j && typeof j === "object" ? j : null; state.coach.aiState = state.coach.ai ? "done" : "error";
  } catch (e) {
    if (coachToken !== token) return;
    state.coach.aiState = "error"; state.coach.aiMsg = handleAIError(e);
  }
  renderCoach();
}
function renderCoach(msg) {
  const el = $("#coachResult"), c = state.coach;
  const notice = msg ? `<div class="notice warn" role="alert" style="margin-bottom:1rem">${esc(msg)}</div>` : "";
  if (!c) {
    el.innerHTML = notice + `<div class="empty"><strong>No feedback yet</strong>Paste a draft above and press “Get coaching feedback”. You will get notes on what works and what could be clearer, without your text being rewritten.</div>`;
    return;
  }
  setFb(c.text);
  const ai = c.ai || {}, mi = ai.main_idea || null;
  const good = [...c.local.good, ...strList(ai.strengths)];
  const sug = (Array.isArray(ai.suggestions) ? ai.suggestions : []).filter(s => s && typeof s.comment === "string" && s.comment.trim());
  const qs = strList(ai.questions);
  const miTxt = mi && typeof mi.comment === "string" && mi.comment.trim() ? mi.comment.trim() : "";
  const miTag = mi ? ({ yes: ["down", tr("Clear", "Jelas")], partly: ["mid", tr("Partly clear", "Cukup jelas")], no: ["up", tr("Unclear", "Belum jelas")] }[mi.clear] || null) : null;
  el.innerHTML = notice + `
  ${c.aiState === "loading" ? `<div class="panel"><div class="thinking"><span class="spin"></span> Asking Claude for deeper feedback… The notes below come from local checks.</div></div>` : ""}
  ${c.aiState === "error" ? `<div class="notice warn" style="margin-bottom:1rem">${esc(c.aiMsg || MSG.generic)} Showing the local notes only.</div>` : ""}
  ${miTxt ? `<div class="panel"><h2 class="panel-title">${tr("Your main idea", "Ide utamamu")}</h2><p style="margin:.5rem 0 0">${miTag ? `<span class="tag ${miTag[0]}" style="margin-right:.5rem">${esc(miTag[1])}</span>` : ""}${esc(miTxt)}</p></div>` : ""}
  <div class="panel" ${miTxt ? 'style="margin-top:1.25rem"' : ""}>
    <h2 class="panel-title">${tr("What is working", "Yang sudah baik")}</h2>
    ${good.length ? `<ul class="bullets">${good.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : `<p style="color:var(--ink-2);margin:.4rem 0 0">${tr("Nothing stood out as a clear strength yet. Keep going: the notes below show where to look.", "Belum ada kekuatan yang menonjol. Lihat catatan di bawah untuk tahu bagian mana yang perlu dilihat.")}</p>`}
  </div>
  <div class="panel" style="margin-top:1.25rem">
    <h2 class="panel-title">${tr("Worth improving", "Layak diperbaiki")}</h2>
    <p class="panel-sub">${tr("Pointers only. You decide what to change.", "Hanya petunjuk. Kamu yang memutuskan apa yang diubah.")}</p>
    ${c.local.improve.length || sug.length ? `<ul class="bullets">
      ${c.local.improve.map(x => `<li><span class="where">${tr("Paragraph ", "Paragraf ")}${x.p}</span>${esc(x.s)}</li>`).join("")}
      ${sug.map(x => `<li><span class="where">${esc(x.where || tr("Overall", "Keseluruhan"))}</span>${esc(x.comment)}</li>`).join("")}</ul>`
      : `<p style="color:var(--ink-2);margin:.4rem 0 0">${tr("No specific problems were flagged.", "Tidak ada masalah spesifik yang ditandai.")}</p>`}
  </div>
  ${qs.length ? `<div class="panel" style="margin-top:1.25rem"><h2 class="panel-title">${tr("Questions to think about", "Pertanyaan untuk direnungkan")}</h2><ul class="bullets">${qs.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
  <div class="btn-row" style="margin-top:1.25rem"><button class="btn btn-sm" data-go="rewriter">Try the Natural Rewriter</button><button class="btn btn-sm" data-go="detector">Open the analyzer</button></div>`;
}
$("#coachBtn").onclick = runCoach;
