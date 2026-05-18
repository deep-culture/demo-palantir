(function () {
  "use strict";

  const STORAGE_KEY_PREFIX = "foundry-studio-demo-v1";
  const PAGE_SIZE = 10;

  // ------------------------------------------------------------------ helpers
  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

  function storageKey(datasetKey) {
    return `${STORAGE_KEY_PREFIX}:${datasetKey}`;
  }

  function loadUiState(datasetKey) {
    try {
      const raw = localStorage.getItem(storageKey(datasetKey));
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return {};
  }

  function saveUiState() {
    try {
      const toSave = {
        activeTab: ui.activeTab,
        selectedTransformId: ui.selectedTransformId,
        selectedDatasetId: ui.selectedDatasetId,
        selectedEntityId: ui.selectedEntityId,
        lineageEntitySearch: ui.lineageEntitySearch,
        datasetRowOffset: ui.datasetRowOffset,
      };
      localStorage.setItem(storageKey(ui.datasetKey), JSON.stringify(toSave));
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
    highlightDatasetRow: null,   // { datasetId, rowIndex }
  };

  // Restore persisted ui for default dataset
  Object.assign(ui, loadUiState(ui.datasetKey));
  ui.datasetKey = datasetKeys.includes("starter") ? "starter" : datasetKeys[0];

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

  // ------------------------------------------------------------------ render root
  function render() {
    const root = document.getElementById("app");
    if (!root) return;

    const active = document.activeElement;
    const activeId = active && active.id ? active.id : null;
    const selStart = active && typeof active.selectionStart === "number" ? active.selectionStart : null;
    const selEnd = active && typeof active.selectionEnd === "number" ? active.selectionEnd : null;

    root.innerHTML = renderApp();
    attachHandlers();

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

  function renderApp() {
    return `
      ${renderHeader()}
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
    const datasets = getDatasets().filter(d => !d.producedBy);  // raw sources

    return `
    <header class="app-header">
      <a class="header-back-link" href="../index.html" title="Back to all demos and docs">← All demos</a>
      <div class="app-title">Foundry <span>Studio</span> Demo</div>
      <div class="dataset-switcher">
        ${datasetKeys.map(k => `
          <button data-action="switch-dataset" data-key="${esc(k)}"
                  class="${k === ui.datasetKey ? "active" : ""}">
            ${esc(k.toUpperCase())}
          </button>
        `).join("")}
      </div>
      <div class="header-stats">
        <span><span class="stat-val">${entities.length}</span> entities</span>
        <span><span class="stat-val">${edges.length}</span> edges</span>
        <span><span class="stat-val">${getDatasets().length}</span> datasets</span>
      </div>
    </header>`;
  }

  // ------------------------------------------------------------------ tab bar
  const TABS = { pipelines: "Pipelines", datasets: "Datasets", lineage: "Lineage" };

  function renderTabBar() {
    return `
    <nav class="tab-bar">
      ${Object.entries(TABS).map(([id, label]) => `
        <button class="${id === ui.activeTab ? "active" : ""}"
                data-action="switch-tab" data-tab="${id}">
          ${esc(label)}
        </button>
      `).join("")}
    </nav>`;
  }

  // ------------------------------------------------------------------ sidebar
  function renderSidebar() {
    if (ui.activeTab === "pipelines") return renderPipelinesSidebar();
    if (ui.activeTab === "datasets") return renderDatasetsSidebar();
    if (ui.activeTab === "lineage") return renderLineageSidebar();
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
               data-action="select-transform" data-id="${esc(t.id)}">
            <div class="item-name">${esc(t.name)}</div>
            <div class="item-meta">${t.rowsOut != null ? t.rowsOut.toLocaleString() : "—"}</div>
          </div>
        `).join("")}
      </div>
    </aside>`;
  }

  function renderDatasetsSidebar() {
    const datasets = getDatasets();
    const raw = datasets.filter(d => !d.producedBy);
    const norm = datasets.filter(d => d.producedBy === "normalize_sources");
    const resolved = datasets.filter(d =>
      ["resolve_persons", "resolve_companies", "resolve_accounts"].includes(d.producedBy)
    );
    const final = datasets.filter(d => d.producedBy === "build_ontology");

    function renderGroup(label, items) {
      if (!items.length) return "";
      return `
        <div class="sidebar-group-label">${esc(label)}</div>
        ${items.map(d => `
          <div class="sidebar-item ${d.id === ui.selectedDatasetId ? "active" : ""}"
               data-action="select-dataset" data-id="${esc(d.id)}">
            <div class="item-name">${esc(d.name)}</div>
            <div class="item-meta">${(d.rowCount || 0).toLocaleString()}</div>
          </div>
        `).join("")}
      `;
    }

    return `
    <aside class="sidebar">
      <div class="sidebar-section-label">Datasets</div>
      <div class="sidebar-list">
        ${renderGroup("Raw Sources", raw)}
        ${renderGroup("Normalized", norm)}
        ${renderGroup("Resolved", resolved)}
        ${renderGroup("Final", final)}
      </div>
    </aside>`;
  }

  function renderLineageSidebar() {
    const entities = getEntities();
    const search = ui.lineageEntitySearch.toLowerCase();
    const filtered = search
      ? entities.filter(e =>
          (e.label || "").toLowerCase().includes(search) ||
          (e.id || "").toLowerCase().includes(search)
        ).slice(0, 40)
      : entities.slice(0, 40);

    return `
    <aside class="sidebar">
      <div class="sidebar-section-label">Entity Lineage</div>
      <div style="padding:8px 12px; border-bottom:1px solid var(--border);">
        <input class="search-input" id="lineage-search"
               placeholder="Search entities…"
               value="${esc(ui.lineageEntitySearch)}"
               data-action="lineage-search">
      </div>
      <div class="sidebar-list">
        ${filtered.map(e => `
          <div class="sidebar-item ${e.id === ui.selectedEntityId ? "active" : ""}"
               data-action="select-entity" data-id="${esc(e.id)}">
            <div style="flex:1;overflow:hidden;">
              <div class="item-name">${esc(e.label || e.id)}</div>
              <div class="item-meta" style="margin:0;">${esc(e.type)}</div>
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
    return "";
  }

  // ------------------------------------------------------------------ pipelines tab
  function renderPipelinesMain() {
    const transforms = getTransforms();
    const datasets = getDatasets();

    // Build a set of dataset IDs used as inputs or outputs
    const rawInputIds = new Set();
    const outputIds = new Set();
    transforms.forEach(t => {
      (t.inputs || []).forEach(id => rawInputIds.add(id));
      if (t.output) outputIds.add(t.output);
    });

    // Collect unique raw source datasets (appear only as inputs, never as outputs of another transform)
    const rawSources = Array.from(rawInputIds).filter(id => !outputIds.has(id));

    return `
      <div class="section-header">
        <div class="section-title">Pipeline DAG</div>
        <div class="section-sub">${transforms.length} transforms</div>
      </div>
      ${renderDag(transforms, rawSources)}
      <div class="mt-12 text-muted text-mono" style="font-size:11px;">
        Click a transform to inspect it in the panel below.
      </div>
    `;
  }

  function renderDag(transforms, rawSources) {
    // Layout: raw inputs → transform → intermediate outputs → next transform …
    // We'll do a simple left-to-right flow: col 0 = raw, then alternating transform/output columns.

    // Gather all unique intermediate + final dataset IDs from transform outputs
    const outputDatasetIds = transforms.map(t => t.output).filter(Boolean);

    // Build columns: [rawSources, transforms[0], output[0], transforms[1], output[1], ...]
    // But since transforms fan-in from multiple sources, we do:
    // Left column: raw sources
    // Then for each transform: arrow → transform box → arrow → output box

    const rawCols = rawSources.length > 0 ? `
      <div class="dag-column">
        <div class="dag-column-label">Raw Sources</div>
        ${rawSources.map(id => {
          const ds = getDataset(id) || {};
          return `
          <div class="dag-box" data-action="select-dataset" data-id="${esc(id)}" title="${esc(id)}">
            <div class="box-type">source</div>
            <div class="box-name">${esc(ds.name || id)}</div>
            <div class="box-count">${(ds.rowCount || 0).toLocaleString()} rows</div>
          </div>`;
        }).join("")}
      </div>
    ` : "";

    const transformCols = transforms.map((t, i) => {
      const outDs = getDataset(t.output) || {};
      const isSelected = t.id === ui.selectedTransformId;
      return `
        <div class="dag-arrow-col" title=""><div class="dag-arrow">→</div></div>
        <div class="dag-column">
          ${i === 0 ? `<div class="dag-column-label">Transform</div>` : `<div class="dag-column-label">&nbsp;</div>`}
          <div class="dag-box transform ${isSelected ? "selected" : ""}"
               data-action="select-transform" data-id="${esc(t.id)}">
            <div class="box-type">transform</div>
            <div class="box-name">${esc(t.name)}</div>
            <div class="box-count">${(t.rowsOut || 0).toLocaleString()} out</div>
          </div>
        </div>
        <div class="dag-arrow-col"><div class="dag-arrow">→</div></div>
        <div class="dag-column">
          ${i === 0 ? `<div class="dag-column-label">Output</div>` : `<div class="dag-column-label">&nbsp;</div>`}
          <div class="dag-box" data-action="select-dataset" data-id="${esc(t.output || "")}"
               title="${esc(t.output || "")}">
            <div class="box-type">dataset</div>
            <div class="box-name">${esc(outDs.name || t.output || "")}</div>
            <div class="box-count">${(outDs.rowCount || 0).toLocaleString()} rows</div>
          </div>
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
    return `
    <div class="inspector">
      <div class="inspector-header">
        <div class="inspector-title">Inspector — select a transform or dataset</div>
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
      return `<button class="link-btn" data-action="goto-dataset" data-id="${esc(id)}">${esc(ds.name || id)}</button>`;
    }).join(", ");

    const outDs = getDataset(t.output) || {};
    const outLink = t.output
      ? `<button class="link-btn" data-action="goto-dataset" data-id="${esc(t.output)}">${esc(outDs.name || t.output)}</button>`
      : "—";

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
        <div class="code-block">
          <pre>${lineHtml}</pre>
        </div>
      </div>
    </div>`;
  }

  // ------------------------------------------------------------------ datasets tab
  function renderDatasetsMain() {
    const ds = ui.selectedDatasetId ? getDataset(ui.selectedDatasetId) : null;
    if (!ds) {
      return `<div class="empty-state">
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

    return `
      <div class="section-header">
        <div class="section-title">${esc(ds.name)}</div>
        <div class="section-sub">${esc(ds.id)}</div>
      </div>
      <div class="info-row">
        <span class="info-chip">Rows: <strong>${totalRows.toLocaleString()}</strong></span>
        ${ds.sourceFile ? `<span class="info-chip">Source: <span class="text-mono text-muted">${esc(ds.sourceFile)}</span></span>` : ""}
        ${ds.producedBy ? `<span class="info-chip">Produced by: <button class="link-btn" data-action="goto-transform" data-id="${esc(ds.producedBy)}">${esc(ds.producedBy)}</button></span>` : ""}
        ${(ds.consumedBy || []).length ? `<span class="info-chip">Consumed by: ${(ds.consumedBy || []).map(id => `<button class="link-btn" data-action="goto-transform" data-id="${esc(id)}">${esc(id)}</button>`).join(", ")}</span>` : ""}
      </div>

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
        <div class="section-sub">showing ${offset + 1}–${Math.min(offset + PAGE_SIZE, totalSample)} of ${totalSample} sampled (${totalRows.toLocaleString()} total)</div>
      </div>
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
      </div>
    `;
  }

  function renderCellValue(val) {
    if (val == null) return "";
    if (typeof val === "object") return JSON.stringify(val);
    return String(val);
  }

  // ------------------------------------------------------------------ lineage tab
  function renderLineageMain() {
    const eid = ui.selectedEntityId;
    if (!eid) {
      return `<div class="empty-state">
        <div class="empty-icon">⬡</div>
        <div>Search and select an entity in the sidebar to view its lineage</div>
      </div>`;
    }

    const entities = getEntities();
    const entity = entities.find(e => e.id === eid);
    if (!entity) {
      return `<div class="empty-state"><div>Entity not found: ${esc(eid)}</div></div>`;
    }

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

    // Per-field provenance table rows
    const props = entity.properties || {};
    const fieldProvRows = [];
    const allFields = new Set([...Object.keys(props), ...Object.keys(fieldProv)]);
    allFields.forEach(field => {
      const val = props[field];
      const refs = fieldProv[field] || [];
      refs.forEach(ref => {
        fieldProvRows.push({ field, val, ref });
      });
      if (!refs.length && val !== undefined && val !== null && val !== "") {
        fieldProvRows.push({ field, val, ref: null });
      }
    });

    const label = entity.label || "";
    const crossLink = `<a href="../demo/index.html" target="_blank" class="link-btn" style="font-size:12px;">
      View ${esc(label)} in Gotham demo →
    </a>`;

    return `
      <div class="section-header">
        <div class="section-title">${esc(label)}</div>
        <div class="section-sub"><span class="entity-type">${esc(entity.type)}</span> &nbsp; ${esc(eid)}</div>
      </div>

      <div class="section-title mb-8">Entity properties</div>
      <table class="prop-table mb-12">
        <tbody>
          <tr><td>id</td><td>${esc(eid)}</td></tr>
          <tr><td>type</td><td>${esc(entity.type)}</td></tr>
          ${Object.entries(props).map(([k, v]) => `
            <tr><td>${esc(k)}</td><td>${esc(typeof v === "object" ? JSON.stringify(v) : v)}</td></tr>
          `).join("")}
        </tbody>
      </table>

      <div class="section-title mb-8">Upstream source rows</div>
      <div class="lineage-tree mb-12">
        <div class="tree-node">
          <span class="tree-icon">◈</span>
          <span class="tree-label">${esc(label)}</span>
          <span class="tree-meta">&nbsp;— ${esc(entity.type)}</span>
        </div>
        <div class="tree-children">
          <div class="tree-node">
            <span class="tree-icon">⬡</span>
            <span class="tree-label">
              ${lineage.producedBy
                ? `<button class="link-btn" data-action="goto-transform" data-id="${esc(lineage.producedBy)}">${esc(producedByTransform.name || lineage.producedBy)}</button>`
                : "<span class='text-muted'>unknown transform</span>"
              }
            </span>
            <span class="tree-meta">&nbsp;transform</span>
          </div>
          <div class="tree-children">
            ${Object.entries(byDataset).map(([dsName, refs]) => {
              const dsObj = getDatasets().find(d => d.id === dsName || d.name === dsName) || {};
              const rowNums = [...new Set(refs.map(r => r.row))].sort((a, b) => a - b);
              return `
                <div class="tree-node">
                  <span class="tree-icon">▤</span>
                  <span class="tree-label">
                    <button class="link-btn" data-action="goto-dataset" data-id="${esc(dsObj.id || dsName)}">${esc(dsObj.name || dsName)}</button>
                  </span>
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
              const dsObj = ref ? (getDatasets().find(d => d.id === ref.dataset || d.name === ref.dataset) || {}) : {};
              const rowIdx = ref ? ref.row : null;
              return `<tr class="${ref ? "clickable" : ""}"
                          ${ref ? `data-action="goto-dataset-row" data-id="${esc(dsObj.id || ref.dataset || "")}" data-row="${rowIdx}"` : ""}>
                <td>${esc(field)}</td>
                <td>${esc(typeof val === "object" ? JSON.stringify(val) : val)}</td>
                <td>${ref ? `<button class="link-btn" data-action="goto-dataset" data-id="${esc(dsObj.id || ref.dataset || "")}">${esc(dsObj.name || ref.dataset || "")}</button>` : ""}</td>
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

  // ------------------------------------------------------------------ event delegation
  function attachHandlers() {
    const root = document.getElementById("app");
    if (!root) return;

    // Tab switches, dataset switches, etc. via delegation
    root.addEventListener("click", function (e) {
      const target = e.target.closest("[data-action]");
      if (!target) return;
      const action = target.dataset.action;
      dispatch(action, target.dataset, e);
    });

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

  function dispatch(action, data, e) {
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
        saveUiState();
        render();
      }
    } else if (action === "switch-tab") {
      ui.activeTab = data.tab;
      saveUiState();
      render();
    } else if (action === "select-transform") {
      ui.selectedTransformId = data.id;
      saveUiState();
      render();
    } else if (action === "select-dataset") {
      ui.activeTab = "datasets";
      ui.selectedDatasetId = data.id;
      ui.datasetRowOffset = 0;
      ui.highlightDatasetRow = null;
      saveUiState();
      render();
    } else if (action === "select-entity") {
      ui.selectedEntityId = data.id;
      saveUiState();
      render();
    } else if (action === "goto-transform") {
      ui.activeTab = "pipelines";
      ui.selectedTransformId = data.id;
      saveUiState();
      render();
    } else if (action === "goto-dataset") {
      ui.activeTab = "datasets";
      ui.selectedDatasetId = data.id;
      ui.datasetRowOffset = 0;
      ui.highlightDatasetRow = null;
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
    } else if (action === "lineage-search") {
      // handled by input event listener
    }
  }

  // ------------------------------------------------------------------ init
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
    render();
  }

  init();
})();
