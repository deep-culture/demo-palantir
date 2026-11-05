// demo/js/render/objects.js — Objects tab: instance list, withheld rows, object editor, link editor.
import { escapeHtml } from "../util.js";
import { core, data, roleView, ui } from "../state.js";
import { isWithheldValue } from "../governance.js";
import {
  entitiesForType,
  entityById,
  entityLabel,
  entityTypeById,
  incomingEdges,
  outgoingEdges,
} from "../derive.js";
import { honestyChip, renderField } from "./common.js";
import { renderResolutionSection } from "./inspector.js";
import { mergeChip } from "./resolution.js";
import { displayId } from "../disclosure.js";
import { actionFor, isGoverned, isSourceRecord, renderEditorNotice } from "../editor.js";

export function renderInstancesTool() {
  const selectedType = entityTypeById(ui.selectedEntityTypeId);
  const selectedEntity = entityById(ui.selectedEntityId);
  const filteredEntities = entitiesForType(ui.selectedEntityTypeId);
  return `
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2>Objects${honestyChip("inv.objects")}</h2>
            <p class="microcopy">Edit concrete objects and the links that connect them. Withheld properties stay withheld here too.</p>
          </div>
          <div class="actions">
            <label class="sr-only" for="objects-type">Object type</label>
            <select id="objects-type" data-scope="instances" data-field="selectedTypeId">
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
            <button class="button-primary" data-action="add-entity" data-type-id="${escapeHtml(ui.selectedEntityTypeId)}">Add object</button>
          </div>
        </div>
        ${renderEditorNotice()}
        <div class="instance-grid">
          <div class="sidebar-list">
            ${renderWithheldTypeRow(ui.selectedEntityTypeId)}
            ${filteredEntities
            .map(
              (entity) => `
                  <button class="list-item ${entity.id === ui.selectedEntityId ? "active" : ""}" data-action="select-entity" data-id="${escapeHtml(entity.id)}">
                    <div class="list-item-title">
                      <span>${escapeHtml(entity.label)}</span>
                      <span class="muted">${escapeHtml(displayId(entity.id).split("::")[1] || displayId(entity.id))}</span>
                    </div>
                    <small>${escapeHtml(entity.type)}</small>${mergeChip(entity)}
                  </button>
                `
            )
            .join("")}
          </div>
          ${selectedEntity && selectedType ? renderEntityDetails(selectedEntity, selectedType) : `<div class="empty-state">${filteredEntities.length ? "Select an object to edit it." : "No objects of this type are visible to your role."}</div>`}
          ${selectedEntity ? renderEdgeEditor(selectedEntity) : `<div class="empty-state">Select an object to edit its links.</div>`}
        </div>
      </div>
    `;
}

export function renderWithheldTypeRow(typeId) {
  const hidden = roleView.withheldByType.get(typeId) || [];
  if (!hidden.length) return "";
  const markings = [...new Set(hidden.flatMap((item) => item._withheld))].sort();
  return `
      <div class="list-item withheld-list-item" data-withheld-type="${escapeHtml(typeId)}">
        <div class="list-item-title"><span>${escapeHtml(`${hidden.length} ${typeId} object${hidden.length === 1 ? "" : "s"} withheld from your role`)}</span></div>
        ${core.ui.withheldCell(markings)}
        ${core.ui.whyLine(markings, roleView.roleId)}
      </div>
    `;
}

export function renderEntityDetails(entity, entityType) {
  // Review F-14: a merged person is a view over several stored records; an edit would be written to the
  // representative only and copy another person's values onto it. Unmerge first.
  if (entity._merge) return renderMergedDetails(entity, entityType);
  return `
      <div class="card-stack">
        <div class="property-card">
          <div class="form-grid">
            ${renderField("Object ID", displayId(entity.id), { disabled: true })}
            ${renderField("Label", entity.label, { scope: "entity", entityId: entity.id, field: "label" })}
          </div>
          <h3 class="section-title">Properties</h3>
          <div class="detail-grid single">
            ${(entityType.properties || [])
            .map((property) =>
              isWithheldValue(entity.properties?.[property.id])
                ? `
                  <div class="field">
                    <label>${escapeHtml(property.label)}</label>
                    ${core.ui.withheldCell(entity.properties[property.id].withheld)}
                  </div>
                `
                : isGoverned(entity.type, property.id)
                  ? `
                  <div class="field governed-field" data-governed="${escapeHtml(property.id)}">
                    <label for="ed-${escapeHtml(property.id)}">${escapeHtml(property.label)} <span class="chip chip-governed">set by an Action</span></label>
                    <input id="ed-${escapeHtml(property.id)}" value="${escapeHtml(entity.properties?.[property.id] ?? "")}" readonly aria-readonly="true" data-entity-id="${escapeHtml(entity.id)}" data-field="${escapeHtml(property.id)}">
                    <div class="microcopy">Read-only here: changing it goes through the role check, Checkpoint, writeback and audit of an Action. ${
                      actionFor(entity.type, property.id) && entityById(entity.id)
                        ? `<button class="link-button" data-action="open-action-drawer" data-id="${escapeHtml(entity.id)}" data-type-id="${escapeHtml(actionFor(entity.type, property.id).id)}">Use the Action “${escapeHtml(actionFor(entity.type, property.id).label)}”</button>`
                        : "Use the Action."
                    }</div>
                  </div>
                `
                  : `
                  <div class="field">
                    <label for="ed-${escapeHtml(property.id)}">${escapeHtml(property.label)}</label>
                    <input
                      id="ed-${escapeHtml(property.id)}"
                      value="${escapeHtml(entity.properties?.[property.id] ?? "")}"
                      data-scope="entity-property"
                      data-entity-id="${escapeHtml(entity.id)}"
                      data-field="${escapeHtml(property.id)}"
                    >
                  </div>
                `
            )
            .join("")}
          </div>
          ${entity._withheldProps ? core.ui.whyLine([...new Set(entity._withheldProps.flatMap((id) => entity.properties[id].withheld))], roleView.roleId) : ""}
          ${renderResolutionSection(entity, "editor")}
          <div class="inline-actions">
            <button class="button-danger" data-action="delete-entity" data-id="${escapeHtml(entity.id)}"${isSourceRecord(entity) ? ` aria-describedby="del-note" title="Source records cannot be deleted in the editor"` : ""}>Delete object</button>
            ${isSourceRecord(entity) ? `<span class="microcopy" id="del-note">From ${escapeHtml((entity.sourceIds || [])[0] || "a source file")}: deleting is refused (and logged).</span>` : ""}
          </div>
        </div>
      </div>
    `;
}

function renderMergedDetails(entity, entityType) {
  return `
      <div class="card-stack">
        <div class="property-card merged-readonly" data-merged-readonly="true">
          <div class="form-grid">${renderField("Object ID", displayId(entity.id), { disabled: true })}${renderField("Label", entity.label, { disabled: true })}</div>
          <p class="editor-notice" role="note">This is a merged person (${escapeHtml(entity._merge.members.length)} source identities at threshold ${escapeHtml(Number(entity._merge.threshold).toFixed(2))}). Its values are combined from several records, so it cannot be edited here: unmerge first, or raise the threshold.</p>
          <div class="detail-grid single">
            ${(entityType.properties || [])
              .map((property) => `<div class="field"><label>${escapeHtml(property.label)}</label>${isWithheldValue(entity.properties?.[property.id]) ? core.ui.withheldCell(entity.properties[property.id].withheld) : `<input value="${escapeHtml(entity.properties?.[property.id] ?? "")}" readonly aria-label="${escapeHtml(property.label)}">`}</div>`)
              .join("")}
          </div>
          ${renderResolutionSection(entity, "editor")}
        </div>
      </div>`;
}

export function renderEdgeEditor(entity) {
  const outgoing = outgoingEdges(entity.id);
  const incoming = incomingEdges(entity.id);
  const availableRelationships = (data.ontology?.relationshipTypes || []).filter((relationship) => relationship.sourceType === entity.type);
  const defaultRelationship = availableRelationships[0];
  const allowedTargets = defaultRelationship
    ? (data.entities || []).filter((candidate) => candidate.type === defaultRelationship.targetType)
    : [];
  return `
      <div class="card-stack">
        <div class="property-card">
          <h3>Outgoing links</h3>
          <div class="table-shell">
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Target</th>
                  <th>Details</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${outgoing
                .map(
                  (edge) => `
                      <tr>
                        <td>${escapeHtml(edge.type)}</td>
                        <td>${escapeHtml(entityLabel(edge.target))}</td>
                        <td>${escapeHtml(JSON.stringify(edge.properties || {}))}</td>
                        <td><button class="ghost-button" data-action="delete-edge" data-id="${escapeHtml(edge.id)}">Remove</button></td>
                      </tr>
                    `
                )
                .join("")}
              </tbody>
            </table>
          </div>
          <h3 class="section-title">Add link</h3>
          <div class="detail-grid">
            <div class="field">
              <label for="new-edge-type">Link type</label>
              <select id="new-edge-type">
                ${availableRelationships
                .map(
                  (relationship) => `
                      <option value="${escapeHtml(relationship.id)}">${escapeHtml(relationship.label)}</option>
                    `
                )
                .join("")}
              </select>
            </div>
            <div class="field">
              <label for="new-edge-target">Target object</label>
              <select id="new-edge-target">
                ${allowedTargets
                .map(
                  (candidate) => `
                      <option value="${escapeHtml(candidate.id)}">${escapeHtml(`${candidate.label} (${candidate.type})`)}</option>
                    `
                )
                .join("")}
              </select>
            </div>
          </div>
          <div class="inline-actions">
            <button class="button-primary" data-action="create-edge" data-source-id="${escapeHtml(entity.id)}">Create link</button>
          </div>
        </div>
        <div class="property-card">
          <h3>Incoming links</h3>
          <div class="table-shell">
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Source</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                ${incoming
                .map(
                  (edge) => `
                      <tr>
                        <td>${escapeHtml(edge.type)}</td>
                        <td>${escapeHtml(entityLabel(edge.source))}</td>
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
    `;
}
