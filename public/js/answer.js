"use strict";
/* HumanText AI — Answer Improver + Student Mode (local analysis, AI review, improve flow). */
/* ============================================================
   ANSWER ANALYSIS (local measurements + optional AI review)
   ============================================================ */
const QSTOP = new Set(("jelaskan sebutkan uraikan bagaimana mengapa kenapa apakah apa siapa kapan dimana berikan bandingkan analisis analisislah diskusikan jabarkan deskripsikan tentukan hitunglah contoh " +
  "explain describe discuss compare contrast analyse analyze evaluate why how what which who when where give state outline define example").split(/\s+/));
const stemOf = w => w.length <= 4 ? w : w.slice(0, Math.min(6, w.length - 1));
const REASON_RE = /\b(?:karena|sebab|sehingga|akibatnya|artinya|because|since|therefore|so that|which means|as a result|thus|hence|due to)\b/;
const EXAMPLE_RE = /\b(?:misalnya|contohnya|contoh|misal|for example|for instance|such as|e\.g\.)|\d/i;
const VAGUE_SRC = "\\b(?:sangat penting|banyak hal|berbagai hal|dan lain-lain|dan lain sebagainya|dll|dsb|segala sesuatu|pada umumnya|secara umum|very important|many things|a lot of|in general|and so on|everything|things like that|a variety of|numerous)\\b";
const CONCL_RE = /\b(?:kesimpulan|disimpulkan|jadi|singkatnya|dengan demikian|secara keseluruhan|in conclusion|to sum up|in summary|overall|in short|therefore|to conclude)\b/;
const SEQ_RE = /\b(?:pertama|kedua|ketiga|selanjutnya|kemudian|selain itu|di sisi lain|namun|sedangkan|first|second|third|next|then|however|in addition|finally)\b/;
const CITE_RE = /\((?:[^()]*?\b(?:19|20)\d{2}[a-z]?[^()]*)\)|\[\d+(?:\s*[-–,]\s*\d+)*\]/g;
const contentStems = s => new Set(wordsOf(s).filter(w => w.length >= 4 && !STOP.has(w)).map(stemOf));

function keyTerms(q) {
  const seen = new Set(), out = [];
  wordsOf(q).forEach(w => {
    if (STOP.has(w) || QSTOP.has(w) || w.length < 4 || /^\d+$/.test(w)) return;
    const s = stemOf(w);
    if (!seen.has(s)) { seen.add(s); out.push({ word: w, stem: s }); }
  });
  return out;
}

function answerLocal(q, a) {
  setFb(a);
  const toks = wordsOf(a), n = toks.length, lower = a.toLowerCase();
  const sents = splitSentences(a), paras = getParas(a);
  const lens = sents.map(s => wordsOf(s).length).filter(x => x > 0);
  const mean = lens.length ? lens.reduce((x, y) => x + y, 0) / lens.length : 0;
  const terms = keyTerms(q);
  const aStems = new Set(toks.filter(w => w.length >= 4 && !STOP.has(w)).map(stemOf));
  const hit = terms.filter(t => aStems.has(t.stem)), miss = terms.filter(t => !aStems.has(t.stem));
  const ratio = terms.length ? hit.length / terms.length : 0.6;
  let coverage = pct(Math.min(1, ratio / 0.8));
  if (n < 40) coverage = Math.min(coverage, 55);

  const qStems = new Set(terms.map(t => t.stem));
  let onTopic = 0, prev = new Set();
  sents.forEach(s => {
    const st = contentStems(s);
    let ok = [...st].some(x => qStems.has(x));
    if (!ok) ok = [...st].some(x => prev.has(x));
    if (ok) onTopic++;
    prev = st;
  });
  const topicShare = sents.length ? onTopic / sents.length : 0;
  const relevance = terms.length ? pct(0.5 * Math.min(1, ratio / 0.8) + 0.5 * topicShare) : pct(topicShare);

  const firstOnTopic = !terms.length || (sents[0] ? [...contentStems(sents[0])].some(x => qStems.has(x)) : false);
  const parasOk = n >= 120 ? paras.length >= 2 : sents.length >= 2;
  const seq = SEQ_RE.test(lower);
  const concl = sents.length >= 3 && CONCL_RE.test(sents[sents.length - 1].toLowerCase());
  const overlong = Math.max(0, ...paras.map(p => wordsOf(p).length)) > 220;
  const structure = pct(0.25 * (firstOnTopic ? 1 : 0) + 0.25 * (parasOk ? 1 : 0) + 0.20 * (seq ? 1 : 0) + 0.15 * (concl ? 1 : 0) + 0.15 * (overlong ? 0 : 1));

  const longFrac = lens.length ? lens.filter(x => x > 35).length / lens.length : 0;
  const vagueList = lower.match(new RegExp(VAGUE_SRC, "g")) || [];
  const vaguePer100 = n ? vagueList.length / n * 100 : 0;
  const clarity = pct(0.4 * clamp01((38 - mean) / 18) + 0.3 * clamp01(1 - longFrac * 3) + 0.3 * clamp01(1 - vaguePer100 / 1.5));
  const readability = readabilityScore(toks, lens);

  let rep = null; try { rep = analyze(a); } catch (e) { }
  const checks = [];
  const C = (id, status, comment) => checks.push({ id, status, comment });
  C("answers", terms.length ? (ratio >= 0.6 ? "good" : ratio >= 0.35 ? "ok" : "needs_work") : "ok",
    terms.length ? tr(`Your answer uses ${hit.length} of the ${terms.length} key terms from the question.`, `Jawabanmu memakai ${hit.length} dari ${terms.length} istilah kunci dalam pertanyaan.`)
      : tr("Add the question to check how well the answer responds to it.", "Tambahkan pertanyaan agar kecocokan jawaban bisa dicek."));
  C("unexplained", miss.length === 0 ? "good" : miss.length <= 2 ? "ok" : "needs_work",
    miss.length ? tr(`Not found in your answer: ${miss.slice(0, 6).map(t => t.word).join(", ")}. You may have covered them in other words, so check.`, `Belum ditemukan di jawabanmu: ${miss.slice(0, 6).map(t => t.word).join(", ")}. Mungkin sudah dibahas dengan kata lain, jadi cek lagi.`)
      : tr("Every key term from the question appears in your answer.", "Semua istilah kunci dari pertanyaan muncul di jawabanmu."));
  const reasons = (lower.match(new RegExp(REASON_RE.source, "g")) || []).length;
  C("argument", n < 40 ? "ok" : reasons === 0 ? "needs_work" : reasons < Math.ceil(n / 120) ? "ok" : "good",
    n < 40 ? tr("Too short to judge the argument.", "Terlalu pendek untuk menilai argumen.")
      : reasons === 0 ? tr("Few reasoning words (because, so, therefore). Make sure each claim says why.", "Hampir tidak ada kata penalaran (karena, sehingga, oleh sebab itu). Pastikan tiap klaim menjelaskan alasannya.")
      : tr(`Reasoning words appear ${reasons} time${reasons === 1 ? "" : "s"}. Check that each claim is backed by a reason.`, `Kata penalaran muncul ${reasons} kali. Cek apakah tiap klaim punya alasan.`));
  const parts = [];
  parts.push(firstOnTopic ? tr("the opening addresses the question", "pembukanya menyentuh pertanyaan") : tr("the opening does not yet address the question clearly", "pembukanya belum jelas menjawab pertanyaan"));
  parts.push(concl ? tr("it closes with a conclusion", "ditutup dengan kesimpulan") : tr("there is no closing sentence that pulls it together", "belum ada kalimat penutup yang merangkum"));
  C("structure", structure >= 70 ? "good" : structure >= 45 ? "ok" : "needs_work", tr(`${paras.length} paragraph${paras.length === 1 ? "" : "s"}; `, `${paras.length} paragraf; `) + parts.join("; ") + ".");
  C("repetition", n < 40 ? "ok" : !rep ? "ok" : rep.repetition >= 55 ? "needs_work" : rep.repetition >= 30 ? "ok" : "good",
    n < 40 ? tr("Too short to judge repetition.", "Terlalu pendek untuk menilai pengulangan.")
      : rep && rep.repetition >= 55 ? tr("Some phrases or sentence openings repeat. Try varying them or merging the repeated points.", "Ada frasa atau awal kalimat yang berulang. Coba variasikan atau gabungkan poin yang sama.")
      : rep && rep.repetition >= 30 ? tr("A little repetition, worth a look.", "Ada sedikit pengulangan, layak dicek.")
      : tr("No noticeable repetition.", "Tidak ada pengulangan yang mencolok."));
  const vu = [...new Set(vagueList)].slice(0, 3);
  C("generic", vagueList.length >= 3 ? "needs_work" : vagueList.length ? "ok" : "good",
    vagueList.length ? tr(`General phrases spotted: ${vu.join(", ")}. Replace them with something specific.`, `Frasa yang terlalu umum: ${vu.join(", ")}. Ganti dengan hal yang lebih spesifik.`)
      : tr("No obviously vague phrases.", "Tidak ada frasa yang jelas terlalu umum."));
  const hasEx = EXAMPLE_RE.test(a) || /["“”]/.test(a);
  C("example", hasEx ? "good" : n >= 80 ? "needs_work" : "ok",
    hasEx ? tr("An example, a figure or a quotation appears.", "Ada contoh, angka, atau kutipan.")
      : tr("No example spotted. A concrete case would make the point land.", "Belum ada contoh. Kasus yang konkret akan memperjelas poinmu."));
  const cites = (a.match(CITE_RE) || []).length;
  C("references", cites ? "ok" : "na",
    cites ? tr(`${cites} citation${cites === 1 ? "" : "s"} found. Check that each source supports the point beside it.`, `Ditemukan ${cites} sitasi. Cek apakah tiap sumber mendukung poin di sebelahnya.`)
      : tr("No references in the answer.", "Tidak ada referensi dalam jawaban."));
  return { scores: { coverage, structure, clarity, relevance, readability }, checks, missingTerms: miss.map(t => t.word), words: n };
}

const strList = v => Array.isArray(v) ? v.filter(x => typeof x === "string" && x.trim()).map(x => x.trim()).slice(0, 8) : [];
function mergeAnswer(local, ai) {
  const res = { scores: { ...local.scores }, checks: local.checks.map(c => ({ ...c })), strengths: [], missing: [], missingTerms: local.missingTerms, aiDone: false };
  if (!ai || typeof ai !== "object") return res;
  ["coverage", "structure", "clarity", "relevance"].forEach(k => {
    const v = Number(ai[k]);
    if (Number.isFinite(v)) res.scores[k] = Math.round((res.scores[k] + Math.max(0, Math.min(100, v))) / 2);
  });
  (Array.isArray(ai.checks) ? ai.checks : []).forEach(c => {
    if (!c || !["good", "ok", "needs_work", "na"].includes(c.status)) return;
    const t = res.checks.find(x => x.id === c.id);
    if (!t) return;
    t.status = c.status;
    if (typeof c.comment === "string" && c.comment.trim()) t.comment = c.comment.trim();
    t.ai = true;
  });
  res.strengths = strList(ai.strengths); res.missing = strList(ai.missing); res.aiDone = true;
  return res;
}

function answerReviewPrompt(q, a) {
  return [
    "You are a writing tutor reviewing a student's answer to a question. You do NOT grade it and you must not give a mark or a pass/fail.",
    "Write every comment in " + fbName() + ".",
    "Reply with ONLY a JSON object of exactly this shape:",
    '{"coverage":0-100,"structure":0-100,"clarity":0-100,"relevance":0-100,',
    ' "checks":[{"id":"answers|unexplained|argument|structure|repetition|generic|example|references","status":"good|ok|needs_work|na","comment":"..."}],',
    ' "missing":["..."],"strengths":["..."]}',
    "",
    "Include one check for each of the 8 ids:",
    "- answers: does the answer respond to the question?",
    "- unexplained: are any parts of the question still not explained?",
    "- argument: is the argument clear?",
    "- structure: is the structure sound?",
    "- repetition: is anything repeated? (status good means no problem)",
    "- generic: are any sentences too general?",
    "- example: would an example help?",
    "- references: are the references given relevant? Use status na if the answer cites none.",
    "Rules: base everything only on the question and the answer below. Do not add facts and do not supply the missing content. 'missing' lists parts of the question the answer does not address yet, phrased as things to cover. Keep each comment under 30 words. Give 1 to 3 strengths.",
    "",
    "QUESTION:", q, "",
    "---BEGIN ANSWER---", a, "---END ANSWER---"
  ].join("\n");
}

function improvePrompt(q, a, idea) {
  return [
    "You are helping a student clarify and tidy THEIR OWN answer. Preserve their ideas.",
    "Write the improved answer in the same language as the student's answer.",
    "",
    "QUESTION:", q, "",
    idea ? "THE STUDENT'S OWN NOTES ON THEIR IDEA (their thinking, to be honoured):\n" + idea + "\n" : "",
    "---BEGIN ANSWER---", a, "---END ANSWER---", "",
    "Rules:",
    "- Keep the student's main idea, point of view, own examples, arguments and conclusion. Do not replace their thinking with a different answer.",
    "- You may reorder, tighten, fix awkward phrasing, remove repetition and make reasoning that is already there more explicit.",
    "- Never invent facts, data, examples, sources or citations. Keep every number, name, term, quotation and citation exactly as given.",
    "- If the answer would benefit from something that is not in the student's text or notes (an example, a definition, a source, a piece of data), do NOT supply it. List it under STILL MISSING instead.",
    "- Do not add grammar mistakes on purpose. Say nothing about AI detectors or authorship.",
    "- Keep the length about the same as the student's answer, within 20%.",
    "",
    "Output format, exactly: the improved answer text only; then a line containing only ===NOTES===; then a line CHANGES followed by up to 5 lines starting with '-' that say what you changed and why; then a line STILL MISSING followed by lines starting with '-' for things the student could add, or '- Nothing important seems to be missing.' Write the CHANGES and STILL MISSING bullets in " + fbName() + "."
  ].filter(x => x !== "").join("\n");
}
function parseImprove(text) {
  const [ans, notes = ""] = String(text).split(/\n?[ \t]*===NOTES===[ \t]*\n?/);
  const bl = s => (s || "").split("\n").map(x => x.replace(/^\s*[-•*]\s*/, "").trim()).filter(Boolean);
  const ch = notes.match(/CHANGES\s*([\s\S]*?)(?=STILL MISSING|$)/i), ms = notes.match(/STILL MISSING\s*([\s\S]*)$/i);
  return { out: ans.trim(), changes: ch ? bl(ch[1]) : [], missing: ms ? bl(ms[1]) : [] };
}
function notesPanel(p) {
  if (!p || (!p.changes.length && !p.missing.length)) return "";
  return `<div class="panel" style="margin-top:1rem">
    ${p.changes.length ? `<h2 class="panel-title">${tr("What changed", "Yang diubah")}</h2><ul class="bullets">${p.changes.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    ${p.missing.length ? `<h2 class="panel-title" style="margin-top:${p.changes.length ? "1.1rem" : "0"}">${tr("Still missing", "Yang masih belum ada")}</h2>
      <p class="panel-sub">${tr("These were not in your text, so nothing was invented. Add them yourself if they matter.", "Hal-hal ini tidak ada di tulisanmu, jadi tidak ditambahkan. Tambahkan sendiri jika penting.")}</p>
      <ul class="bullets">${p.missing.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
  </div>`;
}

const CHECK_LABEL = () => ({
  answers: tr("Does the answer respond to the question?", "Apakah jawaban menjawab pertanyaan?"),
  unexplained: tr("Are any parts of the question still unexplained?", "Apakah ada bagian yang belum dijelaskan?"),
  argument: tr("Is the argument clear?", "Apakah argumen sudah jelas?"),
  structure: tr("Is the structure sound?", "Apakah struktur jawaban sudah baik?"),
  repetition: tr("Is anything repeated?", "Apakah terdapat pengulangan?"),
  generic: tr("Are any sentences too general?", "Apakah ada kalimat yang terlalu umum?"),
  example: tr("Would an example help?", "Apakah jawaban membutuhkan contoh?"),
  references: tr("Are the references relevant?", "Apakah referensi yang diberikan relevan?")
});
const STATUS_TAG = { good: ["down", "Good"], ok: ["mid", "Check"], needs_work: ["up", "Needs work"], na: ["na", "n/a"] };

function analysisPanels(res, opt = {}) {
  const S = res.scores, L = CHECK_LABEL();
  const sub = opt.aiDone ? "Local measurements combined with a review by Claude." : opt.aiPending ? "Local estimate shown now. The AI review is still on its way." : "Local estimate.";
  return `
  <div class="panel">
    <h2 class="panel-title">Answer analysis</h2>
    <p class="panel-sub">${sub} Scores are writing indicators from 0 to 100, not an academic grade.</p>
    <div class="metrics">
      ${bar("Answer coverage", S.coverage, true, "How much of what the question asks for shows up in the answer.")}
      ${bar("Structure", S.structure, true, "Opening, order of points and a closing that pulls it together.")}
      ${bar("Clarity", S.clarity, true, "Sentence length, vague phrases and overlong sentences.")}
      ${bar("Relevance", S.relevance, true, "How much of the answer stays on the topic of the question.")}
      ${bar("Readability", S.readability, true, "Estimated from sentence length and long words.")}
    </div>
    ${opt.aiPending ? `<div class="thinking" style="margin-top:1rem"><span class="spin"></span> Asking Claude for a closer review…</div>` : ""}
    ${opt.aiMsg ? `<div class="notice warn" style="margin-top:1rem">${esc(opt.aiMsg)}</div>` : ""}
  </div>
  <div class="panel" style="margin-top:1.25rem">
    <h2 class="panel-title">Checklist</h2>
    <p class="panel-sub">Eight questions a careful reader would ask${res.aiDone ? "" : ", answered from local measurements"}.</p>
    <ul class="checks">${res.checks.map(c => { const t = STATUS_TAG[c.status] || STATUS_TAG.ok; return `
      <li><span class="tag w ${t[0]}">${t[1]}</span><div><strong>${esc(L[c.id])}</strong><span class="c">${esc(c.comment)}</span></div></li>`; }).join("")}</ul>
  </div>
  ${res.strengths.length || res.missing.length ? `<div class="panel" style="margin-top:1.25rem">
    ${res.strengths.length ? `<h2 class="panel-title">${tr("What is working", "Yang sudah baik")}</h2><ul class="bullets">${res.strengths.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    ${res.missing.length ? `<h2 class="panel-title" style="margin-top:${res.strengths.length ? "1.1rem" : "0"}">${tr("Not yet covered", "Belum tercakup")}</h2><ul class="bullets">${res.missing.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
  </div>` : ""}`;
}

async function analyzeAnswerFlow(q, a, host, store) {
  const local = answerLocal(q, a);
  const token = uid(); store.token = token;
  store.res = mergeAnswer(local, null);
  const canAI = capsResolved && !aiProblem();
  host.innerHTML = analysisPanels(store.res, { aiPending: canAI, aiMsg: !canAI && aiProblem() ? "The AI review is unavailable right now, so this is the local estimate." : "" });
  if (!canAI) return;
  try {
    const ai = await askAI(answerReviewPrompt(q, a), { json: true });
    if (store.token !== token) return;
    store.res = mergeAnswer(local, ai);
    host.innerHTML = analysisPanels(store.res, { aiDone: true });
  } catch (e) {
    if (store.token !== token) return;
    host.innerHTML = analysisPanels(store.res, { aiMsg: handleAIError(e) + " Showing the local estimate only." });
  }
}

/* shared improve flow: getO() returns {q, a, idea, host, store, btn, kind, replace} */
function paintImprove(getO, busy) {
  const o = getO(), st = o.store;
  if (!st || !st.res || !o.host) { if (o.host) o.host.innerHTML = ""; return; }
  compareView(o.host, st.res, {
    busy, busyText: "Improving your answer…", leftTitle: "Original", rightTitle: "Improved version",
    onStop: () => { if (st.ctl) st.ctl.abort(); },
    buttons: [
      { label: "Copy Result", fn: () => copy(st.res.out, "Improved answer") },
      { label: "Replace Original", fn: () => o.replace(st.res.out) },
      { label: "Try Again", fn: () => improveFlow(getO) },
      { label: "Clear", fn: () => { st.res = null; st.notes = null; o.host.innerHTML = ""; } },
      { label: "Download", fn: () => download("improved-answer.txt", st.res.out) }
    ],
    note: "Compare before you accept. Your ideas were kept; check that each sentence still says what you meant.",
    after: notesPanel(st.notes)
  });
}
async function improveFlow(getO) {
  const o = getO(), st = o.store;
  const msg = checkAnswerInputs(o.q, o.a);
  if (msg) { o.host.innerHTML = `<div class="notice warn" role="alert">${esc(msg)}</div>`; return; }
  if (!aiGate()) return;
  setFb(o.a);
  const prompt = improvePrompt(o.q, o.a, o.idea);
  if (new TextEncoder().encode(prompt).length > 62000) { o.host.innerHTML = `<div class="notice warn">${esc(ERR.prompt_too_large)}</div>`; return; }
  const ctlr = new AbortController();
  st.ctl = ctlr; st.notes = null;
  st.res = { original: o.a, out: "", done: false };
  paintImprove(getO, true);
  await withBusy(o.btn, "Improving…", async () => {
    try {
      const r = await askAI(prompt, { signal: ctlr.signal, onText: ({ text }) => { const p = parseImprove(text); st.res.out = p.out; streamInto(o.host, p.out); } });
      const p = parseImprove(r.text);
      st.res.out = p.out; st.res.truncated = r.truncated; st.res.done = true; st.notes = p;
      pushHistory({ kind: "answer", title: titleFrom(o.q), question: o.q, words: wordsOf(p.out).length, style: o.kind === "student" ? "Student Mode" : "Answer Improver",
        preview: p.out.slice(0, 160), text: settings.storeText ? o.a : null, rewrite: settings.storeRewrite ? p.out : null });
      paintImprove(getO, false);
    } catch (e) {
      const code = (e && e.code) || "upstream_error";
      if (code === "cancelled") {
        if (st.res.out) { st.res.done = true; paintImprove(getO, false); } else { st.res = null; o.host.innerHTML = ""; }
      } else {
        const m = handleAIError(e);
        if (e && e.text && parseImprove(e.text).out) { st.res.out = parseImprove(e.text).out; st.res.done = true; st.res.interrupted = true; paintImprove(getO, false); }
        else { st.res = null; o.host.innerHTML = `<div class="notice err" role="alert">${esc(m)}</div>`; }
      }
    }
  });
}

function checkAnswerInputs(q, a) {
  if (!q && !a) return MSG.empty;
  if (!q) return "Please enter the question first.";
  if (!a) return MSG.empty;
  if (wordsOf(a).length < MIN_WORDS) return MSG.short;
  return "";
}

/* ---------- Answer Improver page ---------- */
const ans = { res: null, improve: null, token: null };
function ansCounts() {
  const t = $("#ansA").value, w = wordsOf(t).length;
  $("#ansWords").textContent = w.toLocaleString();
  $("#ansSents").textContent = t.trim() ? splitSentences(t).length : 0;
  $("#ansRead").textContent = Math.max(w ? 1 : 0, Math.round(w / 225));
}
const ansGetO = () => ({
  q: $("#ansQ").value.trim(), a: $("#ansA").value.trim(), idea: "", host: $("#ansImproveOut"), store: (ans.improve = ans.improve || {}),
  btn: $("#ansImprove"), kind: "answer",
  replace: t => { $("#ansA").value = t; ansCounts(); saveDrafts(); toast("Your answer was replaced with the improved version."); }
});
$("#ansQ").addEventListener("input", saveDrafts);
$("#ansA").addEventListener("input", () => { ansCounts(); saveDrafts(); });
$("#ansSample").onclick = () => {
  const s = ANS_SAMPLES[(navigator.language || "en").toLowerCase().startsWith("id") ? "id" : "en"];
  $("#ansQ").value = s.q; $("#ansA").value = s.a; ansCounts(); saveDrafts(); toast("Sample loaded — press “Analyze My Answer”.");
};
$("#ansCopy").onclick = () => $("#ansA").value.trim() ? copy($("#ansA").value, "Answer") : toast("Nothing to copy yet.");
$("#ansClear").onclick = async () => {
  if ($("#ansQ").value || $("#ansA").value) { if (!(await askConfirm("Clear the question and answer?", "", "Clear"))) return; }
  $("#ansQ").value = ""; $("#ansA").value = ""; ans.res = null; ans.improve = null; ans.token = null;
  $("#ansAnalysis").innerHTML = ""; $("#ansImproveOut").innerHTML = ""; ansCounts(); saveDrafts();
};
$("#ansAnalyze").onclick = () => {
  const q = $("#ansQ").value.trim(), a = $("#ansA").value.trim();
  const msg = checkAnswerInputs(q, a);
  if (msg) { $("#ansAnalysis").innerHTML = `<div class="notice warn" role="alert">${esc(msg)}</div>`; return; }
  try { analyzeAnswerFlow(q, a, $("#ansAnalysis"), ans); }
  catch (e) { console.warn(e); $("#ansAnalysis").innerHTML = `<div class="notice err">${MSG.generic}</div>`; }
};
$("#ansImprove").onclick = () => improveFlow(ansGetO);

/* ============================================================
   STUDENT MODE
   ============================================================ */
const stu = { step: 1, max: 1, q: "", idea: "", a: "", res: null, shown: false, improve: null, token: null };
const STU_STEPS = ["Question", "My idea", "My answer", "Analyze", "Improve", "Final version"];
const stuGetO = () => ({
  q: stu.q.trim(), a: stu.a.trim(), idea: stu.idea.trim(), host: $("#stuFinal"), store: (stu.improve = stu.improve || {}),
  btn: $("#stuMake"), kind: "student",
  replace: t => { stu.a = t; toast("Your answer was replaced with the final version."); saveDrafts(); }
});
function stuMove(n) { stu.step = n; stu.max = Math.max(stu.max, n); renderStudent(); window.scrollTo(0, 0); }
function stuMsg(t) { const m = $("#stuMsg"); if (m) m.innerHTML = t ? `<div class="notice warn" role="alert" style="margin-top:1rem">${esc(t)}</div>` : ""; }

function renderStudent() {
  $("#stuSteps").innerHTML = STU_STEPS.map((s, i) => {
    const n = i + 1;
    const cls = n === stu.step ? "cur" : n < stu.step ? "done reach" : n <= stu.max ? "reach" : "";
    return `<li><button type="button" class="${cls}" data-stustep="${n}" ${n <= stu.max ? "" : "disabled"} ${n === stu.step ? 'aria-current="step"' : ""}><b>${n < stu.step ? "✓" : n}</b>${s}</button></li>`;
  }).join("");
  $$("[data-stustep]").forEach(b => b.onclick = () => { stu.step = +b.dataset.stustep; renderStudent(); });
  const body = $("#stuBody");

  if (stu.step === 1) {
    body.innerHTML = `<div class="panel"><h2 class="panel-title">1 · Question</h2>
      <p class="panel-sub">Paste the question or assignment prompt you are answering.</p>
      <label class="field caps"><span>Question</span><textarea class="ta" id="stuQ" rows="4" placeholder="Masukkan pertanyaan atau soal..." spellcheck="false"></textarea></label>
      <div class="btn-row"><button class="btn btn-primary" id="stuNext">Next: my idea</button><button class="btn btn-sm" id="stuSample">Try a sample</button></div><div id="stuMsg"></div></div>`;
    $("#stuQ").value = stu.q;
    $("#stuQ").oninput = e => { stu.q = e.target.value; saveDrafts(); };
    $("#stuNext").onclick = () => { if (!stu.q.trim()) return stuMsg(MSG.empty); stuMove(2); };
    $("#stuSample").onclick = () => {
      const s = ANS_SAMPLES[(navigator.language || "en").toLowerCase().startsWith("id") ? "id" : "en"];
      stu.q = s.q; stu.idea = s.idea; stu.a = s.a; $("#stuQ").value = stu.q; saveDrafts(); toast("Sample loaded for every step.");
    };
  } else if (stu.step === 2) {
    body.innerHTML = `<div class="panel"><h2 class="panel-title">2 · My idea</h2>
      <p class="panel-sub">What do you already think? Rough notes or a few bullet points are fine. This stays yours: it is used to keep the final version faithful to your thinking, never replaced.</p>
      <div class="notice" style="margin-bottom:1rem"><strong>Question:</strong> ${esc(stu.q)}</div>
      <label class="field caps"><span>My idea</span><textarea class="ta" id="stuIdea" rows="6" placeholder="Tulis idemu dengan kata-katamu sendiri..." spellcheck="false"></textarea></label>
      <div class="btn-row"><button class="btn" id="stuBack">Back</button><button class="btn btn-primary" id="stuNext">Next: my answer</button></div>
      <p style="font-size:.84rem;color:var(--ink-3);margin:.9rem 0 0">You can leave this empty, but even a few rough lines help the final version stay yours.</p></div>`;
    $("#stuIdea").value = stu.idea;
    $("#stuIdea").oninput = e => { stu.idea = e.target.value; saveDrafts(); };
    $("#stuBack").onclick = () => stuMove(1);
    $("#stuNext").onclick = () => stuMove(3);
  } else if (stu.step === 3) {
    body.innerHTML = `<div class="panel"><h2 class="panel-title">3 · My answer</h2>
      <p class="panel-sub">Write your answer as well as you can. The next steps will show what could be stronger.</p>
      <div class="notice" style="margin-bottom:1rem"><strong>Question:</strong> ${esc(stu.q)}</div>
      <label class="field caps"><span>My answer</span><textarea class="ta" id="stuA" rows="10" placeholder="Masukkan jawaban kamu..." spellcheck="false"></textarea></label>
      <div class="counts" style="margin-bottom:1rem"><span><b id="stuWords">0</b> words</span></div>
      <div class="btn-row"><button class="btn" id="stuBack">Back</button><button class="btn btn-primary" id="stuNext">Next: analyze</button></div><div id="stuMsg"></div></div>`;
    $("#stuA").value = stu.a;
    const upd = () => { $("#stuWords").textContent = wordsOf(stu.a).length.toLocaleString(); };
    upd();
    $("#stuA").oninput = e => { stu.a = e.target.value; stu.res = null; stu.shown = false; upd(); saveDrafts(); };
    $("#stuBack").onclick = () => stuMove(2);
    $("#stuNext").onclick = () => {
      const m = checkAnswerInputs(stu.q.trim(), stu.a.trim());
      if (m) return stuMsg(m);
      stuMove(4);
    };
  } else if (stu.step === 4) {
    body.innerHTML = `<div class="panel"><h2 class="panel-title">4 · Analyze</h2>
      <p class="panel-sub">Check the answer against the question. Local measurements run in your browser; a closer review is added when Claude is available.</p>
      <div class="btn-row"><button class="btn" id="stuBack">Back</button><button class="btn btn-primary" id="stuRun">Analyze my answer</button>
        <button class="btn" id="stuNext" ${stu.res ? "" : "disabled"}>Next: what needs improvement</button></div>
      <div id="stuMsg"></div></div>
      <div id="stuAnalysis" style="margin-top:1.25rem"></div>`;
    if (stu.res) $("#stuAnalysis").innerHTML = analysisPanels(stu.res, { aiDone: stu.res.aiDone });
    $("#stuBack").onclick = () => stuMove(3);
    $("#stuRun").onclick = async () => {
      const m = checkAnswerInputs(stu.q.trim(), stu.a.trim());
      if (m) return stuMsg(m);
      stuMsg("");
      try {
        await withBusy($("#stuRun"), "Analyzing…", () => analyzeAnswerFlow(stu.q.trim(), stu.a.trim(), $("#stuAnalysis"), stu));
        const nx = $("#stuNext"); if (nx && stu.res) nx.disabled = false;
      } catch (e) { console.warn(e); stuMsg(MSG.generic); }
    };
    $("#stuNext").onclick = () => stuMove(5);
  } else if (stu.step === 5) {
    body.innerHTML = `<div class="panel"><h2 class="panel-title">5 · Improve</h2>
      <p class="panel-sub">Before any final version is written, look at what needs improvement. These are pointers. You decide what to change.</p>
      <div class="btn-row"><button class="btn" id="stuBack">Back</button><button class="btn btn-primary" id="stuShow">Show what needs improvement</button>
        <button class="btn" id="stuNext" ${stu.shown ? "" : "disabled"}>Next: final version</button></div></div>
      <div id="stuImprove" style="margin-top:1.25rem"></div>`;
    const draw = () => { $("#stuImprove").innerHTML = improvementList(); $("#stuNext").disabled = !stu.shown; };
    if (stu.shown) draw();
    $("#stuBack").onclick = () => stuMove(4);
    $("#stuShow").onclick = () => { if (!stu.res) { stuMove(4); return; } stu.shown = true; draw(); };
    $("#stuNext").onclick = () => stuMove(6);
  } else {
    body.innerHTML = `<div class="panel"><h2 class="panel-title">6 · Final version</h2>
      <p class="panel-sub">Your ideas, examples, arguments and conclusion are kept. The tool only clarifies and tidies, and lists what is still missing instead of inventing it.</p>
      ${stu.shown ? "" : `<div class="notice warn" style="margin-bottom:1rem">Open step 5 and press “Show what needs improvement” first.</div>`}
      <div class="btn-row"><button class="btn" id="stuBack">Back</button><button class="btn btn-primary" id="stuMake" data-ai ${stu.shown ? "" : "disabled"}>Create final version</button>
        <button class="btn btn-sm" id="stuReset">Start over</button></div>
      <div data-ainote style="margin-top:.9rem"></div></div>
      <div id="stuFinal" style="margin-top:1.25rem"></div>`;
    $("#stuBack").onclick = () => stuMove(5);
    $("#stuMake").onclick = () => improveFlow(stuGetO);
    $("#stuReset").onclick = async () => {
      if (!(await askConfirm("Start over?", "This clears the question, idea, answer and results in Student Mode.", "Start over"))) return;
      Object.assign(stu, { step: 1, max: 1, q: "", idea: "", a: "", res: null, shown: false, improve: null, token: null }); saveDrafts(); renderStudent();
    };
    paintImprove(stuGetO, false);
    refreshAiNotes();
    if (!stu.shown) $("#stuMake").disabled = true;
  }
}
function improvementList() {
  const res = stu.res; if (!res) return "";
  setFb(stu.a);
  const L = CHECK_LABEL();
  const needs = res.checks.filter(c => c.status === "needs_work"), check = res.checks.filter(c => c.status === "ok");
  let coach = []; try { coach = coachLocal(stu.a).improve; } catch (e) { }
  const li = (label, txt) => `<li>${label ? `<span class="where">${esc(label)}</span>` : ""}${esc(txt)}</li>`;
  const none = !needs.length && !check.length && !res.missing.length && !coach.length;
  return `<div class="panel"><h2 class="panel-title">${tr("What needs improvement", "Yang perlu diperbaiki")}</h2>
    <p class="panel-sub">${tr("Pointers for you to act on. Nothing has been rewritten.", "Petunjuk untukmu. Belum ada yang ditulis ulang.")}</p>
    ${none ? `<p style="margin:0;color:var(--ink-2)">${tr("Nothing major stands out. You can go ahead to the final version.", "Tidak ada yang menonjol. Kamu bisa lanjut ke versi final.")}</p>` : ""}
    ${needs.length ? `<div class="subtle-h">${tr("Needs work", "Perlu diperbaiki")}</div><ul class="bullets">${needs.map(c => li(L[c.id], c.comment)).join("")}</ul>` : ""}
    ${check.length ? `<div class="subtle-h">${tr("Worth a look", "Layak dicek")}</div><ul class="bullets">${check.map(c => li(L[c.id], c.comment)).join("")}</ul>` : ""}
    ${res.missing.length ? `<div class="subtle-h">${tr("Not yet covered", "Belum tercakup")}</div><ul class="bullets">${res.missing.map(x => li("", x)).join("")}</ul>` : ""}
    ${coach.length ? `<div class="subtle-h">${tr("Writing coach notes", "Catatan writing coach")}</div><ul class="bullets">${coach.slice(0, 6).map(c => li(tr("Paragraph ", "Paragraf ") + c.p, c.s)).join("")}</ul>` : ""}
  </div>`;
}
