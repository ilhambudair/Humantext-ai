"use strict";
/* HumanText AI — analysis engine + word-level diff. Runs entirely in the browser; no network, no dependencies. */
/* ============================================================
   1. ANALYSIS ENGINE  —  runs entirely in the browser
   ============================================================ */
const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
const pct = x => Math.round(clamp01(x) * 100);

const ABBR = /\b(?:mr|mrs|ms|dr|prof|sr|jr|st|no|vs|etc|e\.g|i\.e|cf|al|fig|vol|ed|pp|hlm|dll|dsb|dst|tsb|yth|drs|ir|spd|mpd)\.$/i;

function splitSentences(text) {
  const out = [];
  text.split(/\n+/).forEach(block => {
    const p = block.trim();
    if (!p) return;
    const parts = p.match(/[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)/g) || [p];
    let buf = "";
    parts.forEach(raw => {
      const s = raw.trim();
      if (!s) return;
      buf = buf ? buf + " " + s : s;
      const wc = (buf.match(/[\p{L}\p{N}]+/gu) || []).length;
      if (ABBR.test(buf) || /\b\p{L}\.$/u.test(buf) || wc < 2) return;   // keep accumulating
      out.push(buf); buf = "";
    });
    if (buf) out.push(buf);
  });
  return out;
}

const wordsOf = t => (t.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []);

const STOP = new Set(("the a an and or but of to in on at for with by from as is are was were be been being it its this that these those there here " +
  "not no so if then than which who whom whose what when where how also very more most much many some any each such about into over under between " +
  "i you he she we they me him her us them my your his our their do does did done have has had will would can could should may might must " +
  "yang di ke dari untuk pada dengan dan atau tetapi namun adalah ialah itu ini akan telah sudah dapat bisa harus juga tidak bukan sebagai " +
  "dalam oleh karena agar supaya sehingga serta para lebih paling sangat hanya masih saja kami kita saya anda mereka dia ada tersebut " +
  "bahwa jika maka antara terhadap secara suatu adanya merupakan").split(/\s+/));

const CONNECTORS = [
  ["moreover", /\bmoreover\b/g], ["furthermore", /\bfurthermore\b/g], ["additionally", /\badditionally\b/g],
  ["in addition", /\bin addition\b/g], ["however", /\bhowever\b/g], ["therefore", /\btherefore\b/g],
  ["thus", /\bthus\b/g], ["consequently", /\bconsequently\b/g], ["in conclusion", /\bin conclusion\b/g],
  ["overall", /\boverall,/g], ["ultimately", /\bultimately\b/g], ["in today's world", /\bin today'?s? (?:[\w-]+ ){0,3}?(?:world|society|digital age|digital landscape|landscape|era)\b/g],
  ["it is important to note", /\bit is (?:important|worth) (?:to note|noting)\b/g], ["plays a crucial role", /\bplays? a (?:crucial|vital|significant|key) role\b/g],
  ["delve into", /\bdelv(?:e|ing) into\b/g], ["the landscape of", /\bthe (?:landscape|realm|world) of\b/g],
  ["navigate", /\bnavigat(?:e|ing) the\b/g], ["foster", /\bfoster(?:s|ing)?\b/g], ["leverage", /\bleverag(?:e|es|ing)\b/g],
  ["robust", /\brobust\b/g], ["seamless", /\bseamless(?:ly)?\b/g], ["comprehensive", /\bcomprehensive\b/g],
  ["multifaceted", /\bmultifaceted\b/g], ["on the other hand", /\bon the other hand\b/g],
  ["first and foremost", /\bfirst and foremost\b/g], ["in summary", /\bin summary\b/g], ["to sum up", /\bto sum up\b/g],
  ["as a result", /\bas a result\b/g], ["in essence", /\bin essence\b/g], ["a testament to", /\ba testament to\b/g],
  ["not only … but also", /\bnot only\b[^.]{0,60}\bbut also\b/g],
  ["selain itu", /\bselain itu\b/g], ["oleh karena itu", /\boleh karena itu\b/g], ["dengan demikian", /\bdengan demikian\b/g],
  ["di sisi lain", /\bdi sisi lain\b/g], ["namun demikian", /\bnamun demikian\b/g], ["dapat disimpulkan", /\bdapat disimpulkan\b/g],
  ["sebagai kesimpulan", /\bsebagai kesimpulan\b/g], ["hal ini menunjukkan", /\bhal ini menunjukkan\b/g],
  ["memainkan peran penting", /\bmemainkan peran (?:penting|krusial|vital)\b/g], ["di era modern", /\b(?:di|dalam) era (?:modern|digital|globalisasi)\b/g],
  ["penting untuk dicatat", /\bpenting untuk (?:dicatat|diperhatikan|dipahami)\b/g], ["secara keseluruhan", /\bsecara keseluruhan\b/g],
  ["seiring berjalannya waktu", /\bseiring (?:berjalannya waktu|dengan)\b/g], ["tidak hanya … tetapi juga", /\btidak hanya\b[^.]{0,60}\b(?:tetapi|namun) juga\b/g]
];

/* ---------- v2: paragraph + readability helpers ---------- */
function getParas(text) {
  const t = text.replace(/\r/g, "");
  let ps = t.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  if (ps.length === 1 && /\n/.test(ps[0])) ps = ps[0].split(/\n+/).map(p => p.trim()).filter(Boolean);
  return ps;
}

const CONN_START = /^(?:moreover|furthermore|additionally|in addition|however|therefore|thus|consequently|in conclusion|overall|ultimately|in summary|to sum up|as a result|on the other hand|first and foremost|selain itu|oleh karena itu|dengan demikian|namun demikian|di sisi lain|secara keseluruhan|sebagai kesimpulan|dapat disimpulkan|penting untuk dicatat)\b/i;

function readabilityScore(toks, lengths) {
  if (!toks.length) return 0;
  const mean = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : toks.length;
  const sl = clamp01((38 - mean) / 18);
  const longWords = toks.filter(w => w.replace(/[^\p{L}]/gu, "").length >= 13).length / toks.length;
  const lw = clamp01((0.15 - longWords) / 0.12);
  const veryLong = lengths.length ? lengths.filter(n => n > 40).length / lengths.length : 0;
  const vl = clamp01(1 - veryLong * 4);
  return pct(0.5 * sl + 0.3 * lw + 0.2 * vl);
}

function paraScore(p) {
  const toks = wordsOf(p), n = toks.length;
  const lower = p.toLowerCase();
  const lens = splitSentences(p).map(s => wordsOf(s).length).filter(x => x > 0);
  const mean = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 0;
  const sd = lens.length > 1 ? Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / (lens.length - 1)) : 0;
  const cv = mean ? sd / mean : 0;
  // few sentences say little about rhythm, so pull toward the middle
  const uniRaw = lens.length >= 3 ? clamp01((0.62 - cv) / 0.42) : 0.35;
  const shrink = lens.length >= 3 ? Math.min(1, (lens.length - 2) / 4) : 0;
  const uni = 0.35 + (uniRaw - 0.35) * shrink;
  let hits = 0;
  CONNECTORS.forEach(([, re]) => { const m = lower.match(new RegExp(re.source, "g")); if (m) hits += m.length; });
  const conn = clamp01((n ? hits / n * 100 : 0) / 2.2);
  const opener = CONN_START.test(lower.replace(/^[^\p{L}]+/u, ""));
  const tri = new Map(); let extra = 0;
  for (let i = 0; i + 2 < n; i++) { const k = toks[i] + " " + toks[i + 1] + " " + toks[i + 2]; tri.set(k, (tri.get(k) || 0) + 1); }
  tri.forEach(v => { if (v > 1) extra += v - 1; });
  const rep = clamp01((n > 2 ? extra / (n - 2) : 0) / 0.085);
  const ttr = n ? new Set(toks.slice(0, 50)).size / Math.min(50, n) : 0;
  const divers = clamp01((ttr - 0.68) / 0.26);
  const cnt = re => (lower.match(re) || []).length;
  const per = x => n ? x / n * 100 : 0;
  const shortFrac = lens.length ? lens.filter(x => x < 7).length / lens.length : 0;
  const tex = clamp01(0.25 * clamp01(per(cnt(/\b\w+['’](?:s|t|re|ve|ll|d|m)\b/g)) / 1.4)
    + 0.30 * clamp01(per(cnt(/\b(?:i|i['’]m|my|me|we|our|saya|aku|kami)\b/g)) / 1.2)
    + 0.15 * clamp01(per(cnt(/\?/g)) / 0.5)
    + 0.15 * clamp01(per(cnt(/\b(?:i think|i believe|probably|perhaps|maybe|it seems|menurut saya|sepertinya|mungkin|kayaknya|rasanya)\b/g)) / 0.7)
    + 0.15 * clamp01(shortFrac / 0.2));
  const naturalness = pct(0.22 * (1 - uni) + 0.38 * (1 - conn) + 0.10 * (1 - rep) + 0.16 * tex + 0.14 * divers - (opener ? 0.08 : 0));
  const band = naturalness >= 65 ? "low" : naturalness >= 45 ? "mid" : "high";
  const notes = [];
  if (lens.length >= 3 && uni > 0.7) notes.push("very even sentence lengths");
  else if (lens.length >= 3 && uni < 0.3) notes.push("sentence lengths vary naturally");
  if (hits >= 2 || conn > 0.6) notes.push(hits + " formulaic phrase" + (hits === 1 ? "" : "s"));
  if (opener) notes.push("opens with a stock connector");
  if (rep > 0.5) notes.push("repeated phrases");
  if (tex > 0.4) notes.push("personal touches");
  return { text: p, words: n, sentences: lens.length, naturalness, band, notes, opener, reliable: n >= 25 };
}

function analyze(raw) {
  const text = raw.replace(/\r/g, "");
  const lower = text.toLowerCase();
  const sents = splitSentences(text);
  const toks = wordsOf(text);
  const paras = getParas(text);
  const nWords = toks.length;
  const per100 = n => nWords ? (n / nWords) * 100 : 0;

  /* --- sentence rhythm --- */
  const lengths = sents.map(s => wordsOf(s).length).filter(n => n > 0);
  const mean = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;
  const sd = lengths.length > 1
    ? Math.sqrt(lengths.reduce((a, b) => a + (b - mean) ** 2, 0) / (lengths.length - 1)) : 0;
  const cv = mean ? sd / mean : 0;
  const uniformity = pct((0.62 - cv) / 0.42);

  /* --- vocabulary spread (moving-average type-token ratio) --- */
  const win = Math.min(50, Math.max(10, nWords));
  let mattr;
  if (nWords <= win) mattr = nWords ? new Set(toks).size / nWords : 0;
  else {
    const c = new Map(); let sum = 0, n = 0;
    for (let i = 0; i < nWords; i++) {
      c.set(toks[i], (c.get(toks[i]) || 0) + 1);
      if (i >= win) { const o = toks[i - win], v = c.get(o) - 1; v ? c.set(o, v) : c.delete(o); }
      if (i >= win - 1) { sum += c.size / win; n++; }
    }
    mattr = sum / n;
  }
  const diversity = pct((mattr - 0.68) / 0.26);

  /* --- repetition --- */
  const tri = new Map();
  for (let i = 0; i + 2 < nWords; i++) {
    const k = toks[i] + " " + toks[i + 1] + " " + toks[i + 2];
    tri.set(k, (tri.get(k) || 0) + 1);
  }
  let triExtra = 0; const repeatedPhrases = [];
  tri.forEach((v, k) => { if (v > 1) { triExtra += v - 1; if (!STOP.has(k.split(" ")[0]) || v > 2) repeatedPhrases.push({ phrase: k, count: v }); } });
  repeatedPhrases.sort((a, b) => b.count - a.count);
  const triRate = tri.size ? triExtra / Math.max(1, nWords - 2) : 0;

  const openers = sents.map(s => (wordsOf(s)[0] || "")).filter(Boolean);
  const openCount = new Map();
  openers.forEach(o => openCount.set(o, (openCount.get(o) || 0) + 1));
  let openExtra = 0, topOpener = null;
  openCount.forEach((v, k) => { openExtra += v - 1; if (!topOpener || v > topOpener.count) topOpener = { word: k, count: v }; });
  const openerRepeat = openers.length > 3 ? openExtra / openers.length : 0;

  const content = toks.filter(w => !STOP.has(w) && w.length > 2);
  const cCount = new Map();
  content.forEach(w => cCount.set(w, (cCount.get(w) || 0) + 1));
  const topContent = [...cCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const concentration = content.length ? topContent.reduce((a, b) => a + b[1], 0) / content.length : 0;

  const repetition = pct(0.45 * clamp01(triRate / 0.085) + 0.32 * clamp01((openerRepeat - 0.08) / 0.32)
    + 0.23 * clamp01((concentration - 0.06) / 0.15));

  /* --- formulaic connectors --- */
  const found = [];
  let connHits = 0;
  CONNECTORS.forEach(([label, re]) => {
    const m = lower.match(new RegExp(re.source, "g"));
    if (m && m.length) { connHits += m.length; found.push({ phrase: label, count: m.length }); }
  });
  found.sort((a, b) => b.count - a.count);
  const connDensity = per100(connHits);
  const connPressure = clamp01(connDensity / 2.2);

  /* --- paragraph regularity --- */
  let paraReg = 0.35;
  if (paras.length >= 3) {
    const pw = paras.map(p => wordsOf(p).length);
    const pm = pw.reduce((a, b) => a + b, 0) / pw.length;
    const psd = Math.sqrt(pw.reduce((a, b) => a + (b - pm) ** 2, 0) / (pw.length - 1));
    paraReg = clamp01((0.42 - (pm ? psd / pm : 0)) / 0.42);
  }

  /* --- human texture --- */
  const count = re => (lower.match(re) || []).length;
  const contractions = count(/\b\w+['’](?:s|t|re|ve|ll|d|m)\b/g);
  const firstPerson = count(/\b(?:i|i['’]m|my|me|myself|we|our|us|saya|aku|gue|gw|kami)\b/g);
  const questions = count(/\?/g);
  const parens = count(/\(/g);
  const hedges = count(/\b(?:i think|i believe|in my view|probably|perhaps|maybe|it seems|arguably|roughly|more or less|menurut saya|sepertinya|mungkin|kayaknya|agaknya|rasanya|kurang lebih)\b/g);
  const shortSents = lengths.filter(n => n < 7).length;
  const shortFrac = lengths.length ? shortSents / lengths.length : 0;
  const texture = 0.20 * clamp01(per100(contractions) / 1.4) + 0.22 * clamp01(per100(firstPerson) / 1.2)
    + 0.14 * clamp01(per100(questions) / 0.5) + 0.14 * clamp01(per100(parens) / 0.7)
    + 0.16 * clamp01(per100(hedges) / 0.7) + 0.14 * clamp01(shortFrac / 0.2);

  /* --- stylistic habits --- */
  const triplets = count(/\b[\p{L}\p{N}'’-]+,\s+[\p{L}\p{N}'’-]+(?:\s+[\p{L}\p{N}'’-]+)?,?\s+(?:and|or|dan|atau|serta)\s+[\p{L}\p{N}'’-]+/gu);
  const tripletDensity = per100(triplets);
  const dashes = count(/—|–|\s-\s/g);
  const dashDensity = per100(dashes);

  /* --- composite --- */
  const signals = [
    [0.24, uniformity / 100],
    [0.20, connPressure],
    [0.14, repetition / 100],
    [0.14, 1 - texture],
    [0.08, paraReg],
    [0.08, clamp01((0.90 - mattr) / 0.18)],
    [0.07, clamp01(tripletDensity / 1.1)],
    [0.05, clamp01(dashDensity / 1.0)]
  ];
  let ai = signals.reduce((a, [w, v]) => a + w * clamp01(v), 0) * 100;
  // Several habits appearing together is more telling than any one of them,
  // and a text with none of them is more telling still.
  const hot = signals.filter(([, v]) => v > 0.70).length;
  const cold = signals.filter(([, v]) => v < 0.25).length;
  if (hot >= 3) ai += Math.min(15, (hot - 2) * 5);
  if (cold >= 6) ai -= 6;

  const confidence = nWords < 120 ? "low" : nWords < 320 ? "medium" : "high";
  if (nWords < 120) { const k = 0.45 + 0.55 * (nWords / 120); ai = ai * k + 42 * (1 - k); }
  // Deliberately bounded to 5–95: this method cannot justify certainty at either end.
  ai = Math.round(5 + clamp01(ai / 100) * 90);

  const naturalness = pct(0.30 * (1 - uniformity / 100) + 0.22 * (diversity / 100)
    + 0.22 * (1 - repetition / 100) + 0.16 * texture + 0.10 * (1 - connPressure));

  const band = ai >= 66 ? "high" : ai >= 35 ? "mid" : "low";

  /* --- explanations --- */
  const F = [];
  const add = (dir, strength, title, detail) => F.push({ dir, strength, title, detail });

  if (lengths.length >= 4) {
    const lo = Math.min(...lengths), hi = Math.max(...lengths);
    if (cv < 0.38) add("up", cv < 0.26 ? "strong" : "moderate", "Sentence lengths barely vary",
      `Sentences run ${lo}–${hi} words around an average of ${mean.toFixed(1)}. The spread is ${(cv * 100).toFixed(0)}% of the average; most human drafts sit nearer 45–60%.`);
    else if (cv > 0.50) add("down", "moderate", "Sentence lengths vary widely",
      `From ${lo} to ${hi} words, a spread of ${(cv * 100).toFixed(0)}% around the ${mean.toFixed(1)}-word average. Uneven rhythm is one of the clearest human signatures.`);
  }
  if (repeatedPhrases.length && triRate > 0.02)
    add("up", triRate > 0.05 ? "strong" : "moderate", "The same phrases come back",
      `${repeatedPhrases.length} three-word sequence${repeatedPhrases.length > 1 ? "s repeat" : " repeats"}, led by “${repeatedPhrases[0].phrase}” (${repeatedPhrases[0].count}×).`);
  if (openerRepeat > 0.25 && topOpener && topOpener.count > 2)
    add("up", "moderate", "Sentences open the same way",
      `${topOpener.count} of ${sents.length} sentences start with “${topOpener.word}”, and only ${openCount.size} distinct opening words appear in total.`);
  if (found.length && connDensity > 0.6)
    add("up", connDensity > 1.6 ? "strong" : "moderate", "Formulaic connectors are frequent",
      `${connHits} instance${connHits > 1 ? "s" : ""} across ${found.length} phrase${found.length > 1 ? "s" : ""} — ${found.slice(0, 4).map(f => `“${f.phrase}” (${f.count})`).join(", ")}.`);
  if (mattr < 0.80)
    add("up", mattr < 0.74 ? "strong" : "moderate", "Vocabulary keeps circling",
      `In any 50-word stretch only ${(mattr * 100).toFixed(0)}% of words are distinct. ${topContent.length ? `“${topContent[0][0]}” alone appears ${topContent[0][1]} times.` : ""}`);
  else if (mattr > 0.89)
    add("down", "slight", "Wide vocabulary spread", `About ${(mattr * 100).toFixed(0)}% of words in any 50-word stretch are distinct, with ${new Set(toks).size} distinct words overall.`);
  if (paras.length >= 3 && paraReg > 0.72)
    add("up", "moderate", "Paragraphs are built to the same size",
      `${paras.length} paragraphs of ${Math.round(paras.reduce((a, p) => a + wordsOf(p).length, 0) / paras.length)} words on average, with very little difference between them.`);
  if (texture < 0.22 && nWords > 150)
    add("up", texture < 0.1 ? "moderate" : "slight", "Few personal or informal marks",
      `No contractions to speak of (${contractions}), ${questions} question${questions === 1 ? "" : "s"}, ${parens} aside${parens === 1 ? "" : "s"} in brackets and ${shortSents} short sentence${shortSents === 1 ? "" : "s"}. Careful academic prose often looks like this too.`);
  else if (texture > 0.45)
    add("down", "moderate", "A personal voice shows through",
      `Contractions, first-person references, asides and short sentences all appear at rates typical of someone writing in their own voice.`);
  if (tripletDensity > 0.7)
    add("up", "slight", "Lists of three keep appearing", `${triplets} “this, that and the other” construction${triplets === 1 ? "" : "s"} — ${tripletDensity.toFixed(1)} per 100 words.`);
  if (dashDensity > 0.8)
    add("up", "slight", "Heavy use of dashes", `${dashes} dash-set asides, ${dashDensity.toFixed(1)} per 100 words.`);
  if (shortFrac > 0.18 && lengths.length > 5)
    add("down", "slight", "Short sentences break the flow", `${shortSents} of ${lengths.length} sentences are under seven words.`);

  const paraStats = paras.map(paraScore);
  const openerParas = paraStats.filter(p => p.opener).length;
  if (paras.length >= 3 && openerParas >= 2 && openerParas / paras.length >= 0.4)
    add("up", "moderate", "Paragraph transitions look formulaic",
      `${openerParas} of ${paras.length} paragraphs open with a stock connector such as “moreover” or “therefore”.`);
  const readability = readabilityScore(toks, lengths);
  const variation = 100 - uniformity;

  const rank = { strong: 0, moderate: 1, slight: 2 };
  F.sort((a, b) => rank[a.strength] - rank[b.strength] || (a.dir === "up" ? -1 : 1));

  return {
    words: nWords, chars: text.length, sentences: sents.length, paragraphs: paras.length,
    unique: new Set(toks).size, avgLen: mean, minLen: lengths.length ? Math.min(...lengths) : 0,
    maxLen: lengths.length ? Math.max(...lengths) : 0, readMin: Math.max(1, Math.round(nWords / 225)),
    ai, naturalness, repetition, uniformity, diversity, band, confidence,
    variation, readability, paraStats,
    lengths, factors: F, connectors: found, connHits, cv
  };
}

/* ============================================================
   2. WORD-LEVEL DIFF
   ============================================================ */
const dtok = s => s.match(/\s+|[^\s]+/g) || [];

function lcsDiff(a, b) {
  const n = a.length, m = b.length;
  if (!n) return b.map(t => ({ t: "ins", v: t }));
  if (!m) return a.map(t => ({ t: "del", v: t }));
  if (n * m > 1600000) return [{ t: "del", v: a.join("") }, { t: "ins", v: b.join("") }];
  const dp = new Int32Array((n + 1) * (m + 1)), W = m + 1;
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i * W + j] = a[i] === b[j] ? dp[(i + 1) * W + j + 1] + 1
        : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
  const out = []; let i = 0, j = 0;
  const push = (t, v) => { const l = out[out.length - 1]; if (l && l.t === t) l.v += v; else out.push({ t, v }); };
  while (i < n && j < m) {
    if (a[i] === b[j]) { push("eq", a[i]); i++; j++; }
    else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) { push("del", a[i]); i++; }
    else { push("ins", b[j]); j++; }
  }
  while (i < n) push("del", a[i++]);
  while (j < m) push("ins", b[j++]);
  return out;
}

function diffTexts(oldT, newT) {
  const A = oldT.split(/\n\s*\n/), B = newT.split(/\n\s*\n/);
  // Pair paragraphs only when the rewrite kept the same paragraph count;
  // that keeps long documents fast without mis-aligning restructured ones.
  if (A.length < 2 || A.length !== B.length || A.length > 60)
    return lcsDiff(dtok(oldT), dtok(newT));
  const out = [];
  for (let k = 0; k < A.length; k++) {
    if (k) out.push({ t: "eq", v: "\n\n" });
    if (A[k] === B[k]) out.push({ t: "eq", v: A[k] });
    else lcsDiff(dtok(A[k]), dtok(B[k])).forEach(d => out.push(d));
  }
  return out;
}
