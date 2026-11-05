/*
 * core/actions.js — Action types with parameters, validation, permissions, Checkpoints, purpose rules,
 * effects and writeback (spec §4.5, F5; contract §3, §6). Classic script; attaches window.DC.actions.
 * Load after store, governance, session, audit, markings, checkpoints, purposes, resolution.
 * The core never touches an app's data: it resolves an Action's effects and the app's apply callback
 * performs them.
 *
 *   init(actionTypes, externalSystems) · applicable(objectType, roleId)
 *   applyAction(typeId, objectId, params, opts) -> Promise<{outcome, instance?, errors?, message?, rule?, record?}>
 *     opts: {apply(effects, ctx), object, linked(linkType, targetType), staged, runId, surface, datasetId,
 *            dataPurposes, exceptRules, exceptionRecordId}
 *     validate ("invalid") → role ("refused", logged) → purposes.check ("blocked", logged) → plan
 *     ("not-applicable", logged) → staged ? pending only ("staged") : Checkpoint (type.checkpointId, or
 *     cp-action-sensitive when sensitive) → apply → instance in governance.actionLog → "action.apply"
 *     (before/after) and one "action.writeback" per writeback.
 *   pending() — staged edits. approveAction / approveAll / rejectAction live in core/actions-approve.js
 *     (load it after this file). Fix round (A1): approving a staged edit of a sensitive type runs the same Checkpoint as running it
 *     by hand. approveAll asks ONCE: the prompt lists every item (context.items), one checkpoint record,
 *     then ONE "action.approveAll" event {count, ids, instanceIds, approvedBy "<role> (bulk)", runIds,
 *     sensitive} carrying that record id; each edit logs its own "action.apply" with the record id.
 *     Cancel or refusal at the Checkpoint applies nothing (outcome "cancelled" | "refused").
 *   log(filter) {objectId, actionTypeId, role, datasetId, sessionId} · inbox(systemId)
 *
 * Effect ops: setProperty {property, from: "param:x" | "value:…"}; createObject {type, properties};
 * createLink {linkType, target: "created:<Type>" | "object"}; deleteLinked {linkType, targetType} (only
 * Action-created targets); writeback {system, template}. A type with deleteLinked is a reversal: it
 * restores the value from before the Action that set the property, and is refused when the current
 * value came from the source data. act-unmerge-person rejects merge candidates via DC.resolution.reject.
 * Instance: {id, actionTypeId, label, objectId, objectLabel, objectType, datasetId, sessionId, ts, role,
 *   params, before, after, created, deleted, writebacks, stagedBy, approvedBy, checkpointRecordId,
 *   purposes, exceptionRecordId, status, runId}
 * Additions: isActive(), types(), type(id), systems(), system(id), forType(t), validate(), plan() (the
 *   preview), setByAction(), objectsSetByAction(), registerApplier(fn), checkpointFor(type),
 *   governedProperties(objectType) (properties an Action type sets: read-only in editors), onChange(cb).
 */
(function () {
  "use strict";

  const DC = (window.DC = window.DC || {});
  const store = DC.store;
  const GOV_KEY = "dc-palantir:governance";
  const LOG_CAP = 1000;
  const SENSITIVE_CHECKPOINT = "cp-action-sensitive";
  const UNMERGE_OPS = ["unmerge", "rejectCandidates", "resolutionOverride"];
  const listeners = [];
  let typesList = [];
  let systemsList = [];
  let applier = null;
  let memoryState = {};
  let counter = 0;
  let lastSeen = "";

  // ── state ──
  function readState() {
    const value = store ? store.get(GOV_KEY, null) : memoryState;
    return value && typeof value === "object" ? value : {};
  }

  function writeState(patch) {
    memoryState = { ...memoryState, ...patch };
    if (store) store.patch(GOV_KEY, (current) => ({ ...current, ...patch })); // review F-21
    lastSeen = fingerprint();
  }

  function fingerprint() {
    const state = readState();
    return JSON.stringify([(state.actionLog || []).length, (state.pendingActions || []).map((item) => item.id)]);
  }

  function actionLog() {
    const list = readState().actionLog;
    return Array.isArray(list) ? list : [];
  }

  function notify(source) {
    listeners.slice().forEach((callback) => {
      try {
        callback({ source });
      } catch (error) {
        console.error("[DC.actions] listener failed", error);
      }
    });
  }

  function asList(value) {
    return Array.isArray(value) ? value.filter((item) => item !== undefined && item !== null) : [];
  }

  // ── types ──
  function init(actionTypes, externalSystems) {
    typesList = asList(actionTypes).filter((item) => item && item.id && item.objectType);
    systemsList = asList(externalSystems).filter((item) => item && item.id);
    lastSeen = fingerprint();
    return typesList;
  }

  function type(id) {
    return typesList.find((item) => item.id === id) || null;
  }

  function system(id) {
    return systemsList.find((item) => item.id === id) || null;
  }

  function roleId() {
    return DC.session ? DC.session.get().role : "unknown";
  }

  function forType(objectType) {
    return typesList.filter((item) => item.objectType === objectType);
  }

  function applicable(objectType, role) {
    const who = role || roleId();
    return forType(objectType).filter((item) => asList(item.allowedRoles).includes(who));
  }

  function checkpointFor(actionType) {
    if (!actionType) return null;
    return actionType.checkpointId || (actionType.sensitive ? SENSITIVE_CHECKPOINT : null);
  }

  function isUnmerge(actionType) {
    return actionType.id === "act-unmerge-person" || asList(actionType.effects).some((effect) => UNMERGE_OPS.includes(effect.op));
  }

  function isReversal(actionType) {
    return asList(actionType.effects).some((effect) => effect.op === "deleteLinked");
  }

  // ── parameters ──
  function normalise(actionType, params) {
    const out = {};
    asList(actionType.parameters).forEach((param) => {
      const raw = params ? params[param.id] : undefined;
      if (param.type === "boolean") out[param.id] = raw === true || raw === "true" || raw === "on";
      else out[param.id] = raw === undefined || raw === null ? "" : String(raw).trim();
    });
    return out;
  }

  function validate(typeId, params) {
    const actionType = typeof typeId === "object" ? typeId : type(typeId);
    if (!actionType) return { ok: false, errors: { _type: "Unknown Action type." }, params: {} };
    const values = normalise(actionType, params);
    const errors = {};
    asList(actionType.parameters).forEach((param) => {
      const value = values[param.id];
      if (param.type === "boolean") return;
      if (param.required && !value) {
        errors[param.id] = param.type === "enum" ? "Choose a value." : "Required.";
        return;
      }
      if (param.type === "enum" && value && !asList(param.options).includes(value)) {
        errors[param.id] = `Choose one of: ${asList(param.options).join(", ")}.`;
        return;
      }
      const min = Number(param.minLength) || 0;
      if (value && min && value.length < min) errors[param.id] = `At least ${min} characters (you wrote ${value.length}).`;
    });
    return { ok: Object.keys(errors).length === 0, errors, params: values };
  }

  // ── values and templates ──
  function propertyOf(object, name) {
    const value = object && object.properties ? object.properties[name] : undefined;
    if (value && typeof value === "object" && Array.isArray(value.withheld)) return "[withheld]";
    return value === undefined || value === null ? "" : value;
  }

  function resolveValue(spec, ctx) {
    if (typeof spec !== "string") return spec;
    if (spec.startsWith("param:")) return ctx.params[spec.slice(6)] ?? "";
    if (spec.startsWith("value:")) return spec.slice(6);
    if (spec.startsWith("object:")) return propertyOf(ctx.object, spec.slice(7));
    if (spec === "session:role") return ctx.role;
    if (spec === "session:purpose") return ctx.purpose || "";
    if (spec === "now") return ctx.ts;
    return spec;
  }

  function renderTemplate(template, ctx) {
    return String(template || "").replace(/\{([\w.-]+)\}/g, (match, name) => {
      let value;
      if (name in ctx.params) value = ctx.params[name];
      else if (name === "label") value = (ctx.object && ctx.object.label) || ctx.objectId;
      else if (name === "id") value = ctx.objectId;
      else if (name === "type") value = ctx.object && ctx.object.type;
      else if (name === "role") value = ctx.role;
      else if (name === "ts") value = ctx.ts;
      else value = propertyOf(ctx.object, name);
      if (typeof value === "boolean") return value ? "yes" : "no";
      return value === "" || value === undefined || value === null ? "—" : String(value);
    });
  }

  // ── provenance of Action-set values ──
  function matches(instance, filter) {
    const f = filter || {};
    if (f.datasetId && instance.datasetId && instance.datasetId !== f.datasetId) return false;
    if (f.sessionId && instance.sessionId !== f.sessionId) return false;
    return true;
  }

  // The newest applied instance that wrote `property` on the object, if its value is still current.
  function setByAction(objectId, property, currentValue, filter) {
    const log = actionLog();
    for (let index = log.length - 1; index >= 0; index -= 1) {
      const instance = log[index];
      if (instance.status === "pending" || instance.objectId !== objectId || !matches(instance, filter)) continue;
      if (!instance.after || !(property in instance.after)) continue;
      const value = instance.after[property];
      return value !== "" && value !== null && String(value) === String(currentValue ?? "") ? instance : null;
    }
    return null;
  }

  function objectsSetByAction(property, valueOf, filter) {
    const ids = [...new Set(actionLog().filter((item) => item.after && property in item.after && matches(item, filter)).map((item) => item.objectId))];
    return ids.filter((id) => setByAction(id, property, typeof valueOf === "function" ? valueOf(id) : undefined, filter));
  }

  // ── plan (preview) ──
  function plan(typeId, object, params, opts) {
    const actionType = typeof typeId === "object" ? typeId : type(typeId);
    const options = opts || {};
    const target = object || { id: options.objectId, type: actionType && actionType.objectType, label: options.objectId, properties: {} };
    const session = DC.session ? DC.session.get() : { role: "unknown", purpose: null };
    const ctx = {
      params: actionType ? normalise(actionType, params) : {},
      object: target,
      objectId: target.id,
      role: session.role,
      purpose: session.purpose,
      ts: options.ts || new Date().toISOString(),
    };
    const result = { type: actionType, effects: [], before: {}, after: {}, created: [], deleted: [], writebacks: [], problems: [], notes: [], unmerge: null };
    if (!actionType) {
      result.problems.push("Unknown Action type.");
      return result;
    }
    const reversal = isReversal(actionType);
    asList(actionType.effects).forEach((effect) => {
      if (effect.op === "setProperty") {
        const current = propertyOf(target, effect.property);
        let value = resolveValue(effect.from, ctx);
        // Review F-15: the seed's flag onlyIfSetByAction (and its refusal text) decides; a reversal type's
        // "value:" effect is the structural fallback for seeds without the flag.
        const guarded = effect.onlyIfSetByAction === true || (effect.onlyIfSetByAction === undefined && reversal && effect.from === "value:");
        if (guarded) {
          const setter = setByAction(target.id, effect.property, current, { datasetId: options.datasetId });
          if (!setter) {
            result.problems.push(
              current
                ? `${target.label || target.id}'s ${effect.property} (“${current}”) was not set by an Action in this platform: ${effect.refusal ? effect.refusal : `it comes from the source data. “${actionType.label}” only reverses an Action; correcting a source is not an Action here.`}`
                : `${target.label || target.id} has no ${effect.property} to remove.`
            );
            value = current;
          } else {
            value = setter.before && effect.property in setter.before ? setter.before[effect.property] : "";
            result.notes.push(`Reverses ${setter.id} (${setter.label || setter.actionTypeId}, ${setter.ts.slice(0, 16).replace("T", " ")}).`);
          }
        } else if (!guarded && current && String(current) !== String(value) && effect.property === "riskTag") {
          result.notes.push(`${target.label || target.id} is already risk-tagged (“${current}”); the Action overwrites it.`);
        }
        result.before[effect.property] = current;
        result.after[effect.property] = value;
        result.effects.push({ op: "setProperty", property: effect.property, value, previous: current });
      } else if (effect.op === "createObject") {
        const properties = {};
        Object.entries(effect.properties || {}).forEach(([key, spec]) => {
          properties[key] = resolveValue(spec, ctx);
        });
        result.created.push({ type: effect.type, properties });
        result.effects.push({ op: "createObject", type: effect.type, properties });
      } else if (effect.op === "createLink") {
        result.effects.push({ op: "createLink", linkType: effect.linkType, target: effect.target || "object" });
        result.created.push({ link: effect.linkType, target: effect.target || "object" });
      } else if (effect.op === "deleteLinked") {
        const linked = typeof options.linked === "function" ? asList(options.linked(effect.linkType, effect.targetType)) : [];
        // Review F-15: onlyCreatedByAction (default true) keeps source records out of a reversal's reach.
        const own = effect.onlyCreatedByAction === false ? linked.filter(Boolean) : linked.filter((item) => item && item.createdByAction);
        own.forEach((item) => result.deleted.push({ id: item.id, type: item.type || effect.targetType, label: item.label || item.id, link: effect.linkType }));
        if (linked.length > own.length) {
          result.notes.push(`${linked.length - own.length} ${effect.targetType} record${linked.length - own.length === 1 ? "" : "s"} from the source data stay${linked.length - own.length === 1 ? "s" : ""}: only Action-created records are deleted.`);
        }
        result.effects.push({ op: "deleteLinked", linkType: effect.linkType, targetType: effect.targetType, ids: own.map((item) => item.id) });
      } else if (effect.op === "writeback") {
        const known = system(effect.system);
        result.writebacks.push({ system: effect.system, systemLabel: known ? known.label : effect.system, message: renderTemplate(effect.template, ctx) });
        result.effects.push({ op: "writeback", system: effect.system });
      } else if (!UNMERGE_OPS.includes(effect.op)) {
        result.effects.push({ ...effect });
      }
    });
    if (isUnmerge(actionType)) {
      const resolution = DC.resolution;
      const chain = resolution ? resolution.explain(target.id) : [];
      const ids = asList(options.candidateIds).length ? asList(options.candidateIds) : ctx.params.candidateId ? [ctx.params.candidateId] : chain.map((item) => item.candidate.id);
      const members = resolution ? resolution.resolveAt().clusters.get(resolution.resolveAt().repOf.get(target.id)) || [] : [];
      if (!ids.length) {
        result.problems.push(`${target.label || target.id} is not merged with anyone at threshold ${resolution ? resolution.threshold().toFixed(2) : "?"}: there is nothing to unmerge.`);
      } else {
        result.unmerge = { candidateIds: ids, members };
        result.before.identities = members.join(" + ");
        result.after.identities = `${members.length} separate people`;
        result.effects.push({ op: "unmerge", candidateIds: ids });
      }
    }
    return result;
  }

  // ── logging ──
  function logAction(verb, partial) {
    if (!DC.audit) return Promise.resolve(null);
    return DC.audit.logEvent({ kind: "action", verb, ...partial });
  }

  function newId() {
    counter += 1;
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    return `ai-${day}-${Date.now().toString(36).slice(-5)}${String(counter).padStart(3, "0")}`;
  }

  function baseInstance(actionType, target, params, opts, extra) {
    const session = DC.session ? DC.session.get() : { sessionId: "s-unknown", role: "unknown" };
    return {
      id: newId(),
      actionTypeId: actionType.id,
      label: actionType.label,
      objectId: target.id,
      objectLabel: target.label || target.id,
      objectType: target.type || actionType.objectType,
      datasetId: opts.datasetId || null,
      sessionId: session.sessionId,
      ts: new Date().toISOString(),
      role: session.role,
      params,
      before: {},
      after: {},
      created: [],
      deleted: [],
      writebacks: [],
      stagedBy: opts.stagedBy || (opts.staged ? "agent" : "user"),
      approvedBy: null,
      checkpointRecordId: null,
      purposes: [],
      exceptionRecordId: opts.exceptionRecordId || null,
      status: "applied",
      runId: opts.runId || null,
      ...(extra || {}),
    };
  }

  function record(instance) {
    const log = actionLog().concat([instance]);
    writeState({ actionLog: log.length > LOG_CAP ? log.slice(log.length - LOG_CAP) : log });
  }

  async function execute(actionType, target, values, opts, planned, extra) {
    const instance = baseInstance(actionType, target, values, opts, extra);
    const apply = typeof opts.apply === "function" ? opts.apply : applier;
    const ctx = { instanceId: instance.id, actionTypeId: actionType.id, objectId: target.id, object: target, params: values, role: instance.role, ts: instance.ts, plan: planned };
    let outcome = {};
    if (apply) {
      outcome = (await apply(planned.effects, ctx)) || {};
    }
    if (planned.unmerge && DC.resolution) {
      for (const candidateId of planned.unmerge.candidateIds) {
        await DC.resolution.reject(candidateId, values.reason || "", { actionId: instance.id });
      }
    }
    instance.before = { ...planned.before, ...(outcome.before || {}) };
    instance.after = { ...planned.after, ...(outcome.after || {}) };
    instance.created = asList(outcome.created);
    instance.deleted = asList(outcome.deleted).length ? asList(outcome.deleted) : planned.deleted.map((item) => item.id);
    instance.writebacks = planned.writebacks.map((item) => ({ system: item.system, message: item.message, ts: instance.ts, deliveredTs: new Date().toISOString() }));
    record(instance);
    const objectIds = [target.id, ...instance.created, ...instance.deleted];
    await logAction("action.apply", {
      surface: opts.surface,
      objectIds,
      datasetId: opts.datasetId || null,
      checkpointId: instance.checkpointRecordId,
      payload: {
        actionTypeId: actionType.id,
        label: actionType.label,
        instanceId: instance.id,
        outcome: "applied",
        params: values,
        reason: values.reason || "",
        before: instance.before,
        after: instance.after,
        created: instance.created,
        deleted: instance.deleted,
        writebacks: instance.writebacks.map((item) => ({ system: item.system, message: item.message })),
        purposes: instance.purposes,
        karlsruhe: Boolean(DC.purposes && DC.purposes.enabled()),
        exceptionRecordId: instance.exceptionRecordId,
        stagedBy: instance.stagedBy,
        approvedBy: instance.approvedBy,
        runId: instance.runId || null,
      },
    });
    for (const writeback of instance.writebacks) {
      await logAction("action.writeback", {
        surface: opts.surface,
        objectIds: [target.id],
        datasetId: opts.datasetId || null,
        checkpointId: instance.checkpointRecordId,
        payload: { system: writeback.system, message: writeback.message, instanceId: instance.id, actionTypeId: actionType.id, outcome: "delivered" },
      });
    }
    notify("local");
    return instance;
  }

  async function applyAction(typeId, objectId, params, opts) {
    const options = opts || {};
    const actionType = type(typeId);
    if (!actionType) return { outcome: "unknown-type", message: `No Action type ${typeId}.` };
    const target = options.object || { id: objectId, type: actionType.objectType, label: objectId, properties: {} };
    const surface = options.surface || (DC.session && DC.session.surface()) || "unknown";
    const checked = validate(actionType, params);
    if (!checked.ok) return { outcome: "invalid", errors: checked.errors };
    const values = checked.params;
    const role = roleId();
    const purposes = asList(options.dataPurposes).length ? asList(options.dataPurposes) : DC.purposes ? DC.purposes.dataPurposesOf(target) : [];
    const common = { surface, objectIds: [target.id], datasetId: options.datasetId || null };
    const basePayload = { actionTypeId: actionType.id, label: actionType.label, params: values, reason: values.reason || "", purposes, karlsruhe: Boolean(DC.purposes && DC.purposes.enabled()) };
    if (!asList(actionType.allowedRoles).includes(role)) {
      const allowed = asList(actionType.allowedRoles).map((id) => (DC.governance && DC.governance.role(id) ? DC.governance.role(id).label : id));
      const message = `Your role cannot run “${actionType.label}”. Roles allowed: ${allowed.join(", ") || "none"}. This attempt has been logged.`;
      await logAction("action.apply", { ...common, payload: { ...basePayload, outcome: "refused" } });
      return { outcome: "refused", message };
    }
    const check = DC.purposes ? DC.purposes.check("action", { dataPurposes: purposes, except: options.exceptRules }) : { allowed: true };
    if (!check.allowed && check.effect === "block") {
      await logAction("action.apply", { ...common, payload: { ...basePayload, outcome: "blocked", rule: check.rule.id, sessionPurpose: check.sessionPurpose } });
      return { outcome: "blocked", rule: check.rule, check };
    }
    const planned = plan(actionType, target, values, { linked: options.linked, datasetId: options.datasetId, candidateIds: options.candidateIds });
    if (planned.problems.length) {
      await logAction("action.apply", { ...common, payload: { ...basePayload, outcome: "not-applicable", message: planned.problems[0] } });
      return { outcome: "not-applicable", message: planned.problems[0], plan: planned };
    }
    if (options.staged) {
      const instance = baseInstance(actionType, target, values, options, { status: "pending", before: planned.before, after: planned.after, purposes });
      instance.writebacks = planned.writebacks.map((item) => ({ system: item.system, message: item.message, ts: null, deliveredTs: null }));
      const pendingList = (Array.isArray(readState().pendingActions) ? readState().pendingActions : []).concat([instance]);
      writeState({ pendingActions: pendingList });
      await logAction("action.stage", { ...common, payload: { ...basePayload, outcome: "staged", instanceId: instance.id, before: planned.before, after: planned.after, stagedBy: instance.stagedBy, runId: instance.runId } });
      notify("local");
      return { outcome: "staged", instance };
    }
    const checkpointId = checkpointFor(actionType);
    const extra = { purposes, exceptionRecordId: options.exceptionRecordId || null };
    const runner = async (cpRecord) => {
      extra.checkpointRecordId = cpRecord ? cpRecord.recordId : null;
      return execute(actionType, target, values, options, planned, extra);
    };
    // Review F-17: a named Checkpoint always goes through withCheckpoint, which refuses (and logs) when the
    // governance block does not define it, instead of running the Action unguarded.
    if (checkpointId && DC.checkpoints && DC.governance && (DC.governance.isActive() || DC.governance.checkpoint(checkpointId))) {
      const diff = Object.keys(planned.after).map((key) => `${key}: “${planned.before[key] || "—"}” → “${planned.after[key] || "—"}”`).join("; ");
      const answer = await DC.checkpoints.withCheckpoint(
        checkpointId,
        { surface, objectIds: [target.id], datasetId: options.datasetId || null, summary: `${actionType.label} on ${target.label || target.id}${diff ? ` (${diff})` : ""}`, purposes },
        runner
      );
      if (answer.outcome !== "continued") return { outcome: answer.outcome, record: answer.record };
      return { outcome: "applied", instance: answer.result, record: answer.record };
    }
    const instance = await runner(null);
    return { outcome: "applied", instance, record: null };
  }

  // ── staged edits (Phase 3 agent) ──
  function pending() {
    const list = readState().pendingActions;
    return Array.isArray(list) ? list.slice() : [];
  }

  // ── reading ──
  function log(filter) {
    const f = filter || {};
    return actionLog().filter((item) => {
      if (f.objectId && item.objectId !== f.objectId) return false;
      if (f.actionTypeId && item.actionTypeId !== f.actionTypeId) return false;
      if (f.role && item.role !== f.role) return false;
      if (f.datasetId && item.datasetId && item.datasetId !== f.datasetId) return false;
      if (f.sessionId && item.sessionId !== f.sessionId) return false;
      return true;
    });
  }

  function inbox(systemId) {
    const out = [];
    actionLog().forEach((item) => {
      asList(item.writebacks).forEach((writeback) => {
        if (systemId && writeback.system !== systemId) return;
        out.push({ system: writeback.system, message: writeback.message, ts: writeback.deliveredTs || writeback.ts || item.ts, instanceId: item.id, objectId: item.objectId, objectLabel: item.objectLabel, actionTypeId: item.actionTypeId, role: item.role, datasetId: item.datasetId });
      });
    });
    return out.reverse();
  }

  window.addEventListener("storage", (event) => {
    if (event.key !== GOV_KEY) return;
    const now = fingerprint();
    if (now === lastSeen) return;
    lastSeen = now;
    notify("storage");
  });

  DC.actions = {
    KEY: GOV_KEY,
    LOG_CAP,
    SENSITIVE_CHECKPOINT,
    init,
    isActive: () => typesList.length > 0,
    types: () => typesList.slice(),
    type,
    systems: () => systemsList.slice(),
    system,
    forType,
    applicable,
    checkpointFor,
    governedProperties(objectType) {
      const props = new Set();
      forType(objectType).forEach((item) => asList(item.effects).forEach((effect) => effect.op === "setProperty" && effect.property && props.add(effect.property)));
      return [...props];
    },
    validate,
    plan,
    applyAction,
    pending,
    log,
    inbox,
    setByAction,
    objectsSetByAction,
    // For core/actions-approve.js (approveAction / approveAll / rejectAction), which attaches to DC.actions.
    _internal: { readState, writeState, execute, plan, logAction, notify, roleId, asList, type, system, checkpointFor },
    registerApplier(fn) {
      applier = typeof fn === "function" ? fn : null;
    },
    onChange(callback) {
      if (typeof callback === "function") listeners.push(callback);
    },
  };
})();
