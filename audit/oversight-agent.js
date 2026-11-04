/*
 * audit/oversight-agent.js — Phase 3 panels for Oversight (spec §4.7, §4.11; contract §2, §3, §5):
 *   - Agent runs: the agent's tool-call events grouped by run (DC.agent.runs), with the question, the role,
 *     each tool call (denied ones marked, with the reason), the edits it staged and how they were decided;
 *   - Bulk approvals: every "action.approveAll" event with its count — one approval for n edits;
 *   - Object sets: save / update / share / delete events and the current sets with their sharing.
 * Classic script; extends window.DCOversight. The role and run filters of oversight.js apply; rendering
 * helpers come from oversight.js so the redaction toggle applies here too.
 */
(function () {
  "use strict";

  const DC = window.DC || {};
  const base = window.DCOversight || {};

  function stepText(event) {
    const payload = event.payload || {};
    const args = Object.entries(payload.args || {})
      .map(([key, value]) => `${key}: ${Array.isArray(value) ? `[${value.length}]` : value && typeof value === "object" ? JSON.stringify(value).slice(0, 60) : String(value).slice(0, 40)}`)
      .join(", ");
    const result = payload.denied ? `DENIED — ${payload.reason || ""}` : payload.outcome === "unavailable" ? payload.note || "unavailable" : `${payload.resultCount} result${payload.resultCount === 1 ? "" : "s"}`;
    return `${payload.tool}(${args}) → ${result}`;
  }

  function renderRuns(h, filters) {
    if (!DC.agent) return "";
    const runs = DC.agent.runs({ role: filters.role || undefined }).filter((run) => !filters.runId || run.runId === filters.runId);
    const rows = runs
      .slice(0, 30)
      .map((run) => {
        const k = `${run.runId}:run`;
        const denied = run.tools.filter((event) => (event.payload || {}).denied).length;
        const bulk = run.approvals.filter((event) => event.verb === "action.approveAll");
        const single = run.approvals.filter((event) => event.verb === "action.approve" && (event.payload || {}).outcome === "approved");
        const evals = run.evals.length ? run.evals[run.evals.length - 1].payload : null;
        return `<li class="agent-run" data-run="${h.esc(run.runId)}">
          <div class="agent-run-head">${h.cellInline(`<button type="button" class="obj-link" data-action="filter-run" data-id="${h.esc(run.runId)}">${h.esc(run.runId)}</button> · ${h.esc(h.formatTime(run.ts))} · <strong>${h.esc(h.roleLabel(run.role))}</strong> asked “${h.esc(run.query)}”`, `${k}:head`)}
            ${run.failureMode && run.failureMode !== "none" ? `<span class="outcome outcome-exception">scripted: ${h.esc(run.failureMode)}</span>` : ""}
            <span class="muted">${run.tools.length} tool call${run.tools.length === 1 ? "" : "s"}${denied ? ` · ${denied} denied` : ""} · ${run.staged.length} staged · ${single.length} approved one by one${bulk.length ? ` · ${bulk.reduce((n, event) => n + ((event.payload || {}).count || 0), 0)} approved in bulk` : ""} · ${run.rejections.length} rejected${evals ? ` · evals ${h.esc(evals.outcome)}${(evals.failed || []).length ? ` (${h.esc(evals.failed.join(", "))})` : ""}` : " · evals not checked"}</span>
          </div>
          <ol class="agent-run-steps">${run.tools
            .map((event) => `<li class="${(event.payload || {}).denied ? "is-denied" : ""}" data-event="${h.esc(event.id)}">${h.cellInline(h.esc(stepText(event)), `${event.id}:step`)}</li>`)
            .join("")}</ol>
        </li>`;
      })
      .join("");
    return `
      <section class="panel" aria-label="Agent runs">
        <div class="panel-head">
          <h2><span class="dc-highlight">Agent runs</span> ${DC.ui.honestyChip("inv.agent", { onDark: true })}</h2>
          <span class="muted">${runs.length} run${runs.length === 1 ? "" : "s"}. One audit event per tool call, grouped by run. Who asked, what the agent touched, what it was refused, and who approved its edits.</span>
          ${filters.runId ? `<button type="button" class="dc-btn" data-action="filter-run" data-id="">Show all runs</button>` : ""}
        </div>
        <ol class="agent-runs">${rows || `<li class="muted">No agent runs yet. Ask the agent a question in Investigate.</li>`}</ol>
      </section>`;
  }

  function renderBulk(h, filters) {
    const events = DC.audit.readEvents({ verb: "action.approveAll" }).filter((event) => !filters.role || event.role === filters.role).reverse();
    if (!events.length) return "";
    return `
      <section class="panel" aria-label="Bulk approvals">
        <div class="panel-head">
          <h2><span class="dc-highlight">Bulk approvals</span></h2>
          <span class="muted">One click, one audit event, many edits. Count the edits; then ask who read them.</span>
        </div>
        <div class="table-wrap"><table class="audit-table bulk-table">
          <thead><tr><th>#</th><th>Time</th><th>Role</th><th>Approved by</th><th>Edits</th><th>Objects</th></tr></thead>
          <tbody>${events
            .map((event) => {
              const payload = event.payload || {};
              const k = `${event.id}:bulk`;
              return `<tr data-event="${h.esc(event.id)}" data-count="${h.esc(String(payload.count || 0))}">
                ${h.cell(h.esc(event.id), `${k}:id`, "mono nowrap")}
                ${h.cell(h.esc(h.formatTime(event.ts)), `${k}:ts`, "nowrap")}
                ${h.cell(h.esc(h.roleLabel(event.role)), `${k}:role`)}
                ${h.cell(h.esc(payload.approvedBy || ""), `${k}:by`, "mono")}
                ${h.cell(`<strong>${h.esc(String(payload.count || 0))}</strong>${(payload.refused || []).length ? ` <span class="muted">(${payload.refused.length} refused)</span>` : ""}`, `${k}:n`)}
                ${h.cell(h.objectButtons(event.objectIds), `${k}:obj`, "objects")}
              </tr>`;
            })
            .join("")}</tbody>
        </table></div>
      </section>`;
  }

  function renderSets(h, filters) {
    const events = DC.audit.readEvents({ kind: "objectset" }).filter((event) => !filters.role || event.role === filters.role).reverse();
    const sets = DC.objectSets ? DC.objectSets.list() : [];
    if (!events.length && !sets.length) return "";
    return `
      <section class="panel" aria-label="Object sets">
        <div class="panel-head">
          <h2><span class="dc-highlight">Object sets</span> ${DC.ui.honestyChip("inv.object-sets", { onDark: true })}</h2>
          <span class="muted">${sets.length} set${sets.length === 1 ? "" : "s"} saved. Lists decide who is looked at next: who made each one, who it was shared with, and what changed between versions.</span>
        </div>
        <ul class="set-summary">${sets
          .map((set) => `<li>${h.cellInline(`<strong>${h.esc(set.name)}</strong> <span class="mono">${h.esc(set.id)}</span> · ${set.memberIds.length} members · v${set.versions.length} · by ${h.esc(h.roleLabel(set.createdBy))} · shared with ${h.esc((set.sharedWith || []).map(h.roleLabel).join(", ") || "nobody")}`, `${set.id}:set`)}</li>`)
          .join("")}</ul>
        <div class="table-wrap"><table class="audit-table set-table">
          <thead><tr><th>#</th><th>Time</th><th>Role</th><th>Verb</th><th>Set</th><th>Change</th><th>Objects</th></tr></thead>
          <tbody>${events
            .slice(0, h.maxRows)
            .map((event) => {
              const payload = event.payload || {};
              const k = `${event.id}:set`;
              const change =
                event.verb === "objectSet.update"
                  ? `+${payload.added || 0} / −${payload.removed || 0} → v${payload.version}`
                  : event.verb === "objectSet.share"
                    ? `shared with ${(payload.sharedWith || []).map(h.roleLabel).join(", ") || "nobody"}`
                    : event.verb === "objectSet.save"
                      ? `${payload.size} members from ${payload.source || "?"}`
                      : "deleted";
              return `<tr data-event="${h.esc(event.id)}">
                ${h.cell(h.esc(event.id), `${k}:id`, "mono nowrap")}
                ${h.cell(h.esc(h.formatTime(event.ts)), `${k}:ts`, "nowrap")}
                ${h.cell(h.esc(h.roleLabel(event.role)), `${k}:role`)}
                ${h.cell(h.esc(event.verb), `${k}:verb`, "mono")}
                ${h.cell(h.esc(payload.name || payload.setId || ""), `${k}:name`)}
                ${h.cell(h.esc(change), `${k}:change`)}
                ${h.cell(h.objectButtons(event.objectIds), `${k}:obj`, "objects")}
              </tr>`;
            })
            .join("") || `<tr><td colspan="7" class="muted">No object-set events yet.</td></tr>`}</tbody>
        </table></div>
      </section>`;
  }

  function renderAgentPanels(h, filters) {
    return renderRuns(h, filters || {}) + renderBulk(h, filters || {}) + renderSets(h, filters || {});
  }

  window.DCOversight = { ...base, renderAgentPanels };
})();
