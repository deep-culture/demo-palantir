// demo/js/render/agent.js — Agent (simulated AIP) tab (spec §4.7, F7): question and examples, the black "Plan and
// trace" panel, the answer with citation chips, staged edits (Approve / Reject / Approve all), Evals with Check,
// the answer graph (cited items highlighted) and the Maven discussion card.
import { escapeHtml, truncate } from "../util.js";
import { copilotState, core, ui } from "../state.js";
import { currentRoleId, phoneNumbersIn, phoneSearchHeld } from "../governance.js";
import { entityById } from "../derive.js";
import { COPILOT_EXAMPLES } from "../agent.js";
import { citeResolves, runApplied, runPending } from "../agent-run.js";
import { renderPhoneHold } from "./banners.js";
import { citeLabel, displayId } from "../disclosure.js";
import { honestyChip } from "./common.js";
import { buildEntityGraph } from "./graph.js";

const FAILURE_TEXT = { "fabricated-link": "fabricated link", overreach: "overreach", "approve-all": "approve all" };

function roleLabel(id) {
  return core.governance?.role(id)?.label || id;
}

function argsText(args) {
  return Object.entries(args || {})
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? `[${value.map((item) => truncate(String(item), 26)).join(", ")}]` : JSON.stringify(typeof value === "object" ? value : value)}`)
    .join(", ");
}

function stepLine(step) {
  let result;
  if (step.pending) result = `<span class="trace-pending">running…</span>`;
  else if (step.denied) result = `<span class="trace-denied">DENIED and logged</span> <span class="trace-reason">${escapeHtml(step.reason)}</span>`;
  else if (step.unavailable) result = `<span class="trace-unavailable">${escapeHtml(step.note)}</span>`;
  else {
    const kind = step.tool === "get_links" ? "link" : step.tool === "propose_action" ? "staged edit" : step.tool === "get_lineage" ? "dataset" : "object";
    const n = step.resultIds.length;
    result = `→ ${n} ${kind}${n === 1 ? "" : "s"}${step.note ? ` <span class="trace-note">· ${escapeHtml(step.note)}</span>` : ""}`;
  }
  return `<li class="trace-step${step.denied ? " is-denied" : ""}" data-step="${step.n}" data-tool="${escapeHtml(step.tool)}"${step.denied ? ' data-denied="true"' : ""}>
      <span class="trace-n">${step.n}</span> <span class="trace-tool">${escapeHtml(step.tool)}</span>(<span class="trace-args">${escapeHtml(argsText(step.args))}</span>) ${result}
      ${step.checkpointRecordId ? `<span class="trace-note">· Checkpoint ${escapeHtml(step.checkpointRecordId)}</span>` : ""}
      ${!step.pending ? `<span class="trace-ms">${step.ms} ms</span>` : ""}
    </li>`;
}

function traceJson(run) {
  return JSON.stringify(
    {
      id: run.id,
      query: run.query,
      role: run.role,
      mode: run.mode,
      threshold: run.threshold,
      steps: run.steps.map((step) => ({ n: step.n, tool: step.tool, args: step.args, resultIds: step.resultIds.slice(0, 8), denied: step.denied, ...(step.reason ? { reason: step.reason } : {}), ms: step.ms })),
      answer: run.answer.map((sentence) => ({ text: sentence.text, cites: sentence.cites })),
      stagedActions: run.stagedActions,
      ...(core.session?.instructorMode?.() ? { failureMode: run.failureMode === "none" ? null : run.failureMode } : {}),
      evals: run.evals ? run.evals.map((item) => ({ id: item.id, pass: item.pass })) : "not checked",
    },
    null,
    2
  );
}

function renderTrace(run) {
  return `
    <div class="agent-trace dc-on-dark" aria-label="Plan and trace">
      <div class="agent-trace-head"><span class="agent-trace-title">Plan and trace</span>
        <span>${escapeHtml(run.id)} · role ${escapeHtml(run.role)} · mode ${escapeHtml(run.mode)}${run.threshold !== null ? ` · threshold ${Number(run.threshold).toFixed(2)}` : ""}${run.failureMode !== "none" && core.session?.instructorMode?.() ? ` · failure mode ${escapeHtml(FAILURE_TEXT[run.failureMode])} (${escapeHtml(run.failureSource)})` : ""}</span></div>
      <div class="agent-trace-query">&gt; ${escapeHtml(run.query)}</div>
      <div class="agent-trace-plan">plan: ${run.plan.map((item) => escapeHtml(item)).join(" → ")}</div>
      <ol class="agent-trace-steps">${run.steps.map(stepLine).join("") || `<li class="trace-step">…</li>`}</ol>
      <p class="agent-trace-foot">Every tool call above is one audit event (kind <code>agent</code>), denied or not. ${copilotState.running ? "Running…" : `${run.steps.length} call${run.steps.length === 1 ? "" : "s"}.`}</p>
      <details class="agent-trace-json"><summary>Trace JSON</summary><pre>${escapeHtml(traceJson(run))}</pre></details>
    </div>`;
}

// Readable chip text (object label, or link type and target); the id is in the tooltip (A4: masked
// for roles without TELECOM when it embeds a phone number).
function citeChip(id) {
  const entity = entityById(id);
  const shown = displayId(id);
  const title = entity ? `${entity.type}: ${entity.label} (${shown})` : shown;
  const active = copilotState.highlight === id ? " is-active" : "";
  return `<button class="cite-chip${active}" data-action="agent-cite" data-id="${escapeHtml(id)}" title="${escapeHtml(title)} — highlight in the answer graph" aria-label="Citation: ${escapeHtml(citeLabel(id))}">[${escapeHtml(citeLabel(id))}]</button>`;
}

function renderAnswer(run) {
  const failed = new Set(run.checked && run.evals ? run.evals[0].failures.map((item) => item.index) : []);
  const stale = run.role !== currentRoleId() || (run.threshold !== null && core.resolution && Number(core.resolution.threshold()) !== Number(run.threshold));
  return `
    <div class="property-card agent-answer">
      <div class="list-item-title"><h3>Answer</h3>${core.objectSets && run.graph.nodes.length ? `<button class="ghost-button" data-action="save-object-set" data-source="agent">Save answer objects as object set</button>` : ""}</div>
      ${stale ? `<div class="agent-stale" role="status">This run was made as ${escapeHtml(roleLabel(run.role))}${run.threshold !== null ? ` at threshold ${Number(run.threshold).toFixed(2)}` : ""}. <button class="ghost-button" data-action="agent-rerun">Ask again as ${escapeHtml(roleLabel(currentRoleId()))}</button></div>` : ""}
      <ol class="agent-sentences">
        ${run.answer
          .map((sentence, index) => `<li class="agent-sentence${failed.has(index) ? " is-failed" : ""}" data-sentence="${index}">${escapeHtml(sentence.text)} ${sentence.cites.map(citeChip).join(" ")}</li>`)
          .join("") || (copilotState.running ? `<li class="agent-sentence muted">Working…</li>` : `<li class="agent-sentence muted">No claim the agent can support from what your role sees.</li>`)}
      </ol>
      ${run.notes.length ? `<div class="agent-notes">${run.notes.map((note) => `<p class="microcopy">${escapeHtml(note)}</p>`).join("")}</div>` : ""}
      <p class="grounding-summary microcopy">${escapeHtml(`${run.answer.length} sentence${run.answer.length === 1 ? "" : "s"} · ${run.answer.reduce((n, s) => n + s.cites.length, 0)} citations · built only from tool results on objects your role can see. Click a citation to highlight it in the graph.`)}</p>
    </div>`;
}

function stagedRow(item, status) {
  const after = Object.entries(item.after || {}).map(([key, value]) => `${key} → “${value}”`).join(", ");
  return `<li class="staged-edit staged-${status}" data-staged="${escapeHtml(item.id)}">
      <div><strong>${escapeHtml(item.label || item.actionTypeId)}</strong> on ${escapeHtml(item.objectLabel || item.objectId)} <span class="muted">${escapeHtml(item.id)}</span>${core.actions.type(item.actionTypeId)?.sensitive ? ` <span class="chip chip-sensitive">sensitive · Checkpoint on approval</span>` : ""}</div>
      <div class="microcopy">${escapeHtml(after || "no ontology change")}${item.params?.reason ? ` · reason “${escapeHtml(item.params.reason)}”` : ""}</div>
      ${status === "pending"
        ? `<div class="inline-actions"><button class="button-secondary" data-action="agent-approve" data-id="${escapeHtml(item.id)}">Approve</button><button class="ghost-button" data-action="agent-reject" data-id="${escapeHtml(item.id)}">Reject</button></div>`
        : `<div class="microcopy staged-status">${status === "applied" ? `applied · approved by ${escapeHtml(item.approvedBy || "—")}` : "rejected"}</div>`}
    </li>`;
}

function renderStaged(run) {
  const pending = runPending(run);
  const applied = runApplied(run);
  const rejected = run.rejected.length;
  if (!pending.length && !applied.length && !rejected && !run.steps.some((step) => step.tool === "propose_action")) return "";
  const nudge = run.failureMode === "approve-all" && pending.length > 1;
  const last = copilotState.lastApproval;
  return `
    <div class="property-card agent-staged">
      <div class="list-item-title"><h3>Staged edits</h3><span class="muted">${escapeHtml(`${pending.length} waiting · ${applied.length} applied · ${rejected} rejected`)}</span></div>
      <p class="microcopy">The agent cannot change the ontology. It stages Actions; a person with the right role approves or rejects each one.</p>
      ${nudge ? `<div class="agent-nudge" role="note"><strong>The agent is confident.</strong> ${pending.length} edits were checked against the rules. Approve all to save time.</div>` : ""}
      <ul class="staged-list">
        ${pending.map((item) => stagedRow(item, "pending")).join("")}
        ${applied.map((item) => stagedRow(item, "applied")).join("")}
      </ul>
      ${pending.length > 1 || nudge ? `<button class="${nudge ? "button-primary agent-approve-all-nudged" : "button-secondary"}" data-action="agent-approve-all">Approve all ${pending.length}</button>` : ""}
      <p class="microcopy">Approving a sensitive edit asks for the same Checkpoint as running the Action by hand; Approve all asks once, for every edit listed.</p>
      ${last && ["refused", "cancelled", "blocked", "not-applicable"].includes(last.outcome) ? `<p class="lead-close-msg bad" role="alert">${escapeHtml(last.message || "Refused.")}</p>` : ""}
    </div>`;
}

function renderEvals(run) {
  const evals = run.checked ? run.evals : null;
  const labels = ["Every claim cites an existing object or link", "No denied tool result was used", "No edit was applied without approval", "Every sensitive edit passed a Checkpoint"];
  return `
    <div class="property-card agent-evals">
      <div class="list-item-title"><h3>Evals</h3><button class="button-secondary" data-action="agent-check" ${copilotState.running ? "disabled" : ""}>Check</button></div>
      <p class="microcopy">Four seeded checks, as AIP Evals would run them. Nothing is checked until you click Check.</p>
      <ul class="eval-list">
        ${labels
          .map((label, index) => {
            const result = evals ? evals[index] : null;
            const state = result ? (result.pass ? "pass" : "fail") : "unchecked";
            return `<li class="eval eval-${state}" data-eval="${result ? escapeHtml(result.id) : index}" data-state="${state}">
                <span class="eval-badge">${state === "unchecked" ? "not checked" : state}</span> ${escapeHtml(label)}
                ${result ? `<div class="microcopy">${escapeHtml(result.detail)}</div>` : ""}
              </li>`;
          })
          .join("")}
      </ul>
    </div>`;
}

function renderGraph(run) {
  if (!run.graph.nodes.length) return "";
  const cited = run.answer.flatMap((sentence) => sentence.cites);
  const graph = buildEntityGraph(run.graph.nodes, run.graph.edges, run.focusIds, ui.selectedGraphNodeId, { highlight: copilotState.highlight, citedEdgeIds: cited });
  const highlightMissing = copilotState.highlight && !citeResolves(copilotState.highlight);
  return `
    <div class="property-card">
      <div class="list-item-title"><h3>Answer graph</h3><span class="muted">${escapeHtml(`${run.graph.nodes.length} objects · ${run.graph.edges.length} links`)}</span></div>
      ${copilotState.highlight ? `<p class="microcopy">Highlighted: <code>${escapeHtml(displayId(copilotState.highlight))}</code>${highlightMissing ? " — nothing in the graph carries this id." : ""}</p>` : ""}
      <div class="graph-canvas agent-graph">${graph.svg}</div>
    </div>`;
}

function renderIntro() {
  return `
    <div class="property-card">
      <div class="list-item-title"><h3>How this agent works</h3><span class="grounding-badge">Rule-based stand-in</span></div>
      <div class="stack-list">
        <div class="fact-item">It makes a plan from your question and calls tools: search_objects, get_links, expand, run_rule, propose_action, get_lineage. No language model is called.</div>
        <div class="fact-item">Each tool runs as your role: markings, purpose rules (Karlsruhe mode) and Checkpoints apply, and every call is written to the audit log.</div>
        <div class="fact-item">Each sentence of the answer cites the objects or links it rests on. It can also be wrong: check the citations.</div>
        <div class="fact-item">It never edits the ontology itself. It stages Actions for a person to approve.</div>
        <div class="fact-item">${escapeHtml(core.governance?.honesty("inv.agent")?.text || "Rule-based stand-in for an AIP chatbot. Real AIP uses an LLM with tools and stages edits for review.")}</div>
      </div>
    </div>`;
}

// Review F-03: a run made under another role is never re-rendered (its answer, graph and trace hold what
// that role could see).
function renderOtherRole(run) {
  return `<div class="property-card agent-stale" role="status">The last run was made as ${escapeHtml(roleLabel(run.role))}; its answer is not shown to ${escapeHtml(roleLabel(currentRoleId()))}. <button class="ghost-button" data-action="agent-rerun">Ask again as ${escapeHtml(roleLabel(currentRoleId()))}</button></div>`;
}

function renderDropped() {
  const dropped = copilotState.droppedRun;
  return `<div class="property-card agent-stale" role="status">The role changed: the previous answer (made as ${escapeHtml(roleLabel(dropped.role))}) was cleared. Press “Ask the agent” to run the question as ${escapeHtml(roleLabel(currentRoleId()))}.</div>`;
}

export function renderCopilotTool() {
  const run = copilotState.run;
  const held = phoneNumbersIn(copilotState.query).filter(phoneSearchHeld);
  return `
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2>Agent (simulated AIP)${honestyChip("inv.agent")}</h2>
            <p class="microcopy">Ask a question. The agent plans, calls tools on what your role can see, answers with citations and stages edits for you to approve.</p>
          </div>
        </div>
        <div class="agent-layout">
            <div class="property-card">
              <div class="field">
                <label for="agent-query">Ask a question</label>
                <textarea id="agent-query" class="copilot-input" data-scope="copilot" data-field="query" placeholder="${escapeHtml(COPILOT_EXAMPLES[0])}">${escapeHtml(copilotState.query)}</textarea>
              </div>
              <div class="chip-row">
                ${COPILOT_EXAMPLES.map((example) => `<button class="ghost-button" data-action="copilot-example" data-query="${escapeHtml(example)}" ${copilotState.running ? "disabled" : ""}>${escapeHtml(example)}</button>`).join("")}
              </div>
              <div class="inline-actions">
                <button class="button-primary" data-action="run-copilot" ${copilotState.running ? "disabled" : ""}>Ask the agent</button>
              </div>
              ${held.length ? renderPhoneHold("agent", held[0]) : ""}
            </div>
            ${run && run.role !== currentRoleId() ? renderOtherRole(run) : run ? renderTrace(run) + renderAnswer(run) + renderGraph(run) + renderStaged(run) + renderEvals(run) : copilotState.droppedRun ? renderDropped() + renderIntro() : renderIntro()}
            ${core.ui?.discussionCardsFor ? core.ui.discussionCardsFor("inv.agent") : ""}
        </div>
      </div>
    `;
}
