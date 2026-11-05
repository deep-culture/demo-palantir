/*
 * foundry-demo/app.js: Build (Foundry-style), shared strips, event delegation and init (loaded last; calls init()).
 *
 * One of the classic scripts that make up the Build app (split from the former 3,100-line app.js, review F-24).
 * They are loaded in order by foundry-demo/index.html and share one global script scope: top-level
 * functions, const and let declared in one file are visible in the others. Only app.js runs code at load
 * (init()); the other files only declare, apart from the UI state set up in js/app-state.js.
 */
"use strict";
// ------------------------------------------------------------------ shared strips
let auditStripTimer = null;
function refreshAuditStrip() {
  // Assumes DC.ui.renderAuditStrip is idempotent (re-rendering into the same element refreshes it).
  if (!core("ui", "renderAuditStrip") || !governance()) return;
  clearTimeout(auditStripTimer);
  auditStripTimer = setTimeout(() => {
    const host = el("build-audit-strip");
    if (host) safe("ui.renderAuditStrip", () => window.DC.ui.renderAuditStrip(host, { surface: SURFACE }), null);
  }, 30);
}

function renderStrips() {
  const sessionHost = el("build-session-strip");
  const auditHost = el("build-audit-strip");
  const ready = Boolean(governance());
  if (sessionHost) {
    sessionHost.hidden = !(ready && core("ui", "renderSessionStrip"));
    if (!sessionHost.hidden) safe("ui.renderSessionStrip", () => window.DC.ui.renderSessionStrip(sessionHost, { surface: SURFACE }), null);
  }
  if (auditHost) {
    auditHost.hidden = !(ready && core("ui", "renderAuditStrip"));
    if (!auditHost.hidden) safe("ui.renderAuditStrip", () => window.DC.ui.renderAuditStrip(auditHost, { surface: SURFACE }), null);
  }
}

// ------------------------------------------------------------------ event delegation
function attachHandlers() {
  const root = document.getElementById("app");
  if (!root) return;

  // Delegation attached once: render() replaces the inner hosts only.
  if (!root.dataset.delegated) {
    root.dataset.delegated = "1";
    root.addEventListener("click", function (e) {
      const target = e.target.closest("[data-action]");
      if (!target || !root.contains(target)) return;
      if (target.closest("#build-session-strip, #build-audit-strip")) return;
      dispatch(target.dataset.action, target.dataset, e);
    });
    root.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      const target = e.target.closest("[data-action][role='button']");
      if (!target || target.tagName === "BUTTON") return;
      e.preventDefault();
      dispatch(target.dataset.action, target.dataset, e);
    });
  }

  // Resolution threshold slider: "input" previews (results only, the slider survives the drag),
  // "change" commits through DC.resolution.setThreshold (which logs).
  const slider = document.getElementById("res-threshold");
  if (slider) {
    slider.addEventListener("input", function () { if (!thresholdPermission().allowed) return; previewThreshold(parseFloat(this.value)); });
    slider.addEventListener("change", function () { commitThreshold(parseFloat(this.value)); });
  }

  // Retention clock (F12): "input" previews, "change" commits and logs once per release.
  const retSlider = document.getElementById("ret-slider");
  if (retSlider) {
    retSlider.addEventListener("input", function () { previewRetention(parseInt(this.value, 10)); });
    retSlider.addEventListener("change", function () { commitRetention(parseInt(this.value, 10), "slider"); });
  }

  // Lineage search input
  const searchInput = document.getElementById("lineage-search");
  if (searchInput) {
    searchInput.addEventListener("input", function () {
      ui.lineageEntitySearch = this.value;
      ui.selectedEntityId = "";
      saveUiState();
      render();
    });
  }
}

function viewDataset(id, tab) {
  logEvent({ kind: "view", verb: "dataset.view", datasetId: id, payload: { tab } });
}

function dispatch(action, data) {
  if (action === "switch-dataset") {
    const key = data.key;
    if (key && catalog[key]) {
      ui.datasetKey = key;
      Object.assign(ui, {
        selectedTransformId: "",
        selectedDatasetId: "",
        selectedEntityId: "",
        lineageEntitySearch: "",
        datasetRowOffset: 0,
        highlightDatasetRow: null,
        retentionOffset: 0,
        retPreview: null,
        selectedLeadId: "",
      });
      Object.assign(ui, loadUiState(key));
      ui.datasetKey = key;
      seedData = catalog[key] || {};
      initPhase2Core();
      saveUiState();
      render();
      logEvent({ kind: "view", verb: "tab.view", payload: { tab: ui.activeTab, dataset: key } });
    }
  } else if (action === "switch-tab") {
    const changed = ui.activeTab !== data.tab;
    ui.activeTab = data.tab;
    saveUiState();
    render();
    if (changed) logEvent({ kind: "view", verb: "tab.view", payload: { tab: data.tab, dataset: ui.datasetKey } });
  } else if (action === "select-transform") {
    ui.selectedTransformId = data.id;
    saveUiState();
    render();
  } else if (action === "select-dataset" || action === "goto-dataset") {
    const fromTab = ui.activeTab;
    ui.activeTab = "datasets";
    ui.selectedDatasetId = data.id;
    ui.datasetRowOffset = 0;
    ui.highlightDatasetRow = null;
    saveUiState();
    render();
    viewDataset(data.id, "datasets");
    if (fromTab !== "datasets") logEvent({ kind: "view", verb: "tab.view", payload: { tab: "datasets", dataset: ui.datasetKey } });
  } else if (action === "mk-select") {
    ui.selectedDatasetId = data.id;
    saveUiState();
    render();
    viewDataset(data.id, "markings");
  } else if (action === "mk-filter") {
    ui.markingFilter = data.marking || "";
    saveUiState();
    render();
  } else if (action === "mk-remove") {
    attemptMarkingRemoval(data.id, data.marking);
  } else if (action === "mk-restore") {
    attemptMarkingRestore(data.id, data.marking);
  } else if (action === "open-investigate") {
    window.open(`../demo/index.html#object=${encodeURIComponent(data.id)}&dataset=${encodeURIComponent(ui.datasetKey)}`, "_blank", "noopener");
  } else if (action === "select-entity") {
    ui.selectedEntityId = data.id;
    saveUiState();
    render();
    logEvent({ kind: "view", verb: "lineage.view", objectIds: [data.id], payload: { tab: "lineage" } });
  } else if (action === "goto-transform") {
    ui.activeTab = "pipelines";
    ui.selectedTransformId = data.id;
    saveUiState();
    render();
  } else if (action === "goto-dataset-row") {
    ui.activeTab = "datasets";
    ui.selectedDatasetId = data.id;
    const rowIdx = parseInt(data.row, 10);
    ui.highlightDatasetRow = { datasetId: data.id, rowIndex: rowIdx };
    // Calculate page offset so the row is visible
    ui.datasetRowOffset = Math.floor(rowIdx / PAGE_SIZE) * PAGE_SIZE;
    saveUiState();
    render();
    logEvent({ kind: "view", verb: "dataset.view", datasetId: data.id, payload: { tab: "datasets", row: rowIdx, from: "lineage" } });
  } else if (action === "res-select") {
    if (ui.activeTab !== "resolution") ui.activeTab = "resolution";
    ui.selectedPersonId = data.id;
    saveUiState();
    render();
    logEvent({ kind: "view", verb: "resolution.explain.view", objectIds: [data.id], payload: { tab: "resolution", threshold: currentThreshold() } });
  } else if (action === "res-threshold") {
    const v = parseFloat(data.value);
    if (Number.isFinite(v)) commitThreshold(v);
  } else if (action === "res-unmerge") {
    runUnmerge(data.id, data.object);
  } else if (action === "res-unmerge-link") {
    logEvent({ kind: "view", verb: "resolution.unmerge.open", objectIds: [data.id], payload: { tab: "resolution", target: "investigate" } });
  } else if (action === "select-lead") {
    ui.selectedLeadId = data.id;
    saveUiState();
    render();
    const lead = leadById(data.id);
    logEvent({ kind: "view", verb: "lead.view", objectIds: [data.id].concat(lead && lead.personId ? [lead.personId] : []), datasetId: ui.selectedDatasetId || undefined, payload: { tab: ui.activeTab } });
  } else if (action === "lead-lineage" || action === "goto-entity") {
    ui.activeTab = "lineage";
    ui.selectedEntityId = data.id;
    saveUiState();
    render();
    logEvent({ kind: "view", verb: "lineage.view", objectIds: [data.id], payload: { tab: "lineage", from: "datasets" } });
  } else if (action === "ret-preset") {
    const v = parseInt(data.value, 10);
    if (Number.isFinite(v)) commitRetention(v, "preset");
  } else if (action === "page-prev") {
    ui.datasetRowOffset = Math.max(0, ui.datasetRowOffset - PAGE_SIZE);
    saveUiState();
    render();
  } else if (action === "page-next") {
    const ds = getDataset(ui.selectedDatasetId);
    const maxOffset = ds ? Math.max(0, (leadRows(ds) || ds.sampleRows || []).length - PAGE_SIZE) : 0;
    ui.datasetRowOffset = Math.min(maxOffset, ui.datasetRowOffset + PAGE_SIZE);
    saveUiState();
    render();
  }
}

// ------------------------------------------------------------------ init
function firstGovernance() {
  if (seedData.governance) return seedData.governance;
  const key = datasetKeys.find(k => catalog[k] && catalog[k].governance);
  return key ? catalog[key].governance : null;
}

/** Phase 2 core modules (PHASE2_CONTRACT §6); each is optional. Called again on dataset switch. */
function initPhase2Core() {
  const gov = seedGovernanceBlock();
  // F-18: the active dataset's governance block, not the first one found at start-up.
  if (seedData.governance && core("governance", "init") && core("governance", "get") && window.DC.governance.get() !== seedData.governance) {
    safe("governance.init", () => window.DC.governance.init(seedData.governance), null);
  }
  if (core("purposes", "init")) safe("purposes.init", () => window.DC.purposes.init(Array.isArray(gov.purposeRules) ? gov.purposeRules : []), null);
  const block = resolutionBlock();
  // Pass the watchlisted (risk-tagged) Persons, as Investigate does, so both apps name the
  // same representative for a merged cluster: the watchlisted member's label (FIXROUND §2 D).
  const watchlisted = getEntities().filter(e => e.type === "Person" && e.properties && e.properties.riskTag).map(e => e.id);
  if (block && core("resolution", "init")) safe("resolution.init", () => window.DC.resolution.init(block, { watchlisted }), null);
  // F-09: also set it explicitly, in case a core init ignores the option.
  if (block && core("resolution", "setWatchlisted")) safe("resolution.setWatchlisted", () => window.DC.resolution.setWatchlisted(watchlisted), null);
  const onto = seedData.ontology || {};
  const types = onto.actionTypes || seedData.actionTypes;
  if (Array.isArray(types) && core("actions", "init")) {
    safe("actions.init", () => window.DC.actions.init(types, onto.externalSystems || seedData.externalSystems || []), null);
  }
  resolveCache.clear();
  localThreshold = null;
}

function init() {
  const root = document.getElementById("app");
  if (!root) { console.error("No #app element"); return; }
  if (!window.foundrySeed && !window.foundrySeedCatalog) {
    root.innerHTML = `<div class="empty-state" style="height:100vh;">
      <div class="empty-icon">⚠</div>
      <div>seed.js not loaded. Run:<br><code style="font-family:var(--mono)">python3 scripts/build_foundry_seed.py --output foundry-demo/seed.js</code></div>
    </div>`;
    return;
  }

  const seedGovernance = firstGovernance();
  if (seedGovernance && core("governance", "init")) {
    safe("governance.init", () => window.DC.governance.init(seedGovernance), null);
  }

  root.innerHTML = `
    <div id="build-header"></div>
    <div id="build-session-strip" class="build-strip build-strip-session dc-on-dark" hidden></div>
    <div id="build-body" class="build-body"></div>
    <div id="build-audit-strip" class="build-strip build-strip-audit dc-on-dark" aria-live="polite" hidden></div>`;

  initPhase2Core();
  render();
  renderStrips();

  // Karlsruhe mode and the threshold may change from the session strip or another tab.
  ["purposes", "resolution", "actions"].forEach(name => {
    if (core(name, "onChange")) safe(`${name}.onChange`, () => window.DC[name].onChange(() => { resolveCache.clear(); render(); }), null);
  });
  const sessionHost = el("build-session-strip");
  if (sessionHost) sessionHost.addEventListener("change", () => setTimeout(render, 0));

  if (core("session", "onChange")) {
    safe("session.onChange", () => window.DC.session.onChange(() => { render(); refreshAuditStrip(); }), null);
  }
  // Another tab (Investigate, Oversight) may change governance overrides.
  window.addEventListener("storage", (e) => {
    if (e.key && store && e.key === store.key("governance")) { resolveCache.clear(); render(); }
  });
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (ui.activeTab === "markings") drawMarkingEdges(); updateScrollCues(); }, 80);
  });

  logEvent({ kind: "view", verb: "tab.view", payload: { tab: ui.activeTab, dataset: ui.datasetKey, initial: true } });
}

init();
