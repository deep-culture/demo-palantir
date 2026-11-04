// demo/js/mutations.js — Ontology edits (types, properties, links, objects), JSON export and persist-and-render.
import { slugify } from "./util.js";
import { data, fullData, persist, roleView, ui } from "./state.js";
import { currentRoleId } from "./governance.js";
import { entityById, entityTypeById, relationshipById } from "./derive.js";
import { render } from "./render/index.js";

export function updateProperty(propertyId, field, value) {
  const entityType = entityTypeById(ui.selectedEntityTypeId);
  if (!entityType) {
    return;
  }
  const property = entityType.properties.find((item) => item.id === propertyId);
  if (!property) {
    return;
  }
  if (field === "id") {
    const nextId = slugify(value).replace(/-/g, "");
    if (!nextId || entityType.properties.some((item) => item.id === nextId && item !== property)) {
      return;
    }
    (fullData.entities || []).filter((entity) => entity.type === entityType.id).forEach((entity) => {
      entity.properties[nextId] = entity.properties[property.id] ?? "";
      delete entity.properties[property.id];
      if (entity.propertyMarkings && property.id in entity.propertyMarkings) {
        entity.propertyMarkings[nextId] = entity.propertyMarkings[property.id];
        delete entity.propertyMarkings[property.id];
      }
    });
    property.id = nextId;
    return;
  }
  if (field === "required") {
    property.required = value === "true";
    return;
  }
  property[field] = value;
}

export function deleteEntityType(typeId) {
  const entityIdsToRemove = new Set((fullData.entities || []).filter((entity) => entity.type === typeId).map((entity) => entity.id));
  const relationshipsToRemove = new Set(
    (data.ontology?.relationshipTypes || [])
      .filter((relationship) => relationship.sourceType === typeId || relationship.targetType === typeId)
      .map((relationship) => relationship.id)
  );
  fullData.ontology.entityTypes = fullData.ontology.entityTypes.filter((entityType) => entityType.id !== typeId);
  fullData.ontology.relationshipTypes = fullData.ontology.relationshipTypes.filter((relationship) => !relationshipsToRemove.has(relationship.id));
  fullData.entities = fullData.entities.filter((entity) => entity.type !== typeId);
  fullData.edges = fullData.edges.filter(
    (edge) => !entityIdsToRemove.has(edge.source) && !entityIdsToRemove.has(edge.target) && !relationshipsToRemove.has(edge.type)
  );
  fullData.mappings = fullData.mappings.filter((mapping) => mapping.targetType !== typeId);
}

export function deleteProperty(typeId, propertyId) {
  const entityType = entityTypeById(typeId);
  if (!entityType) return;
  entityType.properties = entityType.properties.filter((property) => property.id !== propertyId);
  (fullData.entities || []).filter((entity) => entity.type === typeId).forEach((entity) => {
    delete entity.properties[propertyId];
  });
}

export function deleteRelationship(relationshipId) {
  fullData.ontology.relationshipTypes = fullData.ontology.relationshipTypes.filter((relationship) => relationship.id !== relationshipId);
  fullData.edges = fullData.edges.filter((edge) => edge.type !== relationshipId);
  fullData.mappings = fullData.mappings.map((mapping) => (mapping.relationType === relationshipId ? { ...mapping, relationType: "" } : mapping));
}

export function addEntity(typeId) {
  const entityType = entityTypeById(typeId);
  if (!entityType) return;
  const nextIndex = (fullData.entities || []).filter((entity) => entity.type === typeId).length + 1;
  const entity = {
    id: `${typeId.toLowerCase()}::manual-${nextIndex}`,
    type: typeId,
    label: `${entityType.name} ${nextIndex}`,
    properties: Object.fromEntries((entityType.properties || []).map((property) => [property.id, ""])),
    sourceIds: ["manual-edit"],
  };
  if (entity.properties.name !== undefined) {
    entity.properties.name = entity.label;
  }
  fullData.entities.push(entity);
  ui.selectedEntityId = entity.id;
  ui.selectedGraphNodeId = entity.id;
}

export function deleteEntity(entityId) {
  fullData.entities = fullData.entities.filter((entity) => entity.id !== entityId);
  fullData.edges = fullData.edges.filter((edge) => edge.source !== entityId && edge.target !== entityId);
}

export function createEdge(sourceId) {
  const relationshipId = document.getElementById("new-edge-type")?.value;
  const targetId = document.getElementById("new-edge-target")?.value;
  const relationship = relationshipById(relationshipId);
  const source = entityById(sourceId);
  const target = entityById(targetId);
  if (!relationship || !source || !target) {
    return;
  }
  if (source.type !== relationship.sourceType || target.type !== relationship.targetType) {
    return;
  }
  fullData.edges.push({
    id: `${relationship.id.toLowerCase()}::${slugify(`${sourceId}-${targetId}-${fullData.edges.length + 1}`)}`,
    type: relationship.id,
    source: sourceId,
    target: targetId,
    label: relationship.label,
    properties: { provenance: "manual-edit" },
  });
}

// Exports the role's view (withheld properties stay as {withheld: [...]} placeholders; withheld
// objects are counted, not included) with a note of who exported it under which Checkpoint.
export function exportJson(record) {
  const withheldByType = Object.fromEntries([...roleView.withheldByType.entries()].map(([type, list]) => [type, list.length]));
  const payload = {
    ...data,
    exportMetadata: {
      exportedAt: new Date().toISOString(),
      role: currentRoleId(),
      checkpointRecordId: record ? record.recordId : null,
      withheldObjectsByType: withheldByType,
      withheldLinks: roleView.withheldEdges.length,
    },
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `ontology-demo-${ui.datasetKey}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export function persistAndRender() {
  persist();
  render();
}

export function randomColor(index) {
  const palette = ["#3b82f6", "#8b5cf6", "#14b8a6", "#f59e0b", "#ef4444", "#ec4899", "#10b981", "#64748b"];
  return palette[index % palette.length];
}
