"use strict";
/* HumanText AI — app core: helpers, storage, dialogs, routing, editor, AI-detector UI. */
/* ============================================================
   3. APP
   ============================================================ */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const KEY = "humantext.v1";
const MIN_WORDS = 15;
const MSG = {
  empty: "Please enter some text first.",
  short: "Add a little more text for a more useful analysis.",
  generic: "Something went wrong. Please try again."
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const titleFrom = t => {
  const words = String(t || "").trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  if (!words.length) return "Untitled";
  const s = words.slice(0, 7).join(" ");
  return (s.length > 52 ? s.slice(0, 50) : s) + (words.length > 7 || s.length > 52 ? "…" : "");
};

const STYLES = [
  { id: "student", name: "Natural Student", desc: "Someone who understands the topic explaining it in their own words.",
    prompt: "Rewrite the text so it sounds like a student who genuinely understands the material, explaining it in their own words: natural and unforced, neither stiff nor too polished or formulaic. If the text is Indonesian, use natural, well-formed Indonesian that is easy to read (bahasa yang baik tetapi tidak kaku, tanpa jargon berlebihan). Vary sentence length naturally, use ordinary transitions instead of stock connectors, and avoid repeating phrases or sentence openings. Keep the original meaning, every fact, number, name of people and institutions, key term, quotation and reference exactly as given. Do not add facts or sources, do not change the author's point, do not add grammar mistakes or typos on purpose, and make no claim about detectors or authorship." },
  { id: "casual", name: "Casual Professional", desc: "Relaxed but competent, the register of a good work email.",
    prompt: "Rewrite the text in a relaxed professional register: direct, confident, conversational without being sloppy. Contractions are welcome. Cut hedging and filler, keep the substance and every factual detail intact." },
  { id: "academic", name: "Academic but Natural", desc: "Scholarly register, minus the stiffness and the filler.",
    prompt: "Rewrite the text in an academic register that still reads like a person wrote it. Keep scholarly precision, hedging where the evidence requires it, and all terminology and citations. Remove template connectors, padded noun phrases and sentences that say nothing. Vary sentence length." },
  { id: "simple", name: "Simple & Clear", desc: "Plain words, shorter sentences, no ornamental jargon.",
    prompt: "Rewrite the text as plainly as the subject allows. Prefer short common words, break long sentences apart, cut jargon that is not doing real work, and keep every fact, figure and citation exactly as given. Do not oversimplify technical meaning." },
  { id: "formal", name: "Formal", desc: "Precise and impersonal, for reports and official writing.",
    prompt: "Rewrite the text in a formal register suitable for an official report: precise, impersonal, no contractions or colloquialism. Keep it readable — formal does not mean convoluted. Preserve all facts, figures, names and citations." },
  { id: "custom", name: "Custom", desc: "Describe the voice you want yourself.", prompt: "" }
];

const SAMPLES = {
  en: "In today's rapidly evolving digital landscape, online learning has become an increasingly important component of higher education. Moreover, it offers students a level of flexibility that traditional classroom instruction cannot easily provide. Furthermore, institutions are able to reach learners who would otherwise be excluded by geography, cost, or scheduling constraints. However, the transition to digital delivery also presents a number of significant challenges. It is important to note that student engagement tends to decline in environments that lack direct interaction. Additionally, reliable access to devices and connectivity remains unevenly distributed across populations. Therefore, institutions must invest in robust support structures, comprehensive training, and seamless technical infrastructure. In conclusion, online learning plays a crucial role in the future of education, but its success ultimately depends on careful implementation, sustained investment, and a commitment to equitable access for all learners.",
  id: "Dalam era digital yang berkembang pesat, pembelajaran daring telah menjadi bagian penting dari pendidikan tinggi. Selain itu, metode ini memberikan fleksibilitas yang tidak dapat disediakan oleh perkuliahan tatap muka. Oleh karena itu, banyak institusi mulai mengembangkan program daring secara komprehensif. Namun demikian, peralihan ke pembelajaran digital juga menghadirkan sejumlah tantangan yang signifikan. Penting untuk dicatat bahwa keterlibatan mahasiswa cenderung menurun dalam lingkungan yang minim interaksi langsung. Di sisi lain, akses terhadap perangkat dan jaringan internet masih belum merata di berbagai daerah. Dengan demikian, institusi perlu menyiapkan infrastruktur yang memadai, pelatihan yang menyeluruh, dan dukungan teknis yang berkelanjutan. Secara keseluruhan, pembelajaran daring memainkan peran penting dalam masa depan pendidikan, tetapi keberhasilannya sangat bergantung pada perencanaan yang matang, investasi yang konsisten, dan komitmen terhadap pemerataan akses bagi seluruh mahasiswa."
};
const ANS_SAMPLES = {
  en: {
    q: "Explain how online learning affects student motivation, and give one example.",
    a: "Online learning is very important in today's world. It gives students many benefits, such as flexibility. However, motivation can drop when students have less interaction. Low motivation makes students less engaged in class. Teachers need to make classes more interesting. In conclusion, online learning affects student motivation in many ways.",
    idea: "I think motivation drops mostly because there is nobody around to study with. For example, I kept postponing my statistics course because nobody reminded me."
  },
  id: {
    q: "Jelaskan dampak pembelajaran daring terhadap motivasi belajar mahasiswa, dan berikan satu contoh dari pengalaman belajar.",
    a: "Pembelajaran daring sangat penting di era digital ini. Pembelajaran daring memberikan banyak hal positif bagi mahasiswa. Mahasiswa bisa belajar di mana saja dan kapan saja. Namun, pembelajaran daring juga punya tantangan. Motivasi belajar mahasiswa bisa menurun karena kurang interaksi. Motivasi belajar yang menurun membuat mahasiswa malas mengikuti kuliah. Oleh karena itu, dosen perlu membuat kelas lebih menarik. Dapat disimpulkan bahwa pembelajaran daring berdampak pada motivasi belajar mahasiswa.",
    idea: "Menurut saya motivasi turun terutama karena tidak ada teman belajar. Contohnya, saya sering menunda tugas statistika karena tidak ada yang mengingatkan."
  }
};
const REF_SAMPLE = "Rahman Ali and Putri Sari, 2021, 'Pembelajaran daring di perguruan tinggi', Jurnal Teknologi Pendidikan, volume 12 nomor 3, halaman 45-60\n\nWidodo, Budi. 2019. Motivasi Belajar Mahasiswa. Penerbit Nusantara, Bandung.\n\nLee, J., Kim, H. and Park, S. (2020) Online engagement in university courses, Journal of Learning Studies 8(2), pp. 101-118, doi 10.0000/sample";

const SPECIMENS = {
  even: {
    caption: "Four sentences, eleven to thirteen words each. The rhythm never changes — the commonest pattern in machine-written prose.",
    s: [["Digital literacy has become an essential skill for students in higher education today.", 13],
        ["It allows learners to evaluate sources critically and to organise information effectively.", 12],
        ["Universities have responded by embedding training into their foundation programmes.", 10],
        ["This approach ensures that every student begins with a shared baseline of competence.", 13]] },
  varied: {
    caption: "Two words, then twenty-two. Uneven rhythm is what a person sounds like while they are still thinking.",
    s: [["Digital literacy is a skill students are assumed to have.", 10],
        ["Most do not — at least not the part that matters, which is working out whether a source is worth citing at all.", 23],
        ["Foundation courses try to fix this in a week.", 9],
        ["A week.", 2],
        ["Whether that helps depends almost entirely on who is teaching it.", 11]] }
};

/* ---------- storage ---------- */
const DEFAULTS = { theme: "system", saveHistory: true, storeText: true, storeRewrite: true, saveDrafts: true, defStyle: "student", defLang: "same" };
const DKEY = KEY + ".drafts";
let settings = { ...DEFAULTS };
let history = [];

function load() {
  try {
    const s = localStorage.getItem(KEY + ".settings");
    if (s) settings = { ...DEFAULTS, ...JSON.parse(s) };
  } catch (e) { }
  try {
    const h = localStorage.getItem(KEY + ".history");
    history = h ? JSON.parse(h) : [];
    if (!Array.isArray(history)) history = [];
  } catch (e) { history = []; }
}
function saveSettings() { try { localStorage.setItem(KEY + ".settings", JSON.stringify(settings)); } catch (e) { } }
function saveHistory() {
  try { localStorage.setItem(KEY + ".history", JSON.stringify(history.slice(0, 80))); }
  catch (e) { toast("History is full — older entries were dropped."); history = history.slice(0, 20); }
}
function pushHistory(entry) {
  if (!settings.saveHistory) return;
  history.unshift({ id: uid(), at: Date.now(), ...entry });
  saveHistory();
}
const histTitle = h => h.title || titleFrom(h.preview || h.text || h.rewrite || "");

/* ---------- misc ---------- */
let toastT;
function toast(msg) {
  let el = $("#toast");
  if (!el) { el = document.createElement("div"); el.id = "toast"; el.className = "toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
  el.textContent = msg; el.style.display = "block";
  clearTimeout(toastT); toastT = setTimeout(() => { el.style.display = "none"; }, 2800);
}
async function copy(text, what) {
  try { await navigator.clipboard.writeText(text); toast(what + " copied."); return; } catch (e) { }
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
    toast(what + " copied.");
  } catch (e) { toast("Copying was blocked. Select the text and copy it manually."); }
}
async function download(filename, data) {
  if (!dlFn) { toast("Downloads are unavailable here — use Copy instead."); return; }
  try { await dlFn.save({ filename, data }); toast("Saved."); }
  catch (e) {
    const c = (e && e.code) || "";
    toast(c === "declined" ? "Download cancelled." : "The file could not be saved — use Copy instead.");
  }
}
const fmtDate = ts => new Date(ts).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const bandWord = b => b === "high" ? "Higher AI-like patterns" : b === "mid" ? "Medium AI-like patterns" : "Low AI-like patterns";
const bandShort = b => b === "high" ? "Higher" : b === "mid" ? "Medium" : "Low";
const bandVar = b => b === "high" ? "var(--red)" : b === "mid" ? "var(--amber)" : "var(--green)";

/* in-page dialogs (native confirm/prompt can be blocked inside a framed page) */
function modal({ title, message, value, okLabel }) {
  return new Promise(resolve => {
    const prev = document.activeElement;
    const hasInput = value !== undefined;
    const back = document.createElement("div");
    back.className = "modal-back";
    back.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="mdTitle">
      <h2 class="panel-title" id="mdTitle" style="font-size:1.05rem;margin-bottom:.35rem">${esc(title)}</h2>
      ${message ? `<p style="color:var(--ink-2);font-size:.9rem;margin:0 0 .9rem">${esc(message)}</p>` : ""}
      ${hasInput ? `<input type="text" id="mdInput" maxlength="120" style="width:100%;margin-bottom:.9rem" aria-label="${esc(title)}">` : ""}
      <div class="btn-row" style="justify-content:flex-end"><button type="button" class="btn btn-sm" data-r="0">Cancel</button><button type="button" class="btn btn-sm btn-primary" data-r="1">${esc(okLabel || "OK")}</button></div></div>`;
    document.body.appendChild(back);
    const input = back.querySelector("#mdInput");
    if (input) input.value = value;
    const done = ok => {
      const v = hasInput ? (ok ? input.value.trim() : null) : ok;
      back.remove(); document.removeEventListener("keydown", onKey, true);
      if (prev && prev.focus) prev.focus();
      resolve(v);
    };
    const onKey = e => {
      if (e.key === "Escape") { e.preventDefault(); done(false); }
      else if (e.key === "Enter" && input && document.activeElement === input) { e.preventDefault(); done(true); }
      else if (e.key === "Tab") {
        const f = [...back.querySelectorAll("input,button")];
        const i = f.indexOf(document.activeElement);
        const n = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i === f.length - 1 ? 0 : i + 1);
        e.preventDefault(); f[n].focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    back.addEventListener("click", e => {
      if (e.target === back) return done(false);
      const r = e.target.closest("[data-r]");
      if (r) done(r.dataset.r === "1");
    });
    (input || back.querySelector('[data-r="1"]')).focus();
    if (input) input.select();
  });
}
const askConfirm = (title, message, okLabel) => modal({ title, message, okLabel });
const askText = (title, value) => modal({ title, value, okLabel: "Save" });

/* language for feedback */
const ID_HINT = new Set("yang dan di ke dari untuk pada dengan adalah itu ini akan telah sudah dapat tidak dalam oleh karena bahwa jika maka juga atau sebagai serta para lebih saya kami mereka".split(" "));
const EN_HINT = new Set("the and of to in is are was were for with that this it as on be by not or from which have has".split(" "));
function detectLang(text) {
  let id = 0, en = 0;
  wordsOf(text || "").forEach(w => { if (ID_HINT.has(w)) id++; if (EN_HINT.has(w)) en++; });
  return id > en ? "id" : "en";
}
let fb = "en";
function setFb(sample) { fb = settings.defLang === "Indonesian" ? "id" : settings.defLang === "English" ? "en" : detectLang(sample); }
const tr = (en, id) => fb === "id" ? id : en;
const fbName = () => fb === "id" ? "Indonesian" : "English";

/* ---------- drafts ---------- */
let draftT;
function collectDrafts() {
  return { editor: editor.value, ansQ: $("#ansQ").value, ansA: $("#ansA").value, refSrc: $("#refSrc").value,
    refText: $("#refText").value, refList: $("#refList").value, stu: { q: stu.q, idea: stu.idea, a: stu.a } };
}
function saveDrafts() {
  clearTimeout(draftT);
  draftT = setTimeout(() => {
    if (!settings.saveDrafts) return;
    try { localStorage.setItem(DKEY, JSON.stringify(collectDrafts())); } catch (e) { }
  }, 400);
}
function restoreDrafts() {
  if (!settings.saveDrafts) return;
  try {
    const d = JSON.parse(localStorage.getItem(DKEY) || "null");
    if (!d) return;
    editor.value = d.editor || ""; $("#ansQ").value = d.ansQ || ""; $("#ansA").value = d.ansA || "";
    $("#refSrc").value = d.refSrc || ""; $("#refText").value = d.refText || ""; $("#refList").value = d.refList || "";
    if (d.stu) { stu.q = d.stu.q || ""; stu.idea = d.stu.idea || ""; stu.a = d.stu.a || ""; }
  } catch (e) { }
}
async function clearDrafts() {
  if (!(await askConfirm("Clear all saved drafts?", "This empties the editor and every input box in the app. It cannot be undone.", "Clear drafts"))) return;
  try { localStorage.removeItem(DKEY); } catch (e) { }
  editor.value = ""; $("#ansQ").value = ""; $("#ansA").value = ""; $("#refSrc").value = ""; $("#refText").value = ""; $("#refList").value = "";
  stu.q = stu.idea = stu.a = ""; stu.res = null; stu.shown = false; stu.improve = null; stu.step = 1; stu.max = 1;
  state.paraCtx = null; updateCtxBar(); updateCounts(); ansCounts(); state.analysis = null; renderDetector();
  state.rewrite = null; renderCompare(); state.coach = null; renderCoach();
  ans.res = null; $("#ansAnalysis").innerHTML = ""; ans.improve = null; $("#ansImproveOut").innerHTML = "";
  $("#refOut").innerHTML = ""; $("#refCheckOut").innerHTML = ""; refState = null;
  if (page === "student") renderStudent();
  toast("Saved drafts cleared.");
}

/* ---------- theme ---------- */
function applyTheme() {
  const t = settings.theme;
  if (t === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
  $("#themeLabel").textContent = t === "system" ? "System theme" : t === "light" ? "Light theme" : "Dark theme";
  $$("[data-theme-set]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.themeSet === t)));
}
$("#themeBtn").onclick = () => {
  const order = ["system", "light", "dark"];
  settings.theme = order[(order.indexOf(settings.theme) + 1) % 3];
  applyTheme(); saveSettings();
};
$$("[data-theme-set]").forEach(b => b.onclick = () => { settings.theme = b.dataset.themeSet; applyTheme(); saveSettings(); });

/* ---------- routing ---------- */
let booted = false;
const editorHost = $("#editorHost");
const editorWrap = editorHost.firstElementChild;
const editor = $("#editor");
let page = "home";

function go(name) {
  page = name;
  $$(".page").forEach(p => p.classList.toggle("is-active", p.id === "page-" + name));
  $$(".rail button").forEach(b => b.setAttribute("aria-current", b.dataset.go === name ? "page" : "false"));
  const slot = document.querySelector('.editor-slot[data-slot="' + name + '"]');
  if (slot) slot.appendChild(editorWrap); else editorHost.appendChild(editorWrap);
  if (name === "history") renderHistory();
  if (name === "student") renderStudent();
  if (name === "coach") renderCoach();
  refreshAiNotes();
  window.scrollTo(0, 0);
  if (booted) { const p = $("#page-" + name); if (p) p.focus({ preventScroll: true }); }
}
document.addEventListener("click", e => {
  const b = e.target.closest("[data-go]");
  if (b) { e.preventDefault(); go(b.dataset.go); return; }
  const s = e.target.closest("[data-scroll]");
  if (s) { const t = document.getElementById(s.dataset.scroll); if (t) t.scrollIntoView({ behavior: "smooth", block: "start" }); }
});

/* ---------- editor ---------- */
function updateCounts() {
  const t = editor.value;
  const w = wordsOf(t).length;
  $("#cWords").textContent = w.toLocaleString();
  $("#cChars").textContent = t.length.toLocaleString();
  $("#cSents").textContent = t.trim() ? splitSentences(t).length.toLocaleString() : "0";
  $("#cRead").textContent = Math.max(w ? 1 : 0, Math.round(w / 225));
}
function updateCtxBar() {
  const c = state.paraCtx;
  $("#ctxBar").hidden = !c;
  if (c) $("#ctxN").textContent = c.index;
}
editor.addEventListener("input", () => { updateCounts(); saveDrafts(); });
$("#ctxRestore").onclick = () => {
  const c = state.paraCtx; if (!c) return;
  editor.value = c.full; state.paraCtx = null; updateCtxBar(); updateCounts(); state.rewrite = null; renderCompare(); saveDrafts();
  toast("Full draft restored.");
};
$("#clearBtn").onclick = async () => {
  if (editor.value) {
    const msg = state.paraCtx ? "You are working on a single paragraph. The full draft will not be restored if you clear now." : "";
    if (!(await askConfirm("Clear the editor?", msg, "Clear"))) return;
  }
  editor.value = ""; state.paraCtx = null; updateCtxBar(); updateCounts(); state.analysis = null; renderDetector();
  state.rewrite = null; renderCompare(); state.coach = null; renderCoach(); saveDrafts(); editor.focus();
};
$("#copyTextBtn").onclick = () => editor.value.trim() ? copy(editor.value, "Text") : toast("Nothing to copy yet.");
$("#sampleBtn").onclick = () => {
  const id = (navigator.language || "en").toLowerCase().startsWith("id");
  editor.value = SAMPLES[id ? "id" : "en"];
  updateCounts(); saveDrafts(); toast("Sample loaded — press “Analyze text”.");
};
$("#analyzeBtn").onclick = () => { go("detector"); runAnalysis(); };
$("#naturalBtn").onclick = () => { if (page === "rewriter") doRewrite(); else go("rewriter"); };

/* ---------- state ---------- */
const state = { analysis: null, analyzedText: "", rewrite: null, streaming: false, showDiff: true, paraCtx: null, coach: null };

/* ---------- detector ---------- */
function runAnalysis() {
  const t = editor.value.trim();
  if (!t) { state.analysis = null; renderDetector(MSG.empty); editor.focus(); return; }
  if (wordsOf(t).length < MIN_WORDS) { state.analysis = null; renderDetector(MSG.short); return; }
  try { state.analysis = analyze(t); }
  catch (e) { console.warn(e); state.analysis = null; renderDetector(MSG.generic); return; }
  state.analyzedText = t;
  renderDetector();
  const a = state.analysis;
  pushHistory({
    kind: "analysis", title: titleFrom(t), words: a.words, ai: a.ai, band: a.band,
    analysis: { ai: a.ai, band: a.band, naturalness: a.naturalness, variation: a.variation, diversity: a.diversity, repetition: a.repetition, readability: a.readability },
    preview: t.slice(0, 160), text: settings.storeText ? t : null
  });
  requestAnimationFrame(() => { const h = $("#verdict"); if (h) h.scrollIntoView({ block: "start", behavior: "smooth" }); });
}
function bar(label, val, higherIsBetter, note) {
  const good = higherIsBetter ? val >= 60 : val <= 35;
  const bad = higherIsBetter ? val < 35 : val > 65;
  const cls = good ? "g" : bad ? "r" : "a";
  return `<div><div class="metric-name"><b>${label}</b><i>${val}<small>/100</small></i></div>
    <div class="track" role="img" aria-label="${esc(label)} ${val} out of 100"><div class="fill ${cls}" style="width:${val}%"></div></div>
    <div class="metric-note">${note}</div></div>`;
}

function renderDetector(msg) {
  const el = $("#detectorResult");
  const a = state.analysis;
  const notice = msg ? `<div class="notice warn" role="alert" style="margin-bottom:1rem">${esc(msg)}</div>` : "";
  if (!a) {
    el.innerHTML = notice + `<div class="empty"><strong>No analysis yet</strong>
      Paste a draft above and press “Analyze text”. Nothing is uploaded — the numbers are computed here in your browser.</div>`;
    return;
  }
  const C = 339.292, dash = C * a.ai / 100;
  const maxLen = Math.max(...a.lengths, 1);
  const shown = a.lengths.slice(0, 70);
  const paras = a.paraStats.slice(0, 40);

  el.innerHTML = notice + `
  <div class="panel" id="verdict">
    <div class="verdict">
      <div class="ring">
        <svg width="148" height="148" viewBox="0 0 148 148" aria-hidden="true">
          <circle cx="74" cy="74" r="54" fill="none" stroke="var(--rule)" stroke-width="9"></circle>
          <circle cx="74" cy="74" r="54" fill="none" stroke="${bandVar(a.band)}" stroke-width="9"
            stroke-linecap="round" stroke-dasharray="${dash.toFixed(1)} ${C}"></circle>
        </svg>
        <div class="ring-val"><b>${a.ai}</b><small>out of 100</small></div>
      </div>
      <div>
        <p class="eyebrow" style="margin-bottom:.4rem">Indicative AI-like patterns</p>
        <span class="band ${a.band}"><span class="band-dot"></span>${bandWord(a.band)}</span>
        <h2>This draft shows ${a.band === "high" ? "many" : a.band === "mid" ? "some" : "few"} AI-like patterns</h2>
        <p>The figure is an indicative estimate built from ${a.sentences} sentences and ${a.words.toLocaleString()} words of your text. It describes the writing, not the writer.</p>
      </div>
    </div>
    ${a.confidence !== "high" ? `<div class="notice warn" style="margin-top:1.1rem"><strong>${a.words} words is ${a.confidence === "low" ? "too short for a reliable read" : "a small sample"}.</strong>
      ${a.confidence === "low" ? "Below 120 words these statistics are mostly noise, so the figure has been pulled toward the middle. Add more text for a meaningful result." : "Between 120 and 320 words the figure moves a lot with small edits. Treat it loosely."}</div>` : ""}
    <div class="notice" style="margin-top:1.1rem">AI detection is probabilistic and may produce false positives or false negatives. This result is not proof of authorship.</div>
  </div>

  <div class="panel">
    <h2 class="panel-title">Writing analysis</h2>
    <p class="panel-sub">Six measurements on a 0–100 scale. Indicative, not proof.</p>
    <div class="metrics">
      ${bar("AI-like pattern indicator", a.ai, false, "Blends sentence uniformity, formulaic phrasing, repetition and missing personal texture. Lower means fewer of these patterns.")}
      ${bar("Naturalness", a.naturalness, true, "Variation, vocabulary spread and personal texture taken together.")}
      ${bar("Sentence variation", a.variation, true, `Sentences average ${a.avgLen.toFixed(1)} words, from ${a.minLen} to ${a.maxLen}. Higher means a more varied rhythm.`)}
      ${bar("Vocabulary diversity", a.diversity, true, `${a.unique.toLocaleString()} distinct words, measured in 50-word windows so length does not skew it.`)}
      ${bar("Repetition", a.repetition, false, "Repeated phrases, repeated sentence openings, and how concentrated the content words are.")}
      ${bar("Readability", a.readability, true, "Estimated from sentence length and how many long words appear. A rough guide, not tied to one language.")}
    </div>
  </div>

  <div class="panel">
    <h2 class="panel-title">Why did we get this result?</h2>
    <p class="panel-sub">Every finding below is something you can check in your own text.</p>
    ${a.factors.length ? `<ul class="factors">${a.factors.map(f => `
      <li><span class="tag ${f.dir}">${f.dir === "up" ? "raises" : "lowers"}</span>
        <div><strong>${esc(f.title)}</strong><span>${esc(f.detail)}</span></div></li>`).join("")}</ul>`
      : `<p style="color:var(--ink-2);margin:0">Nothing stood out strongly in either direction. The text sits in the middle of every measurement.</p>`}
  </div>

  <div class="panel">
    <h2 class="panel-title">Paragraph analysis</h2>
    <p class="panel-sub">Naturalness and AI-like pattern for each paragraph. Short paragraphs give less reliable readings.${a.paraStats.length > 40 ? " First 40 shown." : ""}</p>
    <div class="para-list">${paras.map((p, i) => `
      <div class="para">
        <div style="min-width:0">
          <strong>Paragraph ${i + 1}</strong><span class="pill ${p.band}">AI-like pattern: ${bandShort(p.band)}</span>
          <div class="para-meta"><span>Naturalness <b>${p.naturalness}</b></span><span>${p.words} words</span><span>${p.sentences} sentence${p.sentences === 1 ? "" : "s"}</span></div>
          <div class="para-prev">${esc(p.text.slice(0, 120))}</div>
          ${p.notes.length ? `<div class="para-notes">${esc(p.notes.join(" · "))}</div>` : ""}
          ${p.reliable ? "" : `<div class="para-notes">Too short for a reliable reading.</div>`}
        </div>
        <button class="btn btn-sm" data-review="${i}">Review this paragraph</button>
      </div>`).join("")}</div>
  </div>

  <div class="panel">
    <h2 class="panel-title">Sentence rhythm</h2>
    <p class="panel-sub">One bar per sentence, scaled to its word count${a.lengths.length > 70 ? " (first 70 shown)" : ""}.</p>
    <div class="rhythm">${shown.map((n, i) => `<div class="rbar"><em>${i + 1}</em><i style="width:${Math.max(2, n / maxLen * 100)}%;background:${n > maxLen * .75 ? "var(--blue)" : "var(--ink-3)"}"></i></div>`).join("")}</div>
    <div class="rhythm-legend"><span>Shortest ${a.minLen} words</span><span>Average ${a.avgLen.toFixed(1)}</span><span>Longest ${a.maxLen}</span><span>Spread ${(a.cv * 100).toFixed(0)}% of average</span></div>
  </div>

  <div class="panel">
    <h2 class="panel-title">Text statistics</h2>
    <p class="panel-sub">The raw counts, for reference.</p>
    <div class="statgrid">
      <div><b>${a.words.toLocaleString()}</b><small>words</small></div>
      <div><b>${a.chars.toLocaleString()}</b><small>characters</small></div>
      <div><b>${a.sentences}</b><small>sentences</small></div>
      <div><b>${a.paragraphs}</b><small>paragraphs</small></div>
      <div><b>${a.unique.toLocaleString()}</b><small>distinct words</small></div>
      <div><b>${a.connHits}</b><small>formulaic phrases</small></div>
      <div><b>${a.readMin}</b><small>min read</small></div>
    </div>
    ${a.connectors.length ? `<p style="font-size:.86rem;color:var(--ink-2);margin:.9rem 0 0">Found: ${a.connectors.slice(0, 10).map(c => `${esc(c.phrase)}${c.count > 1 ? " ×" + c.count : ""}`).join(", ")}${a.connectors.length > 10 ? ", …" : ""}</p>` : ""}
    <div class="btn-row" style="margin-top:1.1rem">
      <button class="btn btn-sm" id="copyResultBtn">Copy result</button>
      <button class="btn btn-sm" data-go="rewriter">Make more natural</button>
      <button class="btn btn-sm" data-go="coach">Get writing feedback</button>
    </div>
  </div>`;

  $("#copyResultBtn").onclick = () => copy(resultText(a), "Result");
  $$("[data-review]").forEach(b => b.onclick = () => reviewParagraph(+b.dataset.review));
}

function resultText(a) {
  return ["HumanText AI — writing analysis", "Date: " + fmtDate(Date.now()), "",
    `Indicative AI-like patterns: ${a.ai}/100 (${bandWord(a.band).toLowerCase()})`,
    `Naturalness: ${a.naturalness}/100`, `Sentence variation: ${a.variation}/100`, `Vocabulary diversity: ${a.diversity}/100`,
    `Repetition: ${a.repetition}/100`, `Readability: ${a.readability}/100`, "",
    `Words ${a.words} · sentences ${a.sentences} · paragraphs ${a.paragraphs} · distinct words ${a.unique}`,
    `Sentence length ${a.minLen}–${a.maxLen}, average ${a.avgLen.toFixed(1)}`, "",
    "Why did we get this result?", ...a.factors.map(f => `- [${f.dir === "up" ? "raises" : "lowers"}] ${f.title}: ${f.detail}`), "",
    "Paragraph analysis", ...a.paraStats.map((p, i) => `- Paragraph ${i + 1}: naturalness ${p.naturalness}, AI-like pattern ${bandShort(p.band).toLowerCase()}`), "",
    "AI detection is probabilistic and may produce false positives or false negatives. This result is not proof of authorship."
  ].join("\n");
}

function reviewParagraph(i) {
  const a = state.analysis;
  if (!a || !a.paraStats[i]) return;
  state.paraCtx = { full: state.analyzedText, para: a.paraStats[i].text, index: i + 1 };
  editor.value = a.paraStats[i].text; updateCounts(); state.rewrite = null; renderCompare(); updateCtxBar();
  go("rewriter"); toast("Paragraph " + (i + 1) + " sent to the Natural Rewriter.");
}
