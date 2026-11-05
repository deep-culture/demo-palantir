// demo/js/editor.js — The ontology editor tabs (Object types, Properties, Link types, Backing datasets, Objects)
// under governance (fix round, contract §2 A3).
//
// - Governed properties (those an Action type sets: riskTag, reviewFlag, lead status, …) are read-only in
//   the editor, with a pointer to the Action. Typing a risk tag must not put someone on a watchlist
//   without the role check, Checkpoint, writeback and audit an Action has.
// - Objects that come from a source file (not created by an Action or in the editor) cannot be deleted
//   here, and neither can a type or property that would delete them; the refusal is explained and logged.
// - Every create, update and delete of an object, link, type, property or mapping is logged (kind "edit"),
//   and so is Reset dataset.
import { clone, slugify } from "./util.js";
import { roleView } from "./state.js";
import { core, data, datasetCatalog, fullData, persist, resetCopilotState, setFullData, setSeedData, storageKey, store, storedEntityById, ui } from "./state.js";
import { logEvent } from "./governance.js";
import { entityTypeById, mappingById, relationshipById } from "./derive.js";
import { render } from "./render/index.js";
import { addEntity, createEdge, deleteEntity, deleteEntityType, deleteProperty, deleteRelationship, persistAndRender, randomColor, updateProperty } from "./mutations.js";

// Properties an Action owns, per object type (fallback for seeds without action types).
const FALLBACK_GOVERNED = { Person: ["riskTag"], BankAccount: ["reviewFlag"], Lead: ["status"], WatchlistRecord: ["riskTag"] };

export function governedProperties(typeId) {
  const fromActions = core.actions && core.actions.governedProperties ? core.actions.governedProperties(typeId) : [];
  return [...new Set([...(FALLBACK_GOVERNED[typeId] || []), ...fromActions])];
}

export function isGoverned(typeId, propertyId) {
  return governedProperties(typeId).includes(propertyId);
}

// The Action type that sets a governed property on this type (for the "use the Action" link).
export function actionFor(typeId, propertyId) {
  if (!core.actions || !core.actions.forType) return null;
  return core.actions.forType(typeId).find((type) => (type.effects || []).some((effect) => effect.op === "setProperty" && effect.property === propertyId && effect.from !== "value:")) || null;
}

// From a source file (or the seed): neither created by an Action nor added in this editor.
export function isSourceRecord(entity) {
  if (!entity || entity.createdByAction) return false;
  const sources = (entity.sourceIds || []).filter(Boolean);
  return sources.length > 0 && sources.some((id) => id !== "manual-edit" && !String(id).startsWith("action:"));
}

function sourceName(entity) {
  return (entity.sourceIds || []).find((id) => id !== "manual-edit") || "the source data";
}

export function logEdit(verb, payload, objectIds) {
  return logEvent({ kind: "edit", verb, objectIds: objectIds || [], payload: payload || {} });
}

function refuse(message, verb, payload, objectIds) {
  ui.editorNotice = { kind: "refused", text: message };
  logEdit(verb, { ...(payload || {}), outcome: "refused", reason: message }, objectIds);
  render();
}

function done(verb, payload, objectIds) {
  ui.editorNotice = null;
  logEdit(verb, { ...(payload || {}), outcome: "applied" }, objectIds);
  persistAndRender();
}

// Field edits: the value before the first keystroke is remembered so the logged update has from → to.
const editOrigins = new Map();

export const EDITOR_CLICKS = {
  "add-entity-type"() {
    const name = `New Type ${data.ontology.entityTypes.length + 1}`;
    const newType = {
      id: slugify(name),
      name,
      description: "Describe what this entity type represents.",
      color: randomColor(data.ontology.entityTypes.length),
      properties: [{ id: "name", label: "Name", type: "string", required: true, description: "Primary display label." }],
    };
    data.ontology.entityTypes.push(newType);
    ui.selectedEntityTypeId = newType.id;
    done("editor.type.create", { typeId: newType.id });
  },

  "delete-entity-type"(target) {
    const typeId = target.dataset.id;
    const sourced = (fullData.entities || []).filter((entity) => entity.type === typeId && isSourceRecord(entity));
    if (sourced.length) {
      refuse(`${typeId} has ${sourced.length} object${sourced.length === 1 ? "" : "s"} from source files. Deleting the type would delete them; source records are not deleted in the editor.`, "editor.type.delete", { typeId });
      return;
    }
    deleteEntityType(typeId);
    done("editor.type.delete", { typeId });
  },

  "add-property"(target) {
    const type = entityTypeById(target.dataset.typeId);
    if (!type) return;
    const propertyId = `property${type.properties.length + 1}`;
    type.properties.push({ id: propertyId, label: `Property ${type.properties.length + 1}`, type: "string", required: false, description: "" });
    (fullData.entities || []).filter((entity) => entity.type === type.id).forEach((entity) => {
      entity.properties[propertyId] = "";
    });
    done("editor.property.create", { typeId: type.id, propertyId });
  },

  "delete-property"(target) {
    const { typeId, propertyId } = target.dataset;
    if (isGoverned(typeId, propertyId)) {
      const action = actionFor(typeId, propertyId);
      refuse(`${propertyId} is set by an Action${action ? ` (${action.label})` : ""}; deleting the property would clear it on every object without the Action's role check, Checkpoint and audit.`, "editor.property.delete", { typeId, propertyId });
      return;
    }
    deleteProperty(typeId, propertyId);
    done("editor.property.delete", { typeId, propertyId });
  },

  "add-relationship"() {
    const sourceType = data.ontology.entityTypes[0]?.id || "";
    const targetType = data.ontology.entityTypes[1]?.id || sourceType;
    const relationship = {
      id: `REL_${data.ontology.relationshipTypes.length + 1}`,
      label: `NEW_RELATIONSHIP_${data.ontology.relationshipTypes.length + 1}`,
      sourceType,
      targetType,
      description: "Describe what this edge means.",
      color: randomColor(data.ontology.relationshipTypes.length + 4),
    };
    data.ontology.relationshipTypes.push(relationship);
    ui.selectedRelationshipId = relationship.id;
    done("editor.linkType.create", { linkType: relationship.id });
  },

  "delete-relationship"(target) {
    const linkType = target.dataset.id;
    const count = (fullData.edges || []).filter((edge) => edge.type === linkType).length;
    deleteRelationship(linkType);
    done("editor.linkType.delete", { linkType, linksDeleted: count });
  },

  "add-mapping"() {
    const mapping = {
      id: `mapping-${data.mappings.length + 1}`,
      sourceId: "new_source.csv",
      sourceFields: "field_a, field_b",
      targetType: "Person",
      targetProperty: "canonicalName",
      relationType: "",
      rule: "Describe how this source becomes ontology data.",
    };
    fullData.mappings.push(mapping);
    ui.selectedMappingId = mapping.id;
    done("editor.mapping.create", { mappingId: mapping.id });
  },

  "delete-mapping"(target) {
    fullData.mappings = fullData.mappings.filter((mapping) => mapping.id !== target.dataset.id);
    done("editor.mapping.delete", { mappingId: target.dataset.id });
  },

  "add-entity"(target) {
    addEntity(target.dataset.typeId);
    done("editor.object.create", { type: target.dataset.typeId }, [ui.selectedEntityId]);
  },

  "delete-entity"(target) {
    const id = target.dataset.id;
    const stored = storedEntityById(id);
    if (stored && isSourceRecord(stored)) {
      refuse(`${stored.label || id} comes from ${sourceName(stored)}. Source records are not deleted in the editor: correcting a source is not an edit here, and the Actions that reverse an Action only touch what an Action created.`, "editor.object.delete", { type: stored.type }, [id]);
      return;
    }
    deleteEntity(id);
    done("editor.object.delete", { type: stored ? stored.type : "" }, [id]);
  },

  "create-edge"(target) {
    const before = (fullData.edges || []).length;
    createEdge(target.dataset.sourceId);
    const created = (fullData.edges || []).slice(before);
    if (!created.length) return;
    done("editor.link.create", { linkType: created[0].type, linkId: created[0].id }, [created[0].source, created[0].target]);
  },

  "delete-edge"(target) {
    const edge = (fullData.edges || []).find((item) => item.id === target.dataset.id);
    fullData.edges = fullData.edges.filter((item) => item.id !== target.dataset.id);
    done("editor.link.delete", { linkType: edge ? edge.type : "", linkId: target.dataset.id }, edge ? [edge.source, edge.target] : []);
  },

  "reset-state"() {
    if (store) store.remove(storageKey(ui.datasetKey));
    setFullData(clone(datasetCatalog[ui.datasetKey]));
    setSeedData(clone(datasetCatalog[ui.datasetKey]));
    resetCopilotState();
    ui.editorNotice = null;
    logEvent({ kind: "edit", verb: "dataset.reset", payload: { outcome: "applied", note: "Saved edits and Action effects on this dataset discarded; the seed is loaded again. Marking overrides, the threshold and the audit log are kept." } });
    render();
  },

  "dismiss-editor-notice"() {
    ui.editorNotice = null;
    render();
  },
};

export const EDITOR_CHANGES = {
  "entity-type"(target) {
    const entityType = entityTypeById(ui.selectedEntityTypeId);
    if (!entityType) return;
    const from = entityType[target.dataset.field];
    entityType[target.dataset.field] = target.value;
    done("editor.type.update", { typeId: entityType.id, field: target.dataset.field, from, to: target.value });
  },

  "property"(target) {
    const { propertyId, field } = target.dataset;
    if (field === "id" && isGoverned(ui.selectedEntityTypeId, propertyId)) {
      refuse(`${propertyId} is set by an Action; renaming it would detach it from the Action.`, "editor.property.update", { typeId: ui.selectedEntityTypeId, propertyId, field });
      return;
    }
    updateProperty(propertyId, field, target.value);
    done("editor.property.update", { typeId: ui.selectedEntityTypeId, propertyId, field, to: target.value });
  },

  "relationship"(target) {
    const relationship = relationshipById(ui.selectedRelationshipId);
    if (!relationship) return;
    const from = relationship[target.dataset.field];
    relationship[target.dataset.field] = target.value;
    done("editor.linkType.update", { linkType: relationship.id, field: target.dataset.field, from, to: target.value });
  },

  "mapping"(target) {
    const mapping = mappingById(ui.selectedMappingId);
    if (!mapping) return;
    const from = mapping[target.dataset.field];
    mapping[target.dataset.field] = target.value;
    done("editor.mapping.update", { mappingId: mapping.id, field: target.dataset.field, from, to: target.value });
  },

  "entity"(target) {
    const entity = storedEntityById(target.dataset.entityId || ui.selectedEntityId);
    if (!entity) return;
    const from = entity[target.dataset.field];
    entity[target.dataset.field] = target.value;
    done("editor.object.update", { field: target.dataset.field, from, to: target.value }, [entity.id]);
  },

  // The field was edited on input (persisted per keystroke); leaving it logs one update.
  "entity-property"(target) {
    const key = `${target.dataset.entityId}|${target.dataset.field}`;
    if (!editOrigins.has(key)) return;
    const from = editOrigins.get(key);
    editOrigins.delete(key);
    if (String(from ?? "") === String(target.value ?? "")) return;
    logEdit("editor.object.update", { property: target.dataset.field, from, to: target.value, outcome: "applied" }, [target.dataset.entityId]);
  },
};

export const EDITOR_INPUTS = {
  "entity-property"(target) {
    const entity = storedEntityById(target.dataset.entityId);
    if (!entity) return;
    const field = target.dataset.field;
    if (isGoverned(entity.type, field) || roleView.resolution?.repOf?.has(entity.id)) {
      target.value = entity.properties?.[field] ?? "";
      return;
    }
    const key = `${entity.id}|${field}`;
    if (!editOrigins.has(key)) editOrigins.set(key, entity.properties?.[field] ?? "");
    entity.properties[field] = target.value;
    if (["canonicalName", "companyName", "label", "name"].includes(field)) {
      entity.label = target.value || entity.label;
    }
    persist();
  },
};

export function renderEditorNotice() {
  const notice = ui.editorNotice;
  if (!notice) return "";
  return `<div class="editor-notice ${notice.kind === "refused" ? "is-refused" : ""}" role="alert"><strong>${notice.kind === "refused" ? "Refused and logged." : ""}</strong> ${String(notice.text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]))} <button class="ghost-button" data-action="dismiss-editor-notice">Dismiss</button></div>`;
}

