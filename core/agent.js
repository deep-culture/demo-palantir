/*
 * core/agent.js — audit logging for the simulated AIP agent (spec §4.7, F7; contract §2, §5).
 *
 * Classic script; attaches window.DC.agent. Load after store, session, audit.
 *
 * The agent itself lives in the app (demo/js/agent*.js): it plans deterministically and runs its tools
 * through the role view, purpose rules and Checkpoints. The core only fixes the shape of what it logs,
 * so Oversight can group a run's events without knowing the app.
 *
 *   DC.agent.newRunId()                          "run-<base36 time>-<n>"
 *   DC.agent.logRun({runId, query, plan, failureMode, threshold, objectSetId, surface})
 *       -> Promise<event>  kind "agent", verb "agent.query" (the question; one per run, before the tools)
 *   DC.agent.logToolCall({runId, n, tool, args, resultIds, denied, reason, withheld, purposes, rule,
 *       checkpointRecordId, note, surface})
 *       -> Promise<event>  kind "agent", verb "agent.tool": ONE event per tool call, denied or not.
 *       objectIds = the object ids in args (objectId / objectIds) plus up to 40 result ids;
 *       payload.resultIds is capped at 40, payload.resultCount is the full count.
 *   DC.agent.logEval({runId, evals, surface})   kind "agent", verb "agent.eval" (the student clicked Check)
 *   DC.agent.runs(filter?) -> [{runId, query, role, ts, sessionId, failureMode, threshold, events,
 *       tools: [tool events], evals, staged: [action.stage events], approvals: [...], rejections: [...]}]
 *       newest first; filter {role, sessionId}
 *   DC.agent.TOOLS                               the six tool names
 *
 * Without DC.audit every log call resolves to null.
 */
(function () {
  "use strict";

  const DC = (window.DC = window.DC || {});
  const TOOLS = ["search_objects", "get_links", "expand", "run_rule", "propose_action", "get_lineage"];
  const RESULT_CAP = 40;
  let counter = 0;

  function newRunId() {
    counter += 1;
    return `run-${Date.now().toString(36)}-${String(counter).padStart(2, "0")}`;
  }

  function log(partial) {
    if (!DC.audit) return Promise.resolve(null);
    return DC.audit.logEvent({ kind: "agent", ...partial });
  }

  function idsIn(args) {
    const out = [];
    if (!args || typeof args !== "object") return out;
    if (args.objectId) out.push(args.objectId);
    if (Array.isArray(args.objectIds)) out.push(...args.objectIds);
    return out;
  }

  function logRun(run) {
    const r = run || {};
    return log({
      surface: r.surface,
      verb: "agent.query",
      objectIds: [],
      payload: {
        runId: r.runId,
        query: String(r.query || ""),
        plan: Array.isArray(r.plan) ? r.plan : [],
        failureMode: r.failureMode || "none",
        threshold: r.threshold === undefined ? null : r.threshold,
        objectSetId: r.objectSetId || null,
        dataset: r.dataset || null,
      },
    });
  }

  function logToolCall(call) {
    const c = call || {};
    const results = Array.isArray(c.resultIds) ? c.resultIds.filter(Boolean) : [];
    return log({
      surface: c.surface,
      verb: "agent.tool",
      objectIds: [...idsIn(c.args), ...(c.denied ? [] : results.slice(0, RESULT_CAP))],
      checkpointId: c.checkpointRecordId || null,
      payload: {
        runId: c.runId,
        n: c.n,
        tool: c.tool,
        args: c.args || {},
        resultIds: c.denied ? [] : results.slice(0, RESULT_CAP),
        resultCount: c.denied ? 0 : results.length,
        denied: Boolean(c.denied),
        outcome: c.denied ? "denied" : c.unavailable ? "unavailable" : "ok",
        reason: c.reason || "",
        withheld: c.withheld || 0,
        purposes: Array.isArray(c.purposes) ? c.purposes : [],
        rule: c.rule || null,
        note: c.note || "",
        dataset: c.dataset || null,
      },
    });
  }

  function logEval(entry) {
    const e = entry || {};
    const evals = Array.isArray(e.evals) ? e.evals : [];
    return log({
      surface: e.surface,
      verb: "agent.eval",
      payload: { runId: e.runId, evals: evals.map((item) => ({ id: item.id, pass: Boolean(item.pass) })), failed: evals.filter((item) => !item.pass).map((item) => item.id), outcome: evals.every((item) => item.pass) ? "pass" : "fail" },
    });
  }

  function runs(filter) {
    if (!DC.audit) return [];
    const f = filter || {};
    const byRun = new Map();
    const order = [];
    DC.audit.readEvents().forEach((event) => {
      const payload = event.payload || {};
      const runId = payload.runId || (Array.isArray(payload.runIds) && payload.runIds.length === 1 ? payload.runIds[0] : null);
      if (!runId) return;
      if (!byRun.has(runId)) {
        byRun.set(runId, { runId, query: "", role: event.role, ts: event.ts, sessionId: event.sessionId, failureMode: "none", threshold: null, events: [], tools: [], evals: [], staged: [], approvals: [], rejections: [] });
        order.push(runId);
      }
      const run = byRun.get(runId);
      run.events.push(event);
      if (event.verb === "agent.query") {
        run.query = payload.query || "";
        run.role = event.role;
        run.ts = event.ts;
        run.failureMode = payload.failureMode || "none";
        run.threshold = payload.threshold;
        run.plan = payload.plan || [];
      } else if (event.verb === "agent.tool") run.tools.push(event);
      else if (event.verb === "agent.eval") run.evals.push(event);
      else if (event.verb === "action.stage") run.staged.push(event);
      else if (event.verb === "action.approve" || event.verb === "action.approveAll") run.approvals.push(event);
      else if (event.verb === "action.reject") run.rejections.push(event);
    });
    return order
      .map((id) => byRun.get(id))
      .filter((run) => (!f.role || run.role === f.role) && (!f.sessionId || run.sessionId === f.sessionId))
      .reverse();
  }

  DC.agent = { TOOLS, RESULT_CAP, newRunId, logRun, logToolCall, logEval, runs };
})();
