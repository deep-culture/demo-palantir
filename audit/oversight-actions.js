/*
 * audit/oversight-actions.js — Phase 2 panels for Oversight (spec §4.5–4.6, §4.9, §5.4):
 * Action history with before/after and writebacks (DC.actions.log), resolution events (threshold
 * changes, unmerges) with the current overrides, and the discussion card attached to oversight.audit
 * (Raffinaderij). Classic script; attaches window.DCOversight. Rendering helpers (escape, redactable
 * cell, time, role label, object buttons) come from oversight.js so the redaction toggle applies here too.
 */
(function () {
  "use strict";

  const DC = window.DC || {};

  function valueText(value) {
    if (value === undefined || value === null || value === "") return "—";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }

  // Review F-11: values the log copied from the data (an Action's before/after, the writeback message)
  // are shown through the viewer's markings, as the apps show them. The property → markings map comes
  // from the seed's objects; a writeback names the person (PII) and quotes their properties.
  const catalog = window.ontologySeedCatalog || {};
  const seedData = catalog.starter || catalog[Object.keys(catalog)[0]] || {};
  const propertyMarkings = {};
  const typeMarkings = {};
  (seedData.entities || []).forEach((entity) => {
    Object.entries(entity.propertyMarkings || {}).forEach(([key, list]) => {
      propertyMarkings[`${entity.type}.${key}`] = [...new Set([...(propertyMarkings[`${entity.type}.${key}`] || []), ...(list || [])])];
    });
    if (!typeMarkings[entity.type]) typeMarkings[entity.type] = new Set();
    (entity.markings || []).forEach((marking) => typeMarkings[entity.type].add(marking));
  });

  function lacking(markings) {
    if (!DC.markings || !DC.governance || !DC.governance.isActive()) return [];
    return DC.markings.missing(DC.session.get().role, markings || []);
  }

  function withheldText(markings) {
    return `<span class="dc-withheld">withheld — marking ${markings.join(", ")}</span>`;
  }

  function diffHtml(instance, h) {
    const keys = [...new Set([...Object.keys(instance.before || {}), ...Object.keys(instance.after || {})])];
    if (!keys.length) return `<span class="muted">no ontology change</span>`;
    return keys
      .map((key) => {
        const hidden = lacking(propertyMarkings[`${instance.objectType}.${key}`]);
        if (hidden.length) return `<div class="diff-row"><code>${h.esc(key)}</code> ${withheldText(hidden)}</div>`;
        return `<div class="diff-row"><code>${h.esc(key)}</code> <span class="diff-from">${h.esc(valueText((instance.before || {})[key]))}</span> → <span class="diff-to">${h.esc(valueText((instance.after || {})[key]))}</span></div>`;
      })
      .join("");
  }

  function writebacksHtml(instance, h) {
    const list = instance.writebacks || [];
    if (!list.length) return `<span class="muted">—</span>`;
    const hidden = lacking([...(typeMarkings[instance.objectType] || []), "PII"]); // every writeback names a person
    if (hidden.length) {
      return list.map((item) => {
        const system = DC.actions && DC.actions.system(item.system);
        return `<div class="wb"><span class="wb-system">${h.esc(system ? system.label : item.system)}</span> ${withheldText([...new Set(hidden)])}</div>`;
      }).join("");
    }
    return list
      .map((item) => {
        const system = DC.actions && DC.actions.system(item.system);
        return `<div class="wb"><span class="wb-system">${h.esc(system ? system.label : item.system)}</span> <span class="mono">${h.esc(item.message)}</span></div>`;
      })
      .join("");
  }

  function renderActionHistory(h) {
    if (!DC.actions) return "";
    const log = DC.actions.log().slice().reverse();
    const pending = DC.actions.pending();
    const refusals = DC.audit.readEvents({ kind: "action" }).filter((event) => event.verb === "action.apply" && (event.payload || {}).outcome !== "applied");
    if (!log.length && !pending.length && !refusals.length && !DC.actions.isActive()) return "";
    const rows = log
      .slice(0, h.maxRows)
      .map((instance) => {
        const k = `${instance.id}:act`;
        const reason = (instance.params || {}).reason || "";
        return `<tr data-instance="${h.esc(instance.id)}">
          ${h.cell(h.esc(instance.id), `${k}:id`, "mono nowrap")}
          ${h.cell(h.esc(h.formatTime(instance.ts)), `${k}:ts`, "nowrap")}
          ${h.cell(h.esc(h.roleLabel(instance.role)), `${k}:role`)}
          ${h.cell(`${h.esc(instance.label || instance.actionTypeId)}${instance.stagedBy === "agent" ? ` <span class="outcome">staged by agent</span>` : ""}`, `${k}:type`)}
          ${h.cell(h.objectButtons([instance.objectId]), `${k}:obj`, "objects")}
          ${h.cell(reason ? `“${h.esc(reason)}”` : `<span class="muted">—</span>`, `${k}:why`)}
          ${h.cell(diffHtml(instance, h), `${k}:diff`, "diff")}
          ${h.cell(writebacksHtml(instance, h), `${k}:wb`)}
          ${h.cell(`${instance.checkpointRecordId ? `<span class="mono">${h.esc(instance.checkpointRecordId)}</span>` : "—"}${instance.exceptionRecordId ? `<div class="outcome outcome-exception">exception ${h.esc(instance.exceptionRecordId)}</div>` : ""}${instance.approvedBy ? `<div>approved by ${h.esc(h.roleLabel(instance.approvedBy))}</div>` : ""}`, `${k}:cp`)}
        </tr>`;
      })
      .join("");
    const refusalRows = refusals
      .slice(-50)
      .reverse()
      .map((event) => {
        const payload = event.payload || {};
        const k = `${event.id}:actno`;
        return `<li>${h.cellInline(`${h.esc(h.formatTime(event.ts))} <strong>${h.esc(h.roleLabel(event.role))}</strong> ${h.esc(payload.label || payload.actionTypeId || "")} on ${h.esc(DC.ui.displayId((event.objectIds || [])[0] || ""))} — <span class="outcome outcome-${h.esc(payload.outcome || "")}">${h.esc(payload.outcome || "")}</span>${payload.rule ? ` rule ${h.esc(payload.rule)}` : ""}${payload.message ? ` · ${h.esc(payload.message)}` : ""}`, k)}</li>`;
      })
      .join("");
    return `
      <section class="panel" aria-label="Action history">
        <div class="panel-head">
          <h2><span class="dc-highlight">Action history</span> ${DC.ui.honestyChip("inv.actions", { onDark: true })}</h2>
          <span class="muted">${log.length} applied · ${pending.length} staged · ${refusals.length} refused, blocked or not applicable. Each row: what changed, what was sent, under which Checkpoint.</span>
        </div>
        <div class="table-wrap">
          <table class="audit-table action-table">
            <thead><tr><th>Instance</th><th>Time</th><th>Role</th><th>Action</th><th>Object</th><th>Reason</th><th>Before → after</th><th>Writebacks</th><th>Checkpoint</th></tr></thead>
            <tbody>${rows || `<tr><td colspan="9" class="muted">No Actions yet. Run one from Investigate's Action drawer.</td></tr>`}</tbody>
          </table>
        </div>
        ${refusalRows ? `<h3 class="subhead">Not applied</h3><ol class="timeline-list">${refusalRows}</ol>` : ""}
      </section>`;
  }

  function renderResolution(h) {
    const events = DC.audit.readEvents({ kind: "resolution" }).slice().reverse();
    const overrides = DC.resolution ? DC.resolution.overrides() : [];
    if (!events.length && !overrides.length && !(DC.resolution && DC.resolution.isActive())) return "";
    const threshold = DC.resolution ? DC.resolution.threshold() : null;
    const rows = events
      .slice(0, h.maxRows)
      .map((event) => {
        const payload = event.payload || {};
        const k = `${event.id}:res`;
        let detail = "";
        if (event.verb === "resolution.setThreshold") detail = `threshold ${valueText(payload.from)} → ${valueText(payload.to)} · ${valueText(payload.merges)} merge${payload.merges === 1 ? "" : "s"}${(payload.mergedCandidates || []).length ? ` (${payload.mergedCandidates.join(", ")})` : ""}`;
        else if (event.verb === "resolution.unmerge") detail = `unmerge ${valueText(payload.candidateId)} (score ${valueText(payload.score)}) at threshold ${valueText(payload.threshold)}${payload.actionId ? ` · Action ${payload.actionId}` : ""}`;
        else detail = `${event.verb} ${valueText(payload.candidateId || "")}`;
        return `<tr data-event="${h.esc(event.id)}">
          ${h.cell(h.esc(event.id), `${k}:id`, "mono nowrap")}
          ${h.cell(h.esc(h.formatTime(event.ts)), `${k}:ts`, "nowrap")}
          ${h.cell(h.esc(h.roleLabel(event.role)), `${k}:role`)}
          ${h.cell(h.esc(event.surface), `${k}:surface`)}
          ${h.cell(h.esc(detail), `${k}:detail`, "mono")}
          ${h.cell(payload.reason ? `“${h.esc(payload.reason)}”` : `<span class="muted">—</span>`, `${k}:why`)}
          ${h.cell(h.objectButtons(event.objectIds), `${k}:obj`, "objects")}
        </tr>`;
      })
      .join("");
    return `
      <section class="panel" aria-label="Resolution events">
        <div class="panel-head">
          <h2><span class="dc-highlight">Entity resolution</span></h2>
          <span class="muted">Current threshold ${threshold === null ? "—" : Number(threshold).toFixed(2)} · ${overrides.length} rejected merge${overrides.length === 1 ? "" : "s"}${overrides.length ? `: ${h.esc(overrides.map((item) => `${item.candidateId} by ${h.roleLabel(item.by)}`).join(", "))}` : ""}. Who moved the threshold, and who paid for it?</span>
        </div>
        <div class="table-wrap">
          <table class="audit-table resolution-table">
            <thead><tr><th>#</th><th>Time</th><th>Role</th><th>Surface</th><th>Change</th><th>Reason</th><th>Objects</th></tr></thead>
            <tbody>${rows || `<tr><td colspan="7" class="muted">No threshold changes or unmerges yet.</td></tr>`}</tbody>
          </table>
        </div>
      </section>`;
  }

  // Review F-11: say on screen what this page is: a record about people, readable by the oversight roles.
  function renderDiscussion() {
    const cards = DC.ui.discussionCardsFor ? DC.ui.discussionCardsFor("oversight.audit") : "";
    const subjects = DC.governance && DC.governance.discussion && DC.governance.discussion("disc-data-subjects");
    const note = `<p class="log-personal-note" role="note" data-note="log-personal-data"><strong>This log is itself personal data.</strong> It records who was looked at, by whom and why. Values the log copied from the data (an Action's before and after, writeback messages) are shown through your role's markings; free-text justifications are shown as written, and may name people. The people in it are not told and cannot see, correct or contest it${subjects ? ": see the discussion card “" + DC.ui.escapeHtml(subjects.title || "data subjects") + "” below" : ""}.</p>`;
    return `<section class="panel discussion-panel" aria-label="Discussion">${note}${cards}</section>`;
  }

  window.DCOversight = { renderActionHistory, renderResolution, renderDiscussion };
})();
