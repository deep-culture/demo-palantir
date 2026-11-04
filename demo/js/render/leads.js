// demo/js/render/leads.js — Leads tab (spec §4.8, F8; contract §3): table, formula panel, Close lead, discussion.
// Every number and address shown here comes from buildLeadRows(), i.e. from the components the role can
// see; the seed's all-markings lead fields are never read.
import { escapeHtml } from "../util.js";
import { core, ui } from "../state.js";
import { currentRole, currentRoleId } from "../governance.js";
import { karlsruheOn } from "../purpose-gate.js";
import { buildLeadRows, closeLeadType, leadsActive, selectedLeadRow } from "../leads.js";
import { honestyChip } from "./common.js";
import { mergeChip } from "./resolution.js";

function fmt(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(1) : "—";
}

function sourceChips(row) {
  const visible = row.split.visible.map((component) => core.ui.markingChip(component.marking));
  const hidden = row.split.withheld.map((item) =>
    item.reason === "rule"
      ? `<span class="lead-chip-withheld" data-withheld="rule" title="Removed by purpose rule ${escapeHtml(item.rule?.id || "")}">${escapeHtml(item.component.marking)} · ${escapeHtml(item.rule?.id || "rule")}</span>`
      : `<span class="lead-chip-withheld" data-withheld="marking" title="Withheld: your role does not hold this marking">${escapeHtml(item.component.marking)} withheld</span>`
  );
  return visible.concat(hidden).join(" ");
}

function scoreCell(row) {
  const known = row.split.canKnowFull && row.fullScore !== row.score;
  return `<strong class="lead-score" data-score="${escapeHtml(fmt(row.score))}">${escapeHtml(fmt(row.score))}</strong>${
    known ? ` <span class="muted" title="Full score; a purpose rule removed a component you could otherwise see">(full ${escapeHtml(fmt(row.fullScore))})</span>` : ""
  }${row.split.withheld.length && !known ? `<span class="muted lead-score-sub">visible sources only</span>` : ""}`;
}

function renderTable(rows) {
  return `
    <div class="table-shell leads-table-shell">
      <table class="leads-table">
        <thead><tr><th>#</th><th>Person</th><th>Best visible address</th><th>Score 0–100</th><th>Sources</th><th>Age (days)</th><th>Status</th></tr></thead>
        <tbody>
          ${rows
            .map(
              (row) => `
            <tr class="${row === selectedLeadRow(rows) ? "active" : ""}" data-lead-row="${escapeHtml(row.lead.id)}">
              <td>${row.rank}</td>
              <td><button class="link-button" data-action="select-lead" data-id="${escapeHtml(row.lead.id)}">${escapeHtml(row.person.label)}</button>${mergeChip(row.person)}</td>
              <td>${row.address ? escapeHtml(row.address) : `<span class="muted">no visible address</span>`}</td>
              <td>${scoreCell(row)}</td>
              <td>${sourceChips(row)}</td>
              <td>${row.ageDays === null || row.ageDays === undefined ? "—" : escapeHtml(String(row.ageDays))}</td>
              <td><span class="lead-status lead-status-${escapeHtml(String(row.status).replace(/\s+/g, "-"))}">${escapeHtml(row.status)}</span></td>
            </tr>`
            )
            .join("") || `<tr><td colspan="7" class="muted">No lead is visible to your role.</td></tr>`}
        </tbody>
      </table>
    </div>`;
}

function renderRuleNote(row) {
  const byRule = row.split.withheld.filter((item) => item.reason === "rule");
  if (!byRule.length) return "";
  const rule = byRule[0].rule || {};
  const session = core.governance.purpose(byRule[0].sessionPurpose || "")?.label || byRule[0].sessionPurpose || "";
  return `<div class="lead-rule-note" data-rule="${escapeHtml(rule.id || "")}">
      <strong>Karlsruhe mode: rule ${escapeHtml(rule.id || "")} removed ${byRule.map((item) => escapeHtml(item.component.marking)).join(", ")}.</strong>
      ${escapeHtml(rule.text || "")} The session purpose is ${escapeHtml(session || "a law-enforcement purpose")}, so the score is recomputed without that source.
    </div>`;
}

function renderCloseForm(row) {
  const actionType = closeLeadType();
  if (!actionType) return `<p class="microcopy">Close lead needs the <code>act-close-lead</code> Action type, which this seed does not carry.</p>`;
  const allowed = (actionType.allowedRoles || []).includes(currentRoleId());
  const outcomeParam = (actionType.parameters || []).find((param) => param.id === "outcome");
  const result = ui.leadClose.result;
  let message = "";
  if (result) {
    if (result.outcome === "applied") message = `<p class="lead-close-msg ok" role="status">Lead closed (${escapeHtml(result.instance?.id || "")}). Sent to ${escapeHtml((result.instance?.writebacks || []).map((item) => core.actions.system(item.system)?.label || item.system).join(", ") || "—")}.</p>`;
    else if (result.outcome === "invalid") message = `<p class="lead-close-msg bad" role="alert">${escapeHtml(Object.values(result.errors || {}).join(" "))}</p>`;
    else if (result.outcome === "blocked") message = core.ui.blockedCard(result.check || { rule: result.rule }, { operation: "action" });
    else message = `<p class="lead-close-msg bad" role="alert">${escapeHtml(result.message || result.outcome)}</p>`;
  }
  if (row.status === "closed") {
    return `<div class="lead-close"><h3>Close lead</h3><p class="microcopy">Closed${row.outcome ? ` · outcome ${escapeHtml(row.outcome)}` : ""}${row.closeReason ? ` · “${escapeHtml(row.closeReason)}”` : ""}. The lead stays in the list.</p>${message}</div>`;
  }
  return `<div class="lead-close">
      <h3>Close lead ${honestyChip("inv.actions")}</h3>
      ${allowed ? "" : `<p class="microcopy">Your role (${escapeHtml(currentRole()?.label || currentRoleId())}) cannot run this Action; trying is logged.</p>`}
      <div class="lead-close-row">
        <div class="field"><label for="lead-outcome">Outcome</label>
          <select id="lead-outcome" data-scope="lead-close" data-field="outcome">
            <option value="">— choose —</option>
            ${(outcomeParam?.options || []).map((option) => `<option value="${escapeHtml(option)}" ${option === ui.leadClose.outcome ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}
          </select></div>
        <div class="field lead-reason"><label for="lead-reason">Reason (at least 10 characters)</label>
          <input id="lead-reason" data-scope="lead-close" data-field="reason" value="${escapeHtml(ui.leadClose.reason)}" placeholder="e.g. Address checked; no action needed"></div>
        <button class="button-primary" data-action="close-lead">Close lead</button>
      </div>
      ${message}
    </div>`;
}

function renderDetail(row) {
  if (!row) return `<div class="property-card"><div class="empty-state">Select a lead.</div></div>`;
  const hidden = row.split.withheld.length;
  return `
    <div class="property-card lead-detail" data-lead-detail="${escapeHtml(row.lead.id)}">
      <div class="list-item-title">
        <h3>${escapeHtml(row.person.label)}${mergeChip(row.person)}</h3>
        <span class="lead-score-big" data-score="${escapeHtml(fmt(row.score))}">${escapeHtml(fmt(row.score))}</span>
      </div>
      <p class="microcopy">${row.address ? `Best visible address: <strong>${escapeHtml(row.address)}</strong>.` : "No address source is visible to your role."} ${
        hidden ? escapeHtml(`${hidden} component${hidden === 1 ? "" : "s"} withheld; the score is recomputed from what your role can see.`) : "Every component is visible to your role."
      }${row.merged ? escapeHtml(` This lead combines ${row.items.length} people merged at the current threshold.`) : ""}</p>
      ${renderRuleNote(row)}
      ${core.ui.leadFormula(row.lead, row.split.visible, { withheld: row.split.withheld })}
      ${renderCloseForm(row)}
    </div>`;
}

export function renderLeadsTool() {
  const header = `<div class="panel-header"><div>
      <h2>Leads${honestyChip("inv.leads")}</h2>
      <p class="microcopy">Address leads ranked by a 0–100 confidence score: each source contributes its weight, decayed by age. The score is recomputed in your browser from the sources your role may see${karlsruheOn() ? " and the purpose rules allow" : ""}.</p>
    </div><button class="button-secondary" data-action="leads-on-map">Show on map</button></div>`;
  if (!leadsActive()) {
    return `<div class="panel">${header}<div class="empty-state">This dataset has no leads block (the 06 Build Leads transform has not been run for this seed).</div></div>`;
  }
  const { rows, withheldLeads } = buildLeadRows();
  const row = selectedLeadRow(rows);
  return `
    <div class="panel">
      ${header}
      <div class="chip-row">
        <span class="chip">${escapeHtml(`${rows.length} leads visible`)}</span>
        ${withheldLeads ? `<span class="chip chip-withheld">${escapeHtml(`${withheldLeads} lead${withheldLeads === 1 ? "" : "s"} withheld (person not visible to your role)`)}</span>` : ""}
        ${karlsruheOn() ? `<span class="chip">Karlsruhe mode on</span>` : ""}
      </div>
      <div class="leads-layout">
        <div>${renderTable(rows)}</div>
        <div class="card-stack">
          ${renderDetail(row)}
          ${core.ui.discussionCardsFor ? core.ui.discussionCardsFor("inv.leads") : ""}
        </div>
      </div>
    </div>`;
}
