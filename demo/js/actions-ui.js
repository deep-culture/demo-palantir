// demo/js/actions-ui.js — Actions in Investigate (spec §4.5, F5; contract §3): the Action drawer's state, the
// applier that performs an Action's effects on fullData (the persisted ontology, so Reset dataset clears
// them and analytics see them through the role view), and the drawer's event handlers.
import { slugify } from "./util.js";
import { analysisState, core, fullData, persist, roleView, ui } from "./state.js";
import { currentRoleId, telecomExpansionTargets } from "./governance.js";
import { entityById } from "./derive.js";
import { check as purposeCheck, exceptionFor, expansionCheck, purposesOf, requestPurposeException } from "./purpose-gate.js";
import { render } from "./render/index.js";

export function actionsActive() {
  return Boolean(core.actions && core.actions.isActive());
}

export function actionTypesFor(objectType) {
  return actionsActive() ? core.actions.forType(objectType) : [];
}

export function canRun(actionType) {
  return Boolean(actionType) && (actionType.allowedRoles || []).includes(currentRoleId());
}

function emptyDrawer() {
  return { open: false, objectId: "", typeId: "", params: {}, errors: {}, tried: false, result: null, exceptRules: [], exceptionRecordId: null };
}

// ── what the drawer acts on ──
// The role's view of the object (merged Person when resolution merged it); effects go to fullData.
export function drawerObject() {
  return entityById(ui.actionDrawer.objectId) || null;
}

function storedById(id) {
  return roleView.storedById.get(id) || (fullData.entities || []).find((entity) => entity.id === id) || null;
}

// Linked objects in the stored ontology (Remove from watchlist must find the record it deletes).
export function linkedFinder(objectId) {
  return (linkType, targetType) => {
    const ids = (fullData.edges || []).filter((edge) => edge.type === linkType && edge.source === objectId).map((edge) => edge.target);
    return ids.map(storedById).filter((entity) => entity && (!targetType || entity.type === targetType));
  };
}

export function actionPurposes(entity) {
  return purposesOf([entity]);
}

export function actionGate(actionType, entity) {
  const key = `action:${actionType.id}:${entity.id}`;
  return { key, result: purposeCheck("action", key, { dataPurposes: actionPurposes(entity) }) };
}

export function previewAction(actionType, entity) {
  return core.actions.plan(actionType, entity, ui.actionDrawer.params, { linked: linkedFinder(entity.id), datasetId: ui.datasetKey });
}

// Objects whose risk tag an Action set and that still carry it (footnote of "Watchlist operators").
export function riskTaggedByActions(sessionOnly = true) {
  if (!actionsActive()) return [];
  const filter = { datasetId: ui.datasetKey, ...(sessionOnly && core.session ? { sessionId: core.session.get().sessionId } : {}) };
  return core.actions.objectsSetByAction("riskTag", (id) => storedById(id)?.properties?.riskTag ?? "", filter);
}

// ── the applier (registered with DC.actions; also used for staged edits) ──
function sampleOf(list, predicate) {
  return (list || []).find(predicate) || null;
}

function ensureProperty(typeId, propertyId) {
  const entityType = (fullData.ontology?.entityTypes || []).find((item) => item.id === typeId);
  if (!entityType || (entityType.properties || []).some((property) => property.id === propertyId)) return;
  entityType.properties = (entityType.properties || []).concat([{ id: propertyId, label: propertyId, type: "string", required: false, description: "Set by an Action." }]);
}

export function applyEffects(effects, ctx) {
  const entity = storedById(ctx.objectId);
  if (!entity) return { created: [], deleted: [] };
  const created = [];
  const deleted = [];
  const createdByType = {};
  const counter = (fullData.entities || []).filter((item) => item.createdByAction).length;
  effects.forEach((effect) => {
    if (effect.op === "setProperty") {
      entity.properties = entity.properties || {};
      entity.properties[effect.property] = effect.value;
      ensureProperty(entity.type, effect.property);
    } else if (effect.op === "createObject") {
      const sample = sampleOf(fullData.entities, (item) => item.type === effect.type && !item.createdByAction);
      const number = String(counter + created.length + 1).padStart(3, "0");
      const label = effect.type === "WatchlistRecord" ? `WL-ACT-${number}` : `${effect.type} ${number}`;
      const object = {
        id: `${effect.type.toLowerCase()}::act-${slugify(ctx.instanceId)}`,
        type: effect.type,
        label,
        properties: { ...(effect.type === "WatchlistRecord" ? { watchlistId: label } : {}), ...effect.properties },
        sourceIds: [`action:${ctx.instanceId}`],
        createdByAction: ctx.instanceId,
        markings: sample ? (sample.markings || []).slice() : [],
        propertyMarkings: {},
        sourceMarkings: sample ? (sample.markings || []).slice() : [],
      };
      fullData.entities.push(object);
      created.push(object.id);
      createdByType[effect.type] = object.id;
    } else if (effect.op === "createLink") {
      const targetId = String(effect.target).startsWith("created:") ? createdByType[String(effect.target).slice(8)] : entity.id;
      if (!targetId) return;
      const sample = sampleOf(fullData.edges, (item) => item.type === effect.linkType && !item.createdByAction);
      const edge = {
        id: `${effect.linkType.toLowerCase()}::act-${slugify(`${entity.id}-${targetId}`)}`,
        type: effect.linkType,
        source: entity.id,
        target: targetId,
        label: effect.linkType,
        properties: { provenance: "action", actionId: ctx.instanceId },
        createdByAction: ctx.instanceId,
        markings: sample ? (sample.markings || []).slice() : [],
      };
      fullData.edges.push(edge);
      created.push(edge.id);
    } else if (effect.op === "deleteLinked") {
      const ids = new Set(effect.ids || []);
      if (!ids.size) return;
      fullData.edges = fullData.edges.filter((edge) => {
        const drop = edge.type === effect.linkType && edge.source === entity.id && ids.has(edge.target);
        if (drop) deleted.push(edge.id);
        return !drop;
      });
      fullData.entities = fullData.entities.filter((item) => !(ids.has(item.id) && item.createdByAction));
      deleted.push(...ids);
    }
  });
  persist();
  return { created, deleted };
}

// ── drawer handlers ──
export function openActionDrawer(objectId, typeId) {
  const entity = entityById(objectId);
  if (!entity) return;
  const types = actionTypesFor(entity.type);
  const preferred = types.find((item) => item.id === typeId) || types.find(canRun) || types[0];
  const chosen = preferred ? preferred.id : "";
  ui.actionDrawer = { ...emptyDrawer(), open: true, objectId, typeId: chosen, params: prefillParams(chosen, objectId) };
  render();
  requestAnimationFrame(() => {
    const first = document.querySelector(".action-drawer [data-scope='action-param'], .action-drawer button");
    if (first) first.focus();
  });
}

// Parameters that name merge candidates (e.g. act-unmerge-person's "candidateId") are not for
// students to type: fill them from the merges currently applied to this object.
const CANDIDATE_PARAM = /candidate/i;
function prefillParams(typeId, objectId) {
  const actionType = core.actions && core.actions.type(typeId);
  if (!actionType || !core.resolution || !core.resolution.candidatesFor) return {};
  const params = {};
  (actionType.parameters || []).forEach((param) => {
    if (!CANDIDATE_PARAM.test(param.id)) return;
    const merged = core.resolution.candidatesFor(objectId).filter((item) => item.decision === "merged");
    if (merged.length) params[param.id] = merged.map((item) => item.candidate.id).join(", ");
  });
  return params;
}

export function closeActionDrawer() {
  ui.actionDrawer = emptyDrawer();
  render();
}

export function selectActionType(typeId) {
  const objectId = ui.actionDrawer.objectId;
  ui.actionDrawer = { ...emptyDrawer(), open: true, objectId, typeId, params: prefillParams(typeId, objectId) };
  render();
}

export function setActionParam(paramId, value) {
  ui.actionDrawer.params = { ...ui.actionDrawer.params, [paramId]: value };
  ui.actionDrawer.result = null;
  if (ui.actionDrawer.tried && core.actions) {
    ui.actionDrawer.errors = core.actions.validate(ui.actionDrawer.typeId, ui.actionDrawer.params).errors;
  }
  render();
}

export async function runDrawerAction() {
  const drawer = ui.actionDrawer;
  const entity = drawerObject();
  const actionType = core.actions && core.actions.type(drawer.typeId);
  if (!entity || !actionType) return;
  const checked = core.actions.validate(actionType, drawer.params);
  drawer.tried = true;
  drawer.errors = checked.errors;
  if (!checked.ok) {
    drawer.result = { outcome: "invalid" };
    render();
    return;
  }
  const result = await core.actions.applyAction(actionType.id, entity.id, drawer.params, {
    object: entity,
    linked: linkedFinder(entity.id),
    surface: "investigate",
    datasetId: ui.datasetKey,
    dataPurposes: actionPurposes(entity),
    exceptRules: drawer.exceptRules,
    exceptionRecordId: drawer.exceptionRecordId,
    apply: applyEffects,
  });
  const still = ui.actionDrawer === drawer;
  if (still) {
    drawer.result = result;
    if (result.outcome === "applied") {
      drawer.params = {};
      drawer.tried = false;
      drawer.errors = {};
      // The unmerged representative keeps its id; the drawer stays on it.
      if (!entityById(drawer.objectId)) drawer.open = false;
    }
  }
  render();
}

export function requestActionException() {
  const entity = drawerObject();
  const actionType = core.actions && core.actions.type(ui.actionDrawer.typeId);
  if (!entity || !actionType) return;
  const gate = actionGate(actionType, entity);
  if (gate.result.allowed) return;
  const drawer = ui.actionDrawer;
  requestPurposeException(gate.key, gate.result, { objectIds: [entity.id], summary: `Exception to rule ${gate.result.rule.id} for “${actionType.label}” on ${entity.label}` }, (record) => {
    drawer.exceptRules = exceptionFor(gate.key)?.rules || [];
    drawer.exceptionRecordId = record ? record.recordId : null;
  });
}

export const ACTION_CLICKS = {
  "open-action-drawer"(target) {
    openActionDrawer(target.dataset.id, target.dataset.typeId || "");
  },
  "close-action-drawer"() {
    closeActionDrawer();
  },
  "select-action-type"(target) {
    selectActionType(target.dataset.typeId);
  },
  "run-action"() {
    runDrawerAction();
  },
  "action-exception"() {
    requestActionException();
  },
  "purpose-exception"(target) {
    // Rules and expansions (the drawer has its own button).
    const { key, op, id } = target.dataset;
    if (op === "rule") {
      const rule = analysisState.analytics.find((item) => item.id === id);
      if (rule && rule.blocked) requestPurposeException(key, rule.blocked, { objectIds: [], summary: `Exception to rule ${rule.blocked.rule.id} for the rule “${rule.title}”` });
    } else if (op === "expand") {
      const entity = entityById(id);
      if (!entity) return;
      const targets = telecomExpansionTargets(entity);
      const result = expansionCheck(entity.id, targets.objectIds);
      if (!result.allowed && result.effect === "block") {
        requestPurposeException(key, result, { objectIds: [entity.id], summary: `Exception to rule ${result.rule.id} for expanding ${targets.summary}` });
      }
    }
  },
};

// Text fields update on input; selects and checkboxes on change. (A text field's change event fires on
// blur, and a re-render then would swallow the click on "Run action".)
export const ACTION_INPUTS = {
  "action-param"(target) {
    if (target.type === "checkbox" || target.tagName === "SELECT") return;
    setActionParam(target.dataset.field, target.value);
  },
};

export const ACTION_CHANGES = {
  "action-param"(target) {
    if (target.type === "checkbox") setActionParam(target.dataset.field, target.checked);
    else if (target.tagName === "SELECT") setActionParam(target.dataset.field, target.value);
  },
};
