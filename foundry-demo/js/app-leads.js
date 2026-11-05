/*
 * foundry-demo/js/app-leads.js: Build (Foundry-style), Leads in Build (rendering; scores come from js/leads.js).
 *
 * One of the classic scripts that make up the Build app (split from the former 3,100-line app.js, review F-24).
 * They are loaded in order by foundry-demo/index.html and share one global script scope: top-level
 * functions, const and let declared in one file are visible in the others. Only app.js runs code at load
 * (init()); the other files only declare, apart from the UI state set up in js/app-state.js.
 */
"use strict";
// ------------------------------------------------------------------ leads (F8 in Build)
// PHASE3_CONTRACT §1 and §4. The leads dataset is produced by "06 Build Leads". Its rows mix
// sources with different markings, so Build shows each lead with the components the role can see
// (as Investigate's Leads tab does) and recomputes the score without the withheld ones.
const LeadsLib = window.BuildLeads || null;

function isLeadsDataset(ds) {
  if (!ds || !LeadsLib) return false;
  if (ds.id === "leads" || /(^|_)leads$/.test(ds.id) || /(^|_)leads?($|_)/.test(ds.producedBy || "")) return true;
  return LeadsLib.isLead((ds.sampleRows || [])[0]);
}

/** Lead rows of a leads dataset (a full `seedData.leads.items` if the seed has one, else the sample), or null. */
function leadRows(ds) {
  if (!isLeadsDataset(ds)) return null;
  const block = seedData.leads;
  if (ds.id === "leads" && block && Array.isArray(block.items) && block.items.length) return block.items;
  return (ds.sampleRows || []).filter(r => r && r.personId);
}

function leadsDataset() { return getDatasets().find(isLeadsDataset) || null; }

function allLeads() {
  const ds = leadsDataset();
  return ds ? leadRows(ds) || [] : [];
}

function leadById(id) { return allLeads().find(l => l && l.id === id) || null; }

/** Purpose rule that blocks showing data with these markings (Karlsruhe mode on, R2-style rules only). */
function purposeBlock(markings) {
  if (!karlsruheOn() || !core("purposes", "check")) return null;
  const dataPurposes = purposesForMarkings(markings || []);
  if (!dataPurposes.length) return null;
  const r = safe("purposes.check", () => window.DC.purposes.check("view", { dataPurposes }), null);
  return r && r.allowed === false && r.effect === "block" && r.rule && r.rule.incompatible ? r.rule : null;
}

function componentAccess(c) {
  const roleId = currentRoleId();
  // Fix round: clinic components carry markings ["PII", "HEALTH"]; older seeds only `marking`.
  // F-02: markings the DPO removed at the ontology no longer protect a component, exactly as
  // DC.leads.split and DC.markings.redactEntity treat them, so Build and Investigate agree.
  const removed = removedAtOntology();
  const marks = componentMarkings(c).filter(m => !removed.has(m));
  if (roleId && marks.length && !canSee(roleId, marks)) return { visible: false, reason: "marking", markings: marks.filter(m => !canSee(roleId, [m])) };
  const rule = purposeBlock(marks);
  if (rule) return { visible: false, reason: "rule", markings: marks, rule };
  return { visible: true, markings: marks };
}

function componentMarkings(c) {
  if (!c) return [];
  const list = Array.isArray(c.markings) && c.markings.length ? c.markings.slice() : [];
  if (c.marking && !list.includes(c.marking)) list.push(c.marking);
  return list.filter(Boolean);
}

function leadView(lead) {
  const comps = LeadsLib.components(lead);
  const states = comps.map(c => ({ c, access: componentAccess(c) }));
  const visible = states.filter(x => x.access.visible).map(x => x.c);
  const hidden = states.filter(x => !x.access.visible);
  const full = typeof lead.score === "number" ? lead.score : LeadsLib.score(comps);
  const shown = LeadsLib.score(visible);
  const best = LeadsLib.best(comps);
  const bestAccess = best ? componentAccess(best) : { visible: true, markings: [] };
  const bestVisible = LeadsLib.best(visible);
  const person = entityById(lead.personId);
  const pv = person ? visibleLabel(person) : { text: lead.personId || "", withheld: null };
  return { comps, states, visible, hidden, full, shown, best, bestAccess, bestVisible, person: pv };
}

function sourceDataset(source, marking) {
  const direct = findDataset(source);
  if (direct) return direct;
  const st = stemOf(source);
  return getDatasets().find(d => d.producedBy && stemOf(d.id) === st)
    || getDatasets().find(d => stemOf(d.id).split("_")[0] === st.split("_")[0])
    || getDatasets().find(d => !d.producedBy && (d.markings || []).includes(marking))
    || null;
}

function withheldWhy(access) {
  if (access.reason === "rule") return `<span class="withheld" title="${esc(`Rule ${access.rule.id}: ${access.rule.text || ""}`)}">blocked by rule ${esc(access.rule.id)} — ${esc(access.markings.join(", "))}</span>`;
  return withheldCell(access.markings);
}

function hiddenOf(v) { return Array.from(new Set(v.hidden.flatMap(h => h.access.markings))); }

function personCell(lead, v) {
  if (v.person.withheld) return `<span class="withheld small">withheld — ${esc(v.person.withheld.join(", "))}</span>`;
  return `<button class="link-btn" data-action="goto-entity" data-id="${esc(lead.personId)}" title="${esc(displayId(lead.personId))}">${esc(v.person.text)}</button>`;
}

function addressCell(lead, v) {
  // lead.address/lat/lon/score are the all-markings view: shown only when no component is hidden.
  if (!v.hidden.length) return esc(lead.address || (v.best && v.best.address) || "");
  if (v.bestVisible && v.bestVisible.address) return `${esc(v.bestVisible.address)}<div class="text-muted lead-alt">best of the sources you can see</div>`;
  return withheldCell(hiddenOf(v));
}

function componentChips(v) {
  return v.states.map(({ c, access }) => {
    const badge = markingBadge({ id: c.marking || "?" }, { small: true });
    const ds = sourceDataset(c.source, c.marking);
    const name = ds ? stemOf(ds.id).split("_")[0] : stemOf(c.source);
    return `<span class="lead-chip ${access.visible ? "" : "hidden"}">${badge} ${access.visible ? `${esc(name)} <span class="text-mono">${esc(LeadsLib.fmt(LeadsLib.contribution(c)))}</span>` : `<span class="withheld small" data-withheld-sources="1">1 source withheld</span>`}</span>`;
  }).join(" ");
}

function renderLeadsView(ds, allRows, report) {
  // Order by the score the role can see: the stored order is the all-markings ranking.
  const leads = allRows.map((l, i) => ({ l, i, s: leadView(l).shown })).sort((a, b) => b.s - a.s || a.i - b.i).map(x => x.l);
  const offset = ui.datasetRowOffset;
  const page = leads.slice(offset, offset + PAGE_SIZE);
  const pageCount = Math.ceil(leads.length / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE);
  const roleId = currentRoleId();
  const hiddenMarks = Array.from(new Set(leads.flatMap(l => leadView(l).hidden.flatMap(h => h.access.markings))));
  const blockedByRule = leads.some(l => leadView(l).hidden.some(h => h.access.reason === "rule"));
  const carries = report && report.upstream ? report.upstream.ids || new Set() : new Set();
  const showRet = Boolean(report && report.upstream);
  const formula = (leads[0] && leads[0].formula) || LeadsLib.FORMULA;
  const asOf = (leads[0] && leads[0].asOf) || (seedData.leads && seedData.leads.asOf) || ds.asOf || "";
  const selected = leads.find(l => l.id === ui.selectedLeadId) || null;
  return `
    <div class="section-header">
      <div class="section-title">Leads</div>
      <div class="section-sub">${leads.length} of ${(ds.rowCount || leads.length).toLocaleString()} leads${leads.length < (ds.rowCount || 0) ? " (sample)" : ""} · asOf ${esc(asOf)}</div>
      ${honestyChip("inv.leads")}
    </div>
    <p class="lead-formula-line"><code>${esc(formula)}</code></p>
    ${hiddenMarks.length && roleId ? `<div class="why-line lead-why"><strong>Columns withheld from your role.</strong> ${esc(roleLabel(roleId))} cannot see ${hiddenMarks.map(m => `<code>${esc(m)}</code>`).join(", ")}${blockedByRule ? " (or Karlsruhe mode blocks it for the session purpose)" : ""}: those address components are hatched and the score is recomputed without them. The stored score and best address were computed with every source, so they are withheld too.</div>` : ""}
    <div class="scroll-x">
      <table class="data-table leads-table">
        <thead><tr>${showRet ? "<th>retention</th>" : ""}<th>Person</th><th>Best address</th><th>Stored score</th><th>Score you can see</th><th>Sources (contribution)</th><th>Newest</th><th>Status</th></tr></thead>
        <tbody>
          ${page.map(lead => {
            const v = leadView(lead);
            const carry = carries.has(lead.id);
            const ages = v.visible.map(c => Number(c.ageDays)).filter(Number.isFinite);
            return `<tr class="clickable ${lead.id === ui.selectedLeadId ? "highlighted" : ""} ${carry ? "ret-carries" : ""}" data-action="select-lead" data-id="${esc(lead.id)}" data-lead="${esc(lead.id)}" tabindex="0" role="button" aria-label="${esc(`Lead ${v.person.text || displayId(lead.id, { withheld: Boolean(v.person.withheld) })}: score ${LeadsLib.fmt(v.shown)}`)}">
              ${showRet ? `<td class="ret-cell">${retentionCell(carry ? "carries" : "", true)}</td>` : ""}
              <td>${personCell(lead, v)}</td>
              <td class="lead-addr">${addressCell(lead, v)}</td>
              <td class="text-mono lead-score" ${v.hidden.length ? "" : `data-score-full="${esc(LeadsLib.fmt(v.full))}"`}>${v.hidden.length ? withheldCell(hiddenOf(v)) : esc(LeadsLib.fmt(v.full))}</td>
              <td class="text-mono lead-score ${v.hidden.length ? "text-amber" : ""}" data-score-visible="${esc(LeadsLib.fmt(v.shown))}">${v.hidden.length ? esc(LeadsLib.fmt(v.shown)) : `<span class="text-muted">same</span>`}</td>
              <td class="lead-sources">${componentChips(v)}</td>
              <td>${ages.length ? `${Math.min(...ages)} days` : "—"}</td>
              <td>${esc(lead.status || "")}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>
    <div class="pagination-bar">
      <button data-action="page-prev" ${currentPage === 0 ? "disabled" : ""}>&larr; Prev</button>
      <span>Page ${currentPage + 1} / ${Math.max(1, pageCount)}</span>
      <button data-action="page-next" ${currentPage >= pageCount - 1 ? "disabled" : ""}>Next &rarr;</button>
    </div>
    ${selected ? renderLeadDetail(selected, { lineageLink: true }) : `<div class="text-muted mt-8">Select a lead to see its formula with the numbers filled in.</div>`}
    ${discussionCards("inv.leads")}
  `;
}

/** The formula with the numbers filled in: DC.ui.leadFormula when the core has it, else a local table. */
function renderLeadFormula(lead, v) {
  if (core("ui", "leadFormula")) {
    // Hand the core a copy without the all-markings fields when a component is withheld.
    const shown = v.hidden.length ? Object.assign({}, lead, {
      address: v.bestVisible ? v.bestVisible.address || null : null, lat: null, lon: null,
      score: Math.round(v.shown * 10) / 10, addressSource: v.bestVisible ? v.bestVisible.source || null : null, components: v.visible,
    }) : lead;
    const html = safe("ui.leadFormula", () => window.DC.ui.leadFormula(shown, v.visible), null);
    if (typeof html === "string" && html.trim()) return `<div class="lead-formula-host">${html}</div>`;
  }
  const rows = v.states.map(({ c, access }) => {
    const ds = sourceDataset(c.source, c.marking);
    const src = `${markingBadge({ id: c.marking || "?" }, { small: true })} ${ds ? `<button class="link-btn" data-action="goto-dataset" data-id="${esc(ds.id)}">${esc(dsName(ds))}</button>` : esc(c.source || "")}`;
    if (!access.visible && access.reason === "marking") {
      // Neither the dataset nor the weight (the weights table would name the source) is shown.
      return `<tr class="lead-hidden"><td class="text-mono res-w">—</td><td>${markingBadge({ id: c.marking || access.markings[0] || "?" }, { small: true })} ${withheldSources(1, access.markings)}</td><td colspan="2" class="text-muted">left out of the score you can see</td></tr>`;
    }
    if (!access.visible) {
      return `<tr class="lead-hidden"><td class="text-mono res-w">${esc(Number(c.weight).toFixed(2))}</td><td>${src}</td><td colspan="2">${withheldWhy(access)}</td></tr>`;
    }
    const d = LeadsLib.decay(c.ageDays);
    return `<tr><td class="text-mono res-w">${esc(Number(c.weight).toFixed(2))}</td><td>${src}</td>
      <td class="text-mono">× exp(−${esc(c.ageDays)} / 365) = ${esc(d.toFixed(3))}</td>
      <td class="text-mono res-w">${esc(LeadsLib.fmt(LeadsLib.contribution(c)))}${c.address ? ` <span class="text-muted lead-comp-addr">${esc(c.address)}</span>` : ""}</td></tr>`;
  }).join("");
  const sum = v.visible.reduce((a, c) => a + LeadsLib.contribution(c), 0);
  return `
    <table class="res-arith lead-arith">
      <thead><tr><th>weight</th><th>source</th><th>age decay</th><th>contribution</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td class="text-mono res-w">= ${esc(LeadsLib.fmt(v.shown))}</td><td colspan="3">score from the sources you can see${sum > 100 ? ` <span class="text-muted">(sum ${esc(LeadsLib.fmt(sum))}, capped at 100)</span>` : ""}${v.hidden.length ? ` <span class="text-amber">· the stored score, computed with every source, is withheld from your role</span>` : ""}</td></tr></tfoot>
    </table>`;
}

function renderLeadDetail(lead, opts) {
  const v = leadView(lead);
  const rule = v.hidden.find(h => h.access.reason === "rule");
  return `
    <div class="lead-detail" aria-live="polite" data-lead-detail="${esc(lead.id)}">
      <div class="section-title mb-8">${v.person.withheld ? `<span class="withheld small">withheld — ${esc(v.person.withheld.join(", "))}</span>` : esc(v.person.text)} <span class="text-muted text-mono">${esc(displayId(lead.id, { withheld: Boolean(v.person.withheld) }))}</span></div>
      <p class="lead-formula-line"><code>${esc(lead.formula || LeadsLib.FORMULA)}</code> <span class="text-muted">asOf ${esc(lead.asOf || "")}; the best address is the component with the largest contribution.</span></p>
      ${renderLeadFormula(lead, v)}
      ${rule ? `<div class="purpose-conflict inline">${ruleBadge([{ rule: rule.access.rule }])}<div><strong>Karlsruhe mode:</strong> rule ${esc(rule.access.rule.id)} removes the ${esc(rule.access.markings.join(", "))} component for this session's purpose. <span class="purpose-rule-text">“${esc(rule.access.rule.text || "")}”</span></div></div>` : ""}
      <div class="mt-8">
        ${opts && opts.lineageLink ? `<button class="link-btn" data-action="lead-lineage" data-id="${esc(lead.id)}">Lineage of this lead →</button> · ` : ""}
        <a class="link-btn" href="../demo/" target="_blank" rel="noopener">Leads tab in Investigate (Gotham-style) →</a>
      </div>
    </div>`;
}

/** Lineage tab for a lead (leads are not ontology objects, so they have their own page). */
function renderLeadLineage(lead) {
  const v = leadView(lead);
  const ds = leadsDataset();
  const t = ds && ds.producedBy ? getTransform(ds.producedBy) : null;
  const rec = getLineage()[lead.id] || null;
  const title = v.person.withheld ? withheldCell(v.person.withheld) : esc(`${v.person.text} · lead`);
  const byDataset = {};
  const withheldByMarking = new Map(); // "HEALTH" -> count of components hidden by marking
  v.states.forEach(({ c, access }) => {
    if (!access.visible && access.reason === "marking") {
      const k = access.markings.join(", ");
      withheldByMarking.set(k, (withheldByMarking.get(k) || 0) + 1);
      return;
    }
    const src = sourceDataset(c.source, c.marking);
    const key = src ? src.id : c.source || "unknown";
    (byDataset[key] = byDataset[key] || []).push({ c, access });
  });
  const rowRefs = rec && Array.isArray(rec.sourceRows) ? rec.sourceRows : [];
  const visibleRowRefs = rowRefs.filter(r => !lackingMarkings(findDataset(r.dataset)).length);
  const hiddenRowRefs = rowRefs.filter(r => lackingMarkings(findDataset(r.dataset)).length);
  const hiddenRowMarks = Array.from(new Set(hiddenRowRefs.flatMap(r => lackingMarkings(findDataset(r.dataset)))));
  const asOf = Ret ? Ret.parseDate(lead.asOf) : null;
  return `
    <div class="section-header">
      <div class="section-title">${title}</div>
      <div class="section-sub"><span class="entity-type">Lead</span> &nbsp; ${esc(displayId(lead.id, { withheld: Boolean(v.person.withheld) }))}</div>
      ${honestyChip("build.lineage")}
    </div>
    <div class="section-title mb-8">Lead properties</div>
    <table class="prop-table mb-12">
      <tbody>
        <tr><td>id</td><td>${esc(displayId(lead.id, { withheld: Boolean(v.person.withheld) }))}</td></tr>
        <tr><td>personId</td><td>${v.person.withheld ? withheldCell(v.person.withheld) : `<button class="link-btn" data-action="goto-entity" data-id="${esc(lead.personId)}">${esc(displayId(lead.personId))}</button>`}</td></tr>
        <tr><td>address</td><td>${addressCell(lead, v)}</td></tr>
        <tr><td>score</td><td>${v.hidden.length ? `${esc(LeadsLib.fmt(v.shown))} <span class="text-amber">from the sources you can see; stored score</span> ${withheldCell(hiddenOf(v))}` : esc(LeadsLib.fmt(v.full))}</td></tr>
        <tr><td>status</td><td>${esc(lead.status || "")}</td></tr>
        <tr><td>asOf</td><td>${esc(lead.asOf || "")}</td></tr>
        ${ds ? `<tr><td>dataset</td><td><button class="link-btn" data-action="goto-dataset" data-id="${esc(ds.id)}">${esc(dsName(ds))}</button> ${markingBadges(effectiveMarkings(ds), { small: true })}</td></tr>` : ""}
      </tbody>
    </table>
    <div class="section-title mb-8">Score</div>
    ${renderLeadFormula(lead, v)}
    <div class="section-title mt-16 mb-8">Upstream sources</div>
    <div class="lineage-tree mb-12">
      <div class="tree-node"><span class="tree-icon">◈</span><span class="tree-label">${v.person.withheld ? esc(displayId(lead.id, { withheld: true })) : esc(v.person.text)}</span><span class="tree-meta">&nbsp;— Lead</span></div>
      <div class="tree-children">
        <div class="tree-node"><span class="tree-icon">⬡</span><span class="tree-label">${t ? `<button class="link-btn" data-action="goto-transform" data-id="${esc(t.id)}">${esc(t.name || t.id)}</button>` : `<span class="text-muted">${esc((ds && ds.producedBy) || "unknown transform")}</span>`}</span><span class="tree-meta">&nbsp;transform</span></div>
        <div class="tree-children">
          ${Object.entries(byDataset).map(([id, list]) => {
            const d = getDataset(id);
            return `<div class="tree-node">
              <span class="tree-icon">▤</span>
              <span class="tree-label">${d ? `<button class="link-btn" data-action="goto-dataset" data-id="${esc(d.id)}">${esc(dsName(d))}</button>` : esc(id)}</span>
              ${d ? `<span class="tree-marks">${markingBadges(effectiveMarkings(d), { small: true })}</span>` : ""}
              <span class="tree-meta">&nbsp;${list.map(({ c, access }) => access.visible
                ? `${esc(c.address || "")} · ${esc(c.ageDays)} days old${asOf != null ? ` (${esc(Ret.isoDay(asOf - Number(c.ageDays) * DAY_MS))})` : ""}`
                : withheldWhy(access)).join("; ")}</span>
            </div>`;
          }).join("")}
          ${Array.from(withheldByMarking.entries()).map(([k, n]) => `<div class="tree-node tree-withheld"><span class="tree-icon">▤</span>${withheldSources(n, k.split(", "))}<span class="tree-meta">&nbsp;dataset, rows and values hidden from your role</span></div>`).join("")}
          ${!v.states.length ? `<div class="tree-node"><span class="tree-meta">No components recorded</span></div>` : ""}
          ${rowRefs.length ? `<div class="tree-node"><span class="tree-meta">Source rows: ${visibleRowRefs.map(r => `${esc(dsName(findDataset(r.dataset), r.dataset))} row ${esc(r.row)}`).join(", ")}${hiddenRowRefs.length ? `${visibleRowRefs.length ? "; " : ""}${withheldSources(hiddenRowRefs.length, hiddenRowMarks, "row")}` : ""}</span></div>` : ""}
          ${withheldByMarking.size || hiddenRowRefs.length ? signalNote() : ""}
        </div>
      </div>
    </div>
    <div class="mt-8"><a href="../demo/" target="_blank" rel="noopener" class="link-btn" style="font-size:12px;">Leads tab in Investigate (Gotham-style) →</a></div>
  `;
}

function renderCellValue(val) {
  if (val == null) return "";
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}
