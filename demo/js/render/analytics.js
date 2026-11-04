// demo/js/render/analytics.js — Analytics tab.
import { escapeHtml } from "../util.js";
import { analysisState, data, ui } from "../state.js";
import { honestyChip, renderPanelHeader, severityClass } from "./common.js";
import { renderRoleWithheldSummary } from "./inspector.js";

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
                    <span class="stat-pill">${escapeHtml(`${rule.hits.length} hits`)}</span>
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
              <span class="chip">${escapeHtml(`${selectedRule.hits.length} surfaced hits`)}</span>
            </div>
          </div>
          <div class="property-card">
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
                          <td>${escapeHtml(hit.label)}</td>
                          <td>${escapeHtml(String(hit.score))}</td>
                          <td>${escapeHtml(hit.detail)}</td>
                        </tr>
                      `
                  )
                  .join("")}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    `;
}
