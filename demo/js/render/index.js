// demo/js/render/index.js — Top-level render(): role view -> analytics -> agent -> selection -> shell HTML -> map.
import { analysisState, core, data, refreshView, root, ui } from "../state.js";
import { entityById, entityTypeById, mappingById, relationshipById } from "../derive.js";
import { buildAnalytics, buildInvestigations } from "../analytics.js";
import { buildMapData, destroyLeafletMap, initializeLeafletMap, mapRuntime } from "../map.js";
import { renderHeader, renderTabs } from "./header.js";
import { renderStoreBanner } from "./banners.js";
import { renderInspector } from "./inspector.js";
import { renderWalkthroughCard } from "./walkthrough.js";
import { renderCopilotTool } from "./agent.js";
import { renderMapTool } from "./map.js";
import { renderInvestigationsTool } from "./investigations.js";
import { renderAnalyticsTool } from "./analytics.js";
import { renderEntityTypesTool } from "./object-types.js";
import { renderPropertiesTool } from "./properties.js";
import { renderRelationshipsTool } from "./link-types.js";
import { renderMappingsTool } from "./backing-datasets.js";
import { renderInstancesTool } from "./objects.js";
import { renderGraphTool } from "./graph.js";
import { renderLeadsTool } from "./leads.js";
import { renderObjectSetsTool } from "./object-sets.js";
import { renderActionDrawer } from "./action-drawer.js";
import { gateRules } from "../purpose-gate.js";

export function ensureUiSelection() {
  if (!entityTypeById(ui.selectedEntityTypeId)) {
    ui.selectedEntityTypeId = data.ontology?.entityTypes?.[0]?.id || "";
  }
  if (!relationshipById(ui.selectedRelationshipId)) {
    ui.selectedRelationshipId = data.ontology?.relationshipTypes?.[0]?.id || "";
  }
  if (!mappingById(ui.selectedMappingId)) {
    ui.selectedMappingId = data.mappings?.[0]?.id || "";
  }
  if (!entityById(ui.selectedEntityId)) {
    ui.selectedEntityId = data.entities?.[0]?.id || "";
  }
  if (ui.graphMode === "schema") {
    if (!entityTypeById(ui.selectedGraphNodeId)) {
      ui.selectedGraphNodeId = ui.selectedEntityTypeId;
    }
  } else if (!entityById(ui.selectedGraphNodeId)) {
    ui.selectedGraphNodeId = ui.selectedEntityId;
  }
  if (!analysisState.investigations.find((scenario) => scenario.id === ui.selectedScenarioId)) {
    ui.selectedScenarioId = analysisState.investigations[0]?.id || "";
  }
  if (!analysisState.analytics.find((rule) => rule.id === ui.selectedAnalyticsRuleId)) {
    ui.selectedAnalyticsRuleId = analysisState.analytics[0]?.id || "";
  }
  const visibleMapPlaceIds = new Set(buildMapData().places.map((place) => place.id));
  if (!visibleMapPlaceIds.has(ui.selectedMapNodeId)) {
    ui.selectedMapNodeId = buildMapData().places[0]?.id || "";
  }
}

// True while the shell is replaced: removing a focused, edited field fires a "change" event that is not
// the user's (it made every search keystroke an audit event). events.js ignores changes during a render.
let rendering = false;
export function isRendering() {
  return rendering;
}

export function render() {
  refreshView();
  // Purpose rules (F9) run per rule; a blocked rule keeps no ranking, so no scenario is built from it.
  analysisState.analytics = gateRules(buildAnalytics());
  analysisState.investigations = buildInvestigations(analysisState.analytics);
  // The agent's run (agent-run.js) is a recorded trace: it is not recomputed on render. A run made under
  // another role or threshold says so and offers to ask again.
  ensureUiSelection();

  const focusInfo = captureFocus();

  destroyLeafletMap();
  rendering = true;
  try {
  root.innerHTML = `
      <div class="shell">
        ${renderHeader()}
        <div id="dc-session-slot"></div>
        ${renderStoreBanner()}
        ${renderTabs()}
        <div class="layout">
          <section class="workspace">${renderWorkspace()}</section>
          <aside class="inspector">${renderInspector()}</aside>
        </div>
        ${renderWalkthroughCard()}
        ${renderActionDrawer()}
        <div id="dc-audit-slot"></div>
      </div>
    `;
  } finally {
    rendering = false;
  }

  if (core.ui) {
    core.ui.renderSessionStrip(document.getElementById("dc-session-slot"), { surface: "investigate" });
    core.ui.renderAuditStrip(document.getElementById("dc-audit-slot"), { surface: "investigate" });
  }
  restoreFocus(focusInfo);

  if (ui.activeTool === "map") {
    setTimeout(() => {
      const mapData = buildMapData();
      initializeLeafletMap(mapData);
      if (mapRuntime.map) {
        mapRuntime.map.invalidateSize();
      }
    }, 0);
  }
}

export function captureFocus() {
  const active = document.activeElement;
  if (!active || active === document.body) return null;
  let selector = null;
  if (active.dataset && active.dataset.nodeId) {
    selector = `[data-action="${CSS.escape(active.dataset.action || "")}"][data-node-id="${CSS.escape(active.dataset.nodeId)}"]`;
  } else if (active.id) {
    selector = "#" + CSS.escape(active.id);
  } else if (active.dataset && active.dataset.scope && active.dataset.field) {
    selector = `${active.tagName.toLowerCase()}[data-scope="${CSS.escape(active.dataset.scope)}"][data-field="${CSS.escape(active.dataset.field)}"]`;
  }
  if (!selector) return null;
  const selStart = typeof active.selectionStart === "number" ? active.selectionStart : null;
  const selEnd = typeof active.selectionEnd === "number" ? active.selectionEnd : null;
  return { selector, selStart, selEnd };
}

export function restoreFocus(info) {
  if (!info) return;
  const target = document.querySelector(info.selector);
  if (!target) return;
  target.focus();
  if (info.selStart !== null && typeof target.setSelectionRange === "function") {
    try { target.setSelectionRange(info.selStart, info.selEnd); } catch (_) {}
  }
}

export function renderWorkspace() {
  switch (ui.activeTool) {
    case "copilot":
      return renderCopilotTool();
    case "investigations":
      return renderInvestigationsTool();
    case "analytics":
      return renderAnalyticsTool();
    case "map":
      return renderMapTool();
    case "leads":
      return renderLeadsTool();
    case "object-sets":
      return renderObjectSetsTool();
    case "entity-types":
      return renderEntityTypesTool();
    case "properties":
      return renderPropertiesTool();
    case "relationships":
      return renderRelationshipsTool();
    case "mappings":
      return renderMappingsTool();
    case "instances":
      return renderInstancesTool();
    case "graph":
      return renderGraphTool();
    default:
      return "";
  }
}
