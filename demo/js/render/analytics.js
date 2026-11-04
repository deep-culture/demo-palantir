// demo/js/render/analytics.js — Analytics tab.
import { escapeHtml } from "../util.js";
import { analysisState, data, ui } from "../state.js";
import { honestyChip, renderPanelHeader, severityClass } from "./common.js";
import { renderRoleWithheldSummary } from "./inspector.js";
import { renderActionFootnote } from "./action-drawer.js";
import { mergeChip } from "./resolution.js";
import { entityById } from "../derive.js";
import { core } from "../state.js";

// Karlsruhe mode (F9): a blocked rule shows the rule instead of a ranking.
function renderBlockedRule(rule) {
  const hidden = (rule.blockedHits || []).length;
  return `
        <div class="property-card rule-blocked">
          <h3>Ranking blocked</h3>
          ${core.ui.blockedCard(rule.blocked, { operation: "rule", buttonAttrs: `data-action="purpose-exception" data-op="rule" data-key="rule:${escapeHtml(rule.id)}" data-id="${escapeHtml(rule.id)}"` })}
          <p class="microcopy">${escapeHtml(`${hidden} hit${hidden === 1 ? "" : "s"} not ranked. With the mode off the rule runs and only the audit log remembers which purposes it combined.`)}</p>
          ${core.ui.discussionCardsFor("inv.karlsruhe")}
        </div>`;
}

function hitLabel(hit) {
  const entity = hit.focusEntityIds && hit.focusEntityIds.length === 1 ? entityById(hit.focusEntityIds[0]) : null;
  return `${escapeHtml(hit.label)}${entity ? mergeChip(entity) : ""}`;
}

export function renderAnalyticsTool() {
  const selectedRule = analysisState.analytics.find((rule) => rule.id === ui.selectedAnalyticsRuleId);
  if (!selectedRule) {
    return `<div class="panel">${renderPanelHeader("Rule-based analytics", "inv.analytics", "")}<div class="empty-state">No analytics rules are available for this dataset.</div>${renderRoleWithheldSummary()}</div>`;
  }
  return `
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2>Rule-based analytics${honestyChip("inv.analytics")}</h2>
            <p class="microcopy">Show students how suspicious patterns emerge from the ontology after data is normalized and linked.</p>
          </div>
        </div>
        <div class="rule-grid">
          ${analysisState.analytics
          .map(
            (rule) => `
                <button class="scenario-card ${rule.id === ui.selectedAnalyticsRuleId ? "active" : ""}" data-action="select-rule" data-id="${escapeHtml(rule.id)}">
                  <div class="list-item-title">
                    <span>${escapeHtml(rule.title)}</span>
                    <span class="severity-badge ${severityClass(rule.severity)}">${escapeHtml(rule.severity)}</span>
                  </div>
                  <div class="microcopy">${escapeHtml(rule.description)}</div>
                  <div class="chip-row">
                    ${rule.blocked
                      ? `<span class="stat-pill stat-blocked">${escapeHtml(`blocked · rule ${rule.blocked.rule.id}`)}</span>`
                      : `<span class="stat-pill">${escapeHtml(`${rule.hits.length} hits`)}</span>`}
                  </div>
                </button>
              `
          )
          .join("")}
        </div>
        <div class="case-layout">
          <div class="property-card">
            <h3>${escapeHtml(selectedRule.title)}</h3>
            <p class="microcopy">${escapeHtml(selectedRule.description)}</p>
            <div class="chip-row">
              <span class="severity-badge ${severityClass(selectedRule.severity)}">${escapeHtml(selectedRule.severity)}</span>
              ${selectedRule.blocked
                ? `<span class="chip chip-blocked">${escapeHtml(`blocked by rule ${selectedRule.blocked.rule.id}`)}</span>`
                : `<span class="chip">${escapeHtml(`${selectedRule.hits.length} surfaced hits`)}</span>`}
              ${(selectedRule.purposes || []).map(core.ui.purposeChip).join("")}
            </div>
            ${selectedRule.exception ? `<p class="microcopy">Exception granted under Checkpoint record <code>${escapeHtml(selectedRule.exception.recordId || "")}</code> (rule ${escapeHtml(selectedRule.exception.rules.join(", "))}).</p>` : ""}
            ${renderActionFootnote(selectedRule)}
          </div>
          ${selectedRule.blocked ? renderBlockedRule(selectedRule) : `<div class="property-card">
            <h3>Top hits</h3>
            <div class="table-shell">
              <table>
                <thead>
                  <tr>
                    <th>Entity or artifact</th>
                    <th>Score</th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  ${selectedRule.hits
                  .map(
                    (hit) => `
                        <tr>
                          <td>${hitLabel(hit)}</td>
                          <td>${escapeHtml(String(hit.score))}</td>
                          <td>${escapeHtml(hit.detail)}</td>
                        </tr>
                      `
                  )
                  .join("")}
                </tbody>
              </table>
            </div>
          </div>`}
        </div>
      </div>
    `;
}
