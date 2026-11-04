// demo/js/render/agent.js — Agent (simulated AIP) tab.
import { escapeHtml } from "../util.js";
import { copilotState, core, data, ui } from "../state.js";
import { phoneNumbersIn, phoneSearchHeld } from "../governance.js";
import { entityById } from "../derive.js";
import { COPILOT_EXAMPLES } from "../agent.js";
import { renderPhoneHold, withheldNoteHtml } from "./banners.js";
import { honestyChip } from "./common.js";
import { renderTelecomExpansion } from "./inspector.js";
import { buildEntityGraph } from "./graph.js";

export function renderCopilotTool() {
  const result = copilotState.result;
  const resultGraph = result?.graph?.nodes?.length
    ? buildEntityGraph(result.graph.nodes, result.graph.edges, result.focusEntityIds || [], ui.selectedGraphNodeId)
    : null;
  return `
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2>Agent (simulated AIP)${honestyChip("inv.agent")}</h2>
            <p class="microcopy">Ask a plain-English question and the agent pulls together linked evidence from the objects your role can see, the analytics and the investigation graph.</p>
          </div>
        </div>
        <div class="copilot-layout">
          <div class="card-stack">
            <div class="property-card">
              <div class="field">
                <label>Ask a question</label>
                <textarea class="copilot-input" data-scope="copilot" data-field="query" placeholder="Bring together Kareem Haddad across companies, flights, transfers, and devices">${escapeHtml(copilotState.query)}</textarea>
              </div>
              <div class="chip-row">
                ${COPILOT_EXAMPLES.map(
                (example) => `<button class="ghost-button" data-action="copilot-example" data-query="${escapeHtml(example)}">${escapeHtml(example)}</button>`
              ).join("")}
              </div>
              <div class="inline-actions">
                <button class="button-primary" data-action="run-copilot">Ask the agent</button>
              </div>
              ${phoneNumbersIn(copilotState.query).filter(phoneSearchHeld).length ? renderPhoneHold("agent", phoneNumbersIn(copilotState.query).filter(phoneSearchHeld)[0]) : ""}
            </div>
            ${result ? `
              <div class="property-card">
                <h3>Answer</h3>
                <div class="stack-list">
                  ${result.paragraphs.map((paragraph) => `<div class="fact-item">${escapeHtml(paragraph)}</div>`).join("")}
                </div>
                ${withheldNoteHtml(result.withheld, "around these objects")}
                <div class="grounding-summary microcopy">${escapeHtml(`${result.graph?.nodes?.length || 0} objects matched · ${result.graph?.edges?.length || 0} links traversed · built only from objects your role can see`)}</div>
              </div>
              <div class="property-card">
                <h3>Linked evidence</h3>
                <div class="stack-list">
                  ${(result.evidence || []).map((item) => `<div class="fact-item">${escapeHtml(item)}</div>`).join("") || `<div class="fact-item">No evidence extracted yet.</div>`}
                </div>
              </div>
            ` : `
              <div class="property-card">
                <div class="list-item-title">
                  <h3>How this agent works</h3>
                  <span class="grounding-badge">Rule-based stand-in</span>
                </div>
                <div class="stack-list">
                  <div class="fact-item">Anchors natural-language prompts to people, companies, locations, devices, flights, accounts, analytics hits, and investigation scenarios.</div>
                  <div class="fact-item">Synthesizes cross-source evidence into a short analyst-friendly answer.</div>
                  <div class="fact-item">Lets students jump from plain-English questions into structured ontology and case views.</div>
                  <div class="fact-item">${escapeHtml((core.governance && core.governance.honesty("inv.agent")?.text) || "Rule-based stand-in for an AIP chatbot; it cannot invent objects. Real AIP uses an LLM with tools and stages edits for review.")}</div>
                  <div class="fact-item">It only sees what your role sees: withheld objects and properties never reach it.</div>
                </div>
              </div>
              <div class="property-card">
                <h3>Without the ontology vs. with it</h3>
                <div class="comparison-row">
                  <div>
                    <div class="comparison-label">Without</div>
                    <pre class="fact-item comparison-pre">bank_transactions.csv row 14:
  account_id: ACC-002
  to_account: ACC-009
  amount: 47000
  ref: TXF-8812</pre>
                  </div>
                  <div>
                    <div class="comparison-label">With ontology</div>
                    <div class="fact-item">Kareem Haddad → OWNS_ACCOUNT → ACC-002 → TRANSFERRED_TO → ACC-009<br><br>ACC-009 is linked to Cyprus Shell Co Ltd (DIRECTS: Kareem Haddad)<br><br>Corroborated by: 3 mobile location pings near Larnaca Airport</div>
                  </div>
                </div>
              </div>
            `}
          </div>
          <div class="card-stack">
            ${result ? `
              <div class="property-card">
                <div class="list-item-title">
                  <h3>Focus objects</h3>
                  <span class="muted">${escapeHtml(result.graphStats || "")}</span>
                </div>
                <div class="entity-jump-grid">
                  ${result.focusEntities.map(
                  (entity) => `
                      <div class="place-card">
                        <div class="list-item-title">
                          <span>${escapeHtml(entity.label)}</span>
                          <span class="muted">${escapeHtml(entity.type)}</span>
                        </div>
                        <div class="microcopy">${escapeHtml(entity.reason)}</div>
                        <div class="inline-actions">
                          <button class="ghost-button" data-action="copilot-jump-entity" data-id="${escapeHtml(entity.id)}">Open in graph</button>
                        </div>
                        ${entity.type === "Person" ? renderTelecomExpansion(entityById(entity.id)) : ""}
                      </div>
                    `
                ).join("") || `<div class="fact-item">No focal objects were identified for this prompt.</div>`}
                </div>
              </div>
              <div class="property-card">
                <h3>Answer graph</h3>
                <div class="graph-canvas">
                  ${resultGraph ? resultGraph.svg : `<div class="empty-state">No graph available for this answer.</div>`}
                </div>
              </div>
              <div class="property-card">
                <h3>Quick jumps</h3>
                <div class="inline-actions">
                  ${result.recommendedScenarioId ? `<button class="button-secondary" data-action="copilot-jump-scenario" data-id="${escapeHtml(result.recommendedScenarioId)}">Open matching scenario</button>` : ""}
                  ${result.recommendedRuleId ? `<button class="button-secondary" data-action="copilot-jump-rule" data-id="${escapeHtml(result.recommendedRuleId)}">Open matching rule</button>` : ""}
                </div>
                <div class="stack-list">
                  ${(result.suggestedQuestions || []).map((question) => `<div class="fact-item">${escapeHtml(question)}</div>`).join("")}
                </div>
              </div>
            ` : `
              <div class="property-card">
                <h3>Try asking</h3>
                <div class="stack-list">
                  ${COPILOT_EXAMPLES.map((example) => `<div class="fact-item">${escapeHtml(example)}</div>`).join("")}
                </div>
              </div>
            `}
          </div>
        </div>
      </div>
    `;
}
