/*
 * foundry-demo/js/app-markings.js: Build (Foundry-style), Markings tab.
 *
 * One of the classic scripts that make up the Build app (split from the former 3,100-line app.js, review F-24).
 * They are loaded in order by foundry-demo/index.html and share one global script scope: top-level
 * functions, const and let declared in one file are visible in the others. Only app.js runs code at load
 * (init()); the other files only declare, apart from the UI state set up in js/app-state.js.
 */
"use strict";
// ------------------------------------------------------------------ markings tab (F2)
function markingColumns() {
  const cols = [];
  getDatasets().forEach(d => {
    const depth = datasetDepth(d);
    (cols[depth] = cols[depth] || []).push(d);
  });
  return cols.filter(Boolean);
}

function columnLabel(items, index) {
  if (index === 0) return "Raw sources";
  const producers = Array.from(new Set(items.map(d => d.producedBy).filter(Boolean)));
  return producers.length ? producers.join(", ") : `Stage ${index}`;
}

function renderMarkingsMain() {
  const ids = knownMarkingIds();
  const filter = ui.markingFilter && ids.includes(ui.markingFilter) ? ui.markingFilter : "";
  const cols = markingColumns();
  const hit = filter ? getDatasets().filter(d => effectiveIds(d).includes(filter)) : [];
  const own = filter ? hit.filter(d => !(effectiveMarkings(d).find(m => m.id === filter) || {}).inheritedFrom) : [];

  const box = (d) => {
    const marks = effectiveMarkings(d);
    const has = filter && marks.some(m => m.id === filter);
    const conflicts = karlsruheOn() ? purposeConflictsForDataset(d) : [];
    const cls = ["mk-box", d.id === ui.selectedDatasetId ? "selected" : "", filter ? (has ? "hit" : "dim") : ""].filter(Boolean).join(" ");
    return `
      <button class="${cls}" data-action="mk-select" data-id="${esc(d.id)}" data-mk-node="${esc(d.id)}"
              ${has ? `style="--mk-c:${markingColour(filter)}"` : ""}
              aria-label="${esc(`${dsName(d)}: markings ${marks.map(m => m.id).join(", ") || "none"}${d.purpose ? `; purpose ${d.purpose}` : ""}${conflicts.length ? `; breaks rule ${conflicts.map(c => c.rule.id).join(", ")}` : ""}`)}">
        <span class="mk-stripe" aria-hidden="true">${marks.map(m => `<span class="${m.inheritedFrom ? "inherited" : ""}" style="--mk-c:${markingColour(m.id)}"></span>`).join("")}</span>
        <span class="mk-head"><span class="box-name">${esc(dsName(d))}</span>${conflicts.length ? ruleBadge(conflicts) : ""}<span class="box-count">${(d.rowCount || 0).toLocaleString()}</span></span>
        <span class="mk-badges">${marks.length ? marks.map(m => markingBadge(m, { small: true })).join("") : `<span class="text-muted">no markings</span>`}</span>
        ${d.purpose ? `<span class="mk-purpose" title="${esc(d.legalBasis ? `Legal basis: ${d.legalBasis}` : "")}">purpose: ${esc(purposeLabel(d.purpose))}</span>` : ""}
      </button>`;
  };

  return `
    <div class="section-header">
      <div class="section-title">Markings through lineage</div>
      <div class="section-sub">${getDatasets().length} datasets</div>
      ${honestyChip("build.markings")}
    </div>
    <div class="mk-toolbar" role="group" aria-label="Highlight a marking">
      <span class="text-muted">Highlight:</span>
      <button class="mk-filter ${filter ? "" : "active"}" data-action="mk-filter" data-marking="" aria-pressed="${!filter}">All</button>
      ${ids.map(id => `<button class="mk-filter ${filter === id ? "active" : ""}" data-action="mk-filter" data-marking="${esc(id)}" aria-pressed="${filter === id}" style="--mk-c:${markingColour(id)}"><span class="mk-swatch" aria-hidden="true"></span>${esc(id)}</button>`).join("")}
    </div>
    ${purposePanel()}
    ${filter ? `<div class="mk-summary" aria-live="polite"><strong>${esc(filter)}</strong> is carried by ${hit.length} dataset${hit.length === 1 ? "" : "s"}: ${own.length} at source, ${hit.length - own.length} inherited downstream.</div>` : ""}
    ${scrollWrap(`<div class="mk-dag" id="mk-dag" data-scroller>
      <svg class="mk-edges" id="mk-edges" aria-hidden="true"></svg>
      ${cols.map((items, i) => `
        <div class="mk-col">
          <div class="dag-column-label" title="${esc(columnLabel(items, i))}">${esc(columnLabel(items, i))}</div>
          ${items.map(box).join("")}
        </div>`).join("")}
    </div>`, "markings")}
    ${renderMarkingLegend(ids)}
    ${discussionCards("build.markings")}
  `;
}

function renderMarkingLegend(ids) {
  return `
    <div class="section-title mt-16 mb-8">Legend</div>
    <div class="mk-legend">
      ${ids.map(id => {
        const def = markingDef(id);
        const who = rolesThatCanSee([id]).map(r => r.label);
        return `<div class="mk-legend-row">
          ${markingBadge({ id })}
          <span class="mk-legend-label">${esc(def.label)}</span>
          <span class="text-muted">${esc(def.description)}${who.length ? ` Visible to: ${esc(who.join(", "))}.` : ""}</span>
        </div>`;
      }).join("")}
      <div class="mk-legend-row">
        ${markingBadge({ id: ids.includes("PII") ? "PII" : (ids[0] || "PII"), inheritedFrom: "upstream" })}
        <span class="mk-legend-label">Inherited (dashed)</span>
        <span class="text-muted">Dashed outline, coloured text on black (and a hatched stripe on the box): the marking came from an upstream dataset (see markingProvenance). A solid badge is carried by the dataset itself.</span>
      </div>
      <div class="mk-legend-row">
        ${markingBadge({ id: ids.includes("HEALTH") ? "HEALTH" : (ids[0] || "PII") }, { removed: true })}
        <span class="mk-legend-label">Removed</span>
        <span class="text-muted">Dotted outline and the word “removed”: the data protection officer lifted this marking (here or upstream). It can be restored from the inspector below.</span>
      </div>
    </div>`;
}

function renderMarkingsInspector(ds) {
  const marks = effectiveMarkings(ds);
  const removed = removedMarkings(ds);
  const canAttempt = Boolean(core("checkpoints", "withCheckpoint") && core("markings", "removeMarking"));
  const canRestore = restoreAvailable();
  const visibleTo = rolesThatCanSee(marks.map(m => m.id)).map(r => r.label);
  return `
  <div class="inspector">
    <div class="inspector-header">
      <div class="inspector-title"><strong>${esc(dsName(ds))}</strong> — markings${ds.purpose ? ` · purpose ${esc(purposeLabel(ds.purpose))}` : ""}</div>
      <button class="link-btn" data-action="goto-dataset" data-id="${esc(ds.id)}">Open in Datasets</button>
    </div>
    <div class="inspector-body">
      <table class="data-table mk-table">
        <thead><tr><th>Marking</th><th>Label</th><th>inheritedFrom</th><th></th></tr></thead>
        <tbody>
          ${marks.map(m => `
            <tr>
              <td>${markingBadge(m)}</td>
              <td>${esc(markingDef(m.id).label)}</td>
              <td>${m.inheritedFrom ? esc(m.sources.length ? m.sources.join(", ") : m.inheritedFrom) : `<span class="text-muted">(this dataset)</span>`}</td>
              <td>${canAttempt ? `<button class="mk-remove" data-action="mk-remove" data-id="${esc(ds.id)}" data-marking="${esc(m.id)}">Remove marking</button>` : ""}</td>
            </tr>`).join("")}
          ${removed.map(r => `
            <tr class="mk-removed-row" data-removed="${esc(r.id)}">
              <td>${markingBadge({ id: r.id }, { removed: true })}</td>
              <td>${esc(markingDef(r.id).label)}</td>
              <td>${r.override ? `removed by ${esc(roleLabel(r.override.by))}${r.upstream ? ` on ${esc(r.override.datasetId)}` : ""}${r.override.ts ? ` · ${esc(formatTs(r.override.ts))}` : ""}` : "removed"}</td>
              <td>${canRestore && r.override ? `<button class="mk-remove mk-restore" data-action="mk-restore" data-id="${esc(r.override.datasetId)}" data-marking="${esc(r.id)}"${r.upstream ? ` title="${esc(`The removal was made on ${r.override.datasetId}; restoring it there restores it here and on every dataset downstream`)}"` : ""}>Restore marking${r.upstream ? ` on ${esc(dsName(getDataset(r.override.datasetId), r.override.datasetId))}` : ""}</button>` : ""}</td>
            </tr>`).join("")}
          ${marks.length + removed.length === 0 ? `<tr><td colspan="4" class="text-muted">No markings</td></tr>` : ""}
        </tbody>
      </table>
      ${ds.purpose || ds.legalBasis ? `<div class="mt-8 mk-basis">${ds.purpose ? `<span class="info-chip purpose-chip">Purpose: <strong>${esc(purposeLabel(ds.purpose))}</strong></span>` : ""} ${ds.legalBasis ? `<span class="info-chip purpose-chip">Legal basis: <strong>${esc(ds.legalBasis)}</strong></span>` : ""}</div>` : ""}
      ${karlsruheOn() ? purposeConflictsForDataset(ds).map(c => `<div class="purpose-conflict inline">${ruleBadge([c])}<div>Joins ${c.dataSide.map(d => `<code>${esc(d.name)}</code> (${esc(d.purposes.map(purposeLabel).join(", "))})`).join(", ")} with ${c.against.map(a => esc(purposeLabel(a.purpose))).join(", ")}. <span class="purpose-rule-text">Rule ${esc(c.rule.id)}: “${esc(c.rule.text || "")}”</span></div></div>`).join("") : ""}
      ${allRoles().length && core("markings", "canSee") ? `<div class="mt-8 text-muted">Rows visible to: <span class="text-accent">${esc(visibleTo.join(", ") || "no role")}</span></div>` : ""}
      ${removed.length && canRestore ? `<div class="mt-8 text-muted mk-restore-note">Restoring puts the marking back on this dataset and everything derived from it, so roles without it lose sight of those rows again. Only the data protection officer may restore, after a Checkpoint; the restore is logged.</div>` : ""}
    </div>
  </div>`;
}

/** Draw dataset → dataset edges behind the Markings DAG (positions known only after layout). */
function drawMarkingEdges() {
  const dag = el("mk-dag");
  const svg = el("mk-edges");
  if (!dag || !svg) return;
  const base = dag.getBoundingClientRect();
  const nodes = {};
  dag.querySelectorAll("[data-mk-node]").forEach(n => { nodes[n.getAttribute("data-mk-node")] = n.getBoundingClientRect(); });
  const filter = ui.markingFilter;
  const sel = ui.selectedDatasetId;
  const paths = [];
  getDatasets().forEach(d => {
    const to = nodes[d.id];
    if (!to) return;
    datasetParents(d).forEach(pid => {
      const from = nodes[pid];
      if (!from) return;
      const x1 = from.right - base.left + dag.scrollLeft, y1 = from.top + from.height / 2 - base.top + dag.scrollTop;
      const x2 = to.left - base.left + dag.scrollLeft, y2 = to.top + to.height / 2 - base.top + dag.scrollTop;
      const mx = (x1 + x2) / 2;
      const carries = filter && effectiveIds(d).includes(filter) && effectiveIds(getDataset(pid)).includes(filter);
      const touchesSel = sel && (sel === d.id || sel === pid);
      const cls = carries ? "hit" : touchesSel ? "sel" : filter ? "dim" : "";
      paths.push(`<path class="${cls}" d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}"${carries ? ` style="stroke:${markingColour(filter)}"` : ""}/>`);
    });
  });
  svg.setAttribute("width", dag.scrollWidth);
  svg.setAttribute("height", dag.scrollHeight);
  svg.innerHTML = paths.join("");
}

async function attemptMarkingRemoval(datasetId, marking) {
  logEvent({ kind: "marking", verb: "marking.remove.request", datasetId, payload: { marking, tab: "markings" } });
  if (!core("checkpoints", "withCheckpoint") || !core("markings", "removeMarking")) return;
  try {
    await window.DC.checkpoints.withCheckpoint(
      "cp-marking-remove",
      { surface: SURFACE, objectIds: [], datasetId, summary: `Remove ${marking} from ${datasetId}` },
      (record) => window.DC.markings.removeMarking({
        datasetId,
        marking,
        checkpointRecordId: record && typeof record === "object" ? (record.recordId || record.id || null) : (record || null),
      })
    );
  } catch (error) {
    console.warn("[build] marking removal did not complete", error);
  }
  countsCache.clear();
  render();
  refreshAuditStrip();
}

/** Restore needs the core function and the seed's cp-marking-restore Checkpoint (FIXROUND §1, §2 A5). */
function restoreAvailable() {
  if (!core("checkpoints", "withCheckpoint") || !core("markings", "restoreMarking")) return false;
  if (!core("governance", "checkpoint")) return false;
  return Boolean(safe("governance.checkpoint", () => window.DC.governance.checkpoint("cp-marking-restore"), null));
}

async function attemptMarkingRestore(datasetId, marking) {
  logEvent({ kind: "marking", verb: "marking.restore.request", datasetId, payload: { marking, tab: "markings" } });
  if (!restoreAvailable()) return;
  try {
    await window.DC.checkpoints.withCheckpoint(
      "cp-marking-restore",
      { surface: SURFACE, objectIds: [], datasetId, summary: `Restore ${marking} on ${datasetId}` },
      (record) => window.DC.markings.restoreMarking({
        datasetId,
        marking,
        checkpointRecordId: record && typeof record === "object" ? (record.recordId || record.id || null) : (record || null),
      })
    );
  } catch (error) {
    console.warn("[build] marking restore did not complete", error);
  }
  countsCache.clear();
  render();
  refreshAuditStrip();
}
