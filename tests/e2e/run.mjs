// End-to-end UI tests through the REAL stack: browser -> dev server -> /api/ai -> fake Anthropic.
// Optional (Playwright is not a dependency of the site):
//   npm i -D playwright && npx playwright install chromium && node tests/e2e/run.mjs
import { createRequire } from "node:module";
import { createDevServer } from "../../scripts/dev-server.mjs";
import { createMockAnthropic } from "../mock-anthropic.mjs";
import { resetRateLimits } from "../../api/_lib/security.js";
const { chromium } = createRequire(import.meta.url)("playwright");

const KEY = "sk-ant-e2e-SECRET-DO-NOT-LEAK";
const R = [], errs = [];
const ok = (n, c) => R.push((c ? "PASS " : "FAIL ") + n);

const mock = createMockAnthropic();
const mockPort = await mock.listen(0);
const setMode = m => fetch(`http://127.0.0.1:${mockPort}/__mode?set=${m}`);
const lastPrompt = async kind => (await (await fetch(`http://127.0.0.1:${mockPort}/__last?kind=${kind}`)).json()).prompt || "";
const app = createDevServer();
await new Promise(r => app.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${app.address().port}`;
const resetEnv = () => {
  for (const k of ["AI_ACCESS_CODE", "ALLOWED_ORIGINS", "RATE_LIMIT_PER_MINUTE"]) delete process.env[k];
  process.env.ANTHROPIC_API_KEY = KEY; process.env.ANTHROPIC_API_URL = `http://127.0.0.1:${mockPort}/v1/messages`;
  process.env.RATE_LIMIT_PER_MINUTE = "1000"; resetRateLimits();
};
resetEnv();
const browser = await chromium.launch();
const allRequests = [], allResponses = [];

async function page(opts = {}, { wait = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...opts });
  const p = await ctx.newPage();
  p.on("console", m => { if (m.type() === "error" && !/Failed to load resource|net::ERR/.test(m.text())) errs.push(m.text()); });
  p.on("pageerror", e => errs.push("PAGEERROR " + e.message));
  p.on("request", r => allRequests.push(r.url()));
  p.on("response", async r => { try { if (r.url().startsWith(base)) allResponses.push(await r.text()); } catch { } });
  await p.goto(base);
  if (wait) await p.waitForFunction(() => typeof capsResolved !== "undefined" && capsResolved);
  return p;
}
const on = (p, pg) => p.click(`.rail button[data-go="${pg}"]`);
const activePage = p => p.$eval(".page.is-active", e => e.id);

/* ================= 1. navigation, home, detector, rewriter ================= */
{
  const p = await page();
  const labels = await p.$$eval(".rail button", els => els.map(e => e.textContent.trim()));
  ok("nav has 10 items", labels.length === 10);
  for (const pg of ["home", "detector", "rewriter", "answer", "student", "references", "coach", "history", "settings", "about"]) {
    await on(p, pg); ok("nav -> " + pg, (await activePage(p)) === "page-" + pg);
  }
  await on(p, "home");
  ok("home: 6 feature cards", (await p.$$(".feat")).length === 6);
  const hero = await p.textContent(".hero");
  ok("home: hero buttons", hero.includes("Analyze Text") && hero.includes("Improve My Answer") && hero.includes("Write naturally. Understand clearly."));
  await p.click('.hero [data-go="answer"]'); ok("Improve My Answer -> answer", (await activePage(p)) === "page-answer");

  await on(p, "detector");
  await p.click("#analyzeBtn"); ok("detector: empty message", (await p.textContent("#detectorResult")).includes("Please enter some text first."));
  await p.fill("#editor", "Too short text."); await p.click("#analyzeBtn");
  ok("detector: short message", (await p.textContent("#detectorResult")).includes("Add a little more text for a more useful analysis."));
  await p.click("#sampleBtn"); await p.click("#analyzeBtn");
  const det = await p.textContent("#detectorResult");
  for (const s of ["Indicative AI-like patterns", "Writing analysis", "AI-like pattern indicator", "Naturalness", "Sentence variation", "Vocabulary diversity", "Repetition", "Readability", "Why did we get this result?", "Paragraph analysis", "Review this paragraph", "may produce false positives or false negatives. This result is not proof of authorship."])
    ok("detector has: " + s, det.includes(s));
  ok('detector never says "AI detected"', !/AI detected/.test(det));

  const multi = "In today's rapidly evolving digital landscape, online learning has become an increasingly important component of higher education. Moreover, it offers students flexibility. Furthermore, institutions reach more learners.\n\nHonestly, I never liked online classes. My laptop froze twice during the first exam and I panicked. Nobody answered my emails for a day. It was awful, but I learned to plan ahead.\n\nHowever, the transition also presents challenges. Therefore, institutions must invest in robust support. In conclusion, online learning plays a crucial role in the future of education.";
  await p.fill("#editor", multi); await p.click("#analyzeBtn");
  ok("detector: 3 paragraphs", (await p.$$(".para")).length === 3);
  const bands = await p.$$eval(".para .pill", els => els.map(e => e.textContent));
  ok("paragraph scoring: personal para is Low, formulaic para is Higher", bands[1].includes("Low") && bands[2].includes("Higher"));
  await p.click('[data-review="2"]');
  ok("review paragraph -> rewriter with ctx bar", (await activePage(p)) === "page-rewriter" && await p.isVisible("#ctxBar"));

  await p.fill("#toneRange", "90"); await p.fill("#lenRange", "10"); await p.selectOption("#persSel", "Student");
  await p.click("#rewriteBtn"); await p.waitForSelector("#compareWrap [data-act]");
  const rp = await lastPrompt("rewrite");
  ok("prompt reached Anthropic with tone/length/personality/student brief", rp.includes("clearly casual") && rp.includes("noticeably shorter") && rp.includes("thoughtful student") && rp.includes("genuinely understands"));
  const btns = await p.$$eval("#compareWrap [data-act]", els => els.map(e => e.textContent));
  ok("compare buttons", ["Copy Result", "Replace Original", "Try Again", "Clear", "Download"].every(x => btns.includes(x)));
  ok("before/after 'vs' label", await p.isVisible(".vs"));
  await p.click('#compareWrap button:has-text("Replace Original")');
  const full = await p.inputValue("#editor");
  ok("paragraph replaced inside full draft", full.includes("Natural: However, the transition") && full.startsWith("In today's rapidly"));
  ok("ctx bar hidden after replace", !(await p.isVisible("#ctxBar")));
  const styles = await p.$$eval(".style-opt strong", els => els.map(e => e.textContent).join(","));
  ok("6 styles", styles === "Natural Student,Casual Professional,Academic but Natural,Simple & Clear,Formal,Custom");
  await p.click('.style-opt:has-text("Custom")'); ok("custom instructions box", await p.isVisible("#customInstr"));
  await p.click('.style-opt:has-text("Formal")'); await p.click("#rewriteBtn"); await p.waitForSelector("#compareWrap [data-act]");
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click('#compareWrap button:has-text("Download")')]);
  ok("real browser download: natural-version.txt", dl.suggestedFilename() === "natural-version.txt");
  await p.click('#compareWrap button:has-text("Clear")'); ok("compare cleared", (await p.textContent("#compareWrap")).includes("No rewrite yet"));
  await p.close();
}

/* ================= 2. answer improver, student mode, references, coach, history, settings ================= */
{
  const p = await page();
  await on(p, "answer");
  await p.click("#ansAnalyze"); ok("answer: empty msg", (await p.textContent("#ansAnalysis")).includes("Please enter some text first."));
  await p.fill("#ansA", "Jawaban singkat saja."); await p.click("#ansAnalyze");
  ok("answer: needs question", (await p.textContent("#ansAnalysis")).includes("question"));
  await p.fill("#ansQ", "Jelaskan dampak pembelajaran daring."); await p.click("#ansAnalyze");
  ok("answer: short msg", (await p.textContent("#ansAnalysis")).includes("Add a little more text"));
  await p.click("#ansSample"); await p.click("#ansAnalyze");
  await p.waitForFunction(() => document.querySelector("#ansAnalysis").textContent.includes("combined with a review by Claude"));
  const aa = await p.textContent("#ansAnalysis");
  for (const t of ["Answer coverage", "Structure", "Clarity", "Relevance", "Readability", "not an academic grade", "Does the answer respond to the question?", "Are the references relevant?", "Not yet covered", "Give one concrete example"])
    ok("answer analysis has: " + t, aa.includes(t));
  ok("answer: 8 checks", (await p.$$("#ansAnalysis .checks li")).length === 8);
  await p.click("#ansImprove"); await p.waitForSelector("#ansImproveOut [data-act]");
  const imp = await p.textContent("#ansImproveOut");
  ok("improve: compare + notes", imp.includes("Improved version") && imp.includes("What changed") && imp.includes("Still missing") && imp.includes("A concrete example"));
  const ip = await lastPrompt("improve");
  ok("improve prompt preserves ideas / forbids inventing", ip.includes("Preserve their ideas") && ip.includes("Never invent facts"));
  await p.click('#ansImproveOut button:has-text("Replace Original")'); ok("answer replaced", (await p.inputValue("#ansA")).startsWith("IMPROVED:"));
  await p.click('#ansImproveOut button:has-text("Try Again")'); await p.waitForSelector("#ansImproveOut [data-act]");
  await p.click('#ansImproveOut button:has-text("Clear")'); ok("improve cleared", (await p.innerHTML("#ansImproveOut")).trim() === "");

  await on(p, "student");
  await p.click("#stuNext"); ok("student: empty question msg", (await p.textContent("#stuMsg")).includes("Please enter some text first."));
  await p.click("#stuSample"); await p.click("#stuNext"); ok("student: step 2", (await p.textContent("#stuBody")).includes("2 · My idea"));
  await p.click("#stuNext"); await p.click("#stuNext"); ok("student: step 4", (await p.textContent("#stuBody")).includes("4 · Analyze"));
  ok("student: next disabled before analysis", await p.isDisabled("#stuNext"));
  await p.click("#stuRun"); await p.waitForFunction(() => document.querySelector("#stuAnalysis").textContent.includes("review by Claude"));
  await p.click("#stuNext"); ok("student: final locked before 'Show what needs improvement'", await p.isDisabled("#stuNext"));
  await p.click("#stuShow"); await p.click("#stuNext"); await p.click("#stuMake"); await p.waitForSelector("#stuFinal [data-act]");
  ok("student: final version produced", (await p.textContent("#stuFinal")).includes("IMPROVED:"));
  await p.click("#stuBack"); await p.click("#stuNext"); ok("student: result persists when navigating", (await p.textContent("#stuFinal")).includes("IMPROVED:"));

  await on(p, "references");
  await p.click("#refFormat"); ok("refs: empty msg", (await p.textContent("#refOut")).includes("Please enter some text first."));
  await p.click('[data-refstyle="IEEE"]'); await p.click("#refSample"); await p.click("#refFormat"); await p.waitForSelector("#refCopy");
  const rf = await lastPrompt("refs");
  ok("refs: style + no-invention rules sent", rf.includes("Citation style: IEEE") && rf.includes("Never invent"));
  const rh = await p.innerHTML("#refOut");
  ok("refs: formatted, italics, missing flagged", rh.includes("Rahman, A., &amp; Sari, P. (2021)") && rh.includes("<em>Jurnal Teknologi Pendidikan</em>") && rh.includes("<mark>[publisher missing]</mark>"));
  await p.click("#refToCheck"); ok("refs: list copied into consistency check", (await p.inputValue("#refList")).includes("Widodo"));
  await p.fill("#refText", "Online learning changes motivation [1]. Peers matter [2], [4]. See also [1]-[2]."); await p.click("#refCheck");
  const rc = await p.textContent("#refCheckOut");
  ok("consistency (numeric): [4] missing, nothing uncited", rc.includes("[4]") && rc.includes("Cited but missing") && !rc.includes("never cited"));
  await p.fill("#refList", "Rahman, A., & Putri, S. (2021). Pembelajaran daring. Jurnal X.\n\nWidodo, B. (2019). Motivasi belajar. Bandung: Nusantara.\n\nLee, J. (2020). Engagement. Journal Y.\n\nGarcia, M. (2018). Unused source. Journal Z.");
  await p.fill("#refText", "Studi menunjukkan (Rahman & Putri, 2021) bahwa motivasi turun. Widodo (2020) setuju, dan (Lee et al., 2020; Smith, 2017) juga."); await p.click("#refCheck");
  const ay = await p.textContent("#refCheckOut");
  ok("consistency (author-year): missing / year mismatch / uncited / matched", ay.includes("Smith, 2017") && ay.includes("Year does not match") && ay.includes("Widodo, 2020") && ay.includes("never cited") && ay.includes("Garcia") && ay.includes("Matched (2)"));
  await p.fill("#refText", "Semua benar (Rahman & Putri, 2021), (Widodo, 2019), (Lee, 2020), (Garcia, 2018)."); await p.click("#refCheck");
  ok("consistency: all lines up", (await p.textContent("#refCheckOut")).includes("Everything lines up"));

  await on(p, "coach");
  await p.fill("#editor", ""); await p.click("#coachBtn"); ok("coach: empty msg", (await p.textContent("#coachResult")).includes("Please enter some text first."));
  await p.click("#sampleBtn"); await p.click("#coachBtn");
  await p.waitForFunction(() => document.querySelector("#coachResult").textContent.includes("Your main idea is clear."));
  const co = await p.textContent("#coachResult");
  ok("coach: local + AI feedback, no rewrite", co.includes("Worth improving") && co.includes("Who is this for?") && !(await p.inputValue("#editor")).startsWith("IMPROVED"));

  await on(p, "history");
  ok("history has entries", (await p.$$(".hist li")).length >= 3);
  await p.click("[data-rename]"); await p.fill("#mdInput", "Judul baru saya"); await p.click('.modal [data-r="1"]');
  ok("history: rename", (await p.textContent(".hist li .hist-title")) === "Judul baru saya");
  await p.click("[data-open]"); ok("history: open leaves the history page", (await activePage(p)) !== "page-history");
  await on(p, "history"); const before = (await p.$$(".hist li")).length;
  await p.click("[data-del]"); ok("history: delete", (await p.$$(".hist li")).length === before - 1);
  await on(p, "settings");
  const [ex] = await Promise.all([p.waitForEvent("download"), p.click("#exportBtn")]);
  ok("settings: export history downloads humantext-history.json", ex.suggestedFilename() === "humantext-history.json");
  await on(p, "history"); await p.click("#clearHist2"); await p.click('.modal [data-r="1"]'); ok("history: clear all", (await p.textContent("#historyBody")).includes("Nothing saved yet"));

  await on(p, "settings");
  await p.click('[data-theme-set="dark"]'); ok("theme dark", (await p.getAttribute("html", "data-theme")) === "dark");
  await p.click('[data-theme-set="light"]'); ok("theme light", (await p.getAttribute("html", "data-theme")) === "light");
  await p.click('[data-theme-set="system"]'); ok("theme system", (await p.getAttribute("html", "data-theme")) === null);
  await p.selectOption("#setDefStyle", "academic"); await p.selectOption("#setDefLang", "Indonesian");
  await p.reload(); await p.waitForFunction(() => capsResolved); await on(p, "settings");
  ok("settings persist across reload", (await p.inputValue("#setDefStyle")) === "academic" && (await p.inputValue("#setDefLang")) === "Indonesian");
  ok("drafts restored after reload", (await p.inputValue("#ansQ")).length > 0);
  await p.click("#clearDraftsBtn"); await p.click('.modal [data-r="1"]'); await p.waitForTimeout(100);
  ok("clear all saved drafts", (await p.inputValue("#ansQ")) === "" && (await p.inputValue("#editor")) === "");
  await p.reload(); ok("drafts stay cleared after reload", (await p.inputValue("#ansQ")) === "");
  await p.close();
}

/* ================= 3. Indonesian locale ================= */
{
  const p = await page({ locale: "id-ID" });
  await on(p, "answer"); await p.click("#ansSample"); await p.click("#ansAnalyze");
  await p.waitForFunction(() => document.querySelector("#ansAnalysis").textContent.includes("review by Claude"));
  let t = await p.textContent("#ansAnalysis");
  ok("ID: checklist in Indonesian", t.includes("Apakah jawaban menjawab pertanyaan?") && t.includes("Apakah referensi yang diberikan relevan?"));
  await p.click("#ansImprove"); await p.waitForSelector("#ansImproveOut [data-act]");
  t = await p.textContent("#ansImproveOut"); ok("ID: notes headings in Indonesian", t.includes("Yang diubah") && t.includes("Yang masih belum ada"));
  await on(p, "coach"); await p.click("#sampleBtn"); await p.click("#coachBtn");
  await p.waitForFunction(() => document.querySelector("#coachResult").textContent.includes("Ide utamamu"));
  t = await p.textContent("#coachResult"); ok("ID: coach in Indonesian", t.includes("Yang sudah baik") && t.includes("Layak diperbaiki") && /Paragraf \d/.test(t));
  await p.close();
}

/* ================= 4. AI not configured on the server ================= */
{
  delete process.env.ANTHROPIC_API_KEY;
  const p = await page();
  let t;
  await on(p, "answer");
  ok("no key: friendly note shown", (await p.textContent("#page-answer [data-ainote]")).includes("not set up on this site yet"));
  ok("no key: Improve disabled", await p.isDisabled("#ansImprove"));
  await p.click("#ansSample"); await p.click("#ansAnalyze"); await p.waitForSelector("#ansAnalysis .checks");
  t = await p.textContent("#ansAnalysis"); ok("no key: local answer analysis still works", t.includes("Answer coverage") && t.includes("local estimate") && (await p.$$("#ansAnalysis .checks li")).length === 8);
  await on(p, "rewriter"); ok("no key: rewriter unavailable notice + disabled", (await p.textContent("#rewriteStatus")).includes("unavailable right now") && await p.isDisabled("#rewriteBtn"));
  await on(p, "references"); ok("no key: Format disabled but consistency check enabled", (await p.isDisabled("#refFormat")) && !(await p.isDisabled("#refCheck")));
  await on(p, "coach"); await p.click("#sampleBtn"); await p.click("#coachBtn"); await p.waitForTimeout(150);
  ok("no key: coach shows local notes", (await p.textContent("#coachResult")).includes("What is working"));
  await on(p, "detector"); await p.click("#analyzeBtn"); ok("no key: detector works", (await p.textContent("#detectorResult")).includes("Writing analysis"));
  await p.close();
  resetEnv();
}

/* ================= 5. errors and cancellation ================= */
{
  let p = await page();
  await on(p, "answer"); await p.click("#ansSample");
  await setMode("429"); await p.click("#ansImprove"); await p.waitForSelector("#ansImproveOut .notice");
  let t = await p.textContent("#ansImproveOut");
  ok("429 -> friendly rate-limit message (no raw code)", t.includes("usage limit") && !t.includes("rate_limited"));
  ok("button restored after error", !(await p.isDisabled("#ansImprove")) && (await p.textContent("#ansImprove")).trim() === "Improve My Answer");
  await p.click("#ansAnalyze"); await p.waitForFunction(() => document.querySelector("#ansAnalysis").textContent.includes("local estimate only"));
  ok("analysis falls back to local estimate", (await p.textContent("#ansAnalysis")).includes("Answer coverage"));
  await setMode("toolong"); await p.click("#ansImprove"); await p.waitForFunction(() => document.querySelector("#ansImproveOut").textContent.includes("too long"));
  ok("prompt too large -> friendly message", true);
  await setMode("500"); await p.click("#ansImprove"); await p.waitForFunction(() => document.querySelector("#ansImproveOut").textContent.includes("connection dropped"));
  t = await p.textContent("#ansImproveOut"); ok("upstream 5xx -> friendly message, no technical detail", !/boom|500|api_error/.test(t));
  await setMode("refuse"); await p.click("#ansImprove"); await p.waitForFunction(() => document.querySelector("#ansImproveOut").textContent.includes("could not help"));
  ok("refusal surfaced kindly", true);
  await setMode("normal");
  await p.route("**/api/ai", r => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "some_internal_thing" } }) }));
  await p.click("#ansImprove"); await p.waitForFunction(() => document.querySelector("#ansImproveOut").textContent.includes("Something went wrong. Please try again."));
  ok("unknown server code -> generic message", true);
  await p.unroute("**/api/ai");
  await p.close();

  p = await page();
  await on(p, "coach"); await p.click("#sampleBtn");
  delete process.env.ANTHROPIC_API_KEY; // server loses its key after the page loaded
  await p.click("#coachBtn"); await p.waitForFunction(() => document.querySelector("#coachResult").textContent.includes("Showing the local notes only"));
  ok("not_configured mid-session -> all AI buttons blocked", await p.evaluate(() => document.querySelector("#ansImprove").disabled && document.querySelector("#refFormat").disabled));
  await p.close(); resetEnv();

  p = await page();
  await on(p, "answer"); await p.click("#ansSample"); await setMode("slow"); await p.click("#ansImprove");
  await p.waitForSelector('#ansImproveOut [data-role="stop"]');
  await p.waitForFunction(() => document.querySelector('#ansImproveOut [data-role="R"]').textContent.includes("PARTIAL"));
  await p.click('#ansImproveOut [data-role="stop"]'); await p.waitForSelector("#ansImproveOut [data-act]");
  ok("Stop cancels the request and keeps the partial text", (await p.textContent("#ansImproveOut")).includes("PARTIAL ANSWER"));
  await setMode("error_mid"); await on(p, "rewriter"); await on(p, "detector"); await p.click("#sampleBtn"); await on(p, "rewriter");
  await p.click("#rewriteBtn"); await p.waitForFunction(() => document.querySelector("#rewriteStatus").textContent.length > 0);
  ok("stream error mid-way -> partial output kept + notice", (await p.textContent("#compareWrap")).includes("Natural") && (await p.textContent("#compareWrap")).includes("connection dropped"));
  await setMode("normal"); await p.close();
}

/* ================= 6. access code flow ================= */
{
  process.env.AI_ACCESS_CODE = "letmein"; resetRateLimits();
  const p = await page();
  await on(p, "answer"); await p.click("#ansSample"); await p.click("#ansImprove");
  await p.waitForSelector(".modal");
  ok("access code modal appears", (await p.textContent(".modal")).includes("Access code required"));
  await p.fill("#mdInput", "wrong"); await p.click('.modal [data-r="1"]');
  await p.waitForFunction(() => document.querySelector("#ansImproveOut").textContent.includes("access code did not work"));
  ok("wrong code -> friendly message", true);
  await p.click("#ansImprove"); await p.waitForSelector(".modal"); await p.fill("#mdInput", "letmein"); await p.click('.modal [data-r="1"]');
  await p.waitForSelector("#ansImproveOut [data-act]"); ok("right code -> works", (await p.textContent("#ansImproveOut")).includes("IMPROVED:"));
  await p.click('#ansImproveOut button:has-text("Try Again")'); await p.waitForSelector("#ansImproveOut [data-act]");
  ok("code remembered for this tab (no second prompt)", !(await p.$(".modal")));
  await p.close(); resetEnv();
}

/* ================= 7. mobile + dark + network/CSP/secret audit ================= */
{
  const p = await page({ viewport: { width: 390, height: 844 }, isMobile: true, colorScheme: "dark" });
  for (const pg of ["home", "detector", "rewriter", "answer", "student", "references", "coach", "history", "settings", "about"]) {
    await p.evaluate(x => go(x), pg); await p.waitForTimeout(60);
    const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(`mobile: no horizontal overflow on ${pg} (${over}px)`, over <= 1);
  }
  await p.close();
  const hosts = new Set(allRequests.map(u => { try { return new URL(u).host; } catch { return u.slice(0, 20); } }));
  const foreign = [...hosts].filter(h => !h.startsWith("127.0.0.1") && h !== "fonts.googleapis.com" && h !== "fonts.gstatic.com");
  ok("network audit: browser only talks to this site + Google Fonts (" + [...hosts].join(", ") + ")", foreign.length === 0);
  ok("secret audit: API key never appears in anything the browser downloaded", !allResponses.some(b => b.includes(KEY)) && !allResponses.some(b => /sk-ant-/.test(b)));
  ok("CSP audit: no Content-Security-Policy violations in console", !errs.some(e => /Content Security Policy|Refused to/.test(e)));
}

console.log(R.join("\n"));
const fails = R.filter(x => x.startsWith("FAIL")).length;
console.log(`\nchecks: ${R.length}, failed: ${fails}`);
console.log("console/page errors:", JSON.stringify(errs));
await browser.close(); app.closeAllConnections?.(); app.close(); await mock.close();
process.exit(fails || errs.length ? 1 : 0);
