// demo/js/render/header.js — Header (dataset selector, counts, withheld chip) and tab bar.
import { escapeHtml } from "../util.js";
import { renderThresholdChip } from "./resolution.js";
import {
  ANALYST_TOOLS,
  APP_TITLE,
  SCHEMA_TOOLS,
  data,
  datasetCatalog,
  datasetKeys,
  roleView,
  ui,
} from "../state.js";

export function renderHeader() {
  const metadata = data.metadata || {};
  const datasetLabels = datasetKeys.map((datasetKey) => {
    const seed = datasetCatalog[datasetKey];
    return {
      key: datasetKey,
      label: seed?.metadata?.dataset ? String(seed.metadata.dataset).toUpperCase() : datasetKey.toUpperCase(),
    };
  });
  const counts = [
    `${data.ontology?.entityTypes?.length || 0} object types`,
    `${data.ontology?.relationshipTypes?.length || 0} link types`,
    `${data.entities?.length || 0} objects`,
    `${data.edges?.length || 0} links`,
    `${data.mappings?.length || 0} backing-dataset mappings`,
  ];
  const withheldObjects = roleView.withheldEntities.length;
  const withheldLinks = roleView.withheldEdges.length;
  return `
      <header class="topbar dc-on-dark">
        <a href="../index.html" title="All demos and docs"><img class="dc-logo" src="../brand/logo-green-lines.png" alt="Deep Culture"></a>
        <div>
          <h1><span class="dc-highlight">${escapeHtml(APP_TITLE)}</span></h1>
          <p class="subtitle">${escapeHtml(metadata.description || "")}</p>
          <div class="chip-row">
            ${counts.map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join("")}
            ${withheldObjects || withheldLinks || roleView.redactedCount
            ? `<span class="chip chip-withheld" data-withheld-count="${withheldObjects}">${escapeHtml(
                `${withheldObjects} object${withheldObjects === 1 ? "" : "s"} and ${withheldLinks} link${withheldLinks === 1 ? "" : "s"} withheld from your role`
              )}${roleView.redactedCount ? escapeHtml(` · ${roleView.redactedCount} objects partly withheld`) : ""}</span>`
            : ""}
            ${renderThresholdChip()}
          </div>
        </div>
        <div class="actions">
          <a class="header-back-link" href="../index.html" title="Back to all demos and docs">← All demos</a>
          <div class="field header-field">
            <label>Dataset</label>
            <select data-scope="dataset" data-field="datasetKey">
              ${datasetLabels
              .map(
                (dataset) => `
                    <option value="${escapeHtml(dataset.key)}" ${dataset.key === ui.datasetKey ? "selected" : ""}>
                      ${escapeHtml(dataset.label)}
                    </option>
                  `
              )
              .join("")}
            </select>
          </div>
          <button class="walkthrough-launch-btn" data-action="start-walkthrough">▶ Guided tour</button>
          <button class="button-primary" data-action="export-json">Export JSON</button>
          <button class="button-secondary" data-action="reset-state">Reset dataset</button>
        </div>
      </header>
    `;
}

export function renderTabs() {
  const analystButtons = Object.entries(ANALYST_TOOLS)
    .map(
      ([toolId, label]) =>
        `<button class="tab-button analyst-tab ${ui.activeTool === toolId ? "active" : ""}" data-action="switch-tool" data-tool="${toolId}">${escapeHtml(label)}</button>`
    )
    .join("");
  const schemaButtons = Object.entries(SCHEMA_TOOLS)
    .map(
      ([toolId, label]) =>
        `<button class="tab-button ${ui.activeTool === toolId ? "active" : ""}" data-action="switch-tool" data-tool="${toolId}">${escapeHtml(label)}</button>`
    )
    .join("");
  return `
      <nav class="tool-tabs">
        <span class="tab-group-label">Analyst</span>
        <div class="tab-group">${analystButtons}</div>
        <div class="tab-divider"></div>
        <span class="tab-group-label">Schema</span>
        <div class="tab-group">${schemaButtons}</div>
      </nav>
    `;
}
