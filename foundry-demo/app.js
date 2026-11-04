(function () {
  "use strict";

  // Build (Foundry-style). UI state lives under dc-palantir:foundry:{dataset} (core/store.js,
  // REDESIGN_SPEC §6.1–6.2). Foundry treats the pipeline as authoritative, so when the seed is
  // regenerated (or the old "foundry-studio-demo-v1" key is migrated) the saved UI state is reset
  // silently: no banner.
  //
  // Governance (PHASE1_CONTRACT §6) comes from the shared core: DC.governance, DC.session,
  // DC.audit, DC.markings, DC.checkpoints and DC.ui. Every call goes through core()/safe() so the
  // app still works, with the governance features hidden, when a core file or the seed's
  // governance block is missing.
  const LEGACY_STORAGE_PREFIX = "foundry-studio-demo-v1";
  const SURFACE = "build";
  const store = window.DC && window.DC.store;
  if (!store) console.warn("core/store.js should be loaded before foundry-demo/app.js; UI state will not persist.");
  const PAGE_SIZE = 10;

  // ------------------------------------------------------------------ helpers
  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /** The core module `name` if it exposes function `fn`, else null. */
  function core(name, fn) {
    const mod = window.DC && window.DC[name];
    return mod && typeof mod[fn] === "function" ? mod : null;
  }
  /** Run fn; on any exception warn once per label and return the fallback. */
  const warned = new Set();
  function safe(label, fn, fallback) {
    try { return fn(); } catch (error) {
      if (!warned.has(label)) { warned.add(label); console.warn(`[build] ${label} failed; feature hidden`, error); }
      return fallback;
    }
  }

  function storageKey(datasetKey) {
    return store ? store.key("foundry", datasetKey) : `dc-palantir:foundry:${datasetKey}`;
  }

  const PERSISTED_FIELDS = ["activeTab", "selectedTransformId", "selectedDatasetId", "selectedEntityId", "lineageEntitySearch", "datasetRowOffset", "markingFilter", "selectedPersonId"];

  function loadUiState(datasetKey) {
    if (!store) return {};
    const key = storageKey(datasetKey);
    const result = store.loadVersioned(key, catalog[datasetKey] || {}, {
      legacyKey: `${LEGACY_STORAGE_PREFIX}:${datasetKey}`,
    });
    // Silent reset: drop any stale copy instead of offering to restore it.
    if (result.hasStale) store.dismissStale(key);
    const saved = result.data && typeof result.data === "object" ? result.data : {};
    const out = {};
    PERSISTED_FIELDS.forEach((field) => { if (field in saved) out[field] = saved[field]; });
    return out;
  }

  function saveUiState() {
    try {
      const toSave = {};
      PERSISTED_FIELDS.forEach((field) => { toSave[field] = ui[field]; });
      if (store) store.saveVersioned(storageKey(ui.datasetKey), catalog[ui.datasetKey] || {}, toSave);
    } catch (_) {}
  }

  // ------------------------------------------------------------------ state
  const catalog = window.foundrySeedCatalog || { starter: window.foundrySeed || {} };
  const datasetKeys = Object.keys(catalog);

  let ui = {
    datasetKey: "starter",
    activeTab: "pipelines",
    selectedTransformId: "",
    selectedDatasetId: "",
    selectedEntityId: "",
    lineageEntitySearch: "",
    datasetRowOffset: 0,
    markingFilter: "",
    selectedPersonId: "",        // Resolution tab: person whose merge explanation is shown
    resPreview: null,            // Resolution tab: threshold shown while the slider is dragged
    highlightDatasetRow: null,   // { datasetId, rowIndex }
  };

  // Restore persisted ui for default dataset
  ui.datasetKey = datasetKeys.includes("starter") ? "starter" : datasetKeys[0];
  Object.assign(ui, loadUiState(ui.datasetKey));

  let seedData = catalog[ui.datasetKey] || {};

  // ------------------------------------------------------------------ derived helpers
  function getTransforms() {
    return (seedData.pipeline || {}).transforms || [];
  }

  function getDatasets() {
    return seedData.datasets || [];
  }

  function getDataset(id) {
    return getDatasets().find(d => d.id === id);
  }

  function getEntities() {
    return seedData.entities || [];
  }

  function getEdges() {
    return seedData.edges || [];
  }

  function getLineage() {
    return seedData.lineage || {};
  }

  function getTransform(id) {
    return getTransforms().find(t => t.id === id);
  }

  /** Dataset by id first, then by name (lineage refers to datasets by id). */
  function findDataset(ref) {
    return getDataset(ref) || getDatasets().find(d => d.name === ref) || null;
  }

  /**
   * Display name. Raw source datasets in the current seed carry the name of their normalised
   * counterpart (watchlist.csv is named "norm_watchlist"), so raw datasets show their id instead.
   */
  function dsName(ds, fallback) {
    if (!ds || (!ds.id && !ds.name)) return fallback || "";
    if (!ds.producedBy && ds.name && ds.name !== ds.id && /^norm_/.test(ds.name)) return ds.id;
    return ds.name || ds.id;
  }

  function datasetsById() {
    const out = {};
    getDatasets().forEach(d => { out[d.id] = d; });
    return out;
  }

  /** Datasets written by transform t: the declared output if it is a dataset, else every dataset whose producedBy is t. */
  function transformOutputs(t) {
    const own = getDatasets().filter(d => d.producedBy === t.id);
    if (own.length) return own;
    const declared = getDataset(t.output);
    return declared ? [declared] : [];
  }

  function stemOf(id) {
    return String(id || "").replace(/\.(csv|jsonl|json)$/i, "").replace(/^(raw|norm|resolved)_/, "");
  }

  /**
   * Upstream datasets of ds. Prefers an explicit ds.inputs; otherwise the producing transform's
   * inputs. A transform with several outputs (normalize_sources writes one dataset per source)
   * is split by name: norm_watchlist ← watchlist.csv, norm_mobile_pings ← mobile_location_pings.jsonl.
   */
  const parentsCache = new Map();
  function datasetParents(ds) {
    if (!ds) return [];
    const cacheKey = ui.datasetKey + "|" + ds.id;
    if (parentsCache.has(cacheKey)) return parentsCache.get(cacheKey);
    let parents = [];
    if (Array.isArray(ds.inputs)) {
      parents = ds.inputs.filter(id => getDataset(id));
    } else if (ds.producedBy) {
      const t = getTransform(ds.producedBy);
      const inputs = t ? (t.inputs || []).filter(id => getDataset(id)) : [];
      parents = inputs;
      if (t && inputs.length > 1 && transformOutputs(t).length > 1) {
        const stem = stemOf(ds.id);
        let match = inputs.filter(id => stemOf(id) === stem);
        if (match.length !== 1) match = inputs.filter(id => stemOf(id).split("_")[0] === stem.split("_")[0]);
        if (match.length === 1) parents = match;
      }
    }
    parentsCache.set(cacheKey, parents);
    return parents;
  }

  function datasetAncestors(ds) {
    const seen = new Set();
    const stack = datasetParents(ds).slice();
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      datasetParents(getDataset(id)).forEach(p => stack.push(p));
    }
    return seen;
  }

  function datasetDepth(ds, guard) {
    guard = guard || new Set();
    if (!ds || guard.has(ds.id)) return 0;
    guard.add(ds.id);
    const parents = datasetParents(ds);
    if (!parents.length) return 0;
    return 1 + Math.max(...parents.map(id => datasetDepth(getDataset(id), guard)));
  }

  // ------------------------------------------------------------------ governance (contract §6)
  function governance() {
    const fromCore = core("governance", "get") ? safe("governance.get", () => window.DC.governance.get(), null) : null;
    return fromCore || seedData.governance || null;
  }

  function hasGovernanceCore() {
    return Boolean(core("session", "get") && core("markings", "canSee") && governance());
  }

  function currentRoleId() {
    if (!core("session", "get") || !governance()) return null;
    const session = safe("session.get", () => window.DC.session.get(), null);
    return session && session.role ? session.role : null;
  }

  function roleObject(id) {
    if (!id) return null;
    if (core("governance", "role")) {
      const r = safe("governance.role", () => window.DC.governance.role(id), null);
      if (r) return r;
    }
    const g = governance();
    return g && Array.isArray(g.roles) ? g.roles.find(r => r.id === id) || null : null;
  }

  function roleLabel(id) {
    const r = roleObject(id);
    return r ? r.label || r.id : id;
  }

  function allRoles() {
    const g = governance();
    return g && Array.isArray(g.roles) ? g.roles : [];
  }

  function canSee(roleId, markings) {
    if (!roleId || !core("markings", "canSee")) return true;
    return safe("markings.canSee", () => window.DC.markings.canSee(roleId, markings || []), true);
  }

  function rolesThatCanSee(markings) {
    if (!core("markings", "canSee")) return [];
    return allRoles().filter(r => canSee(r.id, markings));
  }

  const DEFAULT_MARKING_LABELS = {
    OPEN: "Open", PII: "Personal data", FIN: "Financial", TELECOM: "Telecom",
    HEALTH: "Health", "LE-SENSITIVE": "Law-enforcement sensitive",
  };

  function markingDefs() {
    const g = governance();
    return g && Array.isArray(g.markings) ? g.markings : [];
  }

  function markingDef(id) {
    const def = markingDefs().find(m => m.id === id);
    const fallbackColour = "--mk-" + String(id).toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return {
      id,
      label: (def && def.label) || DEFAULT_MARKING_LABELS[id] || id,
      description: (def && def.description) || "",
      colour: def && /^--[a-z0-9-]+$/i.test(def.colour || "") ? def.colour : fallbackColour,
    };
  }

  function markingColour(id) {
    return `var(${markingDef(id).colour}, var(--mk-unknown))`;
  }

  /** Every marking id that appears anywhere in the current seed (legend order follows governance). */
  function knownMarkingIds() {
    const ids = new Set(markingDefs().map(m => m.id));
    getDatasets().forEach(d => (d.markings || []).forEach(m => ids.add(m)));
    return Array.from(ids);
  }

  function hasMarkings() {
    return getDatasets().some(d => Array.isArray(d.markings) && d.markings.length > 0);
  }

  function readGovernanceState() {
    if (!store) return {};
    const value = safe("store.get governance", () => store.get(store.key("governance"), {}), {});
    return value && typeof value === "object" ? value : {};
  }

  function markingOverrides() {
    const list = readGovernanceState().markingOverrides;
    return Array.isArray(list) ? list : [];
  }

  /**
   * Effective markings of a dataset as [{id, inheritedFrom, sources}], from
   * DC.markings.effectiveDatasetMarkings (which applies the overrides) when available, else the
   * seed's markings. inheritedFrom is null for a marking the dataset carries itself (a raw
   * source), else the raw dataset id(s) from markingProvenance.
   */
  function effectiveMarkings(ds) {
    if (!ds) return [];
    let list = Array.isArray(ds.markings) ? ds.markings : [];
    if (core("markings", "effectiveDatasetMarkings")) {
      const result = safe("markings.effectiveDatasetMarkings", () => window.DC.markings.effectiveDatasetMarkings(ds, datasetsById()), null);
      if (Array.isArray(result)) list = result;
    }
    return list
      .map(m => (typeof m === "string" ? { id: m } : m))
      .filter(m => m && m.id)
      .map(m => {
        const { own, sources } = provenanceOf(ds, m.id);
        const inheritedFrom = m.inheritedFrom !== undefined ? m.inheritedFrom : (own ? null : (sources[0] || "upstream"));
        return { id: m.id, inheritedFrom: inheritedFrom || null, sources };
      });
  }

  /**
   * Where a marking on ds comes from: own = carried by ds itself (a raw source, or ds listed in its
   * own markingProvenance); sources = the raw dataset ids it was inherited from.
   */
  function provenanceOf(ds, markingId) {
    const prov = (ds.markingProvenance || {})[markingId];
    const list = Array.isArray(prov) ? prov : [];
    const derived = Boolean(ds.producedBy) || Array.isArray(ds.inputs);
    return { own: !derived || list.includes(ds.id), sources: list.filter(id => id !== ds.id) };
  }

  /** Markings the seed declares on ds that are no longer effective, with the override that removed them. */
  function removedMarkings(ds) {
    if (!ds || !Array.isArray(ds.markings)) return [];
    const effective = new Set(effectiveMarkings(ds).map(m => m.id));
    const ancestors = datasetAncestors(ds);
    const overrides = markingOverrides();
    return ds.markings.filter(m => !effective.has(m)).map(m => {
      const own = overrides.find(o => o.datasetId === ds.id && o.removed === m);
      const upstream = own ? null : overrides.find(o => o.removed === m && ancestors.has(o.datasetId));
      return { id: m, override: own || upstream || null, upstream: Boolean(upstream) };
    });
  }

  function effectiveIds(ds) { return effectiveMarkings(ds).map(m => m.id); }

  function isWithheld(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Array.isArray(value.withheld);
  }

  function redact(entity) {
    const roleId = currentRoleId();
    if (!entity || !roleId || !core("markings", "redactEntity")) return entity;
    return safe("markings.redactEntity", () => window.DC.markings.redactEntity(entity, roleId), entity) || entity;
  }

  function objectWithheld(redacted) {
    return redacted && Array.isArray(redacted._withheld) && redacted._withheld.length ? redacted._withheld : null;
  }

  function honestyChip(id) {
    if (!core("ui", "honestyChip")) return "";
    const html = safe("ui.honestyChip", () => window.DC.ui.honestyChip(id), "");
    return typeof html === "string" ? html : "";
  }

  function logEvent(event) {
    if (!core("audit", "logEvent") || !governance()) return;
    const payload = Object.assign({ surface: SURFACE }, event);
    safe("audit.logEvent", () => {
      const p = window.DC.audit.logEvent(payload);
      if (p && typeof p.then === "function") p.then(refreshAuditStrip, (error) => console.warn("[build] audit.logEvent rejected", error));
      else refreshAuditStrip();
    }, null);
  }

  // ------------------------------------------------------------------ marking rendering
  function markingBadge(m, opts) {
    opts = opts || {};
    const def = markingDef(m.id || m);
    const id = def.id;
    const inherited = Boolean(m.inheritedFrom);
    const title = inherited
      ? `${def.label}: inherited from ${(m.sources && m.sources.length ? m.sources : [m.inheritedFrom]).join(", ")}`
      : `${def.label}${def.description ? " — " + def.description : ""}`;
    const cls = ["mk-badge", inherited ? "inherited" : "", opts.removed ? "removed" : "", opts.small ? "small" : ""].filter(Boolean).join(" ");
    return `<span class="${cls}" style="--mk-c:${markingColour(id)}" title="${esc(title)}">${esc(id)}${opts.removed ? " (removed)" : ""}</span>`;
  }

  function markingBadges(list, opts) {
    if (!list || !list.length) return `<span class="text-muted">none</span>`;
    return list.map(m => markingBadge(typeof m === "string" ? { id: m } : m, opts)).join(" ");
  }

  function withheldCell(markings) {
    const ids = (markings || []).join(", ");
    const who = rolesThatCanSee(markings).map(r => r.label).join(", ");
    return `<span class="withheld" title="${esc(who ? "Visible to: " + who : "Not visible to any role")}">withheld — marking ${esc(ids)}</span>`;
  }

  function whyLine(markings) {
    const roleId = currentRoleId();
    const who = rolesThatCanSee(markings).map(r => r.label);
    return `<div class="why-line"><strong>Why can't I see this?</strong> It carries ${markings.map(m => `<code>${esc(m)}</code>`).join(", ")}, which your role (${esc(roleLabel(roleId))}) cannot see.
      ${who.length ? `Roles that can: ${esc(who.join(", "))}.` : "No role can see it."}</div>`;
  }

  function displayValue(v) {
    if (isWithheld(v)) return withheldCell(v.withheld);
    return esc(typeof v === "object" && v !== null ? JSON.stringify(v) : v);
  }

  // ------------------------------------------------------------------ render root
  // Tell the shared core about this pipeline, so a marking removed upstream (e.g. on the raw
  // clinic dataset) is propagated to ontology_entities/ontology_edges and honoured by Investigate.
  let registeredDatasetKey = null;
  function registerPipelineWithCore() {
    if (registeredDatasetKey === ui.datasetKey || !core("markings", "registerDatasets")) return;
    registeredDatasetKey = ui.datasetKey;
    safe("markings.registerDatasets", () => window.DC.markings.registerDatasets(datasetsById(), { transforms: getTransforms() }), null);
  }

  function render() {
    overridesMemo = null;
    registerPipelineWithCore();
    const root = document.getElementById("app");
    if (!root) return;

    const active = document.activeElement;
    const activeId = active && active.id ? active.id : null;
    const selStart = active && typeof active.selectionStart === "number" ? active.selectionStart : null;
    const selEnd = active && typeof active.selectionEnd === "number" ? active.selectionEnd : null;

    if (!availableTabs()[ui.activeTab]) ui.activeTab = "pipelines";
    el("build-header").innerHTML = renderHeader();
    el("build-body").innerHTML = renderBody();
    attachHandlers();
    if (ui.activeTab === "markings") drawMarkingEdges();

    if (activeId) {
      const restored = document.getElementById(activeId);
      if (restored) {
        restored.focus();
        if (selStart !== null && typeof restored.setSelectionRange === "function") {
          try { restored.setSelectionRange(selStart, selEnd); } catch (_) {}
        }
      }
    }
  }

  function renderBody() {
    return `
      ${renderTabBar()}
      <div class="body-wrap">
        ${renderSidebar()}
        <div class="main-pane">
          <div class="main-content" id="main-content">
            ${renderMainContent()}
          </div>
          ${renderInspector()}
        </div>
      </div>
    `;
  }

  // ------------------------------------------------------------------ header
  function renderHeader() {
    const entities = getEntities();
    const edges = getEdges();

    return `
    <header class="app-header">
      <a href="../index.html" title="All sessions and docs"><img class="dc-logo" src="../brand/logo-green-lines.png" alt="Deep Culture"></a>
      <div class="app-title"><span class="dc-highlight">Build (Foundry-style)</span></div>
      <a class="header-back-link" href="../index.html" title="Back to all sessions and docs">← All sessions</a>
      <div class="dataset-switcher" role="group" aria-label="Dataset">
        ${datasetKeys.map(k => `
          <button data-action="switch-dataset" data-key="${esc(k)}"
                  class="${k === ui.datasetKey ? "active" : ""}" aria-pressed="${k === ui.datasetKey}">
            ${esc(k.toUpperCase())}
          </button>
        `).join("")}
      </div>
      <div class="header-stats">
        <span><span class="stat-val">${entities.length}</span> objects</span>
        <span><span class="stat-val">${edges.length}</span> links</span>
        <span><span class="stat-val">${getDatasets().length}</span> datasets</span>
      </div>
    </header>`;
  }

  // ------------------------------------------------------------------ tab bar
  function availableTabs() {
    const tabs = { pipelines: "Pipelines", datasets: "Datasets", lineage: "Lineage" };
    if (hasMarkings()) tabs.markings = "Markings";
    if (resolutionBlock()) tabs.resolution = "Resolution";
    return tabs;
  }

  function renderTabBar() {
    return `
    <nav class="tab-bar" aria-label="Build tabs">
      ${Object.entries(availableTabs()).map(([id, label]) => `
        <button class="${id === ui.activeTab ? "active" : ""}" aria-current="${id === ui.activeTab ? "page" : "false"}"
                data-action="switch-tab" data-tab="${id}">
          ${esc(label)}
        </button>
      `).join("")}
    </nav>`;
  }

  // ------------------------------------------------------------------ sidebar
  function renderSidebar() {
    if (ui.activeTab === "pipelines") return renderPipelinesSidebar();
    if (ui.activeTab === "datasets") return renderDatasetsSidebar("select-dataset");
    if (ui.activeTab === "lineage") return renderLineageSidebar();
    if (ui.activeTab === "markings") return renderDatasetsSidebar("mk-select");
    if (ui.activeTab === "resolution") return renderResolutionSidebar();
    return `<aside class="sidebar"></aside>`;
  }

  function renderPipelinesSidebar() {
    const transforms = getTransforms();
    return `
    <aside class="sidebar">
      <div class="sidebar-section-label">Transforms</div>
      <div class="sidebar-list">
        ${transforms.map(t => `
          <div class="sidebar-item ${t.id === ui.selectedTransformId ? "active" : ""}"
               data-action="select-transform" data-id="${esc(t.id)}" tabindex="0" role="button">
            <div class="item-name">${esc(t.name)}</div>
            <div class="item-meta">${t.rowsOut != null ? t.rowsOut.toLocaleString() : "—"}</div>
          </div>
        `).join("")}
      </div>
    </aside>`;
  }

  function datasetGroups() {
    const datasets = getDatasets();
    const raw = datasets.filter(d => !d.producedBy);
    const norm = datasets.filter(d => d.producedBy === "normalize_sources");
    const resolved = datasets.filter(d => /^resolve_/.test(d.producedBy || ""));
    const final = datasets.filter(d => d.producedBy === "build_ontology");
    const placed = new Set([...raw, ...norm, ...resolved, ...final].map(d => d.id));
    const other = datasets.filter(d => !placed.has(d.id));
    return [["Raw Sources", raw], ["Normalised", norm], ["Resolved", resolved], ["Final", final], ["Other", other]];
  }

  function renderDatasetsSidebar(action) {
    const showMarkings = hasMarkings();
    function renderGroup(label, items) {
      if (!items.length) return "";
      return `
        <div class="sidebar-group-label">${esc(label)}</div>
        ${items.map(d => `
          <div class="sidebar-item ${d.id === ui.selectedDatasetId ? "active" : ""}"
               data-action="${action}" data-id="${esc(d.id)}" tabindex="0" role="button">
            <div class="item-name">${esc(dsName(d))}</div>
            ${showMarkings ? `<div class="item-marks" aria-hidden="true">${effectiveMarkings(d).map(m => `<span class="mk-dot ${m.inheritedFrom ? "inherited" : ""}" style="--mk-c:${markingColour(m.id)}"></span>`).join("")}</div>` : ""}
            <div class="item-meta">${(d.rowCount || 0).toLocaleString()}</div>
          </div>
        `).join("")}
      `;
    }

    return `
    <aside class="sidebar">
      <div class="sidebar-section-label">Datasets</div>
      <div class="sidebar-list">
        ${datasetGroups().map(([label, items]) => renderGroup(label, items)).join("")}
      </div>
    </aside>`;
  }

  /** Label to show for an entity under the current role; withheld objects show their id only. */
  function visibleLabel(entity) {
    const r = redact(entity);
    const hidden = objectWithheld(r);
    if (hidden) return { text: "", withheld: hidden };
    const label = r.label;
    if (isWithheld(label)) return { text: "", withheld: label.withheld };
    return { text: label || entity.id, withheld: null };
  }

  function renderLineageSidebar() {
    const entities = getEntities();
    const search = ui.lineageEntitySearch.toLowerCase();
    const withLabels = entities.map(e => ({ e, v: visibleLabel(e) }));
    const filtered = (search
      ? withLabels.filter(({ e, v }) =>
          v.text.toLowerCase().includes(search) ||
          (e.id || "").toLowerCase().includes(search))
      : withLabels).slice(0, 40);

    return `
    <aside class="sidebar">
      <div class="sidebar-section-label">Object lineage</div>
      <div style="padding:8px 12px; border-bottom:1px solid var(--border);">
        <input class="search-input" id="lineage-search"
               placeholder="Search objects…" aria-label="Search objects"
               value="${esc(ui.lineageEntitySearch)}"
               data-action="lineage-search">
      </div>
      <div class="sidebar-list">
        ${filtered.map(({ e, v }) => `
          <div class="sidebar-item ${e.id === ui.selectedEntityId ? "active" : ""}"
               data-action="select-entity" data-id="${esc(e.id)}" tabindex="0" role="button">
            <div style="flex:1;overflow:hidden;">
              <div class="item-name">${v.withheld ? `<span class="withheld small">withheld — ${esc(v.withheld.join(", "))}</span>` : esc(v.text)}</div>
              <div class="item-meta" style="margin:0;">${esc(e.type)}${v.withheld ? ` · ${esc(e.id)}` : ""}</div>
            </div>
          </div>
        `).join("")}
        ${filtered.length === 0 ? `<div class="empty-state" style="padding:16px;font-size:11px;">No matches</div>` : ""}
      </div>
    </aside>`;
  }

  // ------------------------------------------------------------------ main content
  function renderMainContent() {
    if (ui.activeTab === "pipelines") return renderPipelinesMain();
    if (ui.activeTab === "datasets") return renderDatasetsMain();
    if (ui.activeTab === "lineage") return renderLineageMain();
    if (ui.activeTab === "markings") return renderMarkingsMain();
    if (ui.activeTab === "resolution") return renderResolutionMain();
    return "";
  }

  // ------------------------------------------------------------------ pipelines tab
  function renderPipelinesMain() {
    const transforms = getTransforms();

    // Raw sources: inputs that no transform produces.
    const produced = new Set();
    transforms.forEach(t => transformOutputs(t).forEach(d => produced.add(d.id)));
    const rawInputIds = new Set();
    transforms.forEach(t => (t.inputs || []).forEach(id => rawInputIds.add(id)));
    const rawSources = Array.from(rawInputIds).filter(id => !produced.has(id) && !getDatasets().some(d => d.id === id && d.producedBy));

    return `
      <div class="section-header">
        <div class="section-title">Pipeline DAG</div>
        <div class="section-sub">${transforms.length} transforms</div>
        ${honestyChip("build.pipelines")}
      </div>
      ${purposePanel()}
      ${renderDag(transforms, rawSources)}
      <div class="mt-12 text-muted text-mono" style="font-size:11px;">
        Click a transform to inspect it in the panel below.
      </div>
      ${discussionCards("build.pipelines")}
    `;
  }

  function renderDag(transforms, rawSources) {
    // Left column: raw sources; then for each transform: arrow → transform box → arrow → output box(es).
    const rawCols = rawSources.length > 0 ? `
      <div class="dag-column">
        <div class="dag-column-label">Raw Sources</div>
        ${rawSources.map(id => {
          const ds = getDataset(id) || {};
          return `
          <div class="dag-box" data-action="select-dataset" data-id="${esc(id)}" title="${esc(id)}" tabindex="0" role="button">
            <div class="box-type">source</div>
            <div class="box-name">${esc(dsName(ds, id))}</div>
            <div class="box-count">${(ds.rowCount || 0).toLocaleString()} rows</div>
          </div>`;
        }).join("")}
      </div>
    ` : "";

    const transformCols = transforms.map((t, i) => {
      const outputs = transformOutputs(t);
      const isSelected = t.id === ui.selectedTransformId;
      const conflicts = karlsruheOn() ? purposeConflictsForTransform(t) : [];
      const outBoxes = outputs.length ? outputs.map(outDs => `
          <div class="dag-box" data-action="select-dataset" data-id="${esc(outDs.id)}"
               title="${esc(outDs.id + (outDs.purpose ? ` · purpose ${outDs.purpose}` : ""))}" tabindex="0" role="button">
            <div class="box-type">dataset</div>
            <div class="box-name">${esc(dsName(outDs))}</div>
            <div class="box-count">${(outDs.rowCount || 0).toLocaleString()} rows</div>
          </div>`).join("") : `
          <div class="dag-box" title="${esc(t.output || "")}">
            <div class="box-type">dataset</div>
            <div class="box-name">${esc(t.output || "")}</div>
            <div class="box-count">—</div>
          </div>`;
      return `
        <div class="dag-arrow-col" title=""><div class="dag-arrow">→</div></div>
        <div class="dag-column">
          ${i === 0 ? `<div class="dag-column-label">Transform</div>` : `<div class="dag-column-label">&nbsp;</div>`}
          <div class="dag-box transform ${isSelected ? "selected" : ""} ${conflicts.length ? "rule-hit" : ""}"
               data-action="select-transform" data-id="${esc(t.id)}" tabindex="0" role="button"
               ${conflicts.length ? `aria-label="${esc(`${t.name}: blocked by rule ${conflicts.map(c => c.rule.id).join(", ")} in Karlsruhe mode`)}"` : ""}>
            <div class="box-type">transform ${conflicts.length ? ruleBadge(conflicts) : ""}</div>
            <div class="box-name">${esc(t.name)}</div>
            <div class="box-count">${(t.rowsOut || 0).toLocaleString()} out</div>
          </div>
        </div>
        <div class="dag-arrow-col"><div class="dag-arrow">→</div></div>
        <div class="dag-column">
          ${i === 0 ? `<div class="dag-column-label">Output</div>` : `<div class="dag-column-label">&nbsp;</div>`}
          ${outBoxes}
        </div>
      `;
    }).join("");

    return `<div class="dag-canvas scroll-x">${rawCols}${transformCols}</div>`;
  }

  // ------------------------------------------------------------------ inspector panel
  function renderInspector() {
    if (ui.activeTab === "pipelines" && ui.selectedTransformId) {
      return renderTransformInspector();
    }
    if (ui.activeTab === "markings" && ui.selectedDatasetId && getDataset(ui.selectedDatasetId)) {
      return renderMarkingsInspector(getDataset(ui.selectedDatasetId));
    }
    // The Datasets and Lineage tabs never fill the inspector: give the space to the main pane.
    if (ui.activeTab !== "pipelines" && ui.activeTab !== "markings") return "";
    const hint = ui.activeTab === "markings" ? "Inspector — select a dataset to see its markings" : "Inspector — select a transform";
    return `
    <div class="inspector">
      <div class="inspector-header">
        <div class="inspector-title">${esc(hint)}</div>
      </div>
    </div>`;
  }

  function renderTransformInspector() {
    const t = getTransform(ui.selectedTransformId);
    if (!t) return `<div class="inspector"><div class="inspector-header"><div class="inspector-title">Not found</div></div></div>`;

    const code = t.code || "";
    const lines = code.split("\n").slice(0, 50);  // first 50 lines in inspector
    const lineHtml = lines.map((line, i) =>
      `<span class="ln">${i + 1}</span>${esc(line)}`
    ).join("\n");

    const inputLinks = (t.inputs || []).map(id => {
      const ds = getDataset(id) || {};
      return `<button class="link-btn" data-action="goto-dataset" data-id="${esc(id)}">${esc(dsName(ds, id))}</button>`;
    }).join(", ");

    const outputs = transformOutputs(t);
    const outLink = outputs.length
      ? outputs.map(d => `<button class="link-btn" data-action="goto-dataset" data-id="${esc(d.id)}">${esc(dsName(d))}</button>`).join(", ")
      : esc(t.output || "—");

    return `
    <div class="inspector">
      <div class="inspector-header">
        <div class="inspector-title"><strong>${esc(t.name)}</strong> — ${esc(t.description)}</div>
      </div>
      <div class="inspector-body">
        <div class="info-row">
          <span class="info-chip">Inputs: ${inputLinks}</span>
          <span class="info-chip">Output: ${outLink}</span>
          <span class="info-chip">Rows out: <strong>${(t.rowsOut || 0).toLocaleString()}</strong></span>
          <span class="info-chip">Built: <strong>${esc(t.builtAt || "—")}</strong></span>
          <span class="info-chip">Code: <span class="text-accent">${esc(t.codePath || "")}</span></span>
        </div>
        ${karlsruheOn() ? purposeConflictsForTransform(t).map(c => `<div class="purpose-conflict inline">${ruleBadge([c])}<div><strong>Karlsruhe mode:</strong> writes <code>${esc(dsName(c.dataset))}</code> by joining ${c.dataSide.map(d => `<code>${esc(d.name)}</code> (${esc(d.purposes.map(purposeLabel).join(", "))})`).join(", ")} with ${c.against.map(a => esc(purposeLabel(a.purpose))).join(", ")}. <span class="purpose-rule-text">Rule ${esc(c.rule.id)}: “${esc(c.rule.text || "")}”</span></div></div>`).join("") : ""}
        <div class="code-block">
          <pre>${lineHtml}</pre>
        </div>
      </div>
    </div>`;
  }

  // ------------------------------------------------------------------ datasets tab
  function formatRetention(days) {
    if (typeof days !== "number" || !Number.isFinite(days)) return esc(days);
    const years = days / 365;
    return `${days.toLocaleString()} days${years >= 1 ? ` (about ${Math.round(years * 10) / 10} years)` : ""}`;
  }

  function formatTs(ts) {
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(String(ts || ""));
    return m ? `${m[1]} ${m[2]} UTC` : String(ts || "");
  }

  function renderDatasetGovernance(ds, hiddenMarks) {
    const hasTags = ds.purpose != null || ds.legalBasis != null || ds.retentionDays != null;
    const marks = effectiveMarkings(ds);
    const removed = removedMarkings(ds);
    if (!hasTags && !Array.isArray(ds.markings)) return "";
    return `
      <div class="section-title mb-8">Governance</div>
      <table class="prop-table gov-table mb-12">
        <tbody>
          ${ds.purpose != null ? `<tr><td>purpose</td><td>${esc(ds.purpose)}</td></tr>` : ""}
          ${ds.legalBasis != null ? `<tr><td>legalBasis</td><td>${esc(ds.legalBasis)}</td></tr>` : ""}
          ${ds.retentionDays != null ? `<tr><td>retentionDays</td><td>${formatRetention(ds.retentionDays)}</td></tr>` : ""}
          ${Array.isArray(ds.markings) ? `<tr><td>markings</td><td>
            ${marks.length ? marks.map(m => `<div class="mk-line">${markingBadge(m)} <span class="text-muted">${m.inheritedFrom ? `inherited from ${esc(m.sources.length ? m.sources.join(", ") : m.inheritedFrom)}` : "carried by this dataset"}</span></div>`).join("") : `<span class="text-muted">none</span>`}
            ${removed.map(r => `<div class="mk-line">${markingBadge({ id: r.id }, { removed: true })} <span class="text-muted">${r.override ? `removed by ${esc(roleLabel(r.override.by))}${r.upstream ? ` on ${esc(r.override.datasetId)}` : ""}${r.override.ts ? `, ${esc(formatTs(r.override.ts))}` : ""}` : "removed"}</span></div>`).join("")}
          </td></tr>` : ""}
          ${currentRoleId() && Array.isArray(ds.markings) ? `<tr><td>your access</td><td>${hiddenMarks.length
            ? `<span class="text-amber">rows withheld</span> <span class="text-muted">— your role (${esc(roleLabel(currentRoleId()))}) cannot see ${esc(hiddenMarks.join(", "))}; schema only</span>`
            : `<span class="text-accent">rows visible</span> <span class="text-muted">to your role (${esc(roleLabel(currentRoleId()))})</span>`}</td></tr>` : ""}
        </tbody>
      </table>`;
  }

  function renderDatasetsMain() {
    const ds = ui.selectedDatasetId ? getDataset(ui.selectedDatasetId) : null;
    if (!ds) {
      return `
      <div class="section-header"><div class="section-title">Datasets</div>${honestyChip("build.datasets")}</div>
      <div class="empty-state">
        <div class="empty-icon">⬚</div>
        <div>Select a dataset from the sidebar</div>
      </div>`;
    }

    const offset = ui.datasetRowOffset;
    const rows = (ds.sampleRows || []);
    const pageRows = rows.slice(offset, offset + PAGE_SIZE);
    const totalRows = ds.rowCount || 0;
    const totalSample = rows.length;
    const pageCount = Math.ceil(totalSample / PAGE_SIZE);
    const currentPage = Math.floor(offset / PAGE_SIZE);
    const fields = ds.schema ? ds.schema.map(s => s.field) : (pageRows[0] ? Object.keys(pageRows[0]) : []);
    const highlightIdx = ui.highlightDatasetRow && ui.highlightDatasetRow.datasetId === ds.id
      ? ui.highlightDatasetRow.rowIndex : null;

    // Rows are withheld when the role cannot see every effective marking (schema stays visible).
    const roleId = currentRoleId();
    const marks = effectiveIds(ds);
    const hiddenMarks = roleId ? marks.filter(m => !canSee(roleId, [m])) : [];
    const rowsWithheld = hiddenMarks.length > 0;

    return `
      <div class="section-header">
        <div class="section-title">${esc(dsName(ds))}</div>
        <div class="section-sub">${esc(ds.id)}</div>
        ${honestyChip("build.datasets")}
      </div>
      <div class="info-row">
        <span class="info-chip">Rows: <strong>${totalRows.toLocaleString()}</strong></span>
        ${ds.purpose ? `<span class="info-chip purpose-chip" title="Purpose the data was collected for">Purpose: <strong>${esc(purposeLabel(ds.purpose))}</strong></span>` : ""}
        ${ds.legalBasis ? `<span class="info-chip purpose-chip" title="Legal basis">Legal basis: <strong>${esc(ds.legalBasis)}</strong></span>` : ""}
        ${ds.sourceFile ? `<span class="info-chip">Source: <span class="text-mono text-muted">${esc(ds.sourceFile)}</span></span>` : ""}
        ${ds.producedBy ? `<span class="info-chip">Produced by: <button class="link-btn" data-action="goto-transform" data-id="${esc(ds.producedBy)}">${esc(ds.producedBy)}</button></span>` : ""}
        ${(ds.consumedBy || []).length ? `<span class="info-chip">Consumed by: ${(ds.consumedBy || []).map(id => `<button class="link-btn" data-action="goto-transform" data-id="${esc(id)}">${esc(id)}</button>`).join(", ")}</span>` : ""}
      </div>

      ${renderDatasetGovernance(ds, hiddenMarks)}

      <div class="section-title mb-8">Schema</div>
      <div class="scroll-x mb-12">
        <table class="schema-table">
          <thead><tr><th>Field</th><th>Type</th></tr></thead>
          <tbody>
            ${(ds.schema || []).map(f => `
              <tr>
                <td class="text-mono">${esc(f.field)}</td>
                <td><span class="type-pill">${esc(f.type)}</span></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>

      <div class="section-header">
        <div class="section-title">Sample rows</div>
        <div class="section-sub">${rowsWithheld ? `${totalRows.toLocaleString()} rows` : `showing ${totalSample ? offset + 1 : 0}–${Math.min(offset + PAGE_SIZE, totalSample)} of ${totalSample} sampled (${totalRows.toLocaleString()} total)`}</div>
      </div>
      ${rowsWithheld ? `
        <div class="withheld-block">
          <div>${withheldCell(hiddenMarks)}</div>
          ${whyLine(hiddenMarks)}
        </div>` : `
      <div class="scroll-x">
        <table class="data-table">
          <thead><tr>${fields.map(f => `<th>${esc(f)}</th>`).join("")}</tr></thead>
          <tbody>
            ${pageRows.map((row, i) => {
              const absIdx = offset + i;
              const isHighlighted = highlightIdx === absIdx;
              return `<tr class="${isHighlighted ? "highlighted" : ""}">
                ${fields.map(f => `<td title="${esc(JSON.stringify(row[f]))}">${esc(renderCellValue(row[f]))}</td>`).join("")}
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
      <div class="pagination-bar">
        <button data-action="page-prev" ${currentPage === 0 ? "disabled" : ""}>&larr; Prev</button>
        <span>Page ${currentPage + 1} / ${Math.max(1, pageCount)}</span>
        <button data-action="page-next" ${currentPage >= pageCount - 1 ? "disabled" : ""}>Next &rarr;</button>
      </div>`}
    `;
  }

  function renderCellValue(val) {
    if (val == null) return "";
    if (typeof val === "object") return JSON.stringify(val);
    return String(val);
  }

  // ------------------------------------------------------------------ lineage tab
  /** Markings removed by a DPO override at ontology_entities or upstream (contract §6). */
  function removedAtOntology() {
    if (!core("markings", "removedAtOntology")) return new Set();
    const result = safe("markings.removedAtOntology", () => window.DC.markings.removedAtOntology(), null);
    if (result instanceof Set) return result;
    return new Set(Array.isArray(result) ? result : []);
  }

  function entityMarkingBadges(list, removed) {
    if (!list || !list.length) return `<span class="text-muted">none</span>`;
    return list.map(m => markingBadge({ id: m }, { removed: removed.has(m) })).join(" ");
  }

  function renderEntityMarkings(entity, redacted) {
    const has = Array.isArray(entity.markings) || Array.isArray(entity.sourceMarkings) || entity.propertyMarkings;
    if (!has) return "";
    const roleId = currentRoleId();
    const propMarks = entity.propertyMarkings && typeof entity.propertyMarkings === "object" ? entity.propertyMarkings : {};
    const hiddenObject = objectWithheld(redacted);
    const removed = removedAtOntology();
    return `
      <div class="section-title mb-8">Markings</div>
      <table class="prop-table gov-table mb-12">
        <tbody>
          <tr><td>markings</td><td>${entityMarkingBadges(entity.markings || [], removed)} <span class="text-muted">needed to see that this object exists</span></td></tr>
          ${Array.isArray(entity.sourceMarkings) ? `<tr><td>sourceMarkings</td><td>${entityMarkingBadges(entity.sourceMarkings, removed)} <span class="text-muted">union of the datasets that contributed${removed.size ? "; struck-through markings were removed upstream by a DPO" : ""}</span></td></tr>` : ""}
          ${Object.entries(propMarks).map(([prop, ms]) => {
            const visible = roleId ? canSee(roleId, ms) && !hiddenObject : true;
            return `<tr><td>${esc(prop)}</td><td>${entityMarkingBadges(ms || [], removed)}${roleId ? ` <span class="${visible ? "text-muted" : "text-amber"}">${visible ? "visible to your role" : "withheld from your role"}</span>` : ""}</td></tr>`;
          }).join("")}
        </tbody>
      </table>`;
  }

  function renderLineageMain() {
    const eid = ui.selectedEntityId;
    const chip = honestyChip("build.lineage");
    if (!eid) {
      return `
      <div class="section-header"><div class="section-title">Lineage</div>${chip}</div>
      <div class="empty-state">
        <div class="empty-icon">⬡</div>
        <div>Search and select an object in the sidebar to view its lineage</div>
      </div>`;
    }

    const entities = getEntities();
    const entity = entities.find(e => e.id === eid);
    if (!entity) {
      return `<div class="empty-state"><div>Object not found: ${esc(eid)}</div></div>`;
    }
    const redacted = redact(entity);
    const hiddenObject = objectWithheld(redacted);

    const lineage = getLineage()[eid] || {};
    const transforms = getTransforms();
    const producedByTransform = transforms.find(t => t.id === lineage.producedBy)
      || transforms.find(t => t.output && (t.output === lineage.producedBy || t.id === lineage.producedBy))
      || { name: lineage.producedBy || "unknown", id: lineage.producedBy || "" };

    const sourceRows = lineage.sourceRows || [];
    const fieldProv = lineage.fieldProvenance || {};

    // Group source rows by dataset
    const byDataset = {};
    sourceRows.forEach(ref => {
      const ds = ref.dataset || "unknown";
      byDataset[ds] = byDataset[ds] || [];
      byDataset[ds].push(ref);
    });

    // Per-field provenance table rows (values read through the role's redaction)
    const props = redacted.properties || {};
    const fieldProvRows = [];
    const allFields = new Set([...Object.keys(props), ...Object.keys(fieldProv)]);
    allFields.forEach(field => {
      const val = hiddenObject ? { withheld: hiddenObject } : props[field];
      const refs = fieldProv[field] || [];
      refs.forEach(ref => {
        fieldProvRows.push({ field, val, ref });
      });
      if (!refs.length && val !== undefined && val !== null && val !== "") {
        fieldProvRows.push({ field, val, ref: null });
      }
    });

    const label = hiddenObject || isWithheld(redacted.label) ? "" : (redacted.label || "");
    const titleHtml = label ? esc(label) : withheldCell(hiddenObject || (redacted.label && redacted.label.withheld) || []);
    const gothamHref = `../demo/index.html#object=${encodeURIComponent(eid)}&dataset=${encodeURIComponent(ui.datasetKey)}`;
    const crossLink = `<a href="${esc(gothamHref)}" target="_blank" class="link-btn" style="font-size:12px;">
      View ${label ? esc(label) : "this object"} in Investigate (Gotham-style) →
    </a>`;

    return `
      <div class="section-header">
        <div class="section-title">${titleHtml}</div>
        <div class="section-sub"><span class="entity-type">${esc(entity.type)}</span> &nbsp; ${esc(eid)}</div>
        ${chip}
      </div>
      ${hiddenObject ? whyLine(hiddenObject) : ""}

      <div class="section-title mb-8">Object properties</div>
      <table class="prop-table mb-12">
        <tbody>
          <tr><td>id</td><td>${esc(eid)}</td></tr>
          <tr><td>type</td><td>${esc(entity.type)}</td></tr>
          ${Object.entries(props).map(([k, v]) => `
            <tr><td>${esc(k)}</td><td>${hiddenObject ? withheldCell(hiddenObject) : displayValue(v)}</td></tr>
          `).join("")}
        </tbody>
      </table>
      ${renderEntityMarkings(entity, redacted)}
      ${hiddenObject ? "" : renderResolution(entity)}

      <div class="section-title mb-8">Upstream source rows</div>
      <div class="lineage-tree mb-12">
        <div class="tree-node">
          <span class="tree-icon">◈</span>
          <span class="tree-label">${label ? esc(label) : esc(eid)}</span>
          <span class="tree-meta">&nbsp;— ${esc(entity.type)}</span>
        </div>
        <div class="tree-children">
          <div class="tree-node">
            <span class="tree-icon">⬡</span>
            <span class="tree-label">
              ${lineage.producedBy
                ? `<button class="link-btn" data-action="goto-transform" data-id="${esc(producedByTransform.id || lineage.producedBy)}">${esc(producedByTransform.name || lineage.producedBy)}</button>`
                : "<span class='text-muted'>unknown transform</span>"
              }
            </span>
            <span class="tree-meta">&nbsp;transform</span>
          </div>
          <div class="tree-children">
            ${Object.entries(byDataset).map(([dsRef, refs]) => {
              const dsObj = findDataset(dsRef) || {};
              const rowNums = [...new Set(refs.map(r => r.row))].sort((a, b) => a - b);
              return `
                <div class="tree-node">
                  <span class="tree-icon">▤</span>
                  <span class="tree-label">
                    <button class="link-btn" data-action="goto-dataset" data-id="${esc(dsObj.id || dsRef)}">${esc(dsName(dsObj, dsRef))}</button>
                  </span>
                  ${dsObj.id && Array.isArray(dsObj.markings) ? `<span class="tree-marks">${markingBadges(effectiveMarkings(dsObj), { small: true })}</span>` : ""}
                  <span class="tree-meta">&nbsp;rows: ${rowNums.join(", ")}</span>
                </div>`;
            }).join("")}
            ${Object.keys(byDataset).length === 0
              ? `<div class="tree-node"><span class="tree-meta">No source rows recorded</span></div>` : ""}
          </div>
        </div>
      </div>

      <div class="section-title mb-8">Per-field provenance</div>
      <div class="scroll-x mb-12">
        <table class="data-table">
          <thead>
            <tr>
              <th>Field</th>
              <th>Value</th>
              <th>Source dataset</th>
              <th>Source row</th>
              <th>Source field</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            ${fieldProvRows.map(({ field, val, ref }) => {
              const dsObj = ref ? (findDataset(ref.dataset) || {}) : {};
              const rowIdx = ref ? ref.row : null;
              return `<tr class="${ref ? "clickable" : ""}"
                          ${ref ? `data-action="goto-dataset-row" data-id="${esc(dsObj.id || ref.dataset || "")}" data-row="${rowIdx}"` : ""}>
                <td>${esc(field)}</td>
                <td>${displayValue(val)}</td>
                <td>${ref ? `<button class="link-btn" data-action="goto-dataset" data-id="${esc(dsObj.id || ref.dataset || "")}">${esc(dsName(dsObj, ref.dataset || ""))}</button>` : ""}</td>
                <td>${ref && rowIdx != null ? rowIdx : ""}</td>
                <td>${ref ? esc(ref.field || "") : ""}</td>
                <td>${ref ? esc(ref.note || "") : ""}</td>
              </tr>`;
            }).join("")}
            ${fieldProvRows.length === 0
              ? `<tr><td colspan="6" class="text-muted" style="padding:8px;">No field provenance recorded</td></tr>` : ""}
          </tbody>
        </table>
      </div>

      <div class="mt-8">${crossLink}</div>
    `;
  }

  // ------------------------------------------------------------------ markings tab (F2)
  function markingColumns() {
    const cols = [];
    getDatasets().forEach(d => {
      const depth = datasetDepth(d);
      (cols[depth] = cols[depth] || []).push(d);
    });
    return cols.filter(Boolean);
  }

  function columnLabel(items, index) {
    if (index === 0) return "Raw sources";
    const producers = Array.from(new Set(items.map(d => d.producedBy).filter(Boolean)));
    return producers.length ? producers.join(", ") : `Stage ${index}`;
  }

  function renderMarkingsMain() {
    const ids = knownMarkingIds();
    const filter = ui.markingFilter && ids.includes(ui.markingFilter) ? ui.markingFilter : "";
    const cols = markingColumns();
    const hit = filter ? getDatasets().filter(d => effectiveIds(d).includes(filter)) : [];
    const own = filter ? hit.filter(d => !(effectiveMarkings(d).find(m => m.id === filter) || {}).inheritedFrom) : [];

    const box = (d) => {
      const marks = effectiveMarkings(d);
      const has = filter && marks.some(m => m.id === filter);
      const conflicts = karlsruheOn() ? purposeConflictsForDataset(d) : [];
      const cls = ["mk-box", d.id === ui.selectedDatasetId ? "selected" : "", filter ? (has ? "hit" : "dim") : ""].filter(Boolean).join(" ");
      return `
        <button class="${cls}" data-action="mk-select" data-id="${esc(d.id)}" data-mk-node="${esc(d.id)}"
                ${has ? `style="--mk-c:${markingColour(filter)}"` : ""}
                aria-label="${esc(`${dsName(d)}: markings ${marks.map(m => m.id).join(", ") || "none"}${d.purpose ? `; purpose ${d.purpose}` : ""}${conflicts.length ? `; breaks rule ${conflicts.map(c => c.rule.id).join(", ")}` : ""}`)}">
          <span class="mk-stripe" aria-hidden="true">${marks.map(m => `<span class="${m.inheritedFrom ? "inherited" : ""}" style="--mk-c:${markingColour(m.id)}"></span>`).join("")}</span>
          <span class="mk-head"><span class="box-name">${esc(dsName(d))}</span>${conflicts.length ? ruleBadge(conflicts) : ""}<span class="box-count">${(d.rowCount || 0).toLocaleString()}</span></span>
          <span class="mk-badges">${marks.length ? marks.map(m => markingBadge(m, { small: true })).join("") : `<span class="text-muted">no markings</span>`}</span>
          ${d.purpose ? `<span class="mk-purpose" title="${esc(d.legalBasis ? `Legal basis: ${d.legalBasis}` : "")}">purpose: ${esc(purposeLabel(d.purpose))}</span>` : ""}
        </button>`;
    };

    return `
      <div class="section-header">
        <div class="section-title">Markings through lineage</div>
        <div class="section-sub">${getDatasets().length} datasets</div>
        ${honestyChip("build.markings")}
      </div>
      <div class="mk-toolbar" role="group" aria-label="Highlight a marking">
        <span class="text-muted">Highlight:</span>
        <button class="mk-filter ${filter ? "" : "active"}" data-action="mk-filter" data-marking="" aria-pressed="${!filter}">All</button>
        ${ids.map(id => `<button class="mk-filter ${filter === id ? "active" : ""}" data-action="mk-filter" data-marking="${esc(id)}" aria-pressed="${filter === id}" style="--mk-c:${markingColour(id)}"><span class="mk-swatch" aria-hidden="true"></span>${esc(id)}</button>`).join("")}
      </div>
      ${purposePanel()}
      ${filter ? `<div class="mk-summary" aria-live="polite"><strong>${esc(filter)}</strong> is carried by ${hit.length} dataset${hit.length === 1 ? "" : "s"}: ${own.length} at source, ${hit.length - own.length} inherited downstream.</div>` : ""}
      <div class="mk-dag" id="mk-dag">
        <svg class="mk-edges" id="mk-edges" aria-hidden="true"></svg>
        ${cols.map((items, i) => `
          <div class="mk-col">
            <div class="dag-column-label" title="${esc(columnLabel(items, i))}">${esc(columnLabel(items, i))}</div>
            ${items.map(box).join("")}
          </div>`).join("")}
      </div>
      ${renderMarkingLegend(ids)}
      ${discussionCards("build.markings")}
    `;
  }

  function renderMarkingLegend(ids) {
    return `
      <div class="section-title mt-16 mb-8">Legend</div>
      <div class="mk-legend">
        ${ids.map(id => {
          const def = markingDef(id);
          const who = rolesThatCanSee([id]).map(r => r.label);
          return `<div class="mk-legend-row">
            ${markingBadge({ id })}
            <span class="mk-legend-label">${esc(def.label)}</span>
            <span class="text-muted">${esc(def.description)}${who.length ? ` Visible to: ${esc(who.join(", "))}.` : ""}</span>
          </div>`;
        }).join("")}
        <div class="mk-legend-row">
          ${markingBadge({ id: "ID", inheritedFrom: "upstream" })}
          <span class="mk-legend-label">Inherited</span>
          <span class="text-muted">Dashed outline (and a hatched stripe on the box): the marking came from an upstream dataset (see markingProvenance).</span>
        </div>
      </div>`;
  }

  function renderMarkingsInspector(ds) {
    const marks = effectiveMarkings(ds);
    const removed = removedMarkings(ds);
    const canAttempt = Boolean(core("checkpoints", "withCheckpoint") && core("markings", "removeMarking"));
    const visibleTo = rolesThatCanSee(marks.map(m => m.id)).map(r => r.label);
    return `
    <div class="inspector">
      <div class="inspector-header">
        <div class="inspector-title"><strong>${esc(dsName(ds))}</strong> — markings${ds.purpose ? ` · purpose ${esc(purposeLabel(ds.purpose))}` : ""}</div>
        <button class="link-btn" data-action="goto-dataset" data-id="${esc(ds.id)}">Open in Datasets</button>
      </div>
      <div class="inspector-body">
        <table class="data-table mk-table">
          <thead><tr><th>Marking</th><th>Label</th><th>inheritedFrom</th><th></th></tr></thead>
          <tbody>
            ${marks.map(m => `
              <tr>
                <td>${markingBadge(m)}</td>
                <td>${esc(markingDef(m.id).label)}</td>
                <td>${m.inheritedFrom ? esc(m.sources.length ? m.sources.join(", ") : m.inheritedFrom) : `<span class="text-muted">null (carried by this dataset)</span>`}</td>
                <td>${canAttempt ? `<button class="mk-remove" data-action="mk-remove" data-id="${esc(ds.id)}" data-marking="${esc(m.id)}">Remove marking</button>` : ""}</td>
              </tr>`).join("")}
            ${removed.map(r => `
              <tr class="mk-removed-row">
                <td>${markingBadge({ id: r.id }, { removed: true })}</td>
                <td>${esc(markingDef(r.id).label)}</td>
                <td colspan="2">${r.override ? `removed by ${esc(roleLabel(r.override.by))}${r.upstream ? ` on ${esc(r.override.datasetId)}` : ""}${r.override.ts ? ` · ${esc(formatTs(r.override.ts))}` : ""}` : "removed"}</td>
              </tr>`).join("")}
            ${marks.length + removed.length === 0 ? `<tr><td colspan="4" class="text-muted">No markings</td></tr>` : ""}
          </tbody>
        </table>
        ${ds.purpose || ds.legalBasis ? `<div class="mt-8 mk-basis">${ds.purpose ? `<span class="info-chip purpose-chip">Purpose: <strong>${esc(purposeLabel(ds.purpose))}</strong></span>` : ""} ${ds.legalBasis ? `<span class="info-chip purpose-chip">Legal basis: <strong>${esc(ds.legalBasis)}</strong></span>` : ""}</div>` : ""}
        ${karlsruheOn() ? purposeConflictsForDataset(ds).map(c => `<div class="purpose-conflict inline">${ruleBadge([c])}<div>Joins ${c.dataSide.map(d => `<code>${esc(d.name)}</code> (${esc(d.purposes.map(purposeLabel).join(", "))})`).join(", ")} with ${c.against.map(a => esc(purposeLabel(a.purpose))).join(", ")}. <span class="purpose-rule-text">Rule ${esc(c.rule.id)}: “${esc(c.rule.text || "")}”</span></div></div>`).join("") : ""}
        ${allRoles().length && core("markings", "canSee") ? `<div class="mt-8 text-muted">Rows visible to: <span class="text-accent">${esc(visibleTo.join(", ") || "no role")}</span></div>` : ""}
      </div>
    </div>`;
  }

  /** Draw dataset → dataset edges behind the Markings DAG (positions known only after layout). */
  function drawMarkingEdges() {
    const dag = el("mk-dag");
    const svg = el("mk-edges");
    if (!dag || !svg) return;
    const base = dag.getBoundingClientRect();
    const nodes = {};
    dag.querySelectorAll("[data-mk-node]").forEach(n => { nodes[n.getAttribute("data-mk-node")] = n.getBoundingClientRect(); });
    const filter = ui.markingFilter;
    const sel = ui.selectedDatasetId;
    const paths = [];
    getDatasets().forEach(d => {
      const to = nodes[d.id];
      if (!to) return;
      datasetParents(d).forEach(pid => {
        const from = nodes[pid];
        if (!from) return;
        const x1 = from.right - base.left + dag.scrollLeft, y1 = from.top + from.height / 2 - base.top + dag.scrollTop;
        const x2 = to.left - base.left + dag.scrollLeft, y2 = to.top + to.height / 2 - base.top + dag.scrollTop;
        const mx = (x1 + x2) / 2;
        const carries = filter && effectiveIds(d).includes(filter) && effectiveIds(getDataset(pid)).includes(filter);
        const touchesSel = sel && (sel === d.id || sel === pid);
        const cls = carries ? "hit" : touchesSel ? "sel" : filter ? "dim" : "";
        paths.push(`<path class="${cls}" d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}"${carries ? ` style="stroke:${markingColour(filter)}"` : ""}/>`);
      });
    });
    svg.setAttribute("width", dag.scrollWidth);
    svg.setAttribute("height", dag.scrollHeight);
    svg.innerHTML = paths.join("");
  }

  async function attemptMarkingRemoval(datasetId, marking) {
    logEvent({ kind: "marking", verb: "marking.remove.request", datasetId, payload: { marking, tab: "markings" } });
    if (!core("checkpoints", "withCheckpoint") || !core("markings", "removeMarking")) return;
    try {
      await window.DC.checkpoints.withCheckpoint(
        "cp-marking-remove",
        { surface: SURFACE, objectIds: [], datasetId, summary: `Remove ${marking} from ${datasetId}` },
        (record) => window.DC.markings.removeMarking({
          datasetId,
          marking,
          checkpointRecordId: record && typeof record === "object" ? (record.id || record.recordId || null) : (record || null),
        })
      );
    } catch (error) {
      console.warn("[build] marking removal did not complete", error);
    }
    render();
    refreshAuditStrip();
  }

  // ------------------------------------------------------------------ entity resolution (F0.2)
  const RESOLUTION_METHOD_LABELS = {
    passport: "Matched by passport",
    phone: "Matched by phone",
    "name+dob": "Matched by name + date of birth",
    alias: "Matched by alias",
    "ping-only": "Created from a location ping only",
  };

  function renderResolution(entity) {
    const r = entity && entity.resolution;
    if (!r || typeof r !== "object") return "";
    const method = RESOLUTION_METHOD_LABELS[r.method] || (r.method ? `Matched by ${r.method}` : "Match method not recorded");
    const confidence = typeof r.confidence === "number" && Number.isFinite(r.confidence) ? r.confidence.toFixed(2) : "—";
    const mergedFrom = Array.isArray(r.mergedFrom) ? r.mergedFrom.filter(Boolean) : [];
    return `
      <div class="section-title mb-8">Resolution</div>
      <table class="prop-table mb-12">
        <tbody>
          <tr><td>method</td><td>${esc(method)} <span class="text-muted text-mono">(${esc(r.method || "—")})</span></td></tr>
          <tr><td>confidence</td><td>${esc(confidence)}</td></tr>
          ${mergedFrom.length ? `<tr><td>mergedFrom</td><td>${esc(mergedFrom.join(", "))}</td></tr>` : ""}
        </tbody>
      </table>
      ${r.splitRisk ? `
        <div class="resolution-note mb-12">
          <span class="resolution-note-label">Resolution note</span>
          ${esc(r.note || "This person was created from a single weak key and may be the same individual as another record.")}
        </div>` : ""}
    `;
  }

  // ------------------------------------------------------------------ purposes and Karlsruhe mode (F9)
  // PHASE2_CONTRACT §4. The rules come from the seed (governance.purposeRules); whether they are
  // enforced comes from DC.purposes.enabled(). Build only *shows* which transforms would combine
  // incompatible purposes: the pipeline has already run, so nothing here is blocked.
  const MARKING_PURPOSES = { HEALTH: "healthcare" };

  function seedGovernanceBlock() {
    return seedData.governance || firstGovernance() || {};
  }

  function purposeRules() {
    const mod = window.DC && window.DC.purposes;
    if (mod && typeof mod.rules === "function") {
      const list = safe("purposes.rules", () => mod.rules(), null);
      if (Array.isArray(list) && list.length) return list;
    }
    const list = seedGovernanceBlock().purposeRules;
    return Array.isArray(list) ? list : [];
  }

  function karlsruheOn() {
    if (!core("purposes", "enabled")) return false;
    return Boolean(safe("purposes.enabled", () => window.DC.purposes.enabled(), false));
  }

  function purposeLabel(id) {
    const g = governance();
    const p = g && Array.isArray(g.purposes) ? g.purposes.find(x => x.id === id) : null;
    return (p && p.label) || id;
  }

  /** Purposes a dataset's data was collected for: its manifest purpose plus purposes implied by its markings. */
  function dataPurposesOf(ds) {
    const out = new Set();
    if (!ds) return out;
    if (ds.purpose) out.add(ds.purpose);
    effectiveIds(ds).forEach(m => { if (MARKING_PURPOSES[m]) out.add(MARKING_PURPOSES[m]); });
    return out;
  }

  /**
   * Rules with an `incompatible` clause that a dataset's production breaks: the data purposes of
   * its parents meet a law-enforcement purpose (another parent's purpose, or the output's own).
   * Multi-output transforms (normalize_sources) are judged per output, so a per-source copy is fine.
   */
  function purposeConflictsForDataset(ds) {
    const parents = datasetParents(ds).map(getDataset).filter(Boolean);
    if (parents.length < 1 || !ds.producedBy) return [];
    const out = [];
    purposeRules().forEach(rule => {
      const inc = rule && rule.incompatible;
      if (!inc || !Array.isArray(inc.data) || !Array.isArray(inc.session)) return;
      const dataSide = parents.filter(p => inc.data.some(x => dataPurposesOf(p).has(x)));
      if (!dataSide.length) return;
      const against = new Map(); // purpose -> where it comes from
      parents.filter(p => !dataSide.includes(p)).forEach(p => dataPurposesOf(p).forEach(x => { if (inc.session.includes(x)) against.set(x, dsName(p)); }));
      if (ds.purpose && inc.session.includes(ds.purpose)) against.set(ds.purpose, `${dsName(ds)} (output purpose)`);
      if (!against.size) return;
      out.push({
        rule,
        dataset: ds,
        dataSide: dataSide.map(p => ({ name: dsName(p), purposes: inc.data.filter(x => dataPurposesOf(p).has(x)) })),
        against: Array.from(against.entries()).map(([purpose, from]) => ({ purpose, from })),
      });
    });
    return out;
  }

  function purposeConflictsForTransform(t) {
    return transformOutputs(t).flatMap(purposeConflictsForDataset);
  }

  function allPurposeConflicts() {
    if (!karlsruheOn()) return [];
    return getTransforms().flatMap(t => purposeConflictsForTransform(t).map(c => Object.assign({ transform: t }, c)));
  }

  function ruleBadge(conflicts) {
    const ids = Array.from(new Set(conflicts.map(c => c.rule.id)));
    return ids.map(id => {
      const rule = conflicts.find(c => c.rule.id === id).rule;
      return `<span class="rule-badge" title="${esc(`Rule ${id}: ${rule.text || ""}`)}">${esc(id)}</span>`;
    }).join("");
  }

  function purposePanel() {
    if (!core("purposes", "enabled") || !purposeRules().length) return "";
    if (!karlsruheOn()) {
      return `<div class="purpose-panel off"><span class="text-muted">Karlsruhe mode is off: the pipeline combines datasets without checking their purposes. Turn it on in the session strip to check each transform against the purpose rules.</span></div>`;
    }
    const conflicts = allPurposeConflicts();
    const note = seedGovernanceBlock().legalBasisNote;
    const rules = Array.from(new Map(conflicts.map(c => [c.rule.id, c.rule])).values());
    if (!conflicts.length) {
      return `<div class="purpose-panel on clear" role="note"><span class="rule-badge ok">Karlsruhe mode</span> No transform combines purposes the rules forbid.</div>`;
    }
    return `
      <details class="purpose-panel on" role="note">
        <summary class="purpose-panel-head"><span class="rule-badge">Karlsruhe mode</span>
          ${conflicts.length} dataset${conflicts.length === 1 ? "" : "s"} in this pipeline combine purposes that
          ${rules.map(r => `rule ${esc(r.id)} forbids: <span class="purpose-rule-text">“${esc(r.text || "")}”</span>`).join("; ")}
          <span class="text-muted">The build has already run; Investigate blocks the same combination. Details ▾</span></summary>
        ${conflicts.map(c => `
          <div class="purpose-conflict">
            ${ruleBadge([c])}
            <div><strong>${esc(c.transform.name || c.transform.id)}</strong> → <code>${esc(dsName(c.dataset))}</code>:
              joins ${c.dataSide.map(d => `<code>${esc(d.name)}</code> (${esc(d.purposes.map(purposeLabel).join(", "))})`).join(", ")}
              with ${c.against.map(a => `${esc(purposeLabel(a.purpose))} <span class="text-muted">from ${esc(a.from)}</span>`).join(", ")}.</div>
          </div>`).join("")}
        ${note ? `<div class="purpose-note text-muted">${esc(note)}</div>` : ""}
      </details>`;
  }

  // ------------------------------------------------------------------ discussion cards (spec §5.4)
  function discussionCards(surfaceId) {
    let html = "";
    if (core("ui", "discussionCardsFor")) {
      html = safe("ui.discussionCardsFor", () => window.DC.ui.discussionCardsFor(surfaceId), "");
      if (typeof html !== "string") html = "";
    } else {
      // Without the core helper, render the seed's cards directly (same fields, simpler markup).
      const list = Array.isArray(seedGovernanceBlock().discussions) ? seedGovernanceBlock().discussions : [];
      html = list.filter(d => Array.isArray(d.attachedTo) && d.attachedTo.includes(surfaceId)).map(d => `
        <article class="dc-discussion" id="discussion-${esc(d.id)}">
          <div class="dc-discussion-kicker">Discussion</div>
          <h3>${esc(d.title)}</h3>
          <p>${esc(d.summary)}</p>
          ${Array.isArray(d.questions) && d.questions.length ? `<ol>${d.questions.map(q => `<li>${esc(q)}</li>`).join("")}</ol>` : ""}
          ${Array.isArray(d.sources) && d.sources.length ? `<p class="dc-discussion-sources">Sources: ${d.sources.filter(u => /^https:\/\//i.test(u)).map(u => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace(/^https:\/\/(www\.)?/, "").split("/")[0])}</a>`).join(", ")}</p>` : ""}
          ${d.disclaimer ? `<p class="dc-discussion-disclaimer">${esc(d.disclaimer)}</p>` : ""}
        </article>`).join("");
    }
    if (!html.trim()) return "";
    return `<section class="build-discussions" aria-label="Discussion material">${html}</section>`;
  }

  // ------------------------------------------------------------------ resolution tab (F6)
  // PHASE2_CONTRACT §2 and §6. The seed's Persons are the pipeline's merges at the default
  // threshold; the candidate pairs below it are merged in the browser (DC.resolution.resolveAt).
  // Without core/resolution.js the tab still works on a local copy of the same union-find, but the
  // threshold is then neither shared with Investigate nor logged.
  let localThreshold = null;

  function resolutionBlock() {
    const r = seedData.resolution || (seedData.ontology && seedData.ontology.resolution) || null;
    return r && Array.isArray(r.candidates) ? r : null;
  }

  function hasResolutionCore() { return Boolean(core("resolution", "resolveAt")); }

  function defaultThreshold() {
    const r = resolutionBlock();
    return r && typeof r.defaultThreshold === "number" ? r.defaultThreshold : 0.75;
  }

  function minThreshold() {
    const r = resolutionBlock();
    return r && typeof r.minThreshold === "number" ? r.minThreshold : 0.30;
  }

  const MAX_THRESHOLD = 0.95;

  function roundT(t) { return Math.round(t * 100) / 100; }

  function currentThreshold() {
    let t = null;
    if (core("resolution", "threshold")) t = safe("resolution.threshold", () => window.DC.resolution.threshold(), null);
    if (typeof t !== "number" || !Number.isFinite(t)) t = localThreshold;
    if (typeof t !== "number" || !Number.isFinite(t)) t = defaultThreshold();
    return Math.min(MAX_THRESHOLD, Math.max(minThreshold(), t));
  }

  function setThreshold(t) {
    t = roundT(Math.min(MAX_THRESHOLD, Math.max(minThreshold(), t)));
    if (core("resolution", "setThreshold")) {
      // The core persists the value in dc-palantir:governance and logs the change itself.
      safe("resolution.setThreshold", () => window.DC.resolution.setThreshold(t), null);
    } else {
      localThreshold = t;
    }
  }

  function signalDefs() {
    const r = resolutionBlock();
    return r && Array.isArray(r.signals) ? r.signals : [];
  }

  function signalDef(id) {
    const def = signalDefs().find(s => s.id === id);
    return def || { id, weight: 0, label: id, note: "" };
  }

  /** Signals of a candidate as [{id, weight, label, note}] (accepts ids or objects). */
  function candidateSignals(c) {
    return (Array.isArray(c && c.signals) ? c.signals : []).map(s => {
      if (s && typeof s === "object") return Object.assign({}, signalDef(s.id), s);
      return signalDef(s);
    });
  }

  let overridesMemo = null; // cleared at every render
  function overridesList() {
    if (overridesMemo) return overridesMemo;
    overridesMemo = readOverrides();
    return overridesMemo;
  }

  function readOverrides() {
    let list = null;
    if (core("resolution", "overrides")) list = safe("resolution.overrides", () => window.DC.resolution.overrides(), null);
    if (!Array.isArray(list)) list = readGovernanceState().resolutionOverrides;
    return Array.isArray(list) ? list : [];
  }

  function rejectionOf(candidateId) {
    return overridesList().filter(o => o && o.candidateId === candidateId && (o.decision || "reject") === "reject").slice(-1)[0] || null;
  }

  function isWatchlisted(id) {
    const e = entityById(id);
    return Boolean(e && e.properties && e.properties.riskTag);
  }

  /** Union-find fallback with the contract's representative rule (lowest watchlisted id, else lowest id). */
  function localResolveAt(t) {
    const r = resolutionBlock();
    const parent = new Map();
    const find = (x) => { while (parent.has(x) && parent.get(x) !== x) x = parent.get(x); return x; };
    const merges = [];
    (r ? r.candidates : []).slice().sort((a, b) => String(a.id).localeCompare(String(b.id))).forEach(c => {
      if (!(c.score >= t - 1e-9) || rejectionOf(c.id)) return;
      [c.left, c.right].forEach(id => { if (!parent.has(id)) parent.set(id, id); });
      const a = find(c.left), b = find(c.right);
      if (a !== b) parent.set(a < b ? b : a, a < b ? a : b);
      merges.push({ candidate: c });
    });
    const members = new Map();
    Array.from(parent.keys()).forEach(id => {
      const root = find(id);
      if (!members.has(root)) members.set(root, []);
      members.get(root).push(id);
    });
    const clusters = new Map();
    const repOf = new Map();
    members.forEach(ids => {
      ids.sort();
      const listed = ids.filter(isWatchlisted);
      const rep = listed.length ? listed[0] : ids[0];
      clusters.set(rep, ids);
      ids.forEach(id => repOf.set(id, rep));
    });
    merges.forEach(m => { m.rep = repOf.get(m.candidate.left); });
    return { clusters, repOf, merges };
  }

  function toMap(value) {
    if (value instanceof Map) return value;
    const m = new Map();
    if (value && typeof value === "object") Object.keys(value).forEach(k => m.set(k, value[k]));
    return m;
  }

  /** {clusters: Map(rep -> ids), repOf: Map, merges: [{candidate, rep}], mergedIds: Set(candidate id)} */
  const resolveCache = new Map();
  function resolveAt(t) {
    const cacheKey = `${ui.datasetKey}|${t}|${JSON.stringify(overridesList().map(o => o.candidateId))}`;
    if (resolveCache.has(cacheKey)) return resolveCache.get(cacheKey);
    let raw = null;
    if (hasResolutionCore()) raw = safe("resolution.resolveAt", () => window.DC.resolution.resolveAt(t), null);
    if (!raw || typeof raw !== "object") raw = localResolveAt(t);
    const clusters = toMap(raw.clusters);
    const repOf = toMap(raw.repOf);
    clusters.forEach((ids, rep) => (ids || []).forEach(id => { if (!repOf.has(id)) repOf.set(id, rep); }));
    const merges = Array.isArray(raw.merges) ? raw.merges.filter(m => m && m.candidate) : [];
    const out = { clusters, repOf, merges, mergedIds: new Set(merges.map(m => m.candidate.id)) };
    resolveCache.clear();
    resolveCache.set(cacheKey, out);
    return out;
  }

  function repFor(res, id) { return res.repOf.get(id) || id; }

  function clusterOf(res, id) {
    const rep = repFor(res, id);
    const ids = res.clusters.get(rep);
    return Array.isArray(ids) && ids.length ? ids : [id];
  }

  let entityIndexKey = null;
  let entityIndex = new Map();
  function entityById(id) {
    if (entityIndexKey !== ui.datasetKey) {
      entityIndexKey = ui.datasetKey;
      entityIndex = new Map(getEntities().map(e => [e.id, e]));
    }
    return entityIndex.get(id) || null;
  }

  function persons() { return getEntities().filter(e => e.type === "Person"); }

  /** Count of Persons after merging at t (every Person not in a candidate stays on its own). */
  function personCountAt(res) {
    let absorbed = 0;
    res.clusters.forEach(ids => { absorbed += Math.max(0, (ids || []).filter(id => entityById(id)).length - 1); });
    return persons().length - absorbed;
  }

  function personName(id) {
    const e = entityById(id);
    if (!e) return { html: `<code>${esc(id)}</code>`, text: id, withheld: null };
    const v = visibleLabel(e);
    if (v.withheld) return { html: `<span class="withheld small">withheld — ${esc(v.withheld.join(", "))}</span>`, text: "", withheld: v.withheld };
    return { html: esc(v.text), text: v.text, withheld: null };
  }

  /** One-line description that helps tell namesakes apart (born, from), read through the role's redaction. */
  function personHint(id) {
    const e = entityById(id);
    if (!e) return "";
    const r = redact(e);
    if (objectWithheld(r)) return "";
    const p = r.properties || {};
    const bits = [];
    if (p.dob && !isWithheld(p.dob)) bits.push(`b. ${p.dob}`);
    if (p.nationality && !isWithheld(p.nationality)) bits.push(p.nationality);
    if (p.riskTag && !isWithheld(p.riskTag)) bits.push(`riskTag ${p.riskTag}`);
    return bits.join(" · ");
  }

  function personButton(id, opts) {
    const n = personName(id);
    const hint = opts && opts.hint === false ? "" : personHint(id);
    return `<button class="link-btn res-person" data-action="res-select" data-id="${esc(id)}" title="${esc(id)}">${n.html}</button>${hint ? ` <span class="text-muted res-hint">${hint.split(" · ").map(b => `<span class="nowrap">${esc(b)}</span>`).join(" · ")}</span>` : ""}`;
  }

  function fmtScore(x) { return (Math.round(x * 100) / 100).toFixed(2); }
  function fmtWeight(w) { return `${w < 0 ? "−" : "+"}${Math.abs(w).toFixed(2)}`; }

  function decisionOf(c, res, t) {
    const rejection = rejectionOf(c.id);
    if (rejection) return { id: "rejected", label: "rejected by override", rejection };
    if (res.mergedIds.has(c.id)) return { id: "merged", label: "merged" };
    if (repFor(res, c.left) === repFor(res, c.right) && res.repOf.has(c.left)) return { id: "indirect", label: "same person via another pair" };
    return { id: "separate", label: "separate" };
  }

  function canSeePair(c) {
    return !personName(c.left).withheld && !personName(c.right).withheld;
  }

  /** People whose resolved identity at t differs from the default threshold. */
  function changedIdentities(res, base) {
    const out = [];
    const seen = new Set();
    const ids = new Set([...res.repOf.keys(), ...base.repOf.keys()]);
    ids.forEach(id => {
      if (seen.has(id)) return;
      const now = clusterOf(res, id).slice().sort();
      const before = clusterOf(base, id).slice().sort();
      if (now.join("|") === before.join("|")) return;
      now.forEach(x => seen.add(x));
      out.push({ rep: repFor(res, id), members: now, before });
    });
    return out;
  }

  function signalArithmetic(c) {
    const sigs = candidateSignals(c);
    const sum = sigs.reduce((acc, s) => acc + (Number(s.weight) || 0), 0);
    const clamped = Math.min(1, Math.max(0, sum));
    const rows = sigs.map(s => `
      <tr class="${s.weight < 0 ? "neg" : ""}">
        <td class="text-mono res-w">${esc(fmtWeight(Number(s.weight) || 0))}</td>
        <td><code>${esc(s.id)}</code></td>
        <td>${esc(s.label || "")}${s.note ? ` <span class="text-muted">— ${esc(s.note)}</span>` : ""}</td>
      </tr>`).join("");
    const mismatch = typeof c.score === "number" && Math.abs(clamped - c.score) > 0.005;
    return `
      <table class="res-arith">
        <tbody>${rows}</tbody>
        <tfoot><tr><td class="text-mono res-w">= ${esc(fmtScore(typeof c.score === "number" ? c.score : clamped))}</td><td colspan="2">score${sum !== clamped ? ` <span class="text-muted">(sum ${esc(fmtScore(sum))}, clamped to 0–1)</span>` : ""}${mismatch ? ` <span class="text-amber">(seed score differs from the sum of weights: ${esc(fmtScore(clamped))})</span>` : ""}</td></tr></tfoot>
      </table>`;
  }

  function renderResolutionSidebar() {
    const r = resolutionBlock();
    const ids = [];
    const seen = new Set();
    (r ? r.candidates : []).slice().sort((a, b) => b.score - a.score).forEach(c => [c.left, c.right].forEach(id => { if (!seen.has(id)) { seen.add(id); ids.push(id); } }));
    return `
    <aside class="sidebar">
      <div class="sidebar-section-label">People in candidate pairs</div>
      <div class="sidebar-list">
        ${ids.map(id => {
          const n = personName(id);
          return `
          <div class="sidebar-item ${id === ui.selectedPersonId ? "active" : ""}" data-action="res-select" data-id="${esc(id)}" tabindex="0" role="button">
            <div style="flex:1;overflow:hidden;">
              <div class="item-name">${n.html}</div>
              <div class="item-meta" style="margin:0;">${esc(id)}</div>
            </div>
          </div>`;
        }).join("")}
        ${ids.length === 0 ? `<div class="empty-state" style="padding:16px;font-size:11px;">No candidate pairs</div>` : ""}
      </div>
    </aside>`;
  }

  function resolutionChip() {
    const chip = honestyChip("build.resolution");
    if (chip) return chip;
    // Seed without the honesty entry: same label, linked to the glossary's built-in copy.
    return `<a class="dc-honesty dc-honesty-simplified" href="../glossary.html#build.resolution" target="_blank" rel="noopener" title="Our scorer is a transparent weighted sum of a few signals; real entity resolution uses richer models, but also confidence scores and thresholds.">Simplified</a>`;
  }

  function renderResolutionMain() {
    const r = resolutionBlock();
    if (!r) {
      return `<div class="section-header"><div class="section-title">Entity resolution</div>${resolutionChip()}</div>
        <div class="empty-state"><div>This seed carries no resolution block.</div></div>`;
    }
    const t = ui.resPreview != null ? ui.resPreview : currentThreshold();
    const def = defaultThreshold();
    return `
      <div class="section-header">
        <div class="section-title">Entity resolution</div>
        <div class="section-sub">${r.candidates.length} candidate pair${r.candidates.length === 1 ? "" : "s"} · ${persons().length} Persons from the pipeline</div>
        ${resolutionChip()}
      </div>
      <p class="res-lede">The pipeline merged source rows into Persons with deterministic rules (passport, phone, name and date of birth). It also scored pairs of <em>different</em> Persons that might be the same individual. Lower the threshold and the browser merges every pair that scores at or above it.</p>
      <div class="res-controls">
        <label for="res-threshold" class="res-label">Merge threshold</label>
        <input type="range" id="res-threshold" min="${esc(minThreshold())}" max="${MAX_THRESHOLD}" step="0.01" value="${esc(t)}"
               aria-valuetext="${esc(fmtScore(t))}" aria-describedby="res-threshold-help">
        <output id="res-threshold-value" for="res-threshold" class="res-value">${esc(fmtScore(t))}</output>
        <span class="res-presets" role="group" aria-label="Threshold presets">
          ${[0.55, 0.65, def].filter((v, i, a) => a.indexOf(v) === i).map(v => `<button class="mk-filter ${Math.abs(v - t) < 0.001 ? "active" : ""}" data-action="res-threshold" data-value="${esc(v)}">${esc(fmtScore(v))}${v === def ? " (default)" : ""}</button>`).join("")}
        </span>
        ${hasResolutionCore() ? `<span class="text-muted res-shared" id="res-threshold-help">Shared with Investigate; every change is logged.</span>`
          : `<span class="text-amber res-shared" id="res-threshold-help">core/resolution.js is not loaded: this threshold applies to this page only and is not logged.</span>`}
      </div>
      <div id="res-results">${renderResolutionResults(t)}</div>
    `;
  }

  function renderResolutionResults(t) {
    const r = resolutionBlock();
    const def = defaultThreshold();
    const res = resolveAt(t);
    const base = resolveAt(def);
    const countNow = personCountAt(res);
    const countDef = personCountAt(base);
    const diff = countNow - countDef;
    const changed = changedIdentities(res, base);
    const rows = r.candidates.slice().sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)));

    return `
      ${t > def + 1e-9 ? `<div class="res-fixed-note" role="note"><strong>Above ${esc(fmtScore(def))} nothing splits.</strong> Merges made by the pipeline's deterministic rules are fixed in this build — see each person's resolution record (Lineage tab).</div>` : ""}
      <div class="res-stats" aria-live="polite">
        <span class="info-chip">Persons at <strong>${esc(fmtScore(t))}</strong>: <strong id="res-count">${countNow}</strong></span>
        <span class="info-chip">at default ${esc(fmtScore(def))}: <strong>${countDef}</strong></span>
        <span class="info-chip ${diff ? "text-amber" : ""}">difference: <strong>${diff > 0 ? "+" : ""}${diff}</strong></span>
        <span class="info-chip">merges below the default: <strong>${res.merges.length}</strong></span>
      </div>
      <div class="res-grid">
        <div class="res-left">
          <div class="section-title mb-8">People who changed identity at this threshold</div>
          ${changed.length ? `<ul class="res-changed">${changed.map(ch => {
            const others = ch.members.filter(id => id !== ch.rep);
            const rep = entityById(ch.rep);
            const repRedacted = rep ? redact(rep) : null;
            const tag = repRedacted && repRedacted.properties ? repRedacted.properties.riskTag : null;
            const inherits = tag && !isWithheld(tag) ? others.filter(id => { const e = entityById(id); return !(e && e.properties && e.properties.riskTag); }) : [];
            return `<li>
              ${others.map(personButton).join(", ")} <span class="text-muted">now merged into</span> ${personButton(ch.rep)}
              <span class="text-muted">(${ch.members.length} source identities)</span>
              ${inherits.length ? `<div class="res-inherit">${inherits.map(id => personName(id).html).join(", ")} inherits <code>riskTag: ${esc(tag)}</code> from the watchlisted member.</div>` : ""}
            </li>`;
          }).join("")}</ul>` : `<div class="text-muted mb-12">Nobody: at ${esc(fmtScore(t))} every Person is as the pipeline resolved them.</div>`}

          <div class="section-title mt-16 mb-8">Candidate pairs</div>
          <div class="scroll-x mb-12">
            <table class="data-table res-table">
              <thead><tr><th>Left</th><th>Right</th><th>Score</th><th>Signals (weights)</th><th>Decision at ${esc(fmtScore(t))}</th></tr></thead>
              <tbody>
                ${rows.map(c => {
                  const d = decisionOf(c, res, t);
                  const sel = ui.selectedPersonId && (c.left === ui.selectedPersonId || c.right === ui.selectedPersonId);
                  return `<tr class="res-row res-${d.id} ${sel ? "highlighted" : ""}" data-candidate="${esc(c.id)}">
                    <td>${personButton(c.left)}</td>
                    <td>${personButton(c.right)}</td>
                    <td class="text-mono res-score">${esc(fmtScore(c.score))}</td>
                    <td class="res-sigs">${candidateSignals(c).map(s => `<span class="res-sig ${s.weight < 0 ? "neg" : ""}" title="${esc(s.label || s.id)}">${esc(s.id)} ${esc(fmtWeight(Number(s.weight) || 0))}</span>`).join(" ")}</td>
                    <td><span class="res-decision res-decision-${d.id}" data-decision="${esc(d.id)}">${esc(d.label)}</span>${d.rejection ? `<div class="text-muted res-override">by ${esc(roleLabel(d.rejection.by))}${d.rejection.reason ? `: “${esc(d.rejection.reason)}”` : ""}</div>` : ""}</td>
                  </tr>`;
                }).join("")}
                ${rows.length === 0 ? `<tr><td colspan="5" class="text-muted">No candidate pairs in this seed.</td></tr>` : ""}
              </tbody>
            </table>
          </div>

          <div class="section-title mt-16 mb-8">The scorer's weights</div>
          <p class="text-muted mb-8">Score = sum of the weights of the signals a pair shows, clamped to 0–1. The pipeline builder chose these numbers. Which one would you change, and who would pay for it?</p>
          <table class="data-table res-weights">
            <thead><tr><th>Signal</th><th>Weight</th><th>Meaning</th><th>Note</th></tr></thead>
            <tbody>
              ${signalDefs().map(s => `<tr class="${s.weight < 0 ? "neg" : ""}"><td><code>${esc(s.id)}</code></td><td class="text-mono res-w">${esc(fmtWeight(Number(s.weight) || 0))}</td><td>${esc(s.label || "")}</td><td class="text-muted">${esc(s.note || "")}</td></tr>`).join("")}
            </tbody>
          </table>
        </div>
        <div class="res-right">${renderMergeExplanation(t, res)}</div>
      </div>
    `;
  }

  /** The merge chain for a person: DC.resolution.explain when present, else the merged pairs of its cluster. */
  function explainChain(personId, res) {
    if (core("resolution", "explain")) {
      const list = safe("resolution.explain", () => window.DC.resolution.explain(personId), null);
      if (Array.isArray(list)) {
        return list.filter(x => x && x.candidate).map(x => {
          const c = typeof x.candidate === "string" ? (resolutionBlock().candidates.find(k => k.id === x.candidate) || { id: x.candidate }) : x.candidate;
          return Object.assign({}, c, { signals: x.signals || c.signals, score: typeof x.score === "number" ? x.score : c.score });
        });
      }
    }
    const members = new Set(clusterOf(res, personId));
    return res.merges.map(m => m.candidate).filter(c => members.has(c.left) || members.has(c.right));
  }

  function unmergeTarget(id) {
    return `../demo/index.html#object=${encodeURIComponent(id)}&dataset=${encodeURIComponent(ui.datasetKey)}`;
  }

  function unmergeActionType() {
    const roleId = currentRoleId();
    if (!core("actions", "applicable") || !core("actions", "applyAction")) return { type: null, allowed: false };
    const list = safe("actions.applicable", () => window.DC.actions.applicable("Person", roleId), null);
    const type = Array.isArray(list) ? list.find(a => a && a.id === "act-unmerge-person") : null;
    return { type: type || null, allowed: Boolean(type) };
  }

  function unmergeControls(c, rep) {
    const link = `<a class="link-btn" href="${esc(unmergeTarget(rep))}" target="_blank" data-action="res-unmerge-link" data-id="${esc(c.id)}">Unmerge in Investigate →</a>`;
    const { type } = unmergeActionType();
    if (!type) return `<div class="res-unmerge">${link}</div>`;
    const params = Array.isArray(type.parameters) ? type.parameters : [];
    const fields = params.filter(p => !/candidate/i.test(p.id)).map(p => {
      const fid = `res-param-${esc(c.id)}-${esc(p.id)}`;
      if (p.type === "boolean") return `<label class="res-param"><input type="checkbox" id="${fid}" data-param="${esc(p.id)}"> ${esc(p.label || p.id)}</label>`;
      if (p.type === "enum") return `<label class="res-param" for="${fid}">${esc(p.label || p.id)}<select id="${fid}" data-param="${esc(p.id)}">${(p.options || []).map(o => { const v = typeof o === "object" ? o.id || o.value : o; const l = typeof o === "object" ? o.label || v : o; return `<option value="${esc(v)}">${esc(l)}</option>`; }).join("")}</select></label>`;
      return `<label class="res-param" for="${fid}">${esc(p.label || p.id)}${p.required ? " *" : ""}<input type="text" id="${fid}" data-param="${esc(p.id)}" ${p.minLength ? `minlength="${esc(p.minLength)}"` : ""} placeholder="${p.minLength ? `at least ${esc(p.minLength)} characters` : ""}"></label>`;
    }).join("");
    return `
      <form class="res-unmerge" data-candidate="${esc(c.id)}" data-object="${esc(rep)}" onsubmit="return false">
        ${fields}
        <button type="button" class="mk-remove" data-action="res-unmerge" data-id="${esc(c.id)}" data-object="${esc(rep)}">Unmerge (Action: ${esc(type.label || "Unmerge person")})</button>
        <span class="text-muted">or</span> ${link}
      </form>`;
  }

  function renderMergeExplanation(t, res) {
    const id = ui.selectedPersonId;
    const head = `<div class="section-title mb-8">Merge explanation</div>`;
    if (!id || !entityById(id)) {
      return `<div class="res-explain">${head}<div class="text-muted">Select a person (a name in the table or the sidebar) to see which signals would merge them, and how the score adds up.</div></div>`;
    }
    const n = personName(id);
    if (n.withheld) {
      return `<div class="res-explain">${head}<div class="res-explain-title">${n.html} <span class="text-muted text-mono">${esc(id)}</span></div>${whyLine(n.withheld)}</div>`;
    }
    const cluster = clusterOf(res, id);
    const rep = repFor(res, id);
    const chain = cluster.length > 1 ? explainChain(id, res) : [];
    const r = resolutionBlock();
    const pairs = r.candidates.filter(c => c.left === id || c.right === id).sort((a, b) => b.score - a.score);
    const chainIds = new Set(chain.map(c => c.id));
    const others = pairs.filter(c => !chainIds.has(c.id));
    const pairCard = (c, merged) => {
      const d = decisionOf(c, res, t);
      const verdict = d.id === "rejected"
        ? `<span class="res-decision res-decision-rejected">rejected by override</span> <span class="text-muted">— kept apart at every threshold${d.rejection.by ? ` (by ${esc(roleLabel(d.rejection.by))}${d.rejection.ts ? `, ${esc(formatTs(d.rejection.ts))}` : ""})` : ""}</span>`
        : merged || d.id === "merged"
          ? `<span class="res-decision res-decision-merged">merged</span> <span class="text-muted">${esc(fmtScore(c.score))} ≥ ${esc(fmtScore(t))}</span>`
          : `<span class="res-decision res-decision-separate">separate</span> <span class="text-muted">${esc(fmtScore(c.score))} &lt; ${esc(fmtScore(t))}; would merge at ${esc(fmtScore(c.score))} or lower</span>`;
      return `
        <div class="res-pair" data-candidate="${esc(c.id)}">
          <div class="res-pair-head">${personButton(c.left, { hint: false })} <span class="text-muted">↔</span> ${personButton(c.right, { hint: false })} <span class="text-mono text-muted">${esc(c.id)}${c.block ? ` · block ${esc(c.block)}` : ""}</span></div>
          ${signalArithmetic(c)}
          <div class="res-verdict">${verdict}</div>
          ${c.explanation && canSeePair(c) ? `<div class="res-expl-text">${esc(c.explanation)}</div>` : ""}
          ${(merged || d.id === "merged") && d.id !== "rejected" ? unmergeControls(c, rep) : ""}
        </div>`;
    };
    return `
      <div class="res-explain" aria-live="polite">
        ${head}
        <div class="res-explain-title">${n.html} <span class="text-muted text-mono">${esc(id)}</span></div>
        <div class="res-explain-status">${cluster.length > 1
          ? `At ${esc(fmtScore(t))} this is one of <strong>${cluster.length}</strong> source identities merged into ${rep === id ? "this person (the cluster representative)" : personButton(rep)}.`
          : `At ${esc(fmtScore(t))} this is a separate Person.`}</div>
        ${chain.length ? `<div class="res-sub">Merge chain</div>${chain.map(c => pairCard(c, true)).join("")}` : ""}
        ${others.length ? `<div class="res-sub">${chain.length ? "Other candidate pairs" : "Candidate pairs involving this person"}</div>${others.map(c => pairCard(c, false)).join("")}` : ""}
        ${!pairs.length && !chain.length ? `<div class="text-muted">No candidate pairs involve this person.</div>` : ""}
      </div>`;
  }

  /** Refresh only the results under the slider (keeps the slider element during a drag). */
  function previewThreshold(t) {
    ui.resPreview = t;
    const out = el("res-threshold-value");
    if (out) out.textContent = fmtScore(t);
    const host = el("res-results");
    if (host) host.innerHTML = renderResolutionResults(t);
  }

  function commitThreshold(t) {
    ui.resPreview = null;
    const before = currentThreshold();
    setThreshold(t);
    if (!hasResolutionCore() && roundT(before) !== roundT(t)) {
      logEvent({ kind: "resolution", verb: "resolution.threshold.local", payload: { from: before, to: roundT(t), shared: false } });
    }
    render();
  }

  async function runUnmerge(candidateId, objectId) {
    const { type } = unmergeActionType();
    if (!type) return;
    const form = document.querySelector(`form.res-unmerge[data-candidate="${CSS.escape(candidateId)}"]`);
    const params = {};
    (type.parameters || []).forEach(p => {
      if (/candidate/i.test(p.id)) { params[p.id] = candidateId; return; }
      const input = form ? form.querySelector(`[data-param="${CSS.escape(p.id)}"]`) : null;
      if (!input) return;
      params[p.id] = p.type === "boolean" ? input.checked : input.value;
    });
    if (!("candidateId" in params)) params.candidateId = candidateId;
    let result = null;
    try {
      // The override lives in shared governance, so Build has no data of its own to change.
      result = await window.DC.actions.applyAction("act-unmerge-person", objectId, params, { staged: false, apply: () => {} });
    } catch (error) {
      console.warn("[build] unmerge did not complete", error);
    }
    const outcome = result && typeof result === "object" ? (result.outcome || result.status || (result.ok === false ? "failed" : "")) : "";
    const failed = !result || result.ok === false || result.allowed === false || /refus|cancel|block|busy|invalid|fail|denied/i.test(String(outcome));
    overridesMemo = null; // the Action may just have written the override
    if (!failed && !rejectionOf(candidateId) && core("resolution", "reject")) {
      const reason = Object.keys(params).filter(k => k !== "candidateId").map(k => params[k]).find(v => typeof v === "string" && v) || "Unmerged from Build";
      safe("resolution.reject", () => window.DC.resolution.reject(candidateId, reason), null);
    }
    render();
    refreshAuditStrip();
  }

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
      slider.addEventListener("input", function () { previewThreshold(parseFloat(this.value)); });
      slider.addEventListener("change", function () { commitThreshold(parseFloat(this.value)); });
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
    } else if (action === "page-prev") {
      ui.datasetRowOffset = Math.max(0, ui.datasetRowOffset - PAGE_SIZE);
      saveUiState();
      render();
    } else if (action === "page-next") {
      const ds = getDataset(ui.selectedDatasetId);
      const maxOffset = ds ? Math.max(0, (ds.sampleRows || []).length - PAGE_SIZE) : 0;
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
    if (core("purposes", "init")) safe("purposes.init", () => window.DC.purposes.init(Array.isArray(gov.purposeRules) ? gov.purposeRules : []), null);
    const block = resolutionBlock();
    if (block && core("resolution", "init")) safe("resolution.init", () => window.DC.resolution.init(block), null);
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
      resizeTimer = setTimeout(() => { if (ui.activeTab === "markings") drawMarkingEdges(); }, 80);
    });

    logEvent({ kind: "view", verb: "tab.view", payload: { tab: ui.activeTab, dataset: ui.datasetKey, initial: true } });
  }

  init();
})();
