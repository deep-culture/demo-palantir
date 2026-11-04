// demo/js/agent-tools.js — The agent's six tools (spec §4.7 table; contract §2). Every tool reads only the role
// view (`data`, rebuilt from fullData through resolution and markings), so withheld objects never reach it.
// On top of that:
//   - markings: a tool that asks for a link type whose marking the role lacks is DENIED (not silently
//     emptied): "marking FIN not visible to role patrol";
//   - purposes (Karlsruhe mode on): R1 (no session purpose) denies the step; R2 drops results whose data
//     was collected for healthcare when the session purpose is law enforcement (if nothing is left, the step
//     is denied); R3 (depth > 1) turns the telecom Checkpoint into the danger statement;
//   - Checkpoints: expanding across telecom links runs cp-expand-telecom (or cp-danger-statement); a
//     cancelled or refused Checkpoint denies the step;
//   - Actions: propose_action stages through DC.actions.applyAction(…, {staged: true}) with the USER's role.
// Each tool returns {resultIds, denied, reason, withheld, note, rule, purposes, checkpointRecordId,
// unavailable, data}; agent-run.js logs one "agent" audit event per call (DC.agent.logToolCall).
import { analysisState, core, data, fullData, roleView, ui } from "./state.js";
import { checkpointDefined, currentRoleId, lackingMarkings, telecomEdgeAllowed, telecomGateActive } from "./governance.js";
import { edgesForEntity, entityById } from "./derive.js";
import { collectEntityMatches } from "./agent.js";
import { karlsruheOn, purposesOfIds } from "./purpose-gate.js";
import { actionPurposes, linkedFinder } from "./actions-ui.js";

const EXPAND_NODE_CAP = 40;

export function linkTypeMarkings(type) {
  const edge = (fullData.edges || []).find((item) => item.type === type && Array.isArray(item.markings));
  return edge ? edge.markings : [];
}

function denied(reason, extra = {}) {
  return { resultIds: [], denied: true, reason, withheld: 0, data: {}, ...extra };
}

function markingDenial(linkTypes) {
  for (const type of linkTypes || []) {
    const missing = lackingMarkings(linkTypeMarkings(type));
    if (missing.length) return `marking ${missing.join(", ")} not visible to role ${currentRoleId()} (link type ${type})`;
  }
  return "";
}

// Purpose rules for an agent step. R1 blocks the step, R2 filters results, R3 asks for a Checkpoint.
function purposeGate(ids, depth = 0) {
  const list = [...new Set(ids || [])];
  if (!karlsruheOn()) return { ids: list, removed: 0, rules: [], purposes: purposesOfIds(list), checkpoint: null };
  const base = core.purposes.check("agent", { dataPurposes: [], depth });
  if (!base.allowed && base.effect === "block") return { blocked: base, purposes: [] };
  const kept = [];
  const rules = new Set();
  list.forEach((id) => {
    const result = core.purposes.check("agent", { dataPurposes: purposesOfIds([id]), depth: 0 });
    if (!result.allowed && result.effect === "block") rules.add(result.rule.id);
    else kept.push(id);
  });
  return { ids: kept, removed: list.length - kept.length, rules: [...rules], purposes: purposesOfIds(kept), checkpoint: base.effect === "checkpoint" ? base : null };
}

function blockedByRule(gate) {
  return denied(`blocked by rule ${gate.blocked.rule.id}: ${gate.blocked.rule.text}`, { rule: gate.blocked.rule.id });
}

function removedNote(gate) {
  return gate.removed ? `rule ${gate.rules.join(", ")} removed ${gate.removed} result${gate.removed === 1 ? "" : "s"} (healthcare data, law-enforcement purpose)` : "";
}

// ── search_objects({query, type?, limit?}) | ({objectSetId}) ──
function searchObjects(args) {
  if (args.objectSetId) {
    const set = core.objectSets && core.objectSets.get(args.objectSetId);
    if (!set) return denied(`no object set ${args.objectSetId}`);
    const repOf = roleView.resolution?.repOf || new Map();
    const visible = [];
    let withheld = 0;
    set.memberIds.forEach((id) => {
      const shown = entityById(id) ? id : entityById(repOf.get(id)) ? repOf.get(id) : null;
      if (shown) visible.push(shown);
      else withheld += 1;
    });
    const gate = purposeGate(visible);
    if (gate.blocked) return blockedByRule(gate);
    return { resultIds: [...new Set(gate.ids)], withheld, rule: gate.rules[0] || null, purposes: gate.purposes, note: [withheld ? `${withheld} member${withheld === 1 ? "" : "s"} withheld from your role` : "", removedNote(gate)].filter(Boolean).join("; "), data: { set, members: set.memberIds.length } };
  }
  const matches = collectEntityMatches(args.query || "", { type: args.type, limit: args.limit || 6 });
  const gate = purposeGate(matches.map((match) => match.entity.id));
  if (gate.blocked) return blockedByRule(gate);
  const hiddenOfType = args.type ? (roleView.withheldByType.get(args.type) || []).length : roleView.withheldEntities.length;
  return {
    resultIds: gate.ids,
    withheld: hiddenOfType,
    rule: gate.rules[0] || null,
    purposes: gate.purposes,
    note: [hiddenOfType ? `${hiddenOfType} ${args.type || "object"}${hiddenOfType === 1 ? " is" : "s are"} withheld from your role and cannot be searched` : "", removedNote(gate)].filter(Boolean).join("; "),
    data: {},
  };
}

// ── get_links({objectId | objectIds, linkType?}) ──
function getLinks(args) {
  const ids = (args.objectIds || [args.objectId]).filter(Boolean);
  if (args.linkType) {
    const reason = markingDenial([args.linkType]);
    if (reason) return denied(reason);
  }
  const idSet = new Set(ids);
  const seen = new Set();
  const edges = [];
  let held = 0;
  ids.forEach((id) =>
    edgesForEntity(id).forEach((edge) => {
      if (seen.has(edge.id) || (args.linkType && edge.type !== args.linkType)) return;
      seen.add(edge.id);
      if (!telecomEdgeAllowed(edge)) {
        held += 1;
        return;
      }
      edges.push(edge);
    })
  );
  const far = edges.map((edge) => (idSet.has(edge.source) ? edge.target : edge.source));
  const gate = purposeGate(far);
  if (gate.blocked) return blockedByRule(gate);
  const keep = new Set(gate.ids.concat(ids));
  const kept = edges.filter((edge) => keep.has(edge.source) && keep.has(edge.target));
  const withheld = roleView.withheldEdges.filter((edge) => (idSet.has(edge.source) || idSet.has(edge.target)) && (!args.linkType || edge.type === args.linkType)).length;
  return {
    resultIds: kept.map((edge) => edge.id),
    withheld,
    rule: gate.rules[0] || null,
    purposes: gate.purposes,
    note: [withheld ? `${withheld} link${withheld === 1 ? "" : "s"} withheld from your role` : "", held ? `${held} telecom link${held === 1 ? "" : "s"} held until the telecom Checkpoint` : "", removedNote(gate)].filter(Boolean).join("; "),
    data: { edges: kept },
  };
}

// ── expand({objectIds, depth, linkTypes}) ──
async function expand(args, ctx) {
  const ids = (args.objectIds || []).filter((id) => entityById(id));
  const linkTypes = args.linkTypes || [];
  const depth = Number(args.depth || 1);
  const reason = markingDenial(linkTypes);
  if (reason) return denied(reason);
  const first = purposeGate([], depth);
  if (first.blocked) return blockedByRule(first);
  const telecom = linkTypes.some((type) => linkTypeMarkings(type).includes("TELECOM") && !roleView.removed.has("TELECOM"));
  const needsTelecom = telecom && telecomGateActive() && !ids.every((id) => ui.telecomExpanded.has(id));
  const danger = first.checkpoint && first.checkpoint.checkpointId && checkpointDefined(first.checkpoint.checkpointId);
  let recordId = null;
  if ((needsTelecom || danger) && core.checkpoints) {
    const checkpoint = danger ? first.checkpoint.checkpointId : "graph.expand.telecom";
    const labels = ids.map((id) => entityById(id).label).join(", ");
    const answer = await core.checkpoints.withCheckpoint(
      checkpoint,
      {
        surface: "investigate",
        objectIds: ids,
        summary: `The agent (run ${ctx.runId}) expands ${labels} to depth ${depth} along ${linkTypes.join(", ") || "all links"}${danger ? ` — beyond the first hop (rule ${first.checkpoint.rule.id})` : ""}`,
        rule: danger ? first.checkpoint.rule.id : null,
        purposes: first.purposes,
      },
      (record) => {
        ids.forEach((id) => {
          ui.telecomExpanded.add(id);
          ui.telecomRecords[id] = record ? record.recordId : "";
        });
        return record;
      }
    );
    recordId = answer.record ? answer.record.recordId : null;
    if (answer.outcome !== "continued" && answer.outcome !== "no-checkpoint") {
      return denied(`Checkpoint ${answer.outcome}${answer.outcome === "refused" ? " for your role" : ""}`, { checkpointRecordId: recordId });
    }
  }
  const types = new Set(linkTypes);
  const nodes = new Set(ids);
  const edges = new Map();
  let frontier = ids.slice();
  for (let level = 0; level < depth && frontier.length; level += 1) {
    const next = [];
    frontier.forEach((id) =>
      edgesForEntity(id).forEach((edge) => {
        if (types.size && !types.has(edge.type)) return;
        edges.set(edge.id, edge);
        const other = edge.source === id ? edge.target : edge.source;
        if (!nodes.has(other) && nodes.size < EXPAND_NODE_CAP) {
          nodes.add(other);
          next.push(other);
        }
      })
    );
    frontier = next;
  }
  const reached = [...nodes].filter((id) => !ids.includes(id));
  const gate = purposeGate(reached);
  const keep = new Set(gate.ids.concat(ids));
  const keptEdges = [...edges.values()].filter((edge) => keep.has(edge.source) && keep.has(edge.target));
  return {
    resultIds: gate.ids,
    withheld: roleView.withheldEdges.filter((edge) => keep.has(edge.source) || keep.has(edge.target)).filter((edge) => !types.size || types.has(edge.type)).length,
    rule: gate.rules[0] || null,
    purposes: gate.purposes,
    checkpointRecordId: recordId,
    note: removedNote(gate),
    data: { edges: keptEdges, nodes: gate.ids },
  };
}

// ── run_rule({ruleId}) ──
function runRule(args) {
  const rule = analysisState.analytics.find((item) => item.id === args.ruleId);
  if (!rule) return denied(`no rule ${args.ruleId} in this dataset`);
  const first = purposeGate([]);
  if (first.blocked) return blockedByRule(first);
  if (rule.blocked) return denied(`blocked by rule ${rule.blocked.rule.id}: ${rule.blocked.rule.text}`, { rule: rule.blocked.rule.id });
  const ids = [...new Set(rule.hits.flatMap((hit) => hit.focusEntityIds || []))];
  return { resultIds: ids, withheld: 0, purposes: rule.purposes || purposesOfIds(ids), note: `${rule.hits.length} hit${rule.hits.length === 1 ? "" : "s"}`, data: { rule, hits: rule.hits } };
}

// ── propose_action({actionTypeId, objectId, params}) ──
async function proposeAction(args, ctx) {
  const entity = entityById(args.objectId);
  if (!core.actions || !core.actions.type(args.actionTypeId)) return denied(`no Action type ${args.actionTypeId}`);
  if (!entity) return denied(`object ${args.objectId} not visible to role ${currentRoleId()}`);
  const result = await core.actions.applyAction(args.actionTypeId, entity.id, args.params || {}, {
    staged: true,
    stagedBy: "agent",
    runId: ctx.runId,
    object: entity,
    linked: linkedFinder(entity.id),
    surface: "investigate",
    datasetId: ui.datasetKey,
    dataPurposes: actionPurposes(entity),
  });
  if (result.outcome === "staged") return { resultIds: [result.instance.id], withheld: 0, note: `staged ${result.instance.label} for review`, data: { instance: result.instance } };
  if (result.outcome === "refused") return denied(`role ${currentRoleId()} cannot run “${core.actions.type(args.actionTypeId).label}”`);
  if (result.outcome === "blocked") return denied(`blocked by rule ${result.rule.id}: ${result.rule.text}`, { rule: result.rule.id });
  if (result.outcome === "invalid") return denied(`invalid parameters: ${Object.values(result.errors || {}).join(" ")}`);
  return denied(result.message || result.outcome);
}

// ── get_lineage({objectId}) ── Investigate does not load the Build seed.
function getLineage(args) {
  const catalog = window.foundrySeedCatalog;
  if (!catalog) return { resultIds: [], unavailable: true, withheld: 0, note: "not available on this surface (the Build seed is not loaded in Investigate; open Build → Lineage)", data: {} };
  const entity = entityById(args.objectId);
  const datasets = entity ? [...new Set((entity.sourceIds || []).map((id) => String(id).split(":")[0]))] : [];
  return { resultIds: datasets, withheld: 0, note: `${datasets.length} source dataset${datasets.length === 1 ? "" : "s"}`, data: { datasets } };
}

export const TOOLS = {
  search_objects: searchObjects,
  get_links: getLinks,
  expand,
  run_rule: runRule,
  propose_action: proposeAction,
  get_lineage: getLineage,
};

// Ids a cite may point at: objects and links in the stored ontology or the current (resolved) view.
export function idExists(id) {
  if (!id) return false;
  if (entityById(id) || roleView.storedById.has(id) || roleView.withheldById.has(id)) return true;
  return (fullData.edges || []).some((edge) => edge.id === id) || (data.edges || []).some((edge) => edge.id === id) || roleView.withheldEdges.some((edge) => edge.id === id);
}
