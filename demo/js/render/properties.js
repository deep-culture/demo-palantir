// demo/js/render/properties.js — Properties tab.
import { escapeHtml } from "../util.js";
import { data, ui } from "../state.js";
import { entityTypeById } from "../derive.js";
import { honestyChip, renderField, renderSelect } from "./common.js";

export function renderPropertiesTool() {
  const selected = entityTypeById(ui.selectedEntityTypeId);
  if (!selected) {
    return `<div class="panel"><div class="empty-state">No entity type selected.</div></div>`;
  }
  return `
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2>Properties${honestyChip("inv.properties")}</h2>
            <p class="microcopy">Shape the fields each entity type exposes in the instance editor and graph detail views.</p>
          </div>
          <div class="actions">
            <select data-scope="properties" data-field="selectedTypeId">
              ${(data.ontology?.entityTypes || [])
              .map(
                (entityType) => `
                    <option value="${escapeHtml(entityType.id)}" ${entityType.id === ui.selectedEntityTypeId ? "selected" : ""}>
                      ${escapeHtml(entityType.name)}
                    </option>
                  `
              )
              .join("")}
            </select>
            <button class="button-primary" data-action="add-property" data-type-id="${escapeHtml(selected.id)}">Add property</button>
          </div>
        </div>
        <div class="card-stack">
          ${(selected.properties || [])
          .map(
            (property) => `
                <div class="property-card">
                  <div class="form-grid">
                    ${renderField("Property ID", property.id, { scope: "property", propertyId: property.id, field: "id" })}
                    ${renderField("Label", property.label, { scope: "property", propertyId: property.id, field: "label" })}
                    ${renderSelect("Type", property.type, ["string", "number", "date", "datetime"], { scope: "property", propertyId: property.id, field: "type" })}
                    ${renderSelect("Required", String(Boolean(property.required)), ["true", "false"], { scope: "property", propertyId: property.id, field: "required" })}
                  </div>
                  <div class="field">
                    <label>Description</label>
                    <textarea data-scope="property" data-property-id="${escapeHtml(property.id)}" data-field="description">${escapeHtml(property.description || "")}</textarea>
                  </div>
                  <div class="inline-actions">
                    <button class="button-danger" data-action="delete-property" data-type-id="${escapeHtml(selected.id)}" data-property-id="${escapeHtml(property.id)}">Delete property</button>
                  </div>
                </div>
              `
          )
          .join("")}
        </div>
      </div>
    `;
}
