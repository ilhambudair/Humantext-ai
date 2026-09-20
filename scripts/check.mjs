// Sanity checks you can run any time (and in CI): `npm run check`
//  1. every JS file parses
//  2. no secret-looking strings or server env names ended up in public/
//  3. every <script src> / <link href> in index.html points at a file that exists
//  4. the frontend never calls window.claude outside the optional, unloaded artifact adapter
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT } from "./dev-server.mjs";

let failed = 0;
const ok = (m) => console.log("  ok   " + m);
const bad = (m) => { failed++; console.error("  FAIL " + m); };
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? (e.name === "node_modules" ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]);

const jsFiles = ["api", "public/js", "scripts", "tests"].flatMap(d => fs.existsSync(path.join(ROOT, d)) ? walk(path.join(ROOT, d)) : []).filter(f => /\.(m?js)$/.test(f));
for (const f of jsFiles) { try { execFileSync(process.execPath, ["--check", f], { stdio: "pipe" }); } catch (e) { bad("syntax: " + path.relative(ROOT, f)); } }
if (!failed) ok(`${jsFiles.length} JS files parse`);

const pub = walk(path.join(ROOT, "public"));
const SECRET = /(sk-ant-[A-Za-z0-9_-]{8,}|ANTHROPIC_API_KEY|x-api-key)/i;
for (const f of pub) if (/\.(html|js|css|json|txt|svg)$/.test(f) && SECRET.test(fs.readFileSync(f, "utf8"))) bad("possible secret / server env name in public/: " + path.relative(ROOT, f));
ok("no secrets or server env names in public/");

const html = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8").replace(/<!--[\s\S]*?-->/g, "");
for (const m of html.matchAll(/(?:src|href)="((?!https?:|data:|#)[^"]+)"/g)) if (!fs.existsSync(path.join(ROOT, "public", m[1]))) bad("index.html references a missing file: " + m[1]);
ok("index.html references existing files");

const loaded = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
for (const s of loaded) if (/window\.claude/.test(fs.readFileSync(path.join(ROOT, "public", s), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""))) bad(`window.claude is used by a loaded script: ${s}`);
ok("loaded scripts do not depend on window.claude");

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log("\nall checks passed");
