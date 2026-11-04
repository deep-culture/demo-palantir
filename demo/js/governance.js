// demo/js/governance.js — Governance glue: role checks, withheld-object notes, the telecom and phone-search
// Checkpoints, and the audit logging helpers (DC.audit).
import { analysisState, core, derived, lastViewedId, roleView, setLastViewedId, ui } from "./state.js";
import { entityById, incomingEdges, outgoingEdges } from "./derive.js";
import { render } from "./render/index.js";
import { expansionCheck, purposePayload, purposesOfIds, TELECOM_EXPANSION_DEPTH } from "./purpose-gate.js";

// ── Governance: role view, withheld objects, telecom checkpoint, phone search, audit ──
// Spec §4.1, §4.3, §4.4, §6.3; contract §3, §6. Evaluation order on every render:
// markingOverrides (DC.markings.removedAtOntology) → redactEntity / edgeVisible per object for the
// current role → buildDerivedState → analytics, scenarios, agent, map, graph.
export const TELECOM_LINK_TYPES = ["USES_DEVICE", "OBSERVED_AT"];

export function governanceActive() {
  return Boolean(core.governance && core.governance.isActive() && core.markings);
}

export function currentRoleId() {
  return core.session ? core.session.get().role : "";
}

export function currentRole() {
  return core.governance ? core.governance.role(currentRoleId()) : null;
}

export function checkpointDefined(trigger) {
  return Boolean(governanceActive() && core.checkpoints && core.governance.checkpoint(trigger));
}

export function isWithheldValue(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Array.isArray(value.withheld);
}

// Property values the role may see (withheld placeholders contribute nothing to search or scores).
export function visiblePropertyValues(entity) {
  return Object.values(entity?.properties || {}).filter((value) => !isWithheldValue(value));
}

// Markings the role lacks, ignoring markings a DPO removed at the ontology.
export function lackingMarkings(markings) {
  if (!roleView.active) return [];
  const list = (markings || []).filter((marking) => !roleView.removed.has(marking));
  return core.markings.missing(roleView.roleId, list);
}

// What is hidden around a set of objects: withheld links touching them and withheld objects at
// the far end. Used for "N objects withheld" notes on scenarios, the inspector and the agent.
export function withheldAround(entityIds) {
  const ids = new Set(entityIds || []);
  const result = { links: 0, objects: 0, markings: [] };
  if (!roleView.active || !ids.size) return result;
  const markings = new Set();
  const hidden = new Set();
  roleView.withheldEdges.forEach((edge) => {
    if (!ids.has(edge.source) && !ids.has(edge.target)) return;
    if (ids.has(edge.source) && ids.has(edge.target)) return;
    result.links += 1;
    const otherId = ids.has(edge.source) ? edge.target : edge.source;
    const other = roleView.withheldById.get(otherId);
    if (other) {
      hidden.add(otherId);
      other._withheld.forEach((marking) => markings.add(marking));
    }
    lackingMarkings(edge.markings).forEach((marking) => markings.add(marking));
  });
  result.objects = hidden.size;
  result.markings = [...markings].sort();
  return result;
}

export function markingsLabel(markings) {
  return (markings || []).join(", ");
}

// ── Telecom expansion gate (cp-expand-telecom) ──
// Telecom links (person → device → observed place) are not traversed by scenario, agent or graph
// expansions until the analyst passes the Checkpoint for that person (or place).
export function telecomGateActive() {
  return checkpointDefined("graph.expand.telecom");
}

export function isTelecomEdge(edge) {
  if (Array.isArray(edge.markings)) return edge.markings.includes("TELECOM") && !roleView.removed.has("TELECOM");
  return TELECOM_LINK_TYPES.includes(edge.type);
}

export function telecomEdgeAllowed(edge) {
  if (!telecomGateActive() || !isTelecomEdge(edge)) return true;
  const expanded = ui.telecomExpanded;
  if (expanded.has(edge.source) || expanded.has(edge.target)) return true;
  if (edge.type === "OBSERVED_AT") {
    return (derived.edgesByTarget.get(edge.source) || []).some((use) => use.type === "USES_DEVICE" && expanded.has(use.source));
  }
  return false;
}

export function telecomExpansionTargets(entity) {
  if (entity.type === "Person") {
    const devices = outgoingEdges(entity.id, "USES_DEVICE").map((edge) => edge.target);
    const places = new Set();
    devices.forEach((deviceId) => outgoingEdges(deviceId, "OBSERVED_AT").forEach((edge) => places.add(edge.target)));
    return {
      objectIds: [entity.id, ...devices, ...places],
      count: devices.length + places.size,
      summary: `${entity.label} → ${devices.length} device${devices.length === 1 ? "" : "s"} → ${places.size} observed place${places.size === 1 ? "" : "s"}`,
    };
  }
  const devices = incomingEdges(entity.id, "OBSERVED_AT").map((edge) => edge.source);
  const people = new Set();
  devices.forEach((deviceId) => incomingEdges(deviceId, "USES_DEVICE").forEach((edge) => people.add(edge.source)));
  return {
    objectIds: [entity.id, ...devices, ...people],
    count: devices.length + people.size,
    summary: `${entity.label} → ${devices.length} device${devices.length === 1 ? "" : "s"} observed here → ${people.size} ${people.size === 1 ? "person" : "people"}`,
  };
}

export function expandTelecom(entityId) {
  const entity = entityById(entityId);
  if (!entity) return;
  const targets = telecomExpansionTargets(entity);
  // Purpose rules (F9): blocked → the inspector shows the red card; R3 → the danger statement replaces
  // the telecom Checkpoint. Mode off: allowed, and the purposes are logged.
  const gate = expansionCheck(entity.id, targets.objectIds);
  const purposeInfo = purposePayload(gate);
  if (!gate.allowed && gate.effect === "block") {
    logEvent({
      kind: "expand",
      verb: "graph.expand.telecom",
      objectIds: [entity.id],
      payload: { from: entity.id, depth: TELECOM_EXPANSION_DEPTH, outcome: "blocked", ...purposeInfo },
    }).then(() => render());
    return;
  }
  const danger = gate.effect === "checkpoint" && gate.checkpointId && checkpointDefined(gate.checkpointId);
  const checkpoint = danger ? gate.checkpointId : "graph.expand.telecom";
  const summary = danger ? `${targets.summary} — beyond the first hop (rule ${gate.rule.id})` : targets.summary;
  core.checkpoints
    .withCheckpoint(checkpoint, { surface: "investigate", objectIds: targets.objectIds, summary, rule: danger ? gate.rule.id : null, purposes: gate.purposes }, (record) => {
      ui.telecomExpanded.add(entity.id);
      ui.telecomRecords[entity.id] = record ? record.recordId : "";
      return logEvent({
        kind: "expand",
        verb: "graph.expand.telecom",
        objectIds: targets.objectIds,
        checkpointId: record ? record.recordId : null,
        payload: { from: entity.id, depth: TELECOM_EXPANSION_DEPTH, resultCount: targets.count, ...purposeInfo, ...(danger ? { checkpoint } : {}) },
      });
    })
    .then(() => render());
}

// ── Phone-number search (cp-search-phone) ──
export function looksLikePhone(text) {
  const value = String(text || "").trim();
  if (!/^\+?[\d\s\-().]+$/.test(value)) return false;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return false; // a date, not a number
  return value.replace(/\D/g, "").length >= 7;
}

export function phoneKey(text) {
  return String(text || "").replace(/\D/g, "");
}

export function phoneNumbersIn(text) {
  return (String(text || "").match(/\+?\d[\d\s\-().]{5,}\d/g) || []).filter(looksLikePhone);
}

// A phone query is held (not applied) until the Checkpoint has been passed for that number.
export function phoneSearchHeld(text) {
  return checkpointDefined("search.byPhone") && looksLikePhone(text) && !ui.approvedPhoneQueries.has(phoneKey(text));
}

export function effectiveSearch(text) {
  return phoneSearchHeld(text) ? "" : text;
}

export function requestPhoneSearch(scope, query, then) {
  const role = currentRole();
  return core.checkpoints
    .withCheckpoint("search.byPhone", { surface: "investigate", objectIds: [], summary: `Search ${scope} for “${query.trim()}”` }, (record) => {
      ui.approvedPhoneQueries.add(phoneKey(query));
      const resultCount = typeof then === "function" ? then() : undefined;
      return logEvent({
        kind: "search",
        verb: "search.byPhone",
        checkpointId: record ? record.recordId : null,
        payload: { scope, query: query.trim(), role: role ? role.id : "", resultCount },
      });
    })
    .then(() => render());
}

// ── Audit ──
export function logEvent(partial) {
  if (!core.audit) return Promise.resolve(null);
  const payload = { dataset: ui.datasetKey, ...(partial.payload || {}) };
  return core.audit.logEvent({ surface: "investigate", ...partial, payload }).catch((error) => {
    console.warn("[investigate] audit write failed", error);
    return null;
  });
}

export function logView(entityId, via) {
  const entity = entityById(entityId);
  if (!entity || entityId === lastViewedId) return;
  setLastViewedId(entityId);
  logEvent({ kind: "view", verb: "object.view", objectIds: [entityId], payload: { type: entity.type, via } });
}

export function logScenarioOpen(scenarioId) {
  const scenario = analysisState.investigations.find((item) => item.id === scenarioId);
  if (!scenario) return;
  logEvent({
    kind: "view",
    verb: "scenario.open",
    objectIds: scenario.focusEntityIds,
    payload: { scenarioId, title: scenario.title, score: scenario.score, ...scenarioPurposes(scenario) },
  });
}

export function logRuleOpen(ruleId) {
  const rule = analysisState.analytics.find((item) => item.id === ruleId);
  if (!rule) return;
  // A rule run: the purposes of the data it ranks are logged (mode on or off); a blocked rule logs the rule.
  const purposes = rule.purposes || purposesOfIds(rule.hits.flatMap((hit) => hit.focusEntityIds || []));
  logEvent({
    kind: "view",
    verb: "rule.open",
    payload: {
      ruleId,
      title: rule.title,
      hits: rule.hits.length,
      purposes,
      karlsruhe: Boolean(core.purposes && core.purposes.enabled()),
      ...(rule.blocked ? { outcome: "blocked", rule: rule.blocked.rule.id } : {}),
    },
  });
}

function scenarioPurposes(scenario) {
  if (!core.purposes || !core.purposes.isActive()) return {};
  return { purposes: purposesOfIds(scenario.graph.nodes.map((node) => node.id)), karlsruhe: core.purposes.enabled() };
}

export function logSearch(scope, query, resultCount) {
  const text = String(query || "").trim();
  if (!text || phoneSearchHeld(text)) return;
  logEvent({ kind: "search", verb: `${scope}.search`, payload: { query: text, resultCount } });
}
