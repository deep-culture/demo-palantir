// demo/js/main.js — Boot: deep links and the explicit initialisation order (see the numbered steps below).
import {
  core,
  datasetCatalog,
  initState,
  refreshView,
  roleView,
  root,
  setLastViewedId,
  setStoreNotice,
  storeNotice,
  switchDataset,
  ui,
} from "./state.js";
import { logEvent, logView } from "./governance.js";
import { entityById } from "./derive.js";
import { render } from "./render/index.js";
import { handleChange, handleClick, handleFocusOut, handleInput, handleKeydown } from "./events.js";
import { applyEffects } from "./actions-ui.js";
import { forgetRoleState } from "./state.js";

// ── Deep links (F0.5): #object=<entityId>[&dataset=<key>] ──
export function parseDeepLink(hash) {
  const text = String(hash || "").replace(/^#/, "");
  if (!text) return null;
  const params = new URLSearchParams(text);
  const objectId = params.get("object");
  if (!objectId) return null;
  return { objectId, dataset: params.get("dataset") || "" };
}

// Returns true when the hash held a deep link (found or not), so the caller can render.
export function applyDeepLink(hash) {
  const link = parseDeepLink(hash);
  if (!link) return false;
  if (link.dataset && link.dataset !== ui.datasetKey && datasetCatalog[link.dataset]) {
    switchDataset(link.dataset, { render: false });
  }
  refreshView();
  const entity = entityById(link.objectId);
  if (!entity) {
    const hidden = roleView.withheldById.get(link.objectId);
    if (hidden) {
      setStoreNotice({ kind: "withheld-object", objectId: link.objectId, markings: hidden._withheld });
      logEvent({ kind: "view", verb: "object.view", objectIds: [link.objectId], payload: { via: "deep-link", outcome: "withheld" } });
      return true;
    }
    console.warn(`Deep link: no entity ${link.objectId} in dataset ${ui.datasetKey}`);
    if (!storeNotice) {
      setStoreNotice({ kind: "missing-object", objectId: link.objectId });
    }
    return true;
  }
  logView(entity.id, "deep-link");
  ui.activeTool = "graph";
  ui.graphMode = "instance";
  ui.graphTypeFilter = "all";
  ui.graphSearch = "";
  ui.selectedEntityTypeId = entity.type;
  ui.selectedEntityId = entity.id;
  ui.entityPicked = true;
  ui.selectedGraphNodeId = entity.id;
  ui.inspectorMode = "insight";
  return true;
}

export function scrollSelectedGraphNodeIntoView() {
  requestAnimationFrame(() => {
    // Scroll only the graph canvas (not the page), so the header and tabs stay in view.
    const node = root.querySelector(".graph-node.selected");
    const canvas = node && node.closest(".graph-canvas");
    if (!canvas) return;
    const nodeRect = node.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    canvas.scrollTop += nodeRect.top - canvasRect.top - canvas.clientHeight / 2;
    canvas.scrollLeft += nodeRect.left - canvasRect.left - canvas.clientWidth / 2;
  });
}

// ── Boot ──
// The order is explicit so nothing renders before the state it reads exists (Phase 0 hit a
// temporal-dead-zone bug when a deep link rendered before a const was initialised). All imported
// modules have finished evaluating before this code runs: main.js is the entry point and nothing
// imports it.

// 1. Tell the shared session which surface this page is.
if (core.session) core.session.setSurface("investigate");

// 2. Governance block, stored ontology, role view, derived lookups (state.js).
initState();

// 2b. Actions staged elsewhere (Phase 3 agent) are applied to this app's data by the same applier.
if (core.actions) core.actions.registerApplier(applyEffects);

// 3. One listener per event type on #app; events.js dispatches on data-action / data-scope.
root.addEventListener("click", handleClick);
root.addEventListener("change", handleChange);
root.addEventListener("input", handleInput);
root.addEventListener("keydown", handleKeydown);
root.addEventListener("focusout", handleFocusOut);

// 4. Apply a deep link (may switch dataset and select an object), then the first render.
const openedFromLink = applyDeepLink(window.location.hash);
render();
if (openedFromLink) {
  scrollSelectedGraphNodeIntoView();
}

// 5. Role switches (here, in Build, or in another tab), DPO marking overrides, the resolution threshold
// and unmerges (here or in Build), and Actions written in another tab re-render everything. Several of
// these fire for one storage write, so the render is batched.
let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  setTimeout(() => {
    renderQueued = false;
    render();
  }, 0);
}
// Review F-03 / F-10: a role change (here or in another tab) drops what the previous role saw or was
// granted: the agent run (answer, graph, trace) and the telecom / phone-search Checkpoint caches.
let lastRole = core.session ? core.session.get().role : "";
if (core.session) {
  core.session.onChange((session) => {
    setLastViewedId("");
    if (session && session.role !== lastRole) {
      lastRole = session.role;
      forgetRoleState();
    }
    render();
  });
}
if (core.markings) core.markings.onChange(() => scheduleRender());
if (core.resolution) core.resolution.onChange(() => scheduleRender());
if (core.actions) core.actions.onChange((info) => info && info.source === "storage" && scheduleRender());
if (core.objectSets) core.objectSets.onChange((info) => info && info.source === "storage" && scheduleRender());
window.addEventListener("hashchange", () => {
  if (applyDeepLink(window.location.hash)) {
    render();
    scrollSelectedGraphNodeIntoView();
  }
});
