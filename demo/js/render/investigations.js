// demo/js/render/investigations.js — Investigations tab.
import { currencyFormatter, escapeHtml } from "../util.js";
import { analysisState, data, derived, ui } from "../state.js";
import { entityById } from "../derive.js";
import { withheldNoteHtml } from "./banners.js";
import { honestyChip, renderPanelHeader, severityClass } from "./common.js";
import { renderRoleWithheldSummary, renderTelecomExpansion } from "./inspector.js";
import { buildEntityGraph } from "./graph.js";

export function renderInvestigationsTool() {
  const selectedScenario = analysisState.investigations.find((scenario) => scenario.id === ui.selectedScenarioId);
  if (!selectedScenario) {
    return `<div class="panel">${renderPanelHeader("Investigation workspace", "inv.investigations", "Guided scenarios derived from the current graph.")}<div class="empty-state">No investigation scenarios are available for what your role can see.</div>${renderRoleWithheldSummary()}</div>`;
  }
  const graph = buildEntityGraph(selectedScenario.graph.nodes, selectedScenario.graph.edges, selectedScenario.focusEntityIds, ui.selectedGraphNodeId);
  return `
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2>Investigation workspace${honestyChip("inv.investigations")}</h2>
            <p class="microcopy">Move from ontology design into case analysis using guided scenarios derived from the current graph.</p>
          </div>
        </div>
        <div class="scenario-grid">
          ${analysisState.investigations
          .map(
            (scenario) => `
                <button class="scenario-card ${scenario.id === ui.selectedScenarioId ? "active" : ""}" data-action="select-scenario" data-id="${escapeHtml(scenario.id)}">
                  <div class="list-item-title">
                    <span>${escapeHtml(scenario.title)}</span>
                    <span class="severity-badge ${severityClass(scenario.severity)}">${escapeHtml(scenario.severity)}</span>
                  </div>
                  <div class="microcopy">${escapeHtml(scenario.summary)}</div>
                  <div class="chip-row">
                    <span class="stat-pill">${escapeHtml(`${scenario.graph.nodes.length} nodes`)}</span>
                    <span class="stat-pill">${escapeHtml(`${scenario.graph.edges.length} edges`)}</span>
                  </div>
                </button>
              `
          )
          .join("")}
        </div>
        <div class="case-layout">
          <div class="card-stack">
            <div class="property-card">
              <h3>${escapeHtml(selectedScenario.title)}</h3>
              <p class="microcopy">${escapeHtml(selectedScenario.summary)}</p>
              <div class="chip-row">
                <span class="severity-badge ${severityClass(selectedScenario.severity)}">${escapeHtml(selectedScenario.severity)}</span>
                <span class="chip">${escapeHtml(`score ${selectedScenario.score}`)}</span>
                <span class="chip">${escapeHtml(`${selectedScenario.focusEntityIds.length} focus nodes`)}</span>
              </div>
              <div class="stack-list">
                ${selectedScenario.facts.map((fact) => `<div class="fact-item">${escapeHtml(fact)}</div>`).join("")}
              </div>
              ${withheldNoteHtml(selectedScenario.withheld, "around this case")}
              ${selectedScenario.focusEntityIds.map((id) => entityById(id)).filter((entity) => entity && (entity.type === "Person" || entity.type === "Location")).slice(0, 2).map(renderTelecomExpansion).join("")}
            </div>
            <div class="property-card">
              <h3>Recommended Actions</h3>
              <p class="microcopy">In a production system, these actions would be permissioned and audited. Click to log an action.</p>
              <div class="inline-actions">
                ${selectedScenario.actions.map(
                (actionLabel) => `<button class="ghost-button" data-action="execute-scenario-action" data-scenario-id="${escapeHtml(selectedScenario.id)}" data-scenario-title="${escapeHtml(selectedScenario.title)}" data-action-label="${escapeHtml(actionLabel)}">${escapeHtml(actionLabel)}</button>`
              ).join("")}
              </div>
              <div class="action-log">
                ${analysisState.actionLog.filter((entry) => entry.scenarioId === selectedScenario.id).length
                ? analysisState.actionLog
                    .filter((entry) => entry.scenarioId === selectedScenario.id)
                    .map((entry) => `<div class="action-log-entry"><span class="action-log-ts">${escapeHtml(entry.ts)}</span> — ${escapeHtml(entry.action)}</div>`)
                    .join("")
                : `<div class="action-log-empty">No actions taken yet.</div>`
              }
              </div>
            </div>
            <div class="property-card">
              <h3>Saved graph paths</h3>
              <div class="stack-list">
                ${selectedScenario.paths.map((path) => `<div class="fact-item">${escapeHtml(path)}</div>`).join("")}
              </div>
            </div>
            <div class="property-card">
              <h3>Transfer summary</h3>
              <div class="table-shell">
                <table>
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Target</th>
                      <th>Total</th>
                      <th>Events</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${selectedScenario.transfers
                    .map(
                      (transfer) => `
                          <tr>
                            <td>${escapeHtml(transfer.sourceLabel)}</td>
                            <td>${escapeHtml(transfer.targetLabel)}</td>
                            <td>${escapeHtml(currencyFormatter.format(transfer.totalAmountUsd))}</td>
                            <td>${escapeHtml(`${transfer.count}`)}</td>
                          </tr>
                        `
                    )
                    .join("") || `<tr><td colspan="4" class="muted">No transfer edges in this scenario.</td></tr>`}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <div class="card-stack">
            <div class="property-card">
              <h3>Scenario graph</h3>
              <div class="graph-canvas">
                ${graph.svg}
              </div>
            </div>
            <div class="property-card">
              <h3>Timeline</h3>
              <div class="timeline-list">
                ${selectedScenario.timeline
                .map(
                  (event) => `
                      <div class="timeline-item">
                        <strong>${escapeHtml(event.title)}</strong>
                        <div class="muted">${escapeHtml(event.ts || "Derived relationship")}</div>
                        <div>${escapeHtml(event.detail)}</div>
                      </div>
                    `
                )
                .join("")}
              </div>
            </div>
            <div class="property-card">
              <h3>Location panel</h3>
              <div class="place-list">
                ${selectedScenario.places
                .map(
                  (place) => `
                      <div class="place-card">
                        <div class="list-item-title">
                          <span>${escapeHtml(place.label)}</span>
                          <span class="muted">${escapeHtml(place.type)}</span>
                        </div>
                        <div class="microcopy">${escapeHtml(place.detail)}</div>
                        <div class="chip-row">
                          <span class="stat-pill">${escapeHtml(`${place.relatedCount} connected edges`)}</span>
                          ${place.lat && place.lon ? `<span class="stat-pill">${escapeHtml(`${place.lat}, ${place.lon}`)}</span>` : ""}
                        </div>
                      </div>
                    `
                )
                .join("")}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
}
