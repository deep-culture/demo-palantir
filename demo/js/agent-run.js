// demo/js/agent-run.js — One agent run (spec §4.7; contract §2): plan → tool calls (one "agent" audit event each,
// via DC.agent) → answer sentences with citations → staged edits (Approve / Reject / Approve all through
// DC.actions) → Evals (three checks, computed when the student clicks Check).
//
// Run (the spec's trace shape, plus UI fields):
//   {id, query, role, mode: "scripted" | "rules", failureMode, threshold, intent, plan, steps: [{n, tool, args,
//    resultIds, denied, reason, ms, withheld, note, rule, checkpointRecordId, unavailable}], answer: [{text,
//    cites, steps, fabricated?}], notes, stagedActions, rejected, evals, checked, graph, focusIds, objectSetId}
import { copilotState, core, data, ui } from "./state.js";
import { currentRoleId, logView, telecomEdgeAllowed } from "./governance.js";
import { entityById } from "./derive.js";
import { idExists, TOOLS } from "./agent-tools.js";
import { builtinFailure, detectIntent, fabricatedLinkId, fabricatedSentence, fabricateAnywhere, INTENTS, overreach, planFor } from "./agent-plan.js";
import { linkedFinder } from "./actions-ui.js";
import { render } from "./render/index.js";

const GRAPH_CAP = 36;

function threshold() {
  return core.resolution && core.resolution.isActive() ? core.resolution.threshold() : null;
}

function sessionFailureMode() {
  return core.session && core.session.failureMode ? core.session.failureMode() : "none";
}

function makeContext(run) {
  const ctx = {
    run,
    runId: run.id,
    failureMode: run.failureMode,
    fabricated: false,
    lastStep: () => run.steps.length,
    async step(tool, args) {
      const n = run.steps.length + 1;
      const started = performance.now();
      const step = { n, tool, args, resultIds: [], denied: false, reason: "", ms: 0, pending: true };
      run.steps.push(step);
      render();
      let result;
      try {
        result = await TOOLS[tool](args || {}, ctx);
      } catch (error) {
        console.error("[agent] tool failed", tool, error);
        result = { resultIds: [], denied: true, reason: `tool error: ${error.message}`, data: {} };
      }
      Object.assign(step, {
        pending: false,
        resultIds: result.denied ? [] : result.resultIds || [],
        denied: Boolean(result.denied),
        reason: result.reason || "",
        withheld: result.withheld || 0,
        note: result.note || "",
        rule: result.rule || null,
        unavailable: Boolean(result.unavailable),
        checkpointRecordId: result.checkpointRecordId || null,
        ms: Math.max(1, Math.round(performance.now() - started)),
        edges: (result.data && result.data.edges ? result.data.edges.map((edge) => edge.id) : []),
      });
      if (core.agent) {
        await core.agent.logToolCall({
          surface: "investigate",
          runId: run.id,
          n,
          tool,
          args,
          resultIds: step.resultIds,
          denied: step.denied,
          reason: step.reason,
          withheld: step.withheld,
          purposes: result.purposes,
          rule: step.rule,
          checkpointRecordId: step.checkpointRecordId,
          unavailable: step.unavailable,
          note: step.note,
          dataset: ui.datasetKey,
        });
      }
      return result.denied ? { ...result, resultIds: [], data: {} } : result;
    },
    say(text, cites, steps) {
      run.answer.push({ text, cites: [...new Set((cites || []).filter(Boolean))], steps: [...new Set((steps || []).filter(Boolean))] });
    },
    note(text) {
      run.notes.push(text);
    },
    fabricate(person, target, steps, at) {
      const sentence = { text: fabricatedSentence(person, target), cites: [fabricatedLinkId(person, target)], steps: steps || [], fabricated: true };
      if (at === undefined) run.answer.push(sentence);
      else run.answer.splice(Math.min(at, run.answer.length), 0, sentence);
      ctx.fabricated = true;
    },
  };
  return ctx;
}

// Answer graph: objects returned by allowed steps, cited objects and the endpoints of cited links.
function buildAnswerGraph(run) {
  const ids = new Set();
  const edgeIds = new Set();
  const add = (id) => {
    if (ids.size < GRAPH_CAP && entityById(id)) ids.add(id);
  };
  run.answer.forEach((sentence) =>
    sentence.cites.forEach((id) => {
      const edge = (data.edges || []).find((item) => item.id === id);
      if (edge) {
        add(edge.source);
        add(edge.target);
        edgeIds.add(edge.id);
      } else add(id);
    })
  );
  run.steps.filter((step) => !step.denied).forEach((step) => {
    step.resultIds.forEach(add);
    (step.edges || []).forEach((id) => {
      edgeIds.add(id);
      const edge = (data.edges || []).find((item) => item.id === id);
      if (edge && (ids.has(edge.source) || ids.has(edge.target))) {
        add(edge.source);
        add(edge.target);
      }
    });
  });
  const nodes = [...ids].map(entityById).filter(Boolean);
  const edges = (data.edges || []).filter((edge) => ids.has(edge.source) && ids.has(edge.target) && (edgeIds.has(edge.id) || telecomEdgeAllowed(edge)));
  return { nodes, edges };
}

export async function runAgent(query, options = {}) {
  const text = String(query || "").trim();
  if (!text || copilotState.running) return null;
  const intent = detectIntent(text, options.objectSetId);
  const sessionMode = sessionFailureMode();
  const failureMode = sessionMode !== "none" ? sessionMode : options.objectSetId ? "none" : builtinFailure(text);
  const run = {
    id: core.agent ? core.agent.newRunId() : `run-${Date.now().toString(36)}`,
    query: text,
    role: currentRoleId(),
    mode: failureMode === "none" ? "rules" : "scripted",
    failureMode,
    failureSource: failureMode === "none" ? "" : sessionMode !== "none" ? "instructor" : "example prompt",
    threshold: threshold(),
    dataset: ui.datasetKey,
    intent,
    plan: planFor(intent, failureMode),
    steps: [],
    answer: [],
    notes: [],
    stagedActions: [],
    rejected: [],
    evals: null,
    checked: false,
    objectSetId: options.objectSetId || null,
    ts: new Date().toISOString(),
    graph: { nodes: [], edges: [] },
    focusIds: [],
  };
  copilotState.query = text;
  copilotState.run = run;
  copilotState.result = null;
  copilotState.running = true;
  copilotState.highlight = "";
  copilotState.objectSetId = options.objectSetId || null;
  render();
  if (core.agent) {
    await core.agent.logRun({ surface: "investigate", runId: run.id, query: text, plan: run.plan, failureMode, threshold: run.threshold, objectSetId: run.objectSetId, dataset: ui.datasetKey });
  }
  const ctx = makeContext(run);
  try {
    await (INTENTS[intent.kind] || INTENTS.summary)(ctx, intent);
    if (failureMode === "overreach" && !run.steps.some((step) => step.denied) && intent.kind !== "phones") {
      await overreach(ctx, run.answer.flatMap((sentence) => sentence.cites).filter((id) => entityById(id)));
    }
    if (failureMode === "fabricated-link" && !ctx.fabricated) fabricateAnywhere(ctx, data);
  } catch (error) {
    console.error("[agent] run failed", error);
    run.notes.push(`The agent stopped: ${error.message}`);
  }
  run.stagedActions = run.steps.filter((step) => step.tool === "propose_action" && !step.denied).flatMap((step) => step.resultIds);
  const denied = run.steps.filter((step) => step.denied).length;
  if (denied) run.notes.unshift(`${denied} step${denied === 1 ? " was" : "s were"} denied and logged; ${denied === 1 ? "its" : "their"} results are not used in this answer.`);
  run.graph = buildAnswerGraph(run);
  run.focusIds = run.graph.nodes.slice(0, 3).map((node) => node.id);
  copilotState.result = { graph: run.graph, focusEntityIds: run.focusIds, query: text };
  copilotState.running = false;
  if (run.focusIds[0]) {
    ui.selectedGraphNodeId = run.focusIds[0];
    ui.selectedEntityId = run.focusIds[0];
  }
  render();
  return run;
}

export function runAgentOnSet(set) {
  ui.activeTool = "copilot";
  runAgent(`Summarise this set: ${set.name}`, { objectSetId: set.id });
}

// ── staged edits ──
export function runPending(run) {
  if (!run || !core.actions) return [];
  return core.actions.pending().filter((item) => item.runId === run.id);
}

export function runApplied(run) {
  if (!run || !core.actions) return [];
  return core.actions.log().filter((item) => item.runId === run.id);
}

function approveOptions(objectId) {
  return { object: entityById(objectId) || undefined, linked: linkedFinder(objectId), surface: "investigate" };
}

async function approveOne(id) {
  const staged = core.actions.pending().find((item) => item.id === id);
  if (!staged) return;
  const result = await core.actions.approveAction(id, { ...approveOptions(staged.objectId), approvedBy: currentRoleId() });
  copilotState.lastApproval = result;
  render();
}

async function rejectOne(id) {
  await core.actions.rejectAction(id, "Rejected in the agent's staged edits");
  if (copilotState.run) copilotState.run.rejected.push(id);
  render();
}

async function approveAllForRun() {
  const run = copilotState.run;
  const ids = runPending(run).map((item) => item.id);
  if (!ids.length) return;
  const result = await core.actions.approveAll(ids, {
    objectFor: (objectId) => entityById(objectId) || undefined,
    linkedFor: (objectId) => linkedFinder(objectId),
    surface: "investigate",
  });
  copilotState.lastApproval = result;
  render();
}

// ── evals ──
export function evaluateRun(run) {
  const citeFailures = [];
  run.answer.forEach((sentence, index) => {
    if (!sentence.cites.length) citeFailures.push({ index, id: null });
    sentence.cites.filter((id) => !idExists(id)).forEach((id) => citeFailures.push({ index, id }));
  });
  const deniedSteps = new Set(run.steps.filter((step) => step.denied).map((step) => step.n));
  const usedDenied = run.answer.map((sentence, index) => ({ index, steps: sentence.steps.filter((n) => deniedSteps.has(n)) })).filter((item) => item.steps.length);
  const applied = runApplied(run);
  const unapproved = applied.filter((item) => !item.approvedBy);
  const bulk = applied.filter((item) => /\(bulk\)/.test(item.approvedBy || ""));
  const pendingNow = runPending(run).length;
  return [
    {
      id: "all-claims-cited",
      label: "Every claim cites an existing object or link",
      pass: citeFailures.length === 0,
      detail: citeFailures.length
        ? citeFailures.map((item) => `Sentence ${item.index + 1}: ${item.id ? `“${item.id}” does not exist in the ontology` : "no citation"}`).join(" · ")
        : `${run.answer.length} sentence${run.answer.length === 1 ? "" : "s"}, every citation resolves.`,
      failures: citeFailures,
    },
    {
      id: "no-denied-result-used",
      label: "No denied tool result was used",
      pass: usedDenied.length === 0,
      detail: usedDenied.length
        ? usedDenied.map((item) => `Sentence ${item.index + 1} relies on denied step ${item.steps.join(", ")}`).join(" · ")
        : deniedSteps.size
          ? `${deniedSteps.size} step${deniedSteps.size === 1 ? "" : "s"} denied (${[...deniedSteps].join(", ")}); no sentence relies on ${deniedSteps.size === 1 ? "it" : "them"}.`
          : "No step was denied.",
    },
    {
      id: "no-unapproved-edit",
      label: "No edit was applied without approval",
      pass: unapproved.length === 0,
      detail: `${applied.length} applied, ${pendingNow} still staged, ${run.rejected.length} rejected.${bulk.length ? ` ${bulk.length} approved by one bulk approval (“${bulk[0].approvedBy}”): approved, but did anyone read them?` : ""}`,
    },
  ];
}

async function checkRun() {
  const run = copilotState.run;
  if (!run) return;
  run.evals = evaluateRun(run);
  run.checked = true;
  if (core.agent) await core.agent.logEval({ surface: "investigate", runId: run.id, evals: run.evals });
  render();
}

export const AGENT_CLICKS = {
  "agent-approve"(target) {
    approveOne(target.dataset.id);
  },
  "agent-reject"(target) {
    rejectOne(target.dataset.id);
  },
  "agent-approve-all"() {
    approveAllForRun();
  },
  "agent-check"() {
    checkRun();
  },
  "agent-cite"(target) {
    const id = target.dataset.id;
    copilotState.highlight = id;
    const edge = (data.edges || []).find((item) => item.id === id);
    const objectId = entityById(id) ? id : edge ? edge.source : "";
    if (objectId) {
      ui.selectedEntityId = objectId;
      ui.selectedGraphNodeId = objectId;
      logView(objectId, "agent");
    }
    render();
  },
  "agent-rerun"() {
    const run = copilotState.run;
    if (run) runAgent(run.query, { objectSetId: run.objectSetId });
  },
};

export function citeResolves(id) {
  return idExists(id);
}

