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
import { handleChange, handleClick, handleInput, handleKeydown } from "./events.js";

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

// 3. One listener per event type on #app; events.js dispatches on data-action / data-scope.
root.addEventListener("click", handleClick);
root.addEventListener("change", handleChange);
root.addEventListener("input", handleInput);
root.addEventListener("keydown", handleKeydown);

// 4. Apply a deep link (may switch dataset and select an object), then the first render.
const openedFromLink = applyDeepLink(window.location.hash);
render();
if (openedFromLink) {
  scrollSelectedGraphNodeIntoView();
}

// 5. Role switches (here, in Build, or in another tab) and DPO marking overrides re-render everything.
if (core.session) {
  core.session.onChange(() => {
    setLastViewedId("");
    render();
  });
}
if (core.markings) core.markings.onChange(() => render());
window.addEventListener("hashchange", () => {
  if (applyDeepLink(window.location.hash)) {
    render();
    scrollSelectedGraphNodeIntoView();
  }
});
