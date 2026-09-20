"use strict";
/* HumanText AI — startup. Loaded last. */
/* ---------- init ---------- */
load();
applyTheme();
curStyle = settings.defStyle; curLang = settings.defLang;
restoreDrafts();
renderStyles();
$("#langSel").value = curLang;
syncRefStyle();
wireSettings();
renderSpecimen("even");
updateCounts();
ansCounts();
renderDetector();
renderCompare();
renderCoach();
go("home");
booted = true;
initRuntime(); // resolves the AI backend (js/runtime.js) after everything else is ready
