// demo/js/render/object-types.js — Object types tab.
import { escapeHtml } from "../util.js";
import { data, roleView, ui } from "../state.js";
import { entityCount, entityTypeById } from "../derive.js";
import { honestyChip, renderField } from "./common.js";

export function renderEntityTypesTool() {
  const selected = entityTypeById(ui.selectedEntityTypeId);
  if (!selected) {
    return `<div class="panel"><div class="empty-state">No entity types available.</div></div>`;
  }
  return `
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2>Object types${honestyChip("inv.object-types")}</h2>
            <p class="microcopy">Define the object types students can work with.</p>
          </div>
          <button class="button-primary" data-action="add-entity-type">Add object type</button>
        </div>
        <div class="editor-grid">
          <div class="sidebar-list">
            ${(data.ontology?.entityTypes || [])
            .map(
              (entityType) => `
                  <button class="list-item ${entityType.id === ui.selectedEntityTypeId ? "active" : ""}" data-action="select-entity-type" data-id="${escapeHtml(entityType.id)}">
                    <div class="list-item-title">
                      <span><span class="swatch" style="background:${escapeHtml(entityType.color)}"></span>${escapeHtml(entityType.name)}</span>
                      <span class="muted">${entityCount(entityType.id)}${(roleView.withheldByType.get(entityType.id) || []).length ? ` <span class="withheld-count">+${(roleView.withheldByType.get(entityType.id) || []).length} withheld</span>` : ""}</span>
                    </div>
                    <small>${escapeHtml(entityType.description)}</small>
                  </button>
                `
            )
            .join("")}
          </div>
          <div class="card-stack">
            <div class="property-card">
              <div class="form-grid">
                ${renderField("Object type ID", selected.id, { disabled: true })}
                ${renderField("Display name", selected.name, { scope: "entity-type", field: "name" })}
                ${renderField("Color", selected.color, { scope: "entity-type", field: "color", type: "color" })}
                ${renderField("Instance count", String(entityCount(selected.id)), { disabled: true })}
              </div>
              <div class="field">
                <label>Description</label>
                <textarea data-scope="entity-type" data-field="description">${escapeHtml(selected.description || "")}</textarea>
              </div>
              <div class="inline-actions">
                <button class="button-danger" data-action="delete-entity-type" data-id="${escapeHtml(selected.id)}">Delete object type</button>
              </div>
            </div>
            <div class="stat-card">
              <h3>Properties on this object type</h3>
              <div class="table-shell">
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Label</th>
                      <th>Type</th>
                      <th>Required</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${(selected.properties || [])
                    .map(
                      (property) => `
                          <tr>
                            <td>${escapeHtml(property.id)}</td>
                            <td>${escapeHtml(property.label)}</td>
                            <td>${escapeHtml(property.type)}</td>
                            <td>${property.required ? "Yes" : "No"}</td>
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
