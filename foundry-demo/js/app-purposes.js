/*
 * foundry-demo/js/app-purposes.js: Build (Foundry-style), resolution labels, purposes and Karlsruhe mode, discussion cards.
 *
 * One of the classic scripts that make up the Build app (split from the former 3,100-line app.js, review F-24).
 * They are loaded in order by foundry-demo/index.html and share one global script scope: top-level
 * functions, const and let declared in one file are visible in the others. Only app.js runs code at load
 * (init()); the other files only declare, apart from the UI state set up in js/app-state.js.
 */
"use strict";
// ------------------------------------------------------------------ entity resolution (F0.2)
const RESOLUTION_METHOD_LABELS = {
  passport: "Matched by passport",
  phone: "Matched by phone",
  "name+dob": "Matched by name + date of birth",
  alias: "Matched by alias",
  "ping-only": "Created from a location ping only",
};

function renderResolution(entity) {
  const r = entity && entity.resolution;
  if (!r || typeof r !== "object") return "";
  const method = RESOLUTION_METHOD_LABELS[r.method] || (r.method ? `Matched by ${r.method}` : "Match method not recorded");
  const confidence = typeof r.confidence === "number" && Number.isFinite(r.confidence) ? r.confidence.toFixed(2) : "—";
  const mergedFrom = Array.isArray(r.mergedFrom) ? r.mergedFrom.filter(Boolean) : [];
  // A4: records from a source the role cannot open are counted by marking, never listed.
  const shownRefs = [];
  const hiddenRefs = new Map(); // markings -> count
  mergedFrom.forEach(ref => {
    const lacking = lackingMarkings(datasetForRecordRef(ref));
    if (lacking.length) { const k = lacking.join(", "); hiddenRefs.set(k, (hiddenRefs.get(k) || 0) + 1); } else shownRefs.push(ref);
  });
  // D (fix round): a threshold merge is not the pipeline's passport match; say so on the record.
  let atThreshold = "";
  if (resolutionBlock() && entity.type === "Person") {
    const t = currentThreshold();
    const res = resolveAt(t);
    const cluster = clusterOf(res, entity.id);
    if (cluster.length > 1) {
      const scores = res.merges.filter(m => cluster.includes(m.candidate.left) || cluster.includes(m.candidate.right)).map(m => fmtScore(m.candidate.score));
      atThreshold = `<tr><td>at threshold</td><td data-merged-at="${esc(fmtScore(t))}"><strong>merged at ${esc(fmtScore(t))} from ${cluster.length} source identities</strong>${scores.length ? ` (score${scores.length === 1 ? "" : "s"} ${esc(scores.join(", "))})` : ""} <span class="text-muted">— see the Resolution tab; the pipeline's own record below describes only this object's rows</span></td></tr>`;
    }
  }
  return `
    <div class="section-title mb-8">Resolution</div>
    <table class="prop-table mb-12">
      <tbody>
        ${atThreshold}
        <tr><td>${atThreshold ? "pipeline method" : "method"}</td><td>${esc(method)} <span class="text-muted text-mono">(${esc(r.method || "—")})</span></td></tr>
        <tr><td>${atThreshold ? "pipeline confidence" : "confidence"}</td><td>${esc(confidence)}</td></tr>
        ${mergedFrom.length ? `<tr><td>mergedFrom</td><td>${[shownRefs.length ? esc(shownRefs.join(", ")) : ""].concat(Array.from(hiddenRefs.entries()).map(([k, n]) => withheldSources(n, k.split(", "), "record"))).filter(Boolean).join(" · ")}</td></tr>` : ""}
      </tbody>
    </table>
    ${r.splitRisk ? `
      <div class="resolution-note mb-12">
        <span class="resolution-note-label">Resolution note</span>
        ${esc(r.note || "This person was created from a single weak key and may be the same individual as another record.")}
      </div>` : ""}
  `;
}

// ------------------------------------------------------------------ purposes and Karlsruhe mode (F9)
// PHASE2_CONTRACT §4. The rules come from the seed (governance.purposeRules); whether they are
// enforced comes from DC.purposes.enabled(). Build only *shows* which transforms would combine
// incompatible purposes: the pipeline has already run, so nothing here is blocked.
// Fallback only: the core derives the marking → purpose map (DC.purposes.purposesForMarkings).
const MARKING_PURPOSES = { HEALTH: "healthcare" };

function purposesForMarkings(markings) {
  if (core("purposes", "purposesForMarkings")) {
    const list = safe("purposes.purposesForMarkings", () => window.DC.purposes.purposesForMarkings(markings), null);
    if (Array.isArray(list)) return list;
  }
  return (markings || []).map(m => MARKING_PURPOSES[m]).filter(Boolean);
}

function seedGovernanceBlock() {
  return seedData.governance || firstGovernance() || {};
}

function purposeRules() {
  const mod = window.DC && window.DC.purposes;
  if (mod && typeof mod.rules === "function") {
    const list = safe("purposes.rules", () => mod.rules(), null);
    if (Array.isArray(list) && list.length) return list;
  }
  const list = seedGovernanceBlock().purposeRules;
  return Array.isArray(list) ? list : [];
}

function karlsruheOn() {
  if (!core("purposes", "enabled")) return false;
  return Boolean(safe("purposes.enabled", () => window.DC.purposes.enabled(), false));
}

function purposeLabel(id) {
  const g = governance();
  const p = g && Array.isArray(g.purposes) ? g.purposes.find(x => x.id === id) : null;
  return (p && p.label) || id;
}

/** Purposes a dataset's data was collected for: its manifest purpose plus purposes implied by its markings. */
function dataPurposesOf(ds) {
  const out = new Set();
  if (!ds) return out;
  if (ds.purpose) out.add(ds.purpose);
  purposesForMarkings(effectiveIds(ds)).forEach(x => out.add(x));
  return out;
}

/**
 * Rules with an `incompatible` clause that a dataset's production breaks: the data purposes of
 * its parents meet a law-enforcement purpose (another parent's purpose, or the output's own).
 * Multi-output transforms (normalize_sources) are judged per output, so a per-source copy is fine.
 */
function purposeConflictsForDataset(ds) {
  const parents = datasetParents(ds).map(getDataset).filter(Boolean);
  if (parents.length < 1 || !ds.producedBy) return [];
  const out = [];
  purposeRules().forEach(rule => {
    const inc = rule && rule.incompatible;
    if (!inc || !Array.isArray(inc.data) || !Array.isArray(inc.session)) return;
    const dataSide = parents.filter(p => inc.data.some(x => dataPurposesOf(p).has(x)));
    if (!dataSide.length) return;
    const against = new Map(); // purpose -> where it comes from
    parents.filter(p => !dataSide.includes(p)).forEach(p => dataPurposesOf(p).forEach(x => { if (inc.session.includes(x)) against.set(x, dsName(p)); }));
    if (ds.purpose && inc.session.includes(ds.purpose)) against.set(ds.purpose, `${dsName(ds)} (output purpose)`);
    if (!against.size) return;
    out.push({
      rule,
      dataset: ds,
      dataSide: dataSide.map(p => ({ name: dsName(p), purposes: inc.data.filter(x => dataPurposesOf(p).has(x)) })),
      against: Array.from(against.entries()).map(([purpose, from]) => ({ purpose, from })),
    });
  });
  return out;
}

function purposeConflictsForTransform(t) {
  return transformOutputs(t).flatMap(purposeConflictsForDataset);
}

function allPurposeConflicts() {
  if (!karlsruheOn()) return [];
  return getTransforms().flatMap(t => purposeConflictsForTransform(t).map(c => Object.assign({ transform: t }, c)));
}

function ruleBadge(conflicts) {
  const ids = Array.from(new Set(conflicts.map(c => c.rule.id)));
  return ids.map(id => {
    const rule = conflicts.find(c => c.rule.id === id).rule;
    return `<span class="rule-badge" title="${esc(`Rule ${id}: ${rule.text || ""}`)}">${esc(id)}</span>`;
  }).join("");
}

function purposePanel() {
  if (!core("purposes", "enabled") || !purposeRules().length) return "";
  if (!karlsruheOn()) {
    return `<div class="purpose-panel off"><span class="text-muted">Karlsruhe mode is off: the pipeline combines datasets without checking their purposes. Turn it on in the session strip to check each transform against the purpose rules.</span></div>`;
  }
  const conflicts = allPurposeConflicts();
  const note = seedGovernanceBlock().legalBasisNote;
  const rules = Array.from(new Map(conflicts.map(c => [c.rule.id, c.rule])).values());
  if (!conflicts.length) {
    return `<div class="purpose-panel on clear" role="note"><span class="rule-badge ok">Karlsruhe mode</span> No transform combines purposes the rules forbid.</div>`;
  }
  return `
    <details class="purpose-panel on" role="note">
      <summary class="purpose-panel-head"><span class="rule-badge">Karlsruhe mode</span>
        ${conflicts.length} dataset${conflicts.length === 1 ? "" : "s"} in this pipeline combine purposes that
        ${rules.map(r => `rule ${esc(r.id)} forbids: <span class="purpose-rule-text">“${esc(r.text || "")}”</span>`).join("; ")}
        <span class="text-muted">The build has already run; Investigate blocks the same combination. Details ▾</span></summary>
      ${conflicts.map(c => `
        <div class="purpose-conflict">
          ${ruleBadge([c])}
          <div><strong>${esc(c.transform.name || c.transform.id)}</strong> → <code>${esc(dsName(c.dataset))}</code>:
            joins ${c.dataSide.map(d => `<code>${esc(d.name)}</code> (${esc(d.purposes.map(purposeLabel).join(", "))})`).join(", ")}
            with ${c.against.map(a => `${esc(purposeLabel(a.purpose))} <span class="text-muted">from ${esc(a.from)}</span>`).join(", ")}.</div>
        </div>`).join("")}
      ${rules.filter(r => r.note).map(r => `<div class="purpose-note text-muted"><strong>What rule ${esc(r.id)} abstracts:</strong> ${esc(r.note)}</div>`).join("")}
      ${note ? `<div class="purpose-note text-muted">${esc(cleanPlaceholder(note))}</div>` : ""}
    </details>`;
}

/** Older seeds carried an editorial "[to verify …]" placeholder in legalBasisNote; never show it. */
function cleanPlaceholder(text) {
  return String(text || "").replace(/\s*\[to verify[^\]]*\]/gi, "").trim();
}

// ------------------------------------------------------------------ discussion cards (spec §5.4)
function discussionCards(surfaceId) {
  let html = "";
  if (core("ui", "discussionCardsFor")) {
    html = safe("ui.discussionCardsFor", () => window.DC.ui.discussionCardsFor(surfaceId), "");
    if (typeof html !== "string") html = "";
  } else {
    // Without the core helper, render the seed's cards directly (same fields, simpler markup).
    const list = Array.isArray(seedGovernanceBlock().discussions) ? seedGovernanceBlock().discussions : [];
    html = list.filter(d => Array.isArray(d.attachedTo) && d.attachedTo.includes(surfaceId)).map(d => `
      <article class="dc-discussion" id="discussion-${esc(d.id)}">
        <div class="dc-discussion-kicker">Discussion</div>
        <h3>${esc(d.title)}</h3>
        <p>${esc(d.summary)}</p>
        ${Array.isArray(d.questions) && d.questions.length ? `<ol>${d.questions.map(q => `<li>${esc(q)}</li>`).join("")}</ol>` : ""}
        ${Array.isArray(d.sources) && d.sources.length ? `<p class="dc-discussion-sources">Sources: ${d.sources.filter(u => /^https:\/\//i.test(u)).map(u => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace(/^https:\/\/(www\.)?/, "").split("/")[0])}</a>`).join(", ")}</p>` : ""}
        ${d.disclaimer ? `<p class="dc-discussion-disclaimer">${esc(d.disclaimer)}</p>` : ""}
      </article>`).join("");
  }
  if (!html.trim()) return "";
  return `<section class="build-discussions" aria-label="Discussion material">${html}</section>`;
}
