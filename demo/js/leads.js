// demo/js/leads.js — Leads (spec §4.8, F8; contract §1, §3): the leads block of the seed, recomputed per role.
//
// The seed's lead-level address, lat, lon and score are the ALL-MARKINGS view (for the namesake they are
// his clinic home address). They are never rendered. Every row is rebuilt from the components the role
// can see and that Karlsruhe mode allows (DC.leads.split): visible score, best visible address and its
// coordinates. Resolution applies too: when two Persons merge at the current threshold, their leads
// become one lead on the representative, with the union of their components.
// Leads are not ontology objects; they live in fullData.leads.items, so Reset dataset clears closed leads.
import { clone } from "./util.js";
import { core, datasetCatalog, fullData, persist, roleView, ui } from "./state.js";
import { currentRoleId } from "./governance.js";
import { entityById } from "./derive.js";
import { render } from "./render/index.js";

export function leadsBlock() {
  if (!fullData) return null;
  if (!fullData.leads && datasetCatalog[ui.datasetKey]?.leads) {
    fullData.leads = clone(datasetCatalog[ui.datasetKey].leads);
  }
  const block = fullData.leads;
  return block && Array.isArray(block.items) ? block : null;
}

export function leadsActive() {
  return Boolean(leadsBlock() && core.leads);
}

function componentKey(component) {
  return core.leads.key(component);
}

// One row per (resolved) person. Hidden persons count as withheld leads; their rows are not built.
export function buildLeadRows() {
  const block = leadsBlock();
  if (!block || !core.leads) return { rows: [], withheldLeads: 0, block: null };
  const repOf = roleView.resolution?.repOf || new Map();
  const groups = new Map();
  block.items.forEach((item) => {
    const rep = repOf.get(item.personId) || item.personId;
    if (!groups.has(rep)) groups.set(rep, []);
    groups.get(rep).push(item);
  });
  const rows = [];
  let withheldLeads = 0;
  const roleId = currentRoleId();
  groups.forEach((items, personId) => {
    const person = entityById(personId);
    if (!person) {
      withheldLeads += 1;
      return;
    }
    const seen = new Set();
    const components = [];
    items.forEach((item) =>
      (item.components || []).forEach((component) => {
        const key = componentKey(component);
        if (seen.has(key)) return;
        seen.add(key);
        components.push(component);
      })
    );
    const primary = items.find((item) => item.personId === personId) || items[0];
    const lead = { id: primary.id, personId, components, formula: block.formula || primary.formula, asOf: block.asOf || primary.asOf, memberIds: items.map((item) => item.id) };
    const split = core.leads.split(lead, { roleId });
    const best = split.best;
    const status = items.every((item) => item.status === "closed") ? "closed" : items.some((item) => item.status === "closed") ? "partly closed" : primary.status || "open";
    rows.push({
      lead,
      items,
      person,
      split,
      merged: items.length > 1,
      score: split.visibleScore,
      fullScore: split.fullScore,
      address: best ? best.address || "" : "",
      lat: best && Number.isFinite(Number(best.lat)) ? Number(best.lat) : null,
      lon: best && Number.isFinite(Number(best.lon)) ? Number(best.lon) : null,
      ageDays: best ? best.ageDays : null,
      bestSource: best ? best.source : "",
      status,
      outcome: primary.outcome || "",
      closeReason: primary.closeReason || "",
    });
  });
  rows.sort((left, right) => right.score - left.score || left.person.label.localeCompare(right.person.label));
  rows.forEach((row, index) => {
    row.rank = index + 1;
  });
  return { rows, withheldLeads, block };
}

export function selectedLeadRow(rows) {
  return rows.find((row) => row.lead.id === ui.selectedLeadId || row.lead.memberIds.includes(ui.selectedLeadId)) || rows[0] || null;
}

// ── Close lead (act-close-lead) ──
export function closeLeadType() {
  return core.actions && core.actions.type("act-close-lead");
}

// The Action sees only what the role sees: the visible score and address, never the seed's top-level ones.
export function leadActionObject(row) {
  return {
    id: row.lead.id,
    type: "Lead",
    label: `Lead for ${row.person.label}`,
    properties: { status: row.status, outcome: row.outcome, closeReason: row.closeReason, personId: row.person.id, score: row.score, address: row.address },
    markings: [...new Set(row.split.visible.map((component) => component.marking).filter(Boolean))],
    sourceMarkings: [...new Set(row.split.visible.map((component) => component.marking).filter(Boolean))],
  };
}

export function applyLeadEffects(effects, ctx) {
  const block = leadsBlock();
  if (!block) return {};
  const ids = new Set(ctx.object?.memberIds || [ctx.objectId]);
  const items = block.items.filter((item) => ids.has(item.id));
  const before = {};
  const after = {};
  effects.forEach((effect) => {
    if (effect.op !== "setProperty") return;
    items.forEach((item) => {
      if (!(effect.property in before)) before[effect.property] = item[effect.property] ?? "";
      item[effect.property] = effect.value;
    });
    after[effect.property] = effect.value;
  });
  items.forEach((item) => {
    item.closedBy = ctx.role;
    item.closedAt = ctx.ts;
    item.closeActionId = ctx.instanceId;
  });
  persist();
  return { before, after };
}

export async function closeSelectedLead() {
  const { rows } = buildLeadRows();
  const row = selectedLeadRow(rows);
  const actionType = closeLeadType();
  if (!row || !actionType) return;
  const object = { ...leadActionObject(row), memberIds: row.lead.memberIds };
  const result = await core.actions.applyAction(actionType.id, row.lead.id, { outcome: ui.leadClose.outcome, reason: ui.leadClose.reason }, {
    object,
    surface: "investigate",
    datasetId: ui.datasetKey,
    dataPurposes: core.purposes ? core.purposes.purposesForMarkings(object.markings) : [],
    apply: (effects, ctx) => applyLeadEffects(effects, { ...ctx, object }),
  });
  ui.leadClose = result.outcome === "applied" ? { outcome: "", reason: "", result } : { ...ui.leadClose, result };
  render();
}

export const LEAD_CLICKS = {
  "select-lead"(target) {
    ui.selectedLeadId = target.dataset.id;
    ui.leadClose = { outcome: "", reason: "", result: null };
    render();
  },
  "close-lead"() {
    closeSelectedLead();
  },
  "leads-on-map"() {
    ui.activeTool = "map";
    ui.mapLeads = true;
    ui.mapViewDirty = false;
    render();
  },
};

export const LEAD_INPUTS = {
  "lead-close"(target) {
    if (target.tagName === "SELECT") return;
    ui.leadClose = { ...ui.leadClose, [target.dataset.field]: target.value, result: null };
  },
};

export const LEAD_CHANGES = {
  "lead-close"(target) {
    ui.leadClose = { ...ui.leadClose, [target.dataset.field]: target.value, result: null };
    if (target.tagName === "SELECT") render();
  },
  "map-leads"(target) {
    ui.mapLeads = target.checked;
    ui.mapViewDirty = false;
    render();
  },
};
