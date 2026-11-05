/*
 * core/actions-approve.js — approving and rejecting staged edits (spec §4.7; contract Phase 3 §5, fix round §2 A1).
 *
 * Classic script; extends window.DC.actions. Load right after core/actions.js (Investigate and Oversight).
 *
 *   DC.actions.approveAction(id, {object, linked, surface, approvedBy}) -> Promise<{outcome, instance?, record?, message?}>
 *   DC.actions.approveAll(ids, {by, objectFor(id), linkedFor(id), surface}) -> Promise<{outcome, count, instances, refused, record?}>
 *   DC.actions.rejectAction(id, reason) -> Promise<{outcome}>
 *
 * Approving a staged edit of a sensitive Action type runs the same Checkpoint as running it by hand
 * (cp-action-sensitive, or the type's checkpointId). Approve all asks ONCE: its prompt lists every item
 * (context.items), it writes one checkpoint record and then one "action.approveAll" event with the count
 * and that record id; each edit still logs "action.apply" with the record id. Cancelled or refused at the
 * Checkpoint: nothing is applied and the outcome is returned. Review F-05: approval also re-runs the
 * purpose rules (outcome "blocked") and the plan (outcome "not-applicable" when plan().problems is not
 * empty); in Approve all such edits are skipped (payload.skipped) and the rest go ahead.
 */
(function () {
  "use strict";

  const DC = (window.DC = window.DC || {});
  if (!DC.actions || !DC.actions._internal) {
    console.error("[DC.actions] load core/actions.js before core/actions-approve.js");
    return;
  }
  const { readState, writeState, execute, plan, logAction, notify, roleId, asList, type, system, checkpointFor } = DC.actions._internal;
  const pending = () => DC.actions.pending();

  function mayApprove(actionType) {
    const role = DC.governance && DC.governance.role(roleId());
    if (!(DC.governance && DC.governance.isActive())) return true;
    return Boolean(role && (role.canApprove || asList(actionType && actionType.allowedRoles).includes(role.id)));
  }

  async function applyStaged(staged, options, approvedBy, checkpointRecordId) {
    const actionType = type(staged.actionTypeId);
    const target = options.object || { id: staged.objectId, type: staged.objectType, label: staged.objectLabel, properties: {} };
    const planned = plan(actionType, target, staged.params, { linked: options.linked, datasetId: staged.datasetId });
    writeState({ pendingActions: pending().filter((item) => item.id !== staged.id) });
    return execute(actionType, target, staged.params, { ...options, datasetId: staged.datasetId, stagedBy: staged.stagedBy, runId: staged.runId }, planned, {
      approvedBy,
      stagedId: staged.id,
      purposes: staged.purposes || [],
      checkpointRecordId: checkpointRecordId || null,
    });
  }

  // Review F-05: approval is the moment the edit runs, so it is checked as if it ran now: the purpose rules
  // (Karlsruhe mode may have been switched on since staging) and the plan (a reversal's target may have
  // changed). Returns null when the edit may go ahead, else {outcome, message, rule?}.
  function gate(staged, options) {
    const actionType = type(staged.actionTypeId);
    const purposes = asList(staged.purposes);
    const check = DC.purposes ? DC.purposes.check("action", { dataPurposes: purposes, except: options.exceptRules }) : { allowed: true };
    if (!check.allowed && check.effect === "block") return { outcome: "blocked", rule: check.rule, message: `Blocked by rule ${check.rule.id}: ${check.rule.text || ""} This attempt has been logged.` };
    const target = options.object || { id: staged.objectId, type: staged.objectType, label: staged.objectLabel, properties: {} };
    const planned = plan(actionType, target, staged.params, { linked: options.linked, datasetId: staged.datasetId });
    if (planned.problems.length) return { outcome: "not-applicable", message: `${planned.problems[0]} This attempt has been logged.` };
    return null;
  }

  function logGate(staged, problem, verb) {
    return logAction(verb || "action.approve", { objectIds: [staged.objectId], payload: { instanceId: staged.id, stagedId: staged.id, outcome: problem.outcome, rule: problem.rule ? problem.rule.id : null, message: problem.message, runId: staged.runId || null } });
  }

  function stagedLine(item) {
    const diff = Object.keys(item.after || {}).map((key) => `${key} → “${(item.after || {})[key] || "—"}”`).join(", ");
    const systems = asList(item.writebacks).map((wb) => (system(wb.system) ? system(wb.system).label : wb.system));
    return `${item.label || item.actionTypeId} on ${item.objectLabel || item.objectId}${diff ? ` (${diff})` : ""}${systems.length ? ` · sends to ${systems.join(", ")}` : ""}`;
  }

  // The Checkpoint a staged edit (or a batch) needs: the first sensitive type's checkpoint, if any.
  function approvalCheckpoint(list) {
    for (const item of list) {
      const id = checkpointFor(type(item.actionTypeId));
      if (id && DC.checkpoints && DC.governance && (DC.governance.isActive() || DC.governance.checkpoint(id))) return id;
    }
    return null;
  }

  function withApproval(list, context, fn) {
    const checkpointId = approvalCheckpoint(list);
    if (!checkpointId) return fn(null).then((result) => ({ outcome: "continued", record: null, result }));
    const purposes = [...new Set(list.flatMap((item) => asList(item.purposes)))];
    return DC.checkpoints.withCheckpoint(checkpointId, { ...context, objectIds: list.map((item) => item.objectId), purposes }, fn);
  }

  async function approveAction(id, opts) {
    const options = opts || {};
    const staged = pending().find((item) => item.id === id);
    if (!staged) return { outcome: "not-found" };
    const actionType = type(staged.actionTypeId);
    if (!mayApprove(actionType)) {
      await logAction("action.approve", { objectIds: [staged.objectId], payload: { instanceId: id, outcome: "refused", runId: staged.runId || null } });
      return { outcome: "refused", message: "Your role cannot approve staged Actions. This attempt has been logged." };
    }
    if (!actionType) return { outcome: "unknown-type" };
    const problem = gate(staged, options);
    if (problem) {
      await logGate(staged, problem);
      return problem;
    }
    const answer = await withApproval([staged], { surface: options.surface, summary: `Approve the staged edit: ${stagedLine(staged)}`, items: [stagedLine(staged)] }, (record) =>
      applyStaged(staged, options, options.approvedBy || roleId(), record ? record.recordId : null)
    );
    if (answer.outcome !== "continued") return { outcome: answer.outcome, record: answer.record, message: answer.outcome === "refused" ? "Your role cannot approve this sensitive Action. This attempt has been logged." : "Cancelled at the Checkpoint. Nothing changed; the cancellation is logged." };
    const instance = answer.result;
    await logAction("action.approve", {
      objectIds: [staged.objectId],
      checkpointId: answer.record ? answer.record.recordId : null,
      payload: { instanceId: instance.id, stagedId: id, outcome: "approved", approvedBy: instance.approvedBy, runId: staged.runId || null, sensitive: Boolean(answer.record) },
    });
    return { outcome: "applied", instance, record: answer.record };
  }

  // One approval for many edits (spec §4.7 failure mode c): one Checkpoint listing every item, one event.
  async function approveAll(ids, opts) {
    const options = opts || {};
    const wanted = Array.isArray(ids) && ids.length ? new Set(ids) : null;
    const list = pending().filter((item) => !wanted || wanted.has(item.id));
    const by = options.by || `${roleId()} (bulk)`;
    if (!list.length) return { outcome: "nothing", count: 0, instances: [], refused: [] };
    const refused = list.filter((item) => !type(item.actionTypeId) || !mayApprove(type(item.actionTypeId)));
    const runIds = [...new Set(list.map((item) => item.runId).filter(Boolean))];
    if (refused.length === list.length) {
      await logAction("action.approveAll", { objectIds: list.map((item) => item.objectId), payload: { count: 0, ids: list.map((item) => item.id), outcome: "refused", approvedBy: by, runIds } });
      return { outcome: "refused", count: 0, instances: [], refused: refused.map((item) => item.id), message: "Your role cannot approve staged Actions. This attempt has been logged." };
    }
    const optionsFor = (staged) => ({
      ...options,
      object: typeof options.objectFor === "function" ? options.objectFor(staged.objectId, staged) : options.object,
      linked: typeof options.linkedFor === "function" ? options.linkedFor(staged.objectId, staged) : options.linked,
    });
    const skipped = [];
    for (const staged of list.filter((item) => !refused.includes(item))) {
      const problem = gate(staged, optionsFor(staged));
      if (problem) {
        skipped.push({ id: staged.id, ...problem });
        await logGate(staged, problem);
      }
    }
    const todo = list.filter((item) => !refused.includes(item) && !skipped.some((skip) => skip.id === item.id));
    if (!todo.length) {
      return { outcome: skipped.length ? skipped[0].outcome : "refused", count: 0, instances: [], refused: refused.map((item) => item.id), skipped, message: skipped.length ? skipped[0].message : "Nothing to approve." };
    }
    const sensitive = todo.filter((item) => checkpointFor(type(item.actionTypeId))).length;
    const context = {
      surface: options.surface,
      summary: `Approve all ${todo.length} staged edit${todo.length === 1 ? "" : "s"} at once (${sensitive} sensitive). One justification covers every item below.`,
      items: todo.map(stagedLine),
    };
    const answer = await withApproval(todo, context, async (record) => {
      const instances = [];
      for (const staged of todo) {
        instances.push(await applyStaged(staged, optionsFor(staged), by, record ? record.recordId : null));
      }
      return instances;
    });
    if (answer.outcome !== "continued") {
      return { outcome: answer.outcome, count: 0, instances: [], refused: refused.map((item) => item.id), record: answer.record, message: answer.outcome === "refused" ? "Your role cannot approve these sensitive Actions. This attempt has been logged." : "Cancelled at the Checkpoint. Nothing was approved; the cancellation is logged." };
    }
    const instances = answer.result;
    await logAction("action.approveAll", {
      objectIds: instances.map((item) => item.objectId),
      checkpointId: answer.record ? answer.record.recordId : null,
      payload: {
        count: instances.length,
        ids: todo.map((item) => item.id),
        instanceIds: instances.map((item) => item.id),
        approvedBy: by,
        outcome: "approved",
        refused: refused.map((item) => item.id),
        runIds,
        sensitive,
        skipped: skipped.map((item) => ({ id: item.id, outcome: item.outcome })),
      },
    });
    notify("local");
    return { outcome: "applied", count: instances.length, instances, refused: refused.map((item) => item.id), skipped, record: answer.record };
  }

  async function rejectAction(id, reason) {
    const list = pending();
    const staged = list.find((item) => item.id === id);
    if (!staged) return { outcome: "not-found" };
    writeState({ pendingActions: list.filter((item) => item.id !== id) });
    await logAction("action.reject", { objectIds: [staged.objectId], payload: { stagedId: id, outcome: "rejected", reason: String(reason || ""), runId: staged.runId || null, label: staged.label } });
    notify("local");
    return { outcome: "rejected" };
  }

  Object.assign(DC.actions, { approveAction, approveAll, rejectAction });
})();
