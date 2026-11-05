// demo/js/purpose-gate.js — Purpose rules in Investigate (spec §4.9, F9; contract §4).
// Mode off (default): nothing is blocked; expansions, rule runs and Actions log the purposes involved.
// Mode on: DC.purposes.check() per rule (the rule panel shows "blocked" instead of a ranking), per
// expansion (R3 swaps the telecom Checkpoint for cp-danger-statement) and per Action (the drawer).
// "Request exception" runs cp-exception; a granted exception holds for that operation for this page
// session (ui.purposeExceptions) and the record is tagged "exception".
import { core, fullData, roleView, ui } from "./state.js";
import { entityById } from "./derive.js";
import { lackingMarkings, logEvent } from "./governance.js";
import { render } from "./render/index.js";

export function purposesActive() {
  return Boolean(core.purposes && core.purposes.isActive());
}

export function karlsruheOn() {
  return purposesActive() && core.purposes.enabled();
}

// Purposes of the data behind a set of objects and links (markings ∪ sourceMarkings ⇒ purposes).
export function purposesOf(items) {
  if (!core.purposes) return [];
  return core.purposes.dataPurposesOf((items || []).filter(Boolean));
}

export function purposesOfIds(ids) {
  return purposesOf((ids || []).map((id) => entityById(id) || roleView.withheldById.get(id)));
}

export function exceptionFor(key) {
  return ui.purposeExceptions.get(key) || null;
}

export function check(operation, key, context) {
  if (!core.purposes) return { allowed: true, effect: "log", purposes: context?.dataPurposes || [], enabled: false, rule: null };
  const granted = exceptionFor(key);
  return core.purposes.check(operation, { ...(context || {}), except: granted ? granted.rules : [] });
}

// ── rules ──
// Annotates each rule with .purposes; when blocked, the hits move to .blockedHits and .blocked holds
// the check result, so scenarios built from it disappear as well.
// Fix round B 2.5.3: the purposes of everything the hits carry in the stored data (markings, source
// markings, markings of properties that hold a value, and links touching them: a clinic home address,
// RESIDES_AT), members of merged people included. Markings a DPO removed at the ontology do not count.
export function fullPurposesOfIds(ids) {
  if (!core.purposes || !fullData) return [];
  const wanted = new Set(ids || []);
  const repOf = roleView.resolution?.repOf || new Map();
  repOf.forEach((rep, member) => {
    if (wanted.has(rep)) wanted.add(member);
  });
  const removed = roleView.removed || new Set();
  const markings = new Set();
  const add = (list) => (list || []).forEach((marking) => marking && !removed.has(marking) && markings.add(marking));
  wanted.forEach((id) => {
    const entity = roleView.storedById.get(id);
    if (!entity) return;
    add(entity.markings);
    add(entity.sourceMarkings);
    Object.entries(entity.propertyMarkings || {}).forEach(([property, list]) => {
      const value = entity.properties ? entity.properties[property] : undefined;
      if (value !== undefined && value !== null && value !== "") add(list);
    });
  });
  (fullData.edges || []).forEach((edge) => {
    if (wanted.has(edge.source) || wanted.has(edge.target)) add(edge.markings);
  });
  return core.purposes.purposesForMarkings([...markings]);
}

// Annotates each rule with .purposes; when blocked, the hits move to .blockedHits and .blocked holds
// the check result, so scenarios built from it disappear as well. A role that can see HEALTH is checked
// against everything the hits carry (so R2 fires for the DPO under public order); a role that cannot is
// checked against what it sees, and .r2Note says R2 would also exclude the HEALTH data it is denied.
export function gateRules(analytics) {
  if (!purposesActive()) return analytics;
  const seesHealth = lackingMarkings(["HEALTH"]).length === 0;
  analytics.forEach((rule) => {
    const ids = [...new Set(rule.hits.flatMap((hit) => hit.focusEntityIds || []))];
    const visible = purposesOfIds(ids);
    const full = fullPurposesOfIds(ids);
    rule.purposes = seesHealth ? [...new Set([...visible, ...full])].sort() : visible;
    const key = `rule:${rule.id}`;
    const result = check("rule", key, { dataPurposes: rule.purposes });
    rule.exception = exceptionFor(key);
    rule.r2Note = null;
    if (!seesHealth && core.purposes.enabled() && full.includes("healthcare")) {
      const would = check("rule", key, { dataPurposes: [...new Set([...visible, ...full])] });
      if (!would.allowed && would.rule && would.rule.incompatible && (would.rule.incompatible.data || []).includes("healthcare")) rule.r2Note = would.rule.id;
    }
    if (!result.allowed && result.effect === "block") {
      rule.blocked = result;
      rule.blockedHits = rule.hits;
      rule.hits = [];
    }
  });
  return analytics;
}

// ── expansions (telecom: depth 2) ──
export const TELECOM_EXPANSION_DEPTH = 2;

export function expansionCheck(entityId, objectIds) {
  const purposes = purposesOfIds(objectIds);
  return check("expand", `expand:${entityId}`, { dataPurposes: purposes, depth: TELECOM_EXPANSION_DEPTH });
}

// ── exceptions ──
// key: "rule:<id>" | "expand:<entityId>" | "action:<typeId>:<objectId>"
export function requestPurposeException(key, result, context, then) {
  if (!core.purposes || !result || !result.rule) return Promise.resolve(null);
  return core.purposes
    .requestException(result, { surface: "investigate", ...(context || {}) }, (record) => {
      const previous = exceptionFor(key);
      ui.purposeExceptions.set(key, {
        recordId: record ? record.recordId : null,
        rules: [...new Set([...(previous ? previous.rules : []), result.rule.id])],
      });
      if (typeof then === "function") then(record);
      return logEvent({
        kind: "session",
        verb: "purpose.exception.granted",
        objectIds: context?.objectIds || [],
        checkpointId: record ? record.recordId : null,
        payload: { key, rule: result.rule.id, purposes: result.purposes, sessionPurpose: result.sessionPurpose, outcome: "granted", tags: ["exception"] },
      });
    })
    .then((answer) => {
      render();
      return answer;
    });
}

// Payload fragment every expansion / rule run / Action logs (mode on or off).
export function purposePayload(result) {
  if (!result) return {};
  return { purposes: result.purposes || [], karlsruhe: Boolean(result.enabled), ...(result.rule ? { rule: result.rule.id } : {}) };
}
