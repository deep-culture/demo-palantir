// demo/js/render/inspector.js — The right-hand inspector: insight panel, markings, resolution note, telecom expansion.
import { escapeHtml } from "../util.js";
import { analysisState, copilotState, core, data, roleView, ui } from "../state.js";
import {
  isWithheldValue,
  lackingMarkings,
  telecomExpansionTargets,
  telecomGateActive,
  withheldAround,
} from "../governance.js";
import {
  edgesForEntity,
  entityById,
  entityCount,
  entityTypeById,
  mappingById,
  relationshipById,
} from "../derive.js";
import { buildMapData } from "../map.js";
import { summarizeEntityForCopilot } from "../agent.js";
import { withheldNoteHtml } from "./banners.js";
import { severityClass } from "./common.js";

// Labels for the resolution note (F0.2).
export const RESOLUTION_METHOD_LABELS = {
  passport: "Matched by passport",
  phone: "Matched by phone",
  "name+dob": "Matched by name + date of birth",
  alias: "Matched by alias",
  "ping-only": "Created from a location ping only",
};

// The "Expand devices & locations" control for a Person (or "people observed here" for a Location).
export function renderTelecomExpansion(entity) {
  if (!entity || !telecomGateActive() || !["Person", "Location"].includes(entity.type)) return "";
  const lacking = lackingMarkings(["TELECOM"]);
  const label = entity.type === "Person" ? "Devices & locations" : "People observed here";
  if (lacking.length) {
    return `
        <div class="insight-section telecom-expand">
          <div class="insight-label">${escapeHtml(label)}</div>
          ${core.ui.withheldCell(lacking)}
          ${core.ui.whyLine(lacking, roleView.roleId)}
        </div>
      `;
  }
  if (ui.telecomExpanded.has(entity.id)) {
    return `
        <div class="insight-section telecom-expand">
          <div class="insight-label">${escapeHtml(label)}</div>
          <div class="microcopy">Expanded under Checkpoint record <code>${escapeHtml(ui.telecomRecords[entity.id] || "")}</code>. Telecom links now show in scenario, agent and graph views.</div>
        </div>
      `;
  }
  const targets = telecomExpansionTargets(entity);
  return `
      <div class="insight-section telecom-expand">
        <div class="insight-label">${escapeHtml(label)}</div>
        <div class="microcopy">${escapeHtml(targets.summary)}. Telecom links are not followed until you state a purpose.</div>
        <div class="inline-actions">
          <button class="button-secondary" data-action="expand-telecom" data-id="${escapeHtml(entity.id)}" ${targets.count ? "" : "disabled"}>${
          entity.type === "Person" ? "Expand devices &amp; locations" : "Expand people observed here"
        }</button>
        </div>
      </div>
    `;
}

export function renderInspector() {
  const selection = getInspectorSelection();
  const prompts = data.metadata?.teachingPrompts || [];
  const isInsight = ui.inspectorMode !== "json";
  return `
      <div class="inspector-stack">
        <div class="panel">
          <div class="inspector-toggle-row">
            <h3>${isInsight ? "Insight" : "Raw JSON"}</h3>
            <div style="display:flex;gap:0.4rem">
              <button class="toggle-btn ${isInsight ? "active" : ""}" data-action="inspector-mode" data-mode="insight">Insight</button>
              <button class="toggle-btn ${!isInsight ? "active" : ""}" data-action="inspector-mode" data-mode="json">JSON</button>
            </div>
          </div>
          ${isInsight ? renderInsightPanel(selection) : `<div class="selection-json"><pre>${escapeHtml(JSON.stringify(selection, null, 2))}</pre></div>`}
        </div>
        <div class="panel">
          <h3>Data sources</h3>
          <div class="card-stack">
            ${(data.sources || [])
            .map(
              (source) => `
                  <div class="source-card">
                    <strong>${escapeHtml(source.name)}</strong>
                    <div class="muted">${escapeHtml(source.file)}</div>
                    <div class="microcopy">${escapeHtml(source.description)}</div>
                    <div class="chip-row">
                      <span class="stat-pill">${escapeHtml(`${source.recordCount} records`)}</span>
                      <span class="stat-pill">${escapeHtml(`${source.fields.length} fields`)}</span>
                    </div>
                  </div>
                `
            )
            .join("")}
          </div>
        </div>
        <div class="panel">
          <h3>Teaching prompts</h3>
          <div class="prompt-grid">
            ${prompts
            .map(
              (prompt) => `
                  <div class="prompt-card">
                    <h3>${escapeHtml(prompt)}</h3>
                  </div>
                `
            )
            .join("")}
          </div>
        </div>
      </div>
    `;
}

export function getInspectorSelection() {
  if (ui.activeTool === "copilot") {
    return copilotState.result || { query: copilotState.query };
  }
  if (ui.activeTool === "map") {
    const mapData = buildMapData();
    return {
      scope: mapData.summary.scope,
      selectedPlace: mapData.selectedPlace,
      routeCount: mapData.routes.length,
      visiblePlaces: mapData.places.length,
    };
  }
  if (ui.activeTool === "investigations") {
    return analysisState.investigations.find((scenario) => scenario.id === ui.selectedScenarioId) || {};
  }
  if (ui.activeTool === "analytics") {
    return analysisState.analytics.find((rule) => rule.id === ui.selectedAnalyticsRuleId) || {};
  }
  if (ui.activeTool === "entity-types" || ui.activeTool === "properties") {
    return entityTypeById(ui.selectedEntityTypeId) || {};
  }
  if (ui.activeTool === "relationships") {
    return relationshipById(ui.selectedRelationshipId) || {};
  }
  if (ui.activeTool === "mappings") {
    return mappingById(ui.selectedMappingId) || {};
  }
  if (ui.activeTool === "instances") {
    return {
      entity: entityById(ui.selectedEntityId) || {},
      connectedEdges: edgesForEntity(ui.selectedEntityId),
    };
  }
  if (ui.graphMode === "schema") {
    return entityTypeById(ui.selectedGraphNodeId) || {};
  }
  return {
    entity: entityById(ui.selectedGraphNodeId) || {},
    connectedEdges: edgesForEntity(ui.selectedGraphNodeId),
  };
}

export function insightRow(label, value) {
  if (!value) return "";
  return `<div class="insight-section"><div class="insight-label">${escapeHtml(label)}</div><div class="insight-value">${escapeHtml(String(value))}</div></div>`;
}

export function insightEvidenceList(items) {
  if (!items || !items.length) return "";
  return `<div class="insight-evidence-list">${items.map((item) => `<div class="insight-evidence-item">${escapeHtml(item)}</div>`).join("")}</div>`;
}

export function renderInsightPanel(selection) {
  const tool = ui.activeTool;

  if (tool === "investigations") {
    const scenario = analysisState.investigations.find((s) => s.id === ui.selectedScenarioId);
    if (!scenario) return `<p class="microcopy">No scenario selected.</p>`;
    const maxScore = Math.max(...analysisState.investigations.map((s) => s.score), 1);
    const pct = Math.round((scenario.score / maxScore) * 100);
    return `
        <div class="insight-section">
          <div class="insight-label">Scenario</div>
          <div class="insight-value" style="font-weight:600">${escapeHtml(scenario.title)}</div>
        </div>
        <div class="insight-section">
          <span class="severity-badge ${severityClass(scenario.severity)}">${escapeHtml(scenario.severity)}</span>
          <div class="score-bar-wrap">
            <div class="score-bar-track"><div class="score-bar-fill" style="width:${pct}%"></div></div>
            <span class="score-label">score ${scenario.score}</span>
          </div>
        </div>
        ${insightRow("Summary", scenario.summary)}
        ${scenario.facts?.length ? `<div class="insight-section"><div class="insight-label">Key facts</div>${insightEvidenceList(scenario.facts)}</div>` : ""}
        ${scenario.withheld && (scenario.withheld.links || scenario.withheld.objects) ? `<div class="insight-section"><div class="insight-label">Withheld from your role</div>${withheldNoteHtml(scenario.withheld, "")}</div>` : ""}
        <div class="teaching-tip"><strong>Teaching tip</strong>${escapeHtml(scenario.facts?.[1] || "Ask students what additional sources would strengthen this case.")}</div>
      `;
  }

  if (tool === "analytics") {
    const rule = analysisState.analytics.find((r) => r.id === ui.selectedAnalyticsRuleId);
    if (!rule) return `<p class="microcopy">No rule selected.</p>`;
    const topHit = rule.hits[0];
    const maxScore = Math.max(...rule.hits.map((h) => h.score), 1);
    return `
        <div class="insight-section">
          <div class="insight-label">Rule</div>
          <div class="insight-value" style="font-weight:600">${escapeHtml(rule.title)}</div>
        </div>
        <div class="insight-section">
          <span class="severity-badge ${severityClass(rule.severity)}">${escapeHtml(rule.severity)}</span>
          <span class="stat-pill" style="margin-left:0.5rem">${rule.hits.length} hits</span>
        </div>
        ${insightRow("How it works", rule.description)}
        ${topHit ? `
          <div class="insight-section">
            <div class="insight-label">Top hit</div>
            <div class="insight-value" style="font-weight:600">${escapeHtml(topHit.label)}</div>
            <div class="score-bar-wrap">
              <div class="score-bar-track"><div class="score-bar-fill" style="width:${Math.round((topHit.score / maxScore) * 100)}%"></div></div>
              <span class="score-label">score ${topHit.score}</span>
            </div>
            <div class="microcopy" style="margin-top:0.4rem">${escapeHtml(topHit.detail)}</div>
          </div>
        ` : ""}
        <div class="teaching-tip"><strong>Teaching tip</strong>Ask students why these results surface before any manual investigation.</div>
      `;
  }

  if (tool === "copilot") {
    const result = copilotState.result;
    if (!result) return `<p class="microcopy">Ask the agent a question to see its evidence here.</p>`;
    const focusEntity = result.focusEntities?.[0];
    return `
        ${focusEntity ? `
          <div class="insight-section">
            <div class="insight-label">Primary focus</div>
            <div class="insight-value" style="font-weight:600">${escapeHtml(focusEntity.label)}</div>
            <div class="microcopy">${escapeHtml(focusEntity.type)}</div>
          </div>
          <div class="insight-section">
            <div class="insight-label">Why this object</div>
            <div class="microcopy">${escapeHtml(focusEntity.reason)}</div>
          </div>
        ` : ""}
        ${result.evidence?.length ? `<div class="insight-section"><div class="insight-label">Linked evidence</div>${insightEvidenceList(result.evidence.slice(0, 5))}</div>` : ""}
        <div class="teaching-tip"><strong>Teaching tip</strong>This answer is assembled from graph links, not generated text. Ask students how it would change if a source link was missing.</div>
      `;
  }

  if (tool === "map") {
    const mapData = buildMapData();
    const place = mapData.selectedPlace;
    if (!place) return `<p class="microcopy">Select a map marker to inspect it.</p>`;
    return `
        ${insightRow("Place", place.label)}
        ${insightRow("Type", place.context || place.type)}
        ${insightRow("Summary", place.detail)}
        ${place.people?.length ? insightRow("Linked people", place.people.slice(0, 4).map((p) => p.label).join(", ")) : ""}
        ${place.companies?.length ? insightRow("Companies here", place.companies.slice(0, 3).map((c) => c.label).join(", ")) : ""}
        ${place.travelers?.length ? insightRow("Travelers", place.travelers.slice(0, 4).map((p) => p.label).join(", ")) : ""}
        <div class="teaching-tip"><strong>Teaching tip</strong>A shared address or airport becomes important because the ontology has already linked companies, devices, and people to it.</div>
      `;
  }

  if (tool === "entity-types" || tool === "properties") {
    const et = entityTypeById(ui.selectedEntityTypeId);
    if (!et) return `<p class="microcopy">No object type selected.</p>`;
    return `
        <div class="insight-section">
          <div class="insight-label">Object type</div>
          <div class="insight-value" style="display:flex;align-items:center;gap:0.5rem;font-weight:600">
            <span class="entity-dot" style="background:${escapeHtml(et.color)}"></span>${escapeHtml(et.name)}
          </div>
        </div>
        ${insightRow("Description", et.description)}
        ${insightRow("Instances", String(entityCount(et.id)))}
        <div class="insight-section">
          <div class="insight-label">Properties (${et.properties?.length || 0})</div>
          <div class="insight-evidence-list">${(et.properties || []).map((p) => `<div class="insight-evidence-item">${escapeHtml(p.label)} <span class="muted">(${escapeHtml(p.type)})</span></div>`).join("")}</div>
        </div>
        <div class="teaching-tip"><strong>Teaching tip</strong>Each object type becomes a durable kind of object in the graph. Properties are the fields that can be searched, filtered, and linked.</div>
      `;
  }

  if (tool === "relationships") {
    const rel = relationshipById(ui.selectedRelationshipId);
    if (!rel) return `<p class="microcopy">No link type selected.</p>`;
    const edgeCount = (data.edges || []).filter((e) => e.type === rel.id).length;
    return `
        <div class="insight-section">
          <div class="insight-label">Link type</div>
          <div class="insight-value" style="display:flex;align-items:center;gap:0.5rem;font-weight:600">
            <span class="swatch" style="background:${escapeHtml(rel.color)}"></span>${escapeHtml(rel.label)}
          </div>
        </div>
        ${insightRow("Direction", `${rel.sourceType} → ${rel.targetType}`)}
        ${insightRow("Link count", String(edgeCount))}
        ${insightRow("Description", rel.description)}
        <div class="teaching-tip"><strong>Teaching tip</strong>Ask: is this link directly observed from a source, or inferred from co-occurrence?</div>
      `;
  }

  if (tool === "mappings") {
    const mapping = mappingById(ui.selectedMappingId);
    if (!mapping) return `<p class="microcopy">No backing dataset selected.</p>`;
    return `
        ${insightRow("Source", mapping.sourceId)}
        ${insightRow("Fields", mapping.sourceFields)}
        ${insightRow("Target type", mapping.targetType)}
        ${insightRow("Rule", mapping.rule)}
        <div class="teaching-tip"><strong>Teaching tip</strong>Backing datasets are where raw columns become durable ontology objects. Every field declared here is reusable across all analyst workflows.</div>
      `;
  }

  // instances / graph fallback
  const entity = entityById(ui.selectedEntityId || ui.selectedGraphNodeId);
  if (!entity) return `<p class="microcopy">Select an entity to inspect it.</p>`;
  const et2 = entityTypeById(entity.type);
  const summary = summarizeEntityForCopilot(entity);
  return `
      <div class="insight-section">
        <div class="insight-label">Entity</div>
        <div class="insight-value" style="display:flex;align-items:center;gap:0.5rem;font-weight:600">
          <span class="entity-dot" style="background:${escapeHtml(et2?.color || "#94a3b8")}"></span>${escapeHtml(entity.label)}
        </div>
        <div class="microcopy">${escapeHtml(entity.type)}</div>
      </div>
      ${renderMarkingsSection(entity)}
      ${renderResolutionSection(entity, "inspector")}
      ${summary.headline ? `<div class="insight-section"><div class="insight-label">Summary</div><div class="microcopy">${escapeHtml(summary.headline)}</div></div>` : ""}
      ${summary.evidence?.length ? `<div class="insight-section"><div class="insight-label">Evidence</div>${insightEvidenceList(summary.evidence.slice(0, 5))}</div>` : ""}
      ${renderTelecomExpansion(entity)}
    `;
}

// Markings on an object, its withheld properties, hidden neighbours, and "Why can't I see this?".
export function renderMarkingsSection(entity) {
  if (!roleView.active || !entity) return "";
  const withheldProps = Object.entries(entity.properties || {}).filter(([, value]) => isWithheldValue(value));
  const around = withheldAround([entity.id]);
  const propMarkings = [...new Set(withheldProps.flatMap(([, value]) => value.withheld))];
  const markings = [...new Set([...propMarkings, ...around.markings])].sort();
  const removed = (entity.markings || []).filter((marking) => roleView.removed.has(marking));
  const typeProperties = entityTypeById(entity.type)?.properties || [];
  const labelFor = (id) => typeProperties.find((property) => property.id === id)?.label || id;
  return `
      <div class="insight-section">
        <div class="insight-label">Markings</div>
        <div class="chip-row">${(entity.markings || []).length ? entity.markings.map(core.ui.markingChip).join("") : core.ui.markingChip("OPEN")}</div>
        ${removed.length ? `<div class="microcopy">Removed at the ontology by a DPO override: ${escapeHtml(removed.join(", "))}.</div>` : ""}
      </div>
      ${withheldProps.length ? `
        <div class="insight-section">
          <div class="insight-label">Withheld properties</div>
          <div class="withheld-props">
            ${withheldProps.map(([id, value]) => `<div class="withheld-prop"><span>${escapeHtml(labelFor(id))}</span>${core.ui.withheldCell(value.withheld)}</div>`).join("")}
          </div>
        </div>` : ""}
      ${around.links || around.objects ? `<div class="insight-section"><div class="insight-label">Withheld links</div>${withheldNoteHtml(around, "")}</div>` : ""}
      ${withheldProps.length && !propMarkings.every((marking) => around.markings.includes(marking))
      ? `<div class="insight-section why-section">${core.ui.whyLine(markings, roleView.roleId)}</div>`
      : ""}
    `;
}

// Shown where a role sees little: totals of what is withheld, by type.
export function renderRoleWithheldSummary() {
  if (!roleView.active || !roleView.withheldEntities.length) return "";
  const rows = [...roleView.withheldByType.entries()].map(([type, list]) => {
    const markings = [...new Set(list.flatMap((item) => item._withheld))].sort();
    return `<div class="withheld-row">${core.ui.withheldCell(markings)} <span>${escapeHtml(`${list.length} ${type} object${list.length === 1 ? "" : "s"} withheld from your role`)}</span></div>`;
  });
  const all = [...new Set(roleView.withheldEntities.flatMap((item) => item._withheld))].sort();
  return `<div class="withheld-note">${rows.join("")}${core.ui.whyLine(all, roleView.roleId)}</div>`;
}

// ── Entity resolution note (F0.2): shown only when the seed carries entity.resolution ──
export function describeResolution(resolution) {
  const method = RESOLUTION_METHOD_LABELS[resolution.method] || (resolution.method ? `Matched by ${resolution.method}` : "Match method not recorded");
  const confidence = typeof resolution.confidence === "number" && Number.isFinite(resolution.confidence)
    ? ` · confidence ${resolution.confidence.toFixed(2)}`
    : "";
  return `${method}${confidence}`;
}

export function renderResolutionSection(entity, variant = "inspector") {
  const resolution = entity && entity.resolution;
  if (!resolution || typeof resolution !== "object") return "";
  const mergedFrom = Array.isArray(resolution.mergedFrom) ? resolution.mergedFrom.filter(Boolean) : [];
  const heading = variant === "inspector"
    ? `<div class="insight-label">Resolution</div>`
    : `<h3 class="section-title">Resolution</h3>`;
  return `
      <div class="${variant === "inspector" ? "insight-section" : "resolution-block"}">
        ${heading}
        <div class="insight-value">${escapeHtml(describeResolution(resolution))}</div>
        ${mergedFrom.length ? `<div class="microcopy">Merged from ${mergedFrom.length} record${mergedFrom.length === 1 ? "" : "s"}: ${escapeHtml(mergedFrom.join(", "))}</div>` : ""}
        ${resolution.splitRisk ? `
          <div class="resolution-note">
            <span class="resolution-note-label">Resolution note</span>
            ${escapeHtml(resolution.note || "This person was created from a single weak key and may be the same individual as another record.")}
          </div>
        ` : ""}
      </div>
    `;
}
