// demo/js/state.js — Constants, the shared mutable state (the only place it is declared), persistence via
// DC.store, dataset switching and the role view. Other modules import these bindings; they
// reassign them only through the setters here (ES-module imports are read-only).
import { clone } from "./util.js";
import { currentRoleId, governanceActive } from "./governance.js";
import { buildDerivedState } from "./derive.js";
import { resolveFullData } from "./resolution-view.js";
import { render } from "./render/index.js";

// Saved edits live under dc-palantir:gotham:{dataset} (core/store.js, REDESIGN_SPEC §6.1–6.2).
// The pre-redesign key is migrated once into the ":stale" slot so the restore banner can offer it.
export const LEGACY_STORAGE_PREFIX = "ontology-studio-demo-v2";
export const store = window.DC && window.DC.store;
if (!store) {
  console.error("core/store.js must be loaded before demo/js/main.js");
}
export const MAX_GRAPH_NODES = 84;
export const DEFAULT_MAP_VIEW = { center: [39, 16], zoom: 3 };
export const APP_TITLE = "Investigate (Gotham-style)";
export const ANALYST_TOOLS = {
  copilot: "Agent (simulated AIP)",
  investigations: "Investigations",
  analytics: "Analytics",
  map: "Map",
  leads: "Leads",
  "object-sets": "Object sets",
};

export const SCHEMA_TOOLS = {
  "entity-types": "Object types",
  properties: "Properties",
  relationships: "Link types",
  mappings: "Backing datasets",
  instances: "Objects",
  graph: "Graph Explorer",
};

// Honesty label per tab (contract §2; the text lives in the seed's governance.honesty).
export const TOOL_HONESTY = {
  copilot: "inv.agent",
  investigations: "inv.investigations",
  analytics: "inv.analytics",
  map: "inv.map",
  leads: "inv.leads",
  "object-sets": "inv.object-sets",
  "entity-types": "inv.object-types",
  properties: "inv.properties",
  relationships: "inv.link-types",
  mappings: "inv.backing-datasets",
  instances: "inv.objects",
  graph: "inv.graph",
};

export const TOOL_LABELS = { ...ANALYST_TOOLS, ...SCHEMA_TOOLS };

export const datasetCatalog = normalizeSeedCatalog(window.ontologySeedCatalog || { starter: window.ontologySeed || {} });
export const datasetKeys = Object.keys(datasetCatalog);
export const defaultDatasetKey = datasetCatalog.starter ? "starter" : datasetKeys[0];
export const core = window.DC || {};

export const ui = {
  datasetKey: defaultDatasetKey,
  activeTool: "investigations",
  selectedEntityTypeId: "",
  selectedRelationshipId: "",
  selectedMappingId: "",
  selectedEntityId: "",
  selectedGraphNodeId: "",
  selectedScenarioId: "",
  selectedAnalyticsRuleId: "",
  selectedMapNodeId: "",
  graphMode: "instance",
  graphTypeFilter: "all",
  graphSearch: "",
  mapScope: "dataset",
  mapPlaceFilter: "all",
  mapSearch: "",
  mapViewCenter: [...DEFAULT_MAP_VIEW.center],
  mapViewZoom: DEFAULT_MAP_VIEW.zoom,
  mapViewDirty: false,
  inspectorMode: "insight",
  // Telecom expansions approved through a Checkpoint this page session (object ids).
  telecomExpanded: new Set(),
  telecomRecords: {},
  // Phone-number queries approved through a Checkpoint (normalised digits).
  approvedPhoneQueries: new Set(),
  // Action drawer (F5): {open, objectId, typeId, params, errors, tried, result, exceptRules, exceptionRecordId}
  actionDrawer: { open: false, objectId: "", typeId: "", params: {}, errors: {}, tried: false, result: null, exceptRules: [], exceptionRecordId: null },
  // Purpose-rule exceptions granted through cp-exception this page session (F9): key -> {recordId, rules: [ruleId]}
  purposeExceptions: new Map(),
  // Leads (F8): selected lead row, the Close lead form, the map layer toggle.
  selectedLeadId: "",
  leadClose: { outcome: "", reason: "", result: null },
  mapLeads: false,
  // Object sets (F11): selected set and the two versions compared.
  selectedSetId: "",
  setDiff: { from: 0, to: 0 },
};

// ── Shared mutable state ──
// Declared only here. Importers see the current value (live bindings) and reassign through the
// setters below; property writes (ui.activeTool = …, fullData.edges = …) need no setter.
// Everything starts empty and is filled by initState(), which main.js calls once at boot.

// Banner state for the saved-edits notice: {kind: "regenerated" | "schema-changed" | "missing-object", ...}
export let storeNotice = null;
export let seedData = null;
// fullData: the editable ontology as stored (every object, every property). data: what the
// current role may see, rebuilt from fullData on every render BEFORE buildDerivedState(), so
// analytics, scenarios, the agent, the map and the graph only ever read the role's view.
export let fullData = null;
export let data = null;
export let roleView = null;
export let derived = null;
export const analysisState = { analytics: [], investigations: [], actionLog: [] };
// Agent (F7): query, the last run (trace, answer, staged edit ids, evals) and the cited id highlighted in
// the answer graph. result mirrors {graph, focusEntityIds} of the run for the map's "Agent answer" scope.
export let copilotState = emptyAgentState();
export function emptyAgentState() {
  return { query: "", result: null, run: null, running: false, highlight: "", objectSetId: null };
}
export const walkthroughState = { active: false, step: 0 };
export let lastViewedId = "";

export const root = document.getElementById("app");

export function setStoreNotice(value) {
  storeNotice = value;
}

export function setFullData(value) {
  fullData = value;
}

export function setSeedData(value) {
  seedData = value;
}

export function resetCopilotState() {
  copilotState = emptyAgentState();
}

export function setLastViewedId(value) {
  lastViewedId = value;
}

// Boot step 2 (main.js): governance block, stored ontology, role view, derived lookups — in this
// order, before anything renders.
export function initState() {
  initGovernance(defaultDatasetKey);
  seedData = clone(datasetCatalog[defaultDatasetKey] || {});
  fullData = loadState(defaultDatasetKey);
  data = fullData;
  roleView = null;
  rebuildRoleView();
  derived = buildDerivedState();
}

export function normalizeSeedCatalog(rawCatalog) {
  const catalog = {};
  Object.entries(rawCatalog || {}).forEach(([datasetKey, seed]) => {
    if (!seed || typeof seed !== "object") {
      return;
    }
    const copy = clone(seed);
    copy.metadata = copy.metadata || {};
    copy.metadata.dataset = copy.metadata.dataset || datasetKey;
    catalog[datasetKey] = copy;
  });
  return catalog;
}

export function storageKey(datasetKey) {
  return store ? store.key("gotham", datasetKey) : `dc-palantir:gotham:${datasetKey}`;
}

// Load the editable ontology for a dataset. Versioning (§6.2): stored edits are used only when
// their schemaVersion and buildId match the seed; otherwise the seed wins and storeNotice drives
// the banner (restore / dismiss, or "format changed").
export function loadState(datasetKey) {
  const seed = datasetCatalog[datasetKey] || {};
  storeNotice = null;
  if (!store) {
    return clone(seed);
  }
  const result = store.loadVersioned(storageKey(datasetKey), seed, {
    legacyKey: `${LEGACY_STORAGE_PREFIX}:${datasetKey}`,
  });
  if (result.status === "schema-changed") {
    storeNotice = { kind: "schema-changed", datasetKey };
  } else if (result.hasStale) {
    storeNotice = { kind: "regenerated", datasetKey, migrated: result.migrated };
  }
  if (result.data && typeof result.data === "object") {
    return result.data;
  }
  return clone(seed);
}

export function persist() {
  if (!store) return;
  store.saveVersioned(storageKey(ui.datasetKey), datasetCatalog[ui.datasetKey] || {}, fullData);
}

export function restoreSavedEdits() {
  if (!store) return;
  const restored = store.restoreStale(storageKey(ui.datasetKey), datasetCatalog[ui.datasetKey] || {});
  if (restored && typeof restored === "object") {
    fullData = restored;
    copilotState = emptyAgentState();
  }
  storeNotice = null;
  render();
}

export function dismissStoreNotice() {
  if (store && storeNotice && storeNotice.kind === "regenerated") {
    store.dismissStale(storageKey(ui.datasetKey));
  }
  storeNotice = null;
  render();
}

export function switchDataset(datasetKey, options = {}) {
  if (!datasetCatalog[datasetKey]) {
    return;
  }
  ui.datasetKey = datasetKey;
  seedData = clone(datasetCatalog[datasetKey]);
  initGovernance(datasetKey);
  fullData = loadState(datasetKey);
  ui.telecomExpanded = new Set();
  ui.telecomRecords = {};
  ui.approvedPhoneQueries = new Set();
  ui.actionDrawer = { open: false, objectId: "", typeId: "", params: {}, errors: {}, tried: false, result: null, exceptRules: [], exceptionRecordId: null };
  ui.purposeExceptions = new Map();
  ui.graphSearch = "";
  ui.graphTypeFilter = "all";
  ui.graphMode = "instance";
  ui.selectedScenarioId = "";
  ui.selectedAnalyticsRuleId = "";
  ui.selectedGraphNodeId = "";
  ui.selectedEntityTypeId = "";
  ui.selectedRelationshipId = "";
  ui.selectedMappingId = "";
  ui.selectedEntityId = "";
  ui.selectedMapNodeId = "";
  ui.mapScope = "dataset";
  ui.mapPlaceFilter = "all";
  ui.mapSearch = "";
  ui.mapViewCenter = [...DEFAULT_MAP_VIEW.center];
  ui.mapViewZoom = DEFAULT_MAP_VIEW.zoom;
  ui.mapViewDirty = false;
  ui.selectedLeadId = "";
  ui.leadClose = { outcome: "", reason: "", result: null };
  ui.selectedSetId = "";
  ui.setDiff = { from: 0, to: 0 };
  copilotState = emptyAgentState();
  if (options.render !== false) {
    render();
  }
}

// Governance block plus the Phase 2 seed fields (purpose rules, action types, resolution candidates).
// Each is optional: without it the feature is hidden and nothing is blocked.
export function initGovernance(datasetKey) {
  const seed = datasetCatalog[datasetKey] || {};
  const governance = seed.governance || null;
  if (core.governance) core.governance.init(governance);
  if (core.purposes) {
    core.purposes.init((governance && governance.purposeRules) || [], { legalBasisNote: (governance && governance.legalBasisNote) || "" });
    core.purposes.registerSources(seed.sources || []);
  }
  if (core.actions) core.actions.init(seed.ontology?.actionTypes || [], seed.ontology?.externalSystems || []);
  if (core.resolution) core.resolution.init(seed.resolution || null);
}

export function rebuildRoleView() {
  const roleId = currentRoleId();
  // Evaluation order (spec §6.3): resolveAt → marking overrides → redact per role → derived state.
  const resolved = resolveFullData(fullData);
  const base = resolved.data;
  const view = {
    roleId,
    active: governanceActive(),
    removed: governanceActive() ? core.markings.removedAtOntology() : new Set(),
    withheldEntities: [],
    withheldById: new Map(),
    withheldByType: new Map(),
    withheldEdges: [],
    redactedCount: 0,
    storedById: new Map((fullData.entities || []).map((entity) => [entity.id, entity])),
    resolution: resolved.info,
  };
  if (!view.active) {
    data = base;
    roleView = view;
    return;
  }
  const entities = [];
  const visibleIds = new Set();
  (base.entities || []).forEach((entity) => {
    const redacted = core.markings.redactEntity(entity, roleId);
    if (redacted && redacted._withheld) {
      view.withheldEntities.push(redacted);
      view.withheldById.set(redacted.id, redacted);
      view.withheldByType.set(redacted.type, (view.withheldByType.get(redacted.type) || []).concat([redacted]));
      return;
    }
    visibleIds.add(entity.id);
    if (redacted && redacted._withheldProps) {
      view.redactedCount += 1;
      entities.push(redacted);
    } else {
      entities.push(entity); // same object: edits in the Objects tab write straight through
    }
  });
  const edges = [];
  (base.edges || []).forEach((edge) => {
    if (visibleIds.has(edge.source) && visibleIds.has(edge.target) && core.markings.edgeVisible(edge, roleId)) {
      edges.push(edge);
    } else {
      view.withheldEdges.push(edge);
    }
  });
  data = { ...base, entities, edges };
  roleView = view;
}

export function refreshView() {
  rebuildRoleView();
  derived = buildDerivedState();
}

export function storedEntityById(id) {
  return roleView.storedById.get(id) || (fullData.entities || []).find((entity) => entity.id === id);
}
