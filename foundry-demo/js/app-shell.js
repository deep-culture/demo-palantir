/*
 * foundry-demo/js/app-shell.js: Build (Foundry-style), render root, header, tab bar, sidebar, main content switch.
 *
 * One of the classic scripts that make up the Build app (split from the former 3,100-line app.js, review F-24).
 * They are loaded in order by foundry-demo/index.html and share one global script scope: top-level
 * functions, const and let declared in one file are visible in the others. Only app.js runs code at load
 * (init()); the other files only declare, apart from the UI state set up in js/app-state.js.
 */
"use strict";
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
  updateScrollCues();

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
  const { visible, total } = visibleCounts();
  const stat = (key, noun, title) => visible
    ? `<span data-stat="${key}" title="${esc(title)}"><span class="stat-val">${visible[key].toLocaleString()}</span> / ${total[key].toLocaleString()} ${noun}</span>`
    : `<span data-stat="${key}"><span class="stat-val">${total[key].toLocaleString()}</span> ${noun}</span>`;
  const who = esc(roleLabel(currentRoleId()));

  return `
  <header class="app-header">
    <a href="https://deep-culture.org/" title="Deep Culture project (opens in a new tab)" target="_blank" rel="noopener"><img class="dc-logo" src="../brand/logo-green-lines.png" alt="Deep Culture"></a>
    <div class="app-title"><span class="dc-highlight">Build (Foundry-style)</span></div>
    <a class="dc-home" href="../index.html#" title="Back to the home page"><span class="dc-home-icon" aria-hidden="true">⌂</span> Home</a>
    <div class="dataset-switcher" role="group" aria-label="Dataset">
      ${datasetKeys.map(k => `
        <button data-action="switch-dataset" data-key="${esc(k)}"
                class="${k === ui.datasetKey ? "active" : ""}" aria-pressed="${k === ui.datasetKey}">
          ${esc(k.toUpperCase())}
        </button>
      `).join("")}
    </div>
    <div class="header-stats" ${visible ? `aria-label="Counts visible to your role (${who}) out of the total"` : ""}>
      ${stat("objects", "objects", `Objects your role (${roleLabel(currentRoleId())}) can see, out of all objects in the seed`)}
      ${stat("links", "links", "Links your role can see (both ends and the link's own markings), out of all links")}
      ${stat("datasets", "datasets", "Datasets whose rows your role can open, out of all datasets")}
      ${visible ? `<span class="stat-note">visible / total</span>` : ""}
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
  const leads = datasets.filter(d => !final.includes(d) && isLeadsDataset(d));
  const placed = new Set([...raw, ...norm, ...resolved, ...final, ...leads].map(d => d.id));
  const other = datasets.filter(d => !placed.has(d.id));
  return [["Raw Sources", raw], ["Normalised", norm], ["Resolved", resolved], ["Final", final], ["Leads", leads], ["Other", other]];
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
  return { text: label || displayId(entity.id), withheld: null };
}

function renderLineageSidebar() {
  const entities = getEntities();
  const search = ui.lineageEntitySearch.toLowerCase();
  // Withheld objects match nothing (their IDs can embed an address); other IDs match as displayed.
  const match = ({ e, v }) => !search || (!v.withheld && (v.text.toLowerCase().includes(search) || displayId(e.id).toLowerCase().includes(search)));
  const objects = entities.map(e => ({ e, v: visibleLabel(e) })).filter(match).slice(0, 40);
  // Leads (Phase 3) are listed after the objects, so that every lead stays reachable.
  const leadItems = leadLineageItems().filter(match).slice(0, search ? 40 : 12);
  const item = ({ e, v }) => `
        <div class="sidebar-item ${e.id === ui.selectedEntityId ? "active" : ""}"
             data-action="select-entity" data-id="${esc(e.id)}" tabindex="0" role="button">
          <div style="flex:1;overflow:hidden;">
            <div class="item-name">${v.withheld ? `<span class="withheld small">withheld — ${esc(v.withheld.join(", "))}</span>` : esc(v.text)}</div>
            <div class="item-meta" style="margin:0;">${esc(e.type)}</div>
          </div>
        </div>`;
  const filtered = objects.concat(leadItems);

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
      ${objects.map(item).join("")}
      ${leadItems.length ? `<div class="sidebar-group-label">Leads</div>${leadItems.map(item).join("")}` : ""}
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
