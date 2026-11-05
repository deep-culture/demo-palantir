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
  cancelPhoneCheckpoint,
  logSearch,
  logView,
  phoneSearchHeld,
  requestPhoneSearch,
  flushSearchLog,
  schedulePhoneCheckpoint,
  scheduleSearchLog,
} from "./governance.js";
import { entitiesForType, entityById, entityTypeById, mappingById, relationshipById } from "./derive.js";
import { buildMapData } from "./map.js";
import { runCopilotQuery } from "./agent.js";
import { isRendering, render } from "./render/index.js";
import { WALKTHROUGH_STEPS } from "./render/walkthrough.js";
import { buildInstanceGraph } from "./render/graph.js";
import { ACTION_CHANGES, ACTION_CLICKS, ACTION_INPUTS } from "./actions-ui.js";
import { AGENT_CLICKS } from "./agent-run.js";
import { LEAD_CHANGES, LEAD_CLICKS, LEAD_INPUTS } from "./leads.js";
import { SET_CHANGES, SET_CLICKS } from "./object-sets.js";
import { EDITOR_CHANGES, EDITOR_CLICKS, EDITOR_INPUTS } from "./editor.js";
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
  // Action drawer, purpose-rule exceptions (actions-ui.js); agent run (agent-run.js); leads; object sets.
  ...ACTION_CLICKS,
  ...EDITOR_CLICKS,
  ...AGENT_CLICKS,
  ...LEAD_CLICKS,
  ...SET_CLICKS,

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

  // Clicking an example fills the question box; "Ask the agent" runs it (it used to run on click, so
  // pressing Ask afterwards ran it twice).
  "copilot-example"(actionTarget) {
    copilotState.query = actionTarget.dataset.query || "";
    render();
    requestAnimationFrame(() => document.getElementById("agent-query")?.focus());
  },

  "copilot-jump-entity"(actionTarget) {
    ui.activeTool = "graph";
    ui.graphMode = "instance";
    ui.selectedGraphNodeId = actionTarget.dataset.id;
    ui.selectedEntityId = actionTarget.dataset.id;
    ui.entityPicked = true;
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
    ui.selectedEntityId = actionTarget.dataset.id;
    ui.entityPicked = true;
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

  "select-relationship"(actionTarget) {
    ui.selectedRelationshipId = actionTarget.dataset.id;
    render();
  },

  "select-mapping"(actionTarget) {
    ui.selectedMappingId = actionTarget.dataset.id;
    render();
  },

  "select-entity"(actionTarget) {
    ui.selectedEntityId = actionTarget.dataset.id;
    ui.entityPicked = true;
    ui.editorNotice = null;
    ui.selectedGraphNodeId = actionTarget.dataset.id;
    logView(actionTarget.dataset.id, "objects");
    render();
  },

  "select-graph-node"(actionTarget) {
    ui.selectedGraphNodeId = actionTarget.dataset.nodeId;
    if (entityById(actionTarget.dataset.nodeId)) {
      ui.selectedEntityId = actionTarget.dataset.nodeId;
      ui.entityPicked = true;
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
  ...EDITOR_CHANGES,
  ...LEAD_CHANGES,
  ...SET_CHANGES,

  "dataset"(target) {
    switchDataset(target.value);
  },

  "properties"(target) {
    ui.selectedEntityTypeId = target.value;
    ui.selectedEntityId = entitiesForType(ui.selectedEntityTypeId)[0]?.id || ui.selectedEntityId;
    render();
  },

  "instances"(target) {
    ui.selectedEntityTypeId = target.value;
    ui.selectedEntityId = entitiesForType(ui.selectedEntityTypeId)[0]?.id || ui.selectedEntityId;
    render();
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
      // A change event also fires when a re-render detaches the field: only a real Enter/blur logs now.
      if (!target.isConnected) return;
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
      if (!target.isConnected) return;
      render();
      logSearch("map", ui.mapSearch, buildMapData().places.length);
      return;
    }
    render();
  },
};

export function handleChange(event) {
  if (isRendering()) return;
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
  ...EDITOR_INPUTS,
  ...LEAD_INPUTS,

  "copilot"(target) {
    copilotState.query = target.value;
    render();
  },

  "map"(target) {
    if (target.dataset.field === "search") {
      ui.mapSearch = target.value;
      render();
      schedulePhoneCheckpoint("map", () => ui.mapSearch, () => buildMapData().places.length);
      scheduleSearchLog("map", () => ui.mapSearch, () => buildMapData().places.length);
    }
  },

  "graph"(target) {
    if (target.dataset.field !== "search") return;
    ui.graphSearch = target.value;
    render();
    schedulePhoneCheckpoint("graph", () => ui.graphSearch, () => buildInstanceGraph().totalNodes);
    scheduleSearchLog("graph", () => ui.graphSearch, () => buildInstanceGraph().totalNodes);
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

// Enter in a search box holding a phone number opens the phone-search Checkpoint at once. Enter or Space on
// an SVG graph node (role="button", tabindex="0") selects it, like a click.
export function handleKeydown(event) {
  const target = event.target;
  if ((event.key === "Enter" || event.key === " ") && target.matches && target.matches('[role="button"][data-action]:not(button)')) {
    event.preventDefault();
    handleClick({ target });
    return;
  }
  if (event.key !== "Enter") return;
  if (!target.matches || !target.matches('input[data-field="search"]')) return;
  const scope = target.dataset.scope;
  if (!phoneSearchHeld(target.value)) flushSearchLog(scope);
  if ((scope === "graph" || scope === "map") && phoneSearchHeld(target.value)) {
    event.preventDefault();
    cancelPhoneCheckpoint(scope);
    if (scope === "graph") {
      ui.graphSearch = target.value;
      requestPhoneSearch("graph", ui.graphSearch, () => buildInstanceGraph().totalNodes);
    } else {
      ui.mapSearch = target.value;
      requestPhoneSearch("map", ui.mapSearch, () => buildMapData().places.length);
    }
  }
}

// Leaving a search field logs its query at once (not when a re-render moves focus to the new field).
export function handleFocusOut(event) {
  if (isRendering()) return;
  const target = event.target;
  if (target && target.matches && target.matches('input[data-field="search"]') && ["graph", "map"].includes(target.dataset.scope)) flushSearchLog(target.dataset.scope);
}
