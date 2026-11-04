// demo/js/render/link-types.js — Link types tab.
import { escapeHtml } from "../util.js";
import { data, ui } from "../state.js";
import { entityLabel, relationshipById } from "../derive.js";
import { honestyChip, renderField, renderSelect } from "./common.js";

export function renderRelationshipsTool() {
  const selected = relationshipById(ui.selectedRelationshipId);
  if (!selected) {
    return `<div class="panel"><div class="empty-state">No relationship types available.</div></div>`;
  }
  const typeOptions = (data.ontology?.entityTypes || []).map((entityType) => entityType.id);
  return `
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2>Link types${honestyChip("inv.link-types")}</h2>
            <p class="microcopy">Adjust how object types connect and see the graph explorer update live.</p>
          </div>
          <button class="button-primary" data-action="add-relationship">Add link type</button>
        </div>
        <div class="editor-grid">
          <div class="sidebar-list">
            ${(data.ontology?.relationshipTypes || [])
            .map(
              (relationship) => `
                  <button class="list-item ${relationship.id === ui.selectedRelationshipId ? "active" : ""}" data-action="select-relationship" data-id="${escapeHtml(relationship.id)}">
                    <div class="list-item-title">
                      <span><span class="swatch" style="background:${escapeHtml(relationship.color)}"></span>${escapeHtml(relationship.label)}</span>
                      <span class="muted">${(data.edges || []).filter((edge) => edge.type === relationship.id).length}</span>
                    </div>
                    <small>${escapeHtml(`${relationship.sourceType} -> ${relationship.targetType}`)}</small>
                  </button>
                `
            )
            .join("")}
          </div>
          <div class="card-stack">
            <div class="property-card">
              <div class="form-grid">
                ${renderField("Link type ID", selected.id, { disabled: true })}
                ${renderField("Label", selected.label, { scope: "relationship", field: "label" })}
                ${renderSelect("Source type", selected.sourceType, typeOptions, { scope: "relationship", field: "sourceType" })}
                ${renderSelect("Target type", selected.targetType, typeOptions, { scope: "relationship", field: "targetType" })}
                ${renderField("Color", selected.color, { scope: "relationship", field: "color", type: "color" })}
                ${renderField("Link count", String((data.edges || []).filter((edge) => edge.type === selected.id).length), { disabled: true })}
              </div>
              <div class="field">
                <label>Description</label>
                <textarea data-scope="relationship" data-field="description">${escapeHtml(selected.description || "")}</textarea>
              </div>
              <div class="inline-actions">
                <button class="button-danger" data-action="delete-relationship" data-id="${escapeHtml(selected.id)}">Delete link type</button>
              </div>
            </div>
            <div class="stat-card">
              <h3>Example links</h3>
              <div class="table-shell">
                <table>
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Target</th>
                      <th>Properties</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${(data.edges || [])
                    .filter((edge) => edge.type === selected.id)
                    .slice(0, 8)
                    .map(
                      (edge) => `
                          <tr>
                            <td>${escapeHtml(entityLabel(edge.source))}</td>
                            <td>${escapeHtml(entityLabel(edge.target))}</td>
                            <td>${escapeHtml(JSON.stringify(edge.properties || {}))}</td>
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
