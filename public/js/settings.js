"use strict";
/* HumanText AI — Settings, home specimen. */
/* ============================================================
   SETTINGS
   ============================================================ */
function wireSettings() {
  $("#setDefStyle").innerHTML = STYLES.map(s => `<option value="${s.id}">${s.name}</option>`).join("");
  const map = { setSaveHistory: "saveHistory", setStoreText: "storeText", setStoreRewrite: "storeRewrite", setSaveDrafts: "saveDrafts" };
  Object.entries(map).forEach(([id, key]) => {
    const el = document.getElementById(id);
    el.checked = !!settings[key];
    el.onchange = () => {
      settings[key] = el.checked; saveSettings();
      if (key === "saveDrafts") { if (el.checked) saveDrafts(); else { try { localStorage.removeItem(DKEY); } catch (e) { } } }
    };
  });
  $("#setDefStyle").value = settings.defStyle;
  $("#setDefStyle").onchange = e => { settings.defStyle = e.target.value; curStyle = e.target.value; saveSettings(); renderStyles(); };
  $("#setDefLang").value = settings.defLang;
  $("#setDefLang").onchange = e => {
    settings.defLang = e.target.value; saveSettings();
    curLang = e.target.value === "same" ? "same" : e.target.value; $("#langSel").value = curLang;
  };
  $("#clearHistBtn").onclick = clearHistory;
  $("#clearDraftsBtn").onclick = clearDrafts;
  $("#exportBtn").onclick = async () => {
    if (!history.length) return toast("Nothing to export.");
    const data = JSON.stringify({ exported: new Date().toISOString(), entries: history }, null, 2);
    if (dlFn) {
      try { await dlFn.save({ filename: "humantext-history.json", data }); return toast("Exported."); }
      catch (e) { if ((e && e.code) === "declined") return toast("Export cancelled."); }
    }
    copy(data, "History JSON");
  };
}

/* ---------- home specimen ---------- */
function renderSpecimen(which) {
  const sp = SPECIMENS[which];
  const max = 24;
  $("#specBars").innerHTML = sp.s.map(([, n]) => `<div class="rbar"><em>${n}</em><i style="width:${Math.max(3, n / max * 100)}%"></i></div>`).join("");
  $("#specText").textContent = sp.s.map(x => x[0]).join(" ");
  $("#specCaption").textContent = sp.caption;
  $$("[data-spec]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.spec === which)));
}
$$("[data-spec]").forEach(b => b.onclick = () => renderSpecimen(b.dataset.spec));
