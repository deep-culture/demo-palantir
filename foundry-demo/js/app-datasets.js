/*
 * foundry-demo/js/app-datasets.js: Build (Foundry-style), Datasets tab and the retention clock.
 *
 * One of the classic scripts that make up the Build app (split from the former 3,100-line app.js, review F-24).
 * They are loaded in order by foundry-demo/index.html and share one global script scope: top-level
 * functions, const and let declared in one file are visible in the others. Only app.js runs code at load
 * (init()); the other files only declare, apart from the UI state set up in js/app-state.js.
 */
"use strict";
// ------------------------------------------------------------------ datasets tab
function formatRetention(days) {
  if (typeof days !== "number" || !Number.isFinite(days)) return esc(days);
  const years = days / 365;
  const about = Math.round(years * 10) / 10;
  return `${days.toLocaleString()} days${years >= 1 ? ` (about ${about} year${about === 1 ? "" : "s"})` : ""}`;
}

function formatTs(ts) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(String(ts || ""));
  return m ? `${m[1]} ${m[2]} UTC` : String(ts || "");
}

function renderDatasetGovernance(ds, hiddenMarks, opts) {
  const byColumn = Boolean(opts && opts.columns);
  const hasTags = ds.purpose != null || ds.legalBasis != null || ds.retentionDays != null;
  const marks = effectiveMarkings(ds);
  const removed = removedMarkings(ds);
  if (!hasTags && !Array.isArray(ds.markings)) return "";
  return `
    <div class="section-title mb-8">Governance</div>
    <table class="prop-table gov-table mb-12">
      <tbody>
        ${ds.purpose != null ? `<tr><td>purpose</td><td>${esc(ds.purpose)}</td></tr>` : ""}
        ${ds.legalBasis != null ? `<tr><td>legalBasis</td><td>${esc(ds.legalBasis)}</td></tr>` : ""}
        ${ds.retentionDays != null ? `<tr><td>retentionDays</td><td>${formatRetention(ds.retentionDays)}</td></tr>` : ""}
        ${Array.isArray(ds.markings) ? `<tr><td>markings</td><td>
          ${marks.length ? marks.map(m => `<div class="mk-line">${markingBadge(m)} <span class="text-muted">${m.inheritedFrom ? `inherited from ${esc(m.sources.length ? m.sources.join(", ") : m.inheritedFrom)}` : "carried by this dataset"}</span></div>`).join("") : `<span class="text-muted">none</span>`}
          ${removed.map(r => `<div class="mk-line">${markingBadge({ id: r.id }, { removed: true })} <span class="text-muted">${r.override ? `removed by ${esc(roleLabel(r.override.by))}${r.upstream ? ` on ${esc(r.override.datasetId)}` : ""}${r.override.ts ? `, ${esc(formatTs(r.override.ts))}` : ""}` : "removed"}</span></div>`).join("")}
        </td></tr>` : ""}
        ${currentRoleId() && Array.isArray(ds.markings) ? `<tr><td>your access</td><td>${hiddenMarks.length && byColumn
          ? `<span class="text-amber">columns withheld</span> <span class="text-muted">— your role (${esc(roleLabel(currentRoleId()))}) cannot see ${esc(hiddenMarks.join(", "))}; each lead shows the components you can see, and its score is recomputed without the others</span>`
          : hiddenMarks.length
          ? `<span class="text-amber">rows withheld</span> <span class="text-muted">— your role (${esc(roleLabel(currentRoleId()))}) cannot see ${esc(hiddenMarks.join(", "))}; schema only</span>`
          : `<span class="text-accent">rows visible</span> <span class="text-muted">to your role (${esc(roleLabel(currentRoleId()))})</span>`}</td></tr>` : ""}
      </tbody>
    </table>`;
}

function renderDatasetsMain() {
  const ds = ui.selectedDatasetId ? getDataset(ui.selectedDatasetId) : null;
  const offset = retentionOffsetShown();
  if (!ds) {
    return `
    <div class="section-header"><div class="section-title">Datasets</div>${honestyChip("build.datasets")}</div>
    <p class="text-muted mb-8">Select a dataset from the sidebar, or move the retention clock to see which rows every dataset would have to forget.</p>
    ${renderRetentionClock(offset)}
    <div id="ret-host">${renderRetentionOverview(offset)}</div>`;
  }

  return `
    <div class="section-header">
      <div class="section-title">${esc(dsName(ds))}</div>
      <div class="section-sub">${esc(ds.id)}</div>
      ${honestyChip("build.datasets")}
    </div>
    <div class="info-row">
      <span class="info-chip">Rows: <strong>${(ds.rowCount || 0).toLocaleString()}</strong></span>
      ${ds.purpose ? `<span class="info-chip purpose-chip" title="Purpose the data was collected for">Purpose: <strong>${esc(purposeLabel(ds.purpose))}</strong></span>` : ""}
      ${ds.legalBasis ? `<span class="info-chip purpose-chip" title="Legal basis">Legal basis: <strong>${esc(ds.legalBasis)}</strong></span>` : ""}
      ${ds.sourceFile ? `<span class="info-chip">Source: <span class="text-mono text-muted">${esc(ds.sourceFile)}</span></span>` : ""}
      ${ds.producedBy ? `<span class="info-chip">Produced by: <button class="link-btn" data-action="goto-transform" data-id="${esc(ds.producedBy)}">${esc(ds.producedBy)}</button></span>` : ""}
      ${(ds.consumedBy || []).length ? `<span class="info-chip">Consumed by: ${(ds.consumedBy || []).map(id => `<button class="link-btn" data-action="goto-transform" data-id="${esc(id)}">${esc(id)}</button>`).join(", ")}</span>` : ""}
    </div>
    ${renderRetentionClock(offset)}
    <div id="ret-host">${renderDatasetBody(ds, offset)}</div>
  `;
}

/** Everything under the retention clock (re-rendered alone while the slider is dragged). */
function renderDatasetBody(ds, offset) {
  const report = retentionReport(offset).get(ds.id) || null;
  const offsetRows = ui.datasetRowOffset;
  const rows = (ds.sampleRows || []);
  const pageRows = rows.slice(offsetRows, offsetRows + PAGE_SIZE);
  const totalRows = ds.rowCount || 0;
  const totalSample = rows.length;
  const pageCount = Math.ceil(totalSample / PAGE_SIZE);
  const currentPage = Math.floor(offsetRows / PAGE_SIZE);
  const fields = ds.schema ? ds.schema.map(f => f.field) : (pageRows[0] ? Object.keys(pageRows[0]) : []);
  const highlightIdx = ui.highlightDatasetRow && ui.highlightDatasetRow.datasetId === ds.id
    ? ui.highlightDatasetRow.rowIndex : null;

  // Rows are withheld when the role cannot see every effective marking (schema stays visible).
  const roleId = currentRoleId();
  const marks = effectiveIds(ds);
  const hiddenMarks = roleId ? marks.filter(m => !canSee(roleId, [m])) : [];
  const leads = leadRows(ds);
  const rowsWithheld = hiddenMarks.length > 0 && !leads;
  const showRet = Boolean(report && (report.applicable || report.upstream));
  // Field-level markings (fix round: beneficial_owner / beneficial_owner_dob are PII on the open
  // company register, after WM and Sovim): the column stays, its values are hatched for roles
  // without the marking, and the dataset's fieldNote says why.
  const fieldMarks = ds.fieldMarkings && typeof ds.fieldMarkings === "object" ? ds.fieldMarkings : {};
  const hiddenFields = {};
  Object.entries(fieldMarks).forEach(([f, ms]) => {
    const lacking = roleId ? (Array.isArray(ms) ? ms : []).filter(m => !canSee(roleId, [m])) : [];
    if (lacking.length) hiddenFields[f] = lacking;
  });
  const fieldNote = Object.keys(fieldMarks).length && ds.fieldNote ? `<div class="field-note mb-8"><span class="field-note-tag">field markings</span> ${esc(ds.fieldNote)}${Object.keys(hiddenFields).length ? ` <span class="text-amber">Withheld from your role (${esc(roleLabel(roleId))}): ${Object.keys(hiddenFields).map(f => `<code>${esc(f)}</code>`).join(", ")}.</span>` : ""}</div>` : "";

  return `
    ${renderDatasetGovernance(ds, hiddenMarks, { columns: Boolean(leads) })}
    ${renderRetentionSummary(ds, report, offset)}

    <div class="section-title mb-8">Schema</div>
    <div class="scroll-x mb-12">
      <table class="schema-table">
        <thead><tr><th>Field</th><th>Type</th></tr></thead>
        <tbody>
          ${(ds.schema || []).map(f => `
            <tr>
              <td class="text-mono">${esc(f.field)}${report && report.dateField === f.field ? ` <span class="ret-datecol" title="The retention clock reads this column">retention date</span>` : ""}${Array.isArray(fieldMarks[f.field]) ? ` ${markingBadges(fieldMarks[f.field], { small: true })}${hiddenFields[f.field] ? ` <span class="text-amber">withheld from your role</span>` : ""}` : ""}</td>
              <td><span class="type-pill">${esc(f.type)}</span></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>

    ${fieldNote}
    ${leads ? renderLeadsView(ds, leads, report) : `
    <div class="section-header">
      <div class="section-title">Sample rows</div>
      <div class="section-sub">${rowsWithheld ? `${totalRows.toLocaleString()} rows` : `showing ${totalSample ? offsetRows + 1 : 0}–${Math.min(offsetRows + PAGE_SIZE, totalSample)} of ${totalSample} sampled (${totalRows.toLocaleString()} total)`}</div>
    </div>
    ${rowsWithheld ? `
      <div class="withheld-block">
        <div>${withheldCell(hiddenMarks)}</div>
        ${whyLine(hiddenMarks)}
      </div>` : `
    <div class="scroll-x">
      <table class="data-table">
        <thead><tr>${showRet ? `<th>retention</th>` : ""}${fields.map(f => `<th>${esc(f)}</th>`).join("")}</tr></thead>
        <tbody>
          ${pageRows.map((row, i) => {
            const absIdx = offsetRows + i;
            const isHighlighted = highlightIdx === absIdx;
            const status = report ? report.rowStatus.get(absIdx) || "" : "";
            return `<tr class="${[isHighlighted ? "highlighted" : "", status ? `ret-${status}` : ""].filter(Boolean).join(" ")}" ${status ? `data-retention="${esc(status)}"` : ""}>
              ${showRet ? `<td class="ret-cell">${retentionCell(status, Boolean(ds.producedBy))}</td>` : ""}
              ${fields.map(f => hiddenFields[f] ? `<td data-field-withheld="${esc(f)}">${withheldCell(hiddenFields[f])}</td>` : `<td title="${esc(JSON.stringify(row[f]))}">${esc(renderCellValue(row[f]))}</td>`).join("")}
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>
    <div class="pagination-bar">
      <button data-action="page-prev" ${currentPage === 0 ? "disabled" : ""}>&larr; Prev</button>
      <span>Page ${currentPage + 1} / ${Math.max(1, pageCount)}</span>
      <button data-action="page-next" ${currentPage >= pageCount - 1 ? "disabled" : ""}>Next &rarr;</button>
    </div>`}`}
  `;
}

// ------------------------------------------------------------------ retention clock (F12)
// PHASE3_CONTRACT §4. A date slider from the data's as-of date minus three years to plus one
// year. Raw rows past their dataset's retentionDays turn grey; derived datasets say how many of
// their rows still carry such data, worked out through lineage (js/retention.js). Nothing is ever
// deleted: the pipeline has no deletion step, which is the point.
const Ret = window.BuildRetention || null;
const DAY_MS = 86400000;

function dataAsOfMs() {
  if (!Ret) return null;
  let best = null;
  const consider = (v) => { const ms = Ret.parseDate(v); if (ms != null && (best == null || ms > best)) best = ms; };
  getDatasets().forEach(d => consider(d.asOf));
  if (seedData.leads && typeof seedData.leads === "object") consider(seedData.leads.asOf);
  return best;
}

function retentionBounds() {
  const asOf = dataAsOfMs();
  if (asOf == null) return null;
  const r = Ret.range(asOf);
  return { asOf, min: Math.round((r.min - asOf) / DAY_MS), max: Math.round((r.max - asOf) / DAY_MS) };
}

function retentionOffsetShown() {
  const b = retentionBounds();
  if (!b) return 0;
  const v = Math.round(Number(ui.retPreview != null ? ui.retPreview : ui.retentionOffset) || 0);
  return Math.min(b.max, Math.max(b.min, v));
}

function clockMs(offset) {
  const b = retentionBounds();
  return b ? b.asOf + offset * DAY_MS : null;
}

const retentionCache = new Map();
function retentionReport(offset) {
  if (!Ret || !retentionBounds()) return new Map();
  const key = `${ui.datasetKey}|${offset}`;
  if (retentionCache.has(key)) return retentionCache.get(key);
  const result = safe("retention.compute", () => Ret.compute({
    datasets: getDatasets(), entities: getEntities(), edges: getEdges(), lineage: getLineage(),
    parentsOf: d => datasetParents(d), leadRows: d => leadRows(d),
  }, clockMs(offset)), new Map());
  if (retentionCache.size > 60) retentionCache.clear();
  retentionCache.set(key, result);
  return result;
}

function relativeClock(offset) {
  if (!offset) return "the data's as-of date";
  const n = Math.abs(offset);
  const span = n >= 365 && n % 365 < 2 ? `${Math.round(n / 365)} year${Math.round(n / 365) === 1 ? "" : "s"}` : `${n} day${n === 1 ? "" : "s"}`;
  return `${span} ${offset > 0 ? "after" : "before"} the data's as-of date`;
}

function retentionChip() {
  const chip = honestyChip("build.retention");
  if (chip) return chip;
  // Seed without the honesty entry: the same label, linked to the glossary's built-in copy.
  return `<a class="dc-honesty dc-honesty-simplified" href="../glossary.html#build.retention" target="_blank" rel="noopener" data-honesty="build.retention" title="Each dataset declares a retention period and the clock greys out rows past it. Foundry has retention policies too; ours only shows what would expire, it deletes nothing.">Simplified</a>`;
}

function renderRetentionClock(offset) {
  const b = retentionBounds();
  if (!b) return "";
  const day = Ret.isoDay(clockMs(offset));
  const rel = relativeClock(offset);
  const presets = [[b.min, "3 years before"], [0, "as of"], [183, "+6 months"], [b.max, "+1 year"]];
  return `
    <section class="ret-clock" aria-labelledby="ret-title">
      <div class="ret-head">
        <span class="section-title" id="ret-title">Retention clock</span>
        ${retentionChip()}
        <span class="text-muted ret-asof">data as of ${esc(Ret.isoDay(b.asOf))}</span>
      </div>
      <div class="res-controls ret-controls">
        <label for="ret-slider" class="res-label">Clock date</label>
        <input type="range" id="ret-slider" min="${b.min}" max="${b.max}" step="1" value="${offset}"
               aria-valuetext="${esc(`${day}, ${rel}`)}" aria-describedby="ret-help">
        <output id="ret-value" for="ret-slider" class="res-value ret-value">${esc(day)}</output>
        <span class="res-presets" role="group" aria-label="Clock presets">
          ${presets.map(([v, label]) => `<button class="mk-filter ${v === offset ? "active" : ""}" data-action="ret-preset" data-value="${v}" aria-pressed="${v === offset}">${esc(label)}</button>`).join("")}
        </span>
      </div>
      <div id="ret-help" class="text-muted ret-help"><span id="ret-rel">${esc(rel[0].toUpperCase() + rel.slice(1))}</span>. A row older than its dataset's <code>retentionDays</code> turns grey. Nothing is deleted: this pipeline has no deletion step, so every copy downstream keeps it.</div>
      <p class="ret-discussion"><span class="ret-discussion-kicker">Discussion</span> Deletion that never reaches copies: when a raw row reaches its retention date, who deletes the normalised copy, the resolved person, the ontology object, the lead and the export someone took last month? ICE said the Medicaid data that reached Palantir was “deleted”. What would that word have had to cover?</p>
      ${discussionCards("build.retention")}
    </section>`;
}

function retentionCell(status, derived) {
  if (status === "expired") return `<span class="ret-tag ret-tag-expired">${derived ? "copy past retention" : "past retention"}</span>`;
  if (status === "carries") return `<span class="ret-tag ret-tag-carries">carries expired data</span>`;
  if (status === "future") return `<span class="ret-tag ret-tag-future">not yet collected</span>`;
  return `<span class="text-muted">kept</span>`;
}

const UNIT_HINTS = {
  rows: "",
  objects: " (one row per object; an object carries expired data when a source row it was built from is past retention)",
  links: " (one row per link; a link is dated by its own first-seen, as-of or last-transaction date)",
  leads: " (a lead carries expired data when one of its address components is past its source's retention)",
};

function sourceList(bySource) {
  return Object.entries(bySource || {}).map(([id, n]) => {
    const d = getDataset(id);
    return `<button class="link-btn" data-action="goto-dataset" data-id="${esc(id)}">${esc(dsName(d, id))}</button> (${n})`;
  }).join(", ");
}

/** Raw ancestors of ds that have no date column: nothing from them ever expires downstream. */
function undatedAncestors(ds, reports) {
  return Array.from(datasetAncestors(ds)).map(getDataset).filter(d => d && !d.producedBy && reports.get(d.id) && !reports.get(d.id).applicable);
}

function renderRetentionSummary(ds, report, offset) {
  if (!report || !retentionBounds()) return "";
  const reports = retentionReport(offset);
  const day = Ret.isoDay(clockMs(offset));
  const lines = [];
  if (!ds.producedBy) {
    if (!report.applicable) {
      lines.push(`<div class="ret-line ret-na"><strong>${esc(report.reason ? report.reason[0].toUpperCase() + report.reason.slice(1) : "Retention cannot be applied")}.</strong>
        ${report.retentionDays != null ? `The manifest says ${esc(formatRetention(report.retentionDays))}, but there is no date to count from, so no row in this dataset ever expires: an entry stays until someone removes it by hand.` : ""}</div>`);
    } else {
      const sampled = report.own.sampleSize < report.own.rowCount;
      lines.push(`<div class="ret-line"><strong data-ret-count="${report.own.expired}">${report.own.expired}</strong> of ${report.own.known} sample rows are past the retention period of ${esc(formatRetention(report.retentionDays))} on ${esc(day)}, counted from <code>${esc(report.dateField)}</code>.${sampled ? ` <span class="text-muted">The seed ships ${report.own.sampleSize} of ${report.own.rowCount.toLocaleString()} rows; the count covers the sample.</span>` : ""}</div>`);
      if (report.own.future) lines.push(`<div class="ret-line text-muted">${report.own.future} sample row${report.own.future === 1 ? " was" : "s were"} not yet collected on ${esc(day)}.</div>`);
      if (report.own.expired) {
        const downstream = getDatasets().filter(d => d.producedBy && reports.get(d.id) && reports.get(d.id).upstream && (reports.get(d.id).upstream.bySource || {})[ds.id]);
        lines.push(downstream.length
          ? `<div class="ret-line ret-carry-line">Still present downstream: ${downstream.map(d => `<button class="link-btn" data-action="goto-dataset" data-id="${esc(d.id)}">${esc(dsName(d))}</button> (${reports.get(d.id).upstream.bySource[ds.id]} ${esc(reports.get(d.id).upstream.unit)})`).join(", ")}.</div>`
          : `<div class="ret-line text-muted">No derived dataset records lineage back to these rows.</div>`);
      }
    }
  } else {
    const up = report.upstream;
    if (up && !up.ancestorsOnly) {
      lines.push(`<div class="ret-line ret-carry-line" role="status"><strong data-ret-upstream="${up.count}">${up.count}</strong> ${up.unit === "leads" ? "leads" : "rows"} still carry data past retention upstream on ${esc(day)}${esc(UNIT_HINTS[up.unit] || "")}.
        ${up.count ? `From ${sourceList(up.bySource)}.` : ""}
        ${up.partial ? `<span class="text-muted">At least: counted from the rows whose dates this seed ships (about 20 sample rows per dataset, and dated links).</span>` : ""}</div>`);
    } else if (up) {
      lines.push(`<div class="ret-line ret-carry-line" role="status">This dataset records no row lineage. Its raw ancestors hold <strong data-ret-upstream="${up.count}">${up.count}</strong> sample rows past retention on ${esc(day)}${up.count ? `: ${sourceList(up.bySource)}` : ""}.</div>`);
    }
    if (report.applicable && report.own.expired) {
      lines.push(`<div class="ret-line">${report.own.expired} of its own sample rows are past this dataset's retention of ${esc(formatRetention(report.retentionDays))} (column <code>${esc(report.dateField)}</code>): a copy is not deleted when its source is.</div>`);
    }
    const undated = undatedAncestors(ds, reports);
    if (undated.length) lines.push(`<div class="ret-line text-muted">${undated.map(d => `<code>${esc(dsName(d))}</code>`).join(", ")} ${undated.length === 1 ? "has" : "have"} no date column, so nothing from ${undated.length === 1 ? "it" : "them"} ever expires here.</div>`);
  }
  if (!lines.length) return "";
  return `<div class="ret-summary mb-12" aria-live="polite">${lines.join("")}</div>`;
}

function renderRetentionOverview(offset) {
  if (!retentionBounds()) return "";
  const reports = retentionReport(offset);
  const day = Ret.isoDay(clockMs(offset));
  let rawExpired = 0, carried = 0;
  reports.forEach(r => {
    const d = getDataset(r.id);
    if (d && !d.producedBy) rawExpired += r.own.expired;
    else if (r.upstream && !r.upstream.ancestorsOnly) carried += r.upstream.count;
  });
  const rows = datasetGroups().flatMap(([, items]) => items);
  return `
    <div class="ret-summary mb-12" role="status"><strong data-ret-total="${rawExpired}">${rawExpired}</strong> raw sample rows are past retention on ${esc(day)}; derived datasets hold <strong data-ret-carried="${carried}">${carried}</strong> rows that still carry them.</div>
    <div class="scroll-x">
      <table class="data-table ret-table">
        <thead><tr><th>Dataset</th><th>Date column</th><th>Retention</th><th>Own rows past retention</th><th>Still carried from upstream</th></tr></thead>
        <tbody>
          ${rows.map(d => {
            const r = reports.get(d.id);
            if (!r) return "";
            const own = r.applicable ? `${r.own.expired} / ${r.own.known}${r.own.future ? ` <span class="text-muted">(${r.own.future} not yet collected)</span>` : ""}` : (!d.producedBy ? `<span class="ret-tag ret-tag-na">${esc(r.reason || "n/a")}</span>` : `<span class="text-muted">—</span>`);
            const up = r.upstream ? (r.upstream.ancestorsOnly ? `<span class="text-muted">no row lineage</span>` : `${r.upstream.count} ${esc(r.upstream.unit)}`) : `<span class="text-muted">— (raw)</span>`;
            const cls = r.own.expired ? "ret-expired" : (r.upstream && r.upstream.count && !r.upstream.ancestorsOnly ? "ret-carries" : "");
            return `<tr class="clickable ${cls}" data-action="select-dataset" data-id="${esc(d.id)}" tabindex="0" role="button">
              <td>${esc(dsName(d))}</td>
              <td>${r.dateField ? `<code>${esc(r.dateField)}</code>` : `<span class="text-muted">none</span>`}</td>
              <td>${r.retentionDays != null ? esc(formatRetention(r.retentionDays)) : "—"}</td>
              <td>${own}</td>
              <td>${up}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>`;
}

/** Re-render only what sits under the slider, so the slider survives the drag. */
function previewRetention(offset) {
  ui.retPreview = offset;
  const shown = retentionOffsetShown();
  const day = Ret.isoDay(clockMs(shown));
  const rel = relativeClock(shown);
  const out = el("ret-value");
  if (out) out.textContent = day;
  const relEl = el("ret-rel");
  if (relEl) relEl.textContent = rel[0].toUpperCase() + rel.slice(1);
  const slider = el("ret-slider");
  if (slider) slider.setAttribute("aria-valuetext", `${day}, ${rel}`);
  const host = el("ret-host");
  if (!host) return;
  const ds = ui.selectedDatasetId ? getDataset(ui.selectedDatasetId) : null;
  host.innerHTML = ds ? renderDatasetBody(ds, shown) : renderRetentionOverview(shown);
}

let retentionLogTimer = null;
/** One audit event per release of the slider (keyboard steps within 600 ms count as one). */
function commitRetention(offset, via) {
  ui.retPreview = null;
  ui.retentionOffset = Math.round(Number(offset) || 0);
  const shown = retentionOffsetShown();
  ui.retentionOffset = shown;
  saveUiState();
  render();
  clearTimeout(retentionLogTimer);
  retentionLogTimer = setTimeout(() => {
    const reports = retentionReport(shown);
    let rawExpired = 0, carried = 0;
    reports.forEach(r => {
      const d = getDataset(r.id);
      if (d && !d.producedBy) rawExpired += r.own.expired;
      else if (r.upstream && !r.upstream.ancestorsOnly) carried += r.upstream.count;
    });
    const b = retentionBounds();
    logEvent({
      kind: "view", verb: "retention.clock", datasetId: ui.selectedDatasetId || undefined,
      payload: { tab: "datasets", via: via || "slider", asOf: b ? Ret.isoDay(b.asOf) : null, clock: Ret.isoDay(clockMs(shown)), offsetDays: shown, pastRetention: rawExpired, carriedDownstream: carried },
    });
  }, 600);
}
