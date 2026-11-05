/*
 * foundry-demo/js/app-pipelines.js: Build (Foundry-style), Pipelines tab and the inspector panel.
 *
 * One of the classic scripts that make up the Build app (split from the former 3,100-line app.js, review F-24).
 * They are loaded in order by foundry-demo/index.html and share one global script scope: top-level
 * functions, const and let declared in one file are visible in the others. Only app.js runs code at load
 * (init()); the other files only declare, apart from the UI state set up in js/app-state.js.
 */
"use strict";
// ------------------------------------------------------------------ pipelines tab
function renderPipelinesMain() {
  const transforms = getTransforms();

  // Raw sources: inputs that no transform produces.
  const produced = new Set();
  transforms.forEach(t => transformOutputs(t).forEach(d => produced.add(d.id)));
  const rawInputIds = new Set();
  transforms.forEach(t => (t.inputs || []).forEach(id => rawInputIds.add(id)));
  const rawSources = Array.from(rawInputIds).filter(id => !produced.has(id) && !getDatasets().some(d => d.id === id && d.producedBy));

  return `
    <div class="section-header">
      <div class="section-title">Pipeline DAG</div>
      <div class="section-sub">${transforms.length} transforms</div>
      ${honestyChip("build.pipelines")}
    </div>
    ${purposePanel()}
    ${renderDag(transforms, rawSources)}
    <div class="mt-12 text-muted text-mono" style="font-size:11px;">
      Click a transform to inspect it in the panel below.
    </div>
    ${discussionCards("build.pipelines")}
  `;
}

function renderDag(transforms, rawSources) {
  // Left column: raw sources; then for each transform: arrow → transform box → arrow → output box(es).
  const rawCols = rawSources.length > 0 ? `
    <div class="dag-column">
      <div class="dag-column-label">Raw Sources</div>
      ${rawSources.map(id => {
        const ds = getDataset(id) || {};
        return `
        <div class="dag-box" data-action="select-dataset" data-id="${esc(id)}" title="${esc(id)}" tabindex="0" role="button">
          <div class="box-type">source</div>
          <div class="box-name">${esc(dsName(ds, id))}</div>
          <div class="box-count">${(ds.rowCount || 0).toLocaleString()} rows</div>
        </div>`;
      }).join("")}
    </div>
  ` : "";

  const transformCols = transforms.map((t, i) => {
    const outputs = transformOutputs(t);
    const isSelected = t.id === ui.selectedTransformId;
    const conflicts = karlsruheOn() ? purposeConflictsForTransform(t) : [];
    const outBoxes = outputs.length ? outputs.map(outDs => `
        <div class="dag-box" data-action="select-dataset" data-id="${esc(outDs.id)}"
             title="${esc(outDs.id + (outDs.purpose ? ` · purpose ${outDs.purpose}` : ""))}" tabindex="0" role="button">
          <div class="box-type">dataset</div>
          <div class="box-name">${esc(dsName(outDs))}</div>
          <div class="box-count">${(outDs.rowCount || 0).toLocaleString()} rows</div>
        </div>`).join("") : `
        <div class="dag-box" title="${esc(t.output || "")}">
          <div class="box-type">dataset</div>
          <div class="box-name">${esc(t.output || "")}</div>
          <div class="box-count">—</div>
        </div>`;
    return `
      <div class="dag-arrow-col" title=""><div class="dag-arrow">→</div></div>
      <div class="dag-column">
        ${i === 0 ? `<div class="dag-column-label">Transform</div>` : `<div class="dag-column-label">&nbsp;</div>`}
        <div class="dag-box transform ${isSelected ? "selected" : ""} ${conflicts.length ? "rule-hit" : ""}"
             data-action="select-transform" data-id="${esc(t.id)}" tabindex="0" role="button"
             ${conflicts.length ? `aria-label="${esc(`${t.name}: blocked by rule ${conflicts.map(c => c.rule.id).join(", ")} in Karlsruhe mode`)}"` : ""}>
          <div class="box-type">transform ${conflicts.length ? ruleBadge(conflicts) : ""}</div>
          <div class="box-name">${esc(t.name)}</div>
          <div class="box-count">${(t.rowsOut || 0).toLocaleString()} out</div>
        </div>
      </div>
      <div class="dag-arrow-col"><div class="dag-arrow">→</div></div>
      <div class="dag-column">
        ${i === 0 ? `<div class="dag-column-label">Output</div>` : `<div class="dag-column-label">&nbsp;</div>`}
        ${outBoxes}
      </div>
    `;
  }).join("");

  return scrollWrap(`<div class="dag-canvas scroll-x" data-scroller>${rawCols}${transformCols}</div>`, "pipeline");
}

/**
 * A horizontally scrolling region with a visible cue while columns are hidden to the right
 * (or left). The cue is text, not only a fade, and disappears at the end (FIXROUND §3).
 */
function scrollWrap(inner, name) {
  return `<div class="scroll-wrap" data-scroll-cue="${esc(name)}">
    ${inner}
    <div class="scroll-cue scroll-cue-right" data-cue="right"><span>More to the right →</span> <span class="scroll-cue-sub">scroll sideways or use the bar below</span></div>
    <div class="scroll-cue scroll-cue-left" data-cue="left"><span>← more to the left</span></div>
  </div>`;
}

function updateScrollCues() {
  document.querySelectorAll("[data-scroll-cue]").forEach(wrap => {
    const sc = wrap.querySelector("[data-scroller]");
    if (!sc) return;
    const update = () => {
      const max = sc.scrollWidth - sc.clientWidth;
      wrap.classList.toggle("more-right", max > 4 && sc.scrollLeft < max - 4);
      wrap.classList.toggle("more-left", max > 4 && sc.scrollLeft > 4);
    };
    if (!sc.dataset.cueBound) {
      sc.dataset.cueBound = "1";
      sc.addEventListener("scroll", update, { passive: true });
    }
    update();
  });
}

// ------------------------------------------------------------------ inspector panel
function renderInspector() {
  if (ui.activeTab === "pipelines" && ui.selectedTransformId) {
    return renderTransformInspector();
  }
  if (ui.activeTab === "markings" && ui.selectedDatasetId && getDataset(ui.selectedDatasetId)) {
    return renderMarkingsInspector(getDataset(ui.selectedDatasetId));
  }
  // The Datasets and Lineage tabs never fill the inspector: give the space to the main pane.
  if (ui.activeTab !== "pipelines" && ui.activeTab !== "markings") return "";
  const hint = ui.activeTab === "markings" ? "Inspector — select a dataset to see its markings" : "Inspector — select a transform";
  return `
  <div class="inspector">
    <div class="inspector-header">
      <div class="inspector-title">${esc(hint)}</div>
    </div>
  </div>`;
}

function renderTransformInspector() {
  const t = getTransform(ui.selectedTransformId);
  if (!t) return `<div class="inspector"><div class="inspector-header"><div class="inspector-title">Not found</div></div></div>`;

  const code = t.code || "";
  const lines = code.split("\n").slice(0, 50);  // first 50 lines in inspector
  const lineHtml = lines.map((line, i) =>
    `<span class="ln">${i + 1}</span>${esc(line)}`
  ).join("\n");

  const inputLinks = (t.inputs || []).map(id => {
    const ds = getDataset(id) || {};
    return `<button class="link-btn" data-action="goto-dataset" data-id="${esc(id)}">${esc(dsName(ds, id))}</button>`;
  }).join(", ");

  const outputs = transformOutputs(t);
  const outLink = outputs.length
    ? outputs.map(d => `<button class="link-btn" data-action="goto-dataset" data-id="${esc(d.id)}">${esc(dsName(d))}</button>`).join(", ")
    : esc(t.output || "—");

  return `
  <div class="inspector">
    <div class="inspector-header">
      <div class="inspector-title"><strong>${esc(t.name)}</strong> — ${esc(t.description)}</div>
    </div>
    <div class="inspector-body">
      <div class="info-row">
        <span class="info-chip">Inputs: ${inputLinks}</span>
        <span class="info-chip">Output: ${outLink}</span>
        <span class="info-chip">Rows out: <strong>${(t.rowsOut || 0).toLocaleString()}</strong></span>
        <span class="info-chip">Built: <strong>${esc(t.builtAt || "—")}</strong></span>
        <span class="info-chip">Code: <span class="text-accent">${esc(t.codePath || "")}</span></span>
      </div>
      ${karlsruheOn() ? purposeConflictsForTransform(t).map(c => `<div class="purpose-conflict inline">${ruleBadge([c])}<div><strong>Karlsruhe mode:</strong> writes <code>${esc(dsName(c.dataset))}</code> by joining ${c.dataSide.map(d => `<code>${esc(d.name)}</code> (${esc(d.purposes.map(purposeLabel).join(", "))})`).join(", ")} with ${c.against.map(a => esc(purposeLabel(a.purpose))).join(", ")}. <span class="purpose-rule-text">Rule ${esc(c.rule.id)}: “${esc(c.rule.text || "")}”</span></div></div>`).join("") : ""}
      <div class="code-block">
        <pre>${lineHtml}</pre>
      </div>
    </div>
  </div>`;
}
