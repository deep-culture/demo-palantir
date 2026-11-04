// demo/js/render/backing-datasets.js — Backing datasets tab.
import { escapeHtml } from "../util.js";
import { data, ui } from "../state.js";
import { mappingById } from "../derive.js";
import { honestyChip, renderField } from "./common.js";

export function renderMappingsTool() {
  const selected = mappingById(ui.selectedMappingId);
  if (!selected) {
    return `<div class="panel"><div class="empty-state">No mappings configured.</div></div>`;
  }
  return `
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2>Backing datasets${honestyChip("inv.backing-datasets")}</h2>
            <p class="microcopy">The datasets whose rows become objects, properties and links: how raw source columns map onto the ontology.</p>
          </div>
          <button class="button-primary" data-action="add-mapping">Add mapping</button>
        </div>
        <div class="mapping-grid">
          <div class="sidebar-list">
            ${(data.mappings || [])
            .map(
              (mapping) => `
                  <button class="list-item ${mapping.id === ui.selectedMappingId ? "active" : ""}" data-action="select-mapping" data-id="${escapeHtml(mapping.id)}">
                    <div class="list-item-title">
                      <span>${escapeHtml(mapping.sourceId)}</span>
                      <span class="muted">${escapeHtml(mapping.targetType || mapping.relationType || "")}</span>
                    </div>
                    <small>${escapeHtml(mapping.rule)}</small>
                  </button>
                `
            )
            .join("")}
          </div>
          <div class="card-stack">
            <div class="property-card">
              <div class="form-grid">
                ${renderField("Mapping ID", selected.id, { scope: "mapping", field: "id" })}
                ${renderField("Source ID", selected.sourceId, { scope: "mapping", field: "sourceId" })}
                ${renderField("Target type", selected.targetType || "", { scope: "mapping", field: "targetType" })}
                ${renderField("Target property", selected.targetProperty || "", { scope: "mapping", field: "targetProperty" })}
                ${renderField("Link type", selected.relationType || "", { scope: "mapping", field: "relationType" })}
                ${renderField("Source fields", selected.sourceFields || "", { scope: "mapping", field: "sourceFields" })}
              </div>
              <div class="field">
                <label>Rule</label>
                <textarea data-scope="mapping" data-field="rule">${escapeHtml(selected.rule || "")}</textarea>
              </div>
              <div class="inline-actions">
                <button class="button-danger" data-action="delete-mapping" data-id="${escapeHtml(selected.id)}">Delete mapping</button>
              </div>
            </div>
            <div class="stat-card">
              <h3>Source columns by file</h3>
              <div class="table-shell">
                <table>
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Columns</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${(data.sources || [])
                    .map(
                      (source) => `
                          <tr>
                            <td>${escapeHtml(source.id)}</td>
                            <td>${escapeHtml((source.fields || []).join(", "))}</td>
                          </tr>
                        `
                    )
                    .join("")}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
}
