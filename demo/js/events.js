// demo/js/events.js — DOM event handlers. Clicks dispatch on data-action, change/input on data-scope, through
// lookup tables instead of an if-chain.
import { clone, slugify } from "./util.js";
import {
  DEFAULT_MAP_VIEW,
  analysisState,
  copilotState,
  core,
  data,
  datasetCatalog,
  dismissStoreNotice,
  fullData,
  persist,
  resetCopilotState,
  restoreSavedEdits,
  roleView,
  setFullData,
  setSeedData,
  storageKey,
  store,
  storedEntityById,
  switchDataset,
  ui,
  walkthroughState,
} from "./state.js";
import {
  currentRole,
  currentRoleId,
  expandTelecom,
  logEvent,
  logRuleOpen,
  logScenarioOpen,
  logSearch,
  logView,
  phoneSearchHeld,
  requestPhoneSearch,
} from "./governance.js";
import { entitiesForType, entityById, entityTypeById, mappingById, relationshipById } from "./derive.js";
import { buildMapData } from "./map.js";
import { runCopilotQuery } from "./agent.js";
import { render } from "./render/index.js";
import { WALKTHROUGH_STEPS } from "./render/walkthrough.js";
import { buildInstanceGraph } from "./render/graph.js";
import { ACTION_CHANGES, ACTION_CLICKS, ACTION_INPUTS } from "./actions-ui.js";
import {
  addEntity,
  createEdge,
  deleteEntity,
  deleteEntityType,
  deleteProperty,
  deleteRelationship,
  exportJson,
  persistAndRender,
  randomColor,
  updateProperty,
} from "./mutations.js";

// Click handlers keyed by the data-action of the clicked element (or its nearest ancestor).
export const CLICK_ACTIONS = {
  // Action drawer, purpose-rule exceptions (actions-ui.js).
  ...ACTION_CLICKS,

  "start-walkthrough"(actionTarget) {
    walkthroughState.active = true;
    walkthroughState.step = 0;
    render();
  },

  "close-walkthrough"(actionTarget) {
    walkthroughState.active = false;
    render();
  },

  "walkthrough-next"(actionTarget) {
    const nextStep = walkthroughState.step + 1;
    if (nextStep >= WALKTHROUGH_STEPS.length) {
      walkthroughState.active = false;
    } else {
      walkthroughState.step = nextStep;
      const targetTab = WALKTHROUGH_STEPS[nextStep].tab;
      if (targetTab) {
        ui.activeTool = targetTab;
        if (targetTab === "graph") {
          ui.selectedGraphNodeId = ui.graphMode === "schema" ? ui.selectedEntityTypeId : ui.selectedEntityId;
        }
      }
    }
    render();
  },

  "walkthrough-back"(actionTarget) {
    const prevStep = walkthroughState.step - 1;
    if (prevStep >= 0) {
      walkthroughState.step = prevStep;
      const targetTab = WALKTHROUGH_STEPS[prevStep].tab;
      if (targetTab) {
        ui.activeTool = targetTab;
      }
    }
    render();
  },

  "inspector-mode"(actionTarget) {
    ui.inspectorMode = actionTarget.dataset.mode;
    render();
  },

  "switch-tool"(actionTarget) {
    ui.activeTool = actionTarget.dataset.tool;
    if (ui.activeTool === "graph") {
      ui.selectedGraphNodeId = ui.graphMode === "schema" ? ui.selectedEntityTypeId : ui.selectedEntityId;
    }
    render();
  },

  "run-copilot"(actionTarget) {
    runCopilotQuery(copilotState.query);
  },

  "copilot-example"(actionTarget) {
    runCopilotQuery(actionTarget.dataset.query || "");
  },

  "copilot-jump-entity"(actionTarget) {
    ui.activeTool = "graph";
    ui.graphMode = "instance";
    ui.selectedGraphNodeId = actionTarget.dataset.id;
    ui.selectedEntityId = actionTarget.dataset.id;
    logView(actionTarget.dataset.id, "agent");
    render();
  },

  "expand-telecom"(actionTarget) {
    expandTelecom(actionTarget.dataset.id);
  },

  "phone-search"(actionTarget) {
    const scopeName = actionTarget.dataset.scopeName;
    if (scopeName === "agent") {
      runCopilotQuery(copilotState.query);
    } else if (scopeName === "map") {
      requestPhoneSearch("map", ui.mapSearch, () => buildMapData().places.length);
    } else {
      requestPhoneSearch("graph", ui.graphSearch, () => buildInstanceGraph().totalNodes);
    }
  },

  "copilot-jump-scenario"(actionTarget) {
    ui.activeTool = "investigations";
    ui.selectedScenarioId = actionTarget.dataset.id;
    const scenario = analysisState.investigations.find((item) => item.id === ui.selectedScenarioId);
    ui.selectedGraphNodeId = scenario?.focusEntityIds?.[0] || ui.selectedGraphNodeId;
    logScenarioOpen(ui.selectedScenarioId);
    render();
  },

  "copilot-jump-rule"(actionTarget) {
    ui.activeTool = "analytics";
    ui.selectedAnalyticsRuleId = actionTarget.dataset.id;
    logRuleOpen(ui.selectedAnalyticsRuleId);
    render();
  },

  "select-map-node"(actionTarget) {
    ui.selectedMapNodeId = actionTarget.dataset.id;
    render();
  },

  "map-jump-graph"(actionTarget) {
    ui.activeTool = "graph";
    ui.graphMode = "instance";
    ui.selectedGraphNodeId = actionTarget.dataset.id;
    logView(actionTarget.dataset.id, "map");
    render();
  },

  "select-scenario"(actionTarget) {
    ui.selectedScenarioId = actionTarget.dataset.id;
    const scenario = analysisState.investigations.find((item) => item.id === ui.selectedScenarioId);
    ui.selectedGraphNodeId = scenario?.focusEntityIds?.[0] || ui.selectedGraphNodeId;
    logScenarioOpen(ui.selectedScenarioId);
    render();
  },

  "execute-scenario-action"(actionTarget) {
    const { scenarioId, scenarioTitle, actionLabel } = actionTarget.dataset;
    const ts = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    analysisState.actionLog.push({ ts, scenarioId, scenarioTitle, action: actionLabel });
    const scenario = analysisState.investigations.find((item) => item.id === scenarioId);
    logEvent({ kind: "action", verb: "scenario.action", objectIds: scenario?.focusEntityIds || [], payload: { scenarioId, action: actionLabel } });
    render();
  },

  "select-rule"(actionTarget) {
    ui.selectedAnalyticsRuleId = actionTarget.dataset.id;
    logRuleOpen(ui.selectedAnalyticsRuleId);
    render();
  },

  "select-entity-type"(actionTarget) {
    ui.selectedEntityTypeId = actionTarget.dataset.id;
    ui.selectedEntityId = entitiesForType(ui.selectedEntityTypeId)[0]?.id || ui.selectedEntityId;
    persistAndRender();
  },

  "add-entity-type"(actionTarget) {
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
    persistAndRender();
  },

  "delete-entity-type"(actionTarget) {
    deleteEntityType(actionTarget.dataset.id);
    persistAndRender();
  },

  "add-property"(actionTarget) {
    const type = entityTypeById(actionTarget.dataset.typeId);
    if (!type) return;
    const propertyId = `property${type.properties.length + 1}`;
    type.properties.push({ id: propertyId, label: `Property ${type.properties.length + 1}`, type: "string", required: false, description: "" });
    (fullData.entities || []).filter((entity) => entity.type === type.id).forEach((entity) => {
      entity.properties[propertyId] = "";
    });
    persistAndRender();
  },

  "delete-property"(actionTarget) {
    deleteProperty(actionTarget.dataset.typeId, actionTarget.dataset.propertyId);
    persistAndRender();
  },

  "select-relationship"(actionTarget) {
    ui.selectedRelationshipId = actionTarget.dataset.id;
    render();
  },

  "add-relationship"(actionTarget) {
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
    persistAndRender();
  },

  "delete-relationship"(actionTarget) {
    deleteRelationship(actionTarget.dataset.id);
    persistAndRender();
  },

  "select-mapping"(actionTarget) {
    ui.selectedMappingId = actionTarget.dataset.id;
    render();
  },

  "add-mapping"(actionTarget) {
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
    persistAndRender();
  },

  "delete-mapping"(actionTarget) {
    fullData.mappings = fullData.mappings.filter((mapping) => mapping.id !== actionTarget.dataset.id);
    persistAndRender();
  },

  "select-entity"(actionTarget) {
    ui.selectedEntityId = actionTarget.dataset.id;
    ui.selectedGraphNodeId = actionTarget.dataset.id;
    logView(actionTarget.dataset.id, "objects");
    render();
  },

  "add-entity"(actionTarget) {
    addEntity(actionTarget.dataset.typeId);
    persistAndRender();
  },

  "delete-entity"(actionTarget) {
    deleteEntity(actionTarget.dataset.id);
    persistAndRender();
  },

  "create-edge"(actionTarget) {
    createEdge(actionTarget.dataset.sourceId);
    persistAndRender();
  },

  "delete-edge"(actionTarget) {
    fullData.edges = fullData.edges.filter((edge) => edge.id !== actionTarget.dataset.id);
    persistAndRender();
  },

  "select-graph-node"(actionTarget) {
    ui.selectedGraphNodeId = actionTarget.dataset.nodeId;
    if (entityById(actionTarget.dataset.nodeId)) {
      ui.selectedEntityId = actionTarget.dataset.nodeId;
      logView(actionTarget.dataset.nodeId, ui.activeTool);
    } else if (entityTypeById(actionTarget.dataset.nodeId)) {
      ui.selectedEntityTypeId = actionTarget.dataset.nodeId;
    }
    render();
  },

  "restore-saved-edits"(actionTarget) {
    restoreSavedEdits();
  },

  "dismiss-store-notice"(actionTarget) {
    dismissStoreNotice();
  },

  "reset-state"(actionTarget) {
    if (store) {
      store.remove(storageKey(ui.datasetKey));
    }
    setFullData(clone(datasetCatalog[ui.datasetKey]));
    setSeedData(clone(datasetCatalog[ui.datasetKey]));
    resetCopilotState();
    render();
  },

  "export-json"(actionTarget) {
    const role = currentRole();
    const summary = `${data.entities?.length || 0} objects and ${data.edges?.length || 0} links visible to ${role ? role.label : currentRoleId()} (${String(ui.datasetKey).toUpperCase()})`;
    const run = (record) => {
      exportJson(record);
      return logEvent({
        kind: "export",
        verb: "export.json",
        checkpointId: record ? record.recordId : null,
        payload: { objects: data.entities?.length || 0, links: data.edges?.length || 0, withheldObjects: roleView.withheldEntities.length },
      });
    };
    if (core.checkpoints) {
      core.checkpoints.withCheckpoint("export.json", { surface: "investigate", objectIds: [], summary }, run);
    } else {
      run(null);
    }
  },
};

export function handleClick(event) {
  const actionTarget = event.target.closest("[data-action]");
  if (!actionTarget) {
    return;
  }
  const { action } = actionTarget.dataset;
  if (Object.prototype.hasOwnProperty.call(CLICK_ACTIONS, action)) {
    CLICK_ACTIONS[action](actionTarget);
  }
}

// Change handlers keyed by the data-scope of the changed control.
export const CHANGE_SCOPES = {
  ...ACTION_CHANGES,

  "dataset"(target) {
    switchDataset(target.value);
  },

  "entity-type"(target) {
    const entityType = entityTypeById(ui.selectedEntityTypeId);
    if (!entityType) return;
    entityType[target.dataset.field] = target.value;
    persistAndRender();
  },

  "properties"(target) {
    ui.selectedEntityTypeId = target.value;
    ui.selectedEntityId = entitiesForType(ui.selectedEntityTypeId)[0]?.id || ui.selectedEntityId;
    render();
  },

  "property"(target) {
    updateProperty(target.dataset.propertyId, target.dataset.field, target.value);
    persistAndRender();
  },

  "relationship"(target) {
    const relationship = relationshipById(ui.selectedRelationshipId);
    if (!relationship) return;
    relationship[target.dataset.field] = target.value;
    persistAndRender();
  },

  "mapping"(target) {
    const mapping = mappingById(ui.selectedMappingId);
    if (!mapping) return;
    mapping[target.dataset.field] = target.value;
    persistAndRender();
  },

  "instances"(target) {
    ui.selectedEntityTypeId = target.value;
    ui.selectedEntityId = entitiesForType(ui.selectedEntityTypeId)[0]?.id || ui.selectedEntityId;
    render();
  },

  "entity"(target) {
    const entity = storedEntityById(target.dataset.entityId || ui.selectedEntityId);
    if (!entity) return;
    entity[target.dataset.field] = target.value;
    persistAndRender();
  },

  "graph"(target) {
    if (target.dataset.field === "mode") {
      ui.graphMode = target.value;
      ui.selectedGraphNodeId = ui.graphMode === "schema" ? ui.selectedEntityTypeId : ui.selectedEntityId;
    }
    if (target.dataset.field === "typeFilter") {
      ui.graphTypeFilter = target.value;
    }
    if (target.dataset.field === "search") {
      ui.graphSearch = target.value;
      render();
      logSearch("graph", ui.graphSearch, buildInstanceGraph().totalNodes);
      return;
    }
    render();
  },

  "map"(target) {
    if (target.dataset.field === "scope") {
      ui.mapScope = target.value;
      ui.selectedMapNodeId = "";
      ui.mapViewCenter = [...DEFAULT_MAP_VIEW.center];
      ui.mapViewZoom = DEFAULT_MAP_VIEW.zoom;
      ui.mapViewDirty = false;
    }
    if (target.dataset.field === "placeFilter") {
      ui.mapPlaceFilter = target.value;
      ui.selectedMapNodeId = "";
      ui.mapViewCenter = [...DEFAULT_MAP_VIEW.center];
      ui.mapViewZoom = DEFAULT_MAP_VIEW.zoom;
      ui.mapViewDirty = false;
    }
    if (target.dataset.field === "search") {
      ui.mapSearch = target.value;
      ui.mapViewCenter = [...DEFAULT_MAP_VIEW.center];
      ui.mapViewZoom = DEFAULT_MAP_VIEW.zoom;
      ui.mapViewDirty = false;
      render();
      logSearch("map", ui.mapSearch, buildMapData().places.length);
      return;
    }
    render();
  },
};

export function handleChange(event) {
  const target = event.target;
  const scope = target.dataset.scope;
  if (!scope) {
    return;
  }
  if (Object.prototype.hasOwnProperty.call(CHANGE_SCOPES, scope)) {
    CHANGE_SCOPES[scope](target);
  }
}

// Input handlers keyed by the data-scope of the edited control.
export const INPUT_SCOPES = {
  ...ACTION_INPUTS,

  "entity-property"(target) {
    const entity = storedEntityById(target.dataset.entityId);
    if (!entity) return;
    entity.properties[target.dataset.field] = target.value;
    if (["canonicalName", "companyName", "label", "name"].includes(target.dataset.field)) {
      entity.label = target.value || entity.label;
    }
    persist();
  },

  "copilot"(target) {
    copilotState.query = target.value;
    if (!copilotState.query.trim()) {
      copilotState.result = null;
    }
    render();
  },

  "map"(target) {
    if (target.dataset.field === "search") {
      ui.mapSearch = target.value;
      render();
    }
  },

  "graph"(target) {
    ui.graphSearch = target.value;
    render();
  },
};

export function handleInput(event) {
  const target = event.target;
  const scope = target.dataset.scope;
  if (!scope) {
    return;
  }
  if (Object.prototype.hasOwnProperty.call(INPUT_SCOPES, scope)) {
    INPUT_SCOPES[scope](target);
  }
}

// Enter in a search box holding a phone number opens the phone-search Checkpoint.
export function handleKeydown(event) {
  if (event.key !== "Enter") return;
  const target = event.target;
  if (!target.matches || !target.matches('input[data-field="search"]')) return;
  const scope = target.dataset.scope;
  if ((scope === "graph" || scope === "map") && phoneSearchHeld(target.value)) {
    event.preventDefault();
    if (scope === "graph") {
      ui.graphSearch = target.value;
      requestPhoneSearch("graph", ui.graphSearch, () => buildInstanceGraph().totalNodes);
    } else {
      ui.mapSearch = target.value;
      requestPhoneSearch("map", ui.mapSearch, () => buildMapData().places.length);
    }
  }
}
