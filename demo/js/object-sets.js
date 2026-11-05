// demo/js/object-sets.js — Object sets in Investigate (spec §4.11 F11; contract §3): save a graph selection, rule
// hits, a search result or an agent answer as a versioned set (DC.objectSets, stored in
// dc-palantir:governance.objectSets), compare versions, simulate sharing by role, and hand a set to the agent.
import { analysisState, copilotState, core, roleView, ui } from "./state.js";
import { currentRoleId } from "./governance.js";
import { entityById } from "./derive.js";
import { buildInstanceGraph } from "./render/graph.js";
import { render } from "./render/index.js";
import { runAgentOnSet } from "./agent-run.js";

export function setsActive() {
  return Boolean(core.objectSets);
}

function stamp() {
  return new Date().toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

// What a "Save as object set" button saves, by data-source.
export function membersFor(source, id) {
  if (source === "rule") {
    const rule = analysisState.analytics.find((item) => item.id === id);
    return { ids: rule ? [...new Set(rule.hits.flatMap((hit) => hit.focusEntityIds || []))] : [], name: `Rule hits: ${rule ? rule.title : id}`, source: `rule:${id}` };
  }
  if (source === "agent") {
    const run = copilotState.run;
    return { ids: run ? run.graph.nodes.map((node) => node.id) : [], name: `Agent answer: ${run ? run.query.slice(0, 40) : ""}`, source: `agent:${run ? run.id : ""}` };
  }
  if (source === "selected") {
    return { ids: ui.selectedEntityId ? [ui.selectedEntityId] : [], name: `Selection: ${entityById(ui.selectedEntityId)?.label || ui.selectedEntityId}`, source: "selection" };
  }
  const graph = buildInstanceGraph();
  const search = ui.graphSearch.trim();
  return { ids: graph.nodes.map((node) => node.id), name: search ? `Search: “${search}”` : `Graph view (${ui.graphTypeFilter === "all" ? "all types" : ui.graphTypeFilter})`, source: search ? "search" : "graph" };
}

export function visibleSets() {
  return setsActive() ? core.objectSets.list({ datasetId: ui.datasetKey, role: currentRoleId() }) : [];
}

export function hiddenSetCount() {
  return setsActive() ? core.objectSets.list({ datasetId: ui.datasetKey }).length - visibleSets().length : 0;
}

export function selectedSet() {
  const sets = visibleSets();
  return sets.find((set) => set.id === ui.selectedSetId) || sets[0] || null;
}

// Members the role cannot see (withheld, or merged into another person at this threshold) are counted only.
export function splitMembers(ids) {
  const visible = [];
  const merged = [];
  let withheld = 0;
  (ids || []).forEach((id) => {
    if (entityById(id)) visible.push(id);
    else if (roleView.resolution?.repOf?.get(id) && entityById(roleView.resolution.repOf.get(id))) merged.push(id);
    else withheld += 1;
  });
  return { visible, merged, withheld };
}

async function saveFrom(source, id) {
  const picked = membersFor(source, id);
  if (!picked.ids.length) return;
  const set = await core.objectSets.save({ name: `${picked.name} · ${stamp()}`, memberIds: picked.ids, datasetId: ui.datasetKey, source: picked.source });
  ui.selectedSetId = set.id;
  ui.setDiff = { from: 1, to: 1 };
  ui.activeTool = "object-sets";
  render();
}

export const SET_CLICKS = {
  "save-object-set"(target) {
    if (setsActive()) saveFrom(target.dataset.source, target.dataset.id || "");
  },
  "select-set"(target) {
    ui.selectedSetId = target.dataset.id;
    const set = core.objectSets.get(target.dataset.id);
    const last = set ? set.versions.length : 0;
    ui.setDiff = { from: Math.max(1, last - 1), to: last };
    render();
  },
  async "set-add-selected"(target) {
    const set = core.objectSets.get(target.dataset.id);
    if (!set || !ui.selectedEntityId || !ui.entityPicked) return;
    await core.objectSets.update(set.id, { add: [ui.selectedEntityId] });
    const updated = core.objectSets.get(set.id);
    ui.setDiff = { from: updated.versions.length - 1, to: updated.versions.length };
    render();
  },
  async "set-add-rule"(target) {
    const set = core.objectSets.get(target.dataset.id);
    if (!set) return;
    const picked = membersFor("rule", ui.selectedAnalyticsRuleId);
    await core.objectSets.update(set.id, { add: picked.ids });
    const updated = core.objectSets.get(set.id);
    ui.setDiff = { from: Math.max(1, updated.versions.length - 1), to: updated.versions.length };
    render();
  },
  async "set-remove-member"(target) {
    await core.objectSets.update(target.dataset.id, { remove: [target.dataset.member] });
    const updated = core.objectSets.get(target.dataset.id);
    ui.setDiff = { from: updated.versions.length - 1, to: updated.versions.length };
    render();
  },
  async "set-delete"(target) {
    await core.objectSets.remove(target.dataset.id);
    ui.selectedSetId = "";
    render();
  },
  "set-summarise"(target) {
    const set = core.objectSets.get(target.dataset.id);
    if (set) runAgentOnSet(set);
  },
};

export const SET_CHANGES = {
  "set-share"(target) {
    const set = core.objectSets.get(target.dataset.id);
    if (!set) return;
    const roles = new Set(set.sharedWith || []);
    if (target.checked) roles.add(target.dataset.role);
    else roles.delete(target.dataset.role);
    core.objectSets.share(set.id, [...roles]).then(() => render());
  },
  "set-diff"(target) {
    ui.setDiff = { ...ui.setDiff, [target.dataset.field]: Number(target.value) };
    render();
  },
};
