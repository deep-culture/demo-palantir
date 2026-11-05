/*
 * audit/oversight-governance.js — fix-round panels for Oversight (contract §2 A5, A8).
 *
 * - Marking overrides: every marking a DPO removed, with who removed it, when and under which Checkpoint
 *   record. The DPO can Restore it (DC.markings.requestRestore → Checkpoint cp-marking-restore →
 *   DC.markings.restoreMarking, logged "marking.restore"). Other roles see the list read-only.
 * - Exceptions to review: every self-certified exception (Checkpoint records tagged "exception"). The
 *   exception took effect when it was asked for; the DPO reviews it afterwards. "Mark reviewed" writes an
 *   "exception.review" event (kind "review") naming the record; the reviewed state is read back from
 *   the log, so it needs no other storage.
 * Classic script; attaches window.DCOversightGov. Uses the redactable cell helpers from oversight.js.
 */
(function () {
  "use strict";

  const DC = window.DC || {};

  function isDpo() {
    const role = DC.session && DC.session.role();
    return Boolean(role && role.canRemoveMarkings);
  }

  function renderMarkings(h) {
    if (!DC.markings || !DC.markings.overrides) return "";
    const list = DC.markings.overrides().slice().reverse();
    const dpo = isDpo();
    const restores = DC.audit.readEvents({ verb: "marking.restore" }).slice(-5).reverse();
    return `
      <section class="panel" aria-label="Marking overrides" data-panel="marking-overrides">
        <div class="panel-head">
          <h2><span class="dc-highlight">Marking overrides</span></h2>
          <span class="muted">Markings removed by a data protection officer. While removed, everything derived from the dataset is visible to more roles.${dpo ? " Restoring needs a Checkpoint and is logged." : " Only the data protection officer can restore a marking."}</span>
        </div>
        <div class="table-wrap">
          <table class="audit-table">
            <thead><tr><th>Dataset</th><th>Marking</th><th>Removed by</th><th>When</th><th>Checkpoint record</th><th></th></tr></thead>
            <tbody>
              ${list
                .map((item, index) => {
                  const k = `mo-${index}-${item.datasetId}-${item.removed}`;
                  return `<tr data-override="${h.esc(item.datasetId)}|${h.esc(item.removed)}">
                    ${h.cell(`<code>${h.esc(item.datasetId)}</code>`, `${k}:ds`, "mono")}
                    ${h.cell(DC.ui.markingChip(item.removed), `${k}:mk`)}
                    ${h.cell(h.esc(h.roleLabel(item.by)), `${k}:by`)}
                    ${h.cell(h.esc(h.formatTime(item.ts)), `${k}:ts`, "nowrap")}
                    ${h.cell(h.esc(item.checkpointRecordId || "—"), `${k}:cp`, "mono")}
                    <td>${dpo ? `<button type="button" class="dc-btn" data-action="restore-marking" data-dataset="${h.esc(item.datasetId)}" data-marking="${h.esc(item.removed)}">Restore ${h.esc(item.removed)}…</button>` : ""}</td>
                  </tr>`;
                })
                .join("") || `<tr><td colspan="6" class="muted">No marking has been removed.</td></tr>`}
            </tbody>
          </table>
        </div>
        ${restores.length ? `<p class="muted">Restored: ${restores.map((event) => h.cellInline(`${h.esc((event.payload || {}).marking || "")} on ${h.esc(event.datasetId || "")} by ${h.esc(h.roleLabel(event.role))} (${h.esc((event.payload || {}).outcome || "")})`, `${event.id}:rs`)).join(" · ")}</p>` : ""}
      </section>`;
  }

  function reviewed() {
    const map = new Map();
    DC.audit.readEvents({ verb: "exception.review" }).forEach((event) => {
      const id = (event.payload || {}).recordId;
      if (id) map.set(id, event);
    });
    return map;
  }

  function renderExceptions(h) {
    const records = DC.audit
      .readEvents({ kind: "checkpoint" })
      .filter((event) => ((event.payload || {}).tags || []).includes("exception") && (event.payload || {}).outcome === "continued")
      .reverse();
    const done = reviewed();
    const dpo = isDpo();
    const open = records.filter((event) => !done.has(event.checkpointId)).length;
    return `
      <section class="panel" aria-label="Exceptions to review" data-panel="exceptions-review">
        <div class="panel-head">
          <h2><span class="dc-highlight">Exceptions to review</span></h2>
          <span class="muted">${records.length} self-certified exception${records.length === 1 ? "" : "s"}, ${open} not yet reviewed. Each took effect the moment it was asked for: the review comes after, not before.</span>
        </div>
        <div class="table-wrap">
          <table class="audit-table">
            <thead><tr><th>Record</th><th>Time</th><th>Role</th><th>Rule</th><th>Justification</th><th>Purpose</th><th>Review</th></tr></thead>
            <tbody>
              ${records
                .map((event) => {
                  const payload = event.payload || {};
                  const k = `${event.id}:ex`;
                  const review = done.get(event.checkpointId);
                  return `<tr data-exception="${h.esc(event.checkpointId || "")}">
                    ${h.cell(h.esc(event.checkpointId || ""), `${k}:id`, "mono nowrap")}
                    ${h.cell(h.esc(h.formatTime(event.ts)), `${k}:ts`, "nowrap")}
                    ${h.cell(h.esc(h.roleLabel(event.role)), `${k}:role`)}
                    ${h.cell(h.esc(payload.rule || "—"), `${k}:rule`)}
                    ${h.cell(payload.justification ? `“${h.esc(payload.justification)}”` : "—", `${k}:why`)}
                    ${h.cell(h.esc(payload.purpose || "—"), `${k}:purpose`)}
                    <td>${review
                      ? `<span class="outcome outcome-reviewed" data-reviewed="true">reviewed by ${h.esc(h.roleLabel(review.role))} · ${h.esc(h.formatTime(review.ts))}</span>`
                      : dpo
                        ? `<button type="button" class="dc-btn" data-action="review-exception" data-id="${h.esc(event.checkpointId || "")}">Mark reviewed</button>`
                        : `<span class="muted">awaiting the DPO</span>`}</td>
                  </tr>`;
                })
                .join("") || `<tr><td colspan="7" class="muted">No exception has been requested.</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>`;
  }

  // Returns true when it handled the click.
  function handleClick(target, rerender) {
    const action = target.dataset.action;
    if (action === "restore-marking") {
      DC.markings.requestRestore({ datasetId: target.dataset.dataset, marking: target.dataset.marking, surface: "oversight" }).then(rerender);
      return true;
    }
    if (action === "review-exception") {
      const recordId = target.dataset.id;
      const record = DC.audit.readEvents({ kind: "checkpoint" }).find((event) => event.checkpointId === recordId);
      DC.audit
        .logEvent({ surface: "oversight", kind: "review", verb: "exception.review", objectIds: record ? record.objectIds : [], checkpointId: null, payload: { recordId, outcome: "reviewed", rule: record ? (record.payload || {}).rule : null, requestedBy: record ? record.role : null } })
        .then(rerender);
      return true;
    }
    return false;
  }

  window.DCOversightGov = { renderMarkings, renderExceptions, handleClick };
})();
