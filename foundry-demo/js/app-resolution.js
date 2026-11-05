/*
 * foundry-demo/js/app-resolution.js: Build (Foundry-style), Resolution tab (threshold, candidate pairs, merge explanation, unmerge).
 *
 * One of the classic scripts that make up the Build app (split from the former 3,100-line app.js, review F-24).
 * They are loaded in order by foundry-demo/index.html and share one global script scope: top-level
 * functions, const and let declared in one file are visible in the others. Only app.js runs code at load
 * (init()); the other files only declare, apart from the UI state set up in js/app-state.js.
 */
"use strict";
// ------------------------------------------------------------------ resolution tab (F6)
// PHASE2_CONTRACT §2 and §6. The seed's Persons are the pipeline's merges at the default
// threshold; the candidate pairs below it are merged in the browser (DC.resolution.resolveAt).
// Without core/resolution.js the tab still works on a local copy of the same union-find, but the
// threshold is then neither shared with Investigate nor logged.
let localThreshold = null;

function resolutionBlock() {
  const r = seedData.resolution || (seedData.ontology && seedData.ontology.resolution) || null;
  return r && Array.isArray(r.candidates) ? r : null;
}

function hasResolutionCore() { return Boolean(core("resolution", "resolveAt")); }

function defaultThreshold() {
  const r = resolutionBlock();
  return r && typeof r.defaultThreshold === "number" ? r.defaultThreshold : 0.75;
}

function minThreshold() {
  const r = resolutionBlock();
  return r && typeof r.minThreshold === "number" ? r.minThreshold : 0.30;
}

const MAX_THRESHOLD = 0.95;

function roundT(t) { return Math.round(t * 100) / 100; }

function currentThreshold() {
  let t = null;
  if (core("resolution", "threshold")) t = safe("resolution.threshold", () => window.DC.resolution.threshold(), null);
  if (typeof t !== "number" || !Number.isFinite(t)) t = localThreshold;
  if (typeof t !== "number" || !Number.isFinite(t)) t = defaultThreshold();
  return Math.min(MAX_THRESHOLD, Math.max(minThreshold(), t));
}

function setThreshold(t) {
  t = roundT(Math.min(MAX_THRESHOLD, Math.max(minThreshold(), t)));
  if (core("resolution", "setThreshold")) {
    // The core persists the value in dc-palantir:governance and logs the change itself.
    safe("resolution.setThreshold", () => window.DC.resolution.setThreshold(t), null);
  } else {
    localThreshold = t;
  }
}

function signalDefs() {
  const r = resolutionBlock();
  return r && Array.isArray(r.signals) ? r.signals : [];
}

function signalDef(id) {
  const def = signalDefs().find(s => s.id === id);
  return def || { id, weight: 0, label: id, note: "" };
}

/** Signals of a candidate as [{id, weight, label, note}] (accepts ids or objects). */
function candidateSignals(c) {
  return (Array.isArray(c && c.signals) ? c.signals : []).map(s => {
    if (s && typeof s === "object") return Object.assign({}, signalDef(s.id), s);
    return signalDef(s);
  });
}

let overridesMemo = null; // cleared at every render
function overridesList() {
  if (overridesMemo) return overridesMemo;
  overridesMemo = readOverrides();
  return overridesMemo;
}

function readOverrides() {
  let list = null;
  if (core("resolution", "overrides")) list = safe("resolution.overrides", () => window.DC.resolution.overrides(), null);
  if (!Array.isArray(list)) list = readGovernanceState().resolutionOverrides;
  return Array.isArray(list) ? list : [];
}

function rejectionOf(candidateId) {
  return overridesList().filter(o => o && o.candidateId === candidateId && (o.decision || "reject") === "reject").slice(-1)[0] || null;
}

function isWatchlisted(id) {
  const e = entityById(id);
  return Boolean(e && e.properties && e.properties.riskTag);
}

/** Union-find fallback with the contract's representative rule (lowest watchlisted id, else lowest id). */
function localResolveAt(t) {
  const r = resolutionBlock();
  const parent = new Map();
  const find = (x) => { while (parent.has(x) && parent.get(x) !== x) x = parent.get(x); return x; };
  const merges = [];
  (r ? r.candidates : []).slice().sort((a, b) => String(a.id).localeCompare(String(b.id))).forEach(c => {
    if (!(c.score >= t - 1e-9) || rejectionOf(c.id)) return;
    [c.left, c.right].forEach(id => { if (!parent.has(id)) parent.set(id, id); });
    const a = find(c.left), b = find(c.right);
    if (a !== b) parent.set(a < b ? b : a, a < b ? a : b);
    merges.push({ candidate: c });
  });
  const members = new Map();
  Array.from(parent.keys()).forEach(id => {
    const root = find(id);
    if (!members.has(root)) members.set(root, []);
    members.get(root).push(id);
  });
  const clusters = new Map();
  const repOf = new Map();
  members.forEach(ids => {
    ids.sort();
    const listed = ids.filter(isWatchlisted);
    const rep = listed.length ? listed[0] : ids[0];
    clusters.set(rep, ids);
    ids.forEach(id => repOf.set(id, rep));
  });
  merges.forEach(m => { m.rep = repOf.get(m.candidate.left); });
  return { clusters, repOf, merges };
}

function toMap(value) {
  if (value instanceof Map) return value;
  const m = new Map();
  if (value && typeof value === "object") Object.keys(value).forEach(k => m.set(k, value[k]));
  return m;
}

/** {clusters: Map(rep -> ids), repOf: Map, merges: [{candidate, rep}], mergedIds: Set(candidate id)} */
const resolveCache = new Map();
function resolveAt(t) {
  const cacheKey = `${ui.datasetKey}|${t}|${JSON.stringify(overridesList().map(o => o.candidateId))}`;
  if (resolveCache.has(cacheKey)) return resolveCache.get(cacheKey);
  let raw = null;
  if (hasResolutionCore()) raw = safe("resolution.resolveAt", () => window.DC.resolution.resolveAt(t), null);
  if (!raw || typeof raw !== "object") raw = localResolveAt(t);
  const clusters = toMap(raw.clusters);
  const repOf = toMap(raw.repOf);
  clusters.forEach((ids, rep) => (ids || []).forEach(id => { if (!repOf.has(id)) repOf.set(id, rep); }));
  const merges = Array.isArray(raw.merges) ? raw.merges.filter(m => m && m.candidate) : [];
  const out = { clusters, repOf, merges, mergedIds: new Set(merges.map(m => m.candidate.id)) };
  resolveCache.clear();
  resolveCache.set(cacheKey, out);
  return out;
}

function repFor(res, id) { return res.repOf.get(id) || id; }

function clusterOf(res, id) {
  const rep = repFor(res, id);
  const ids = res.clusters.get(rep);
  return Array.isArray(ids) && ids.length ? ids : [id];
}

let entityIndexKey = null;
let entityIndex = new Map();
function entityById(id) {
  if (entityIndexKey !== ui.datasetKey) {
    entityIndexKey = ui.datasetKey;
    entityIndex = new Map(getEntities().map(e => [e.id, e]));
  }
  return entityIndex.get(id) || null;
}

function persons() { return getEntities().filter(e => e.type === "Person"); }

/** Count of Persons after merging at t (every Person not in a candidate stays on its own). */
function personCountAt(res) {
  let absorbed = 0;
  res.clusters.forEach(ids => { absorbed += Math.max(0, (ids || []).filter(id => entityById(id)).length - 1); });
  return persons().length - absorbed;
}

function personName(id) {
  const e = entityById(id);
  if (!e) return { html: `<code>${esc(displayId(id))}</code>`, text: displayId(id), withheld: null };
  const v = visibleLabel(e);
  if (v.withheld) return { html: `<span class="withheld small">withheld — ${esc(v.withheld.join(", "))}</span>`, text: "", withheld: v.withheld };
  return { html: esc(v.text), text: v.text, withheld: null };
}

/** One-line description that helps tell namesakes apart (born, from), read through the role's redaction. */
function personHint(id) {
  const e = entityById(id);
  if (!e) return "";
  const r = redact(e);
  if (objectWithheld(r)) return "";
  const p = r.properties || {};
  const bits = [];
  if (p.dob && !isWithheld(p.dob)) bits.push(`b. ${p.dob}`);
  if (p.nationality && !isWithheld(p.nationality)) bits.push(p.nationality);
  if (p.riskTag && !isWithheld(p.riskTag)) bits.push(`riskTag ${p.riskTag}`);
  return bits.join(" · ");
}

function personButton(id, opts) {
  const n = personName(id);
  const hint = opts && opts.hint === false ? "" : personHint(id);
  return `<button class="link-btn res-person" data-action="res-select" data-id="${esc(id)}" title="${esc(displayId(id, { withheld: Boolean(n.withheld) }))}">${n.html}</button>${hint ? ` <span class="text-muted res-hint">${hint.split(" · ").map(b => `<span class="nowrap">${esc(b)}</span>`).join(" · ")}</span>` : ""}`;
}

function fmtScore(x) { return (Math.round(x * 100) / 100).toFixed(2); }
function fmtWeight(w) { return `${w < 0 ? "−" : "+"}${Math.abs(w).toFixed(2)}`; }

function decisionOf(c, res, t) {
  const rejection = rejectionOf(c.id);
  if (rejection) return { id: "rejected", label: "rejected by override", rejection };
  if (res.mergedIds.has(c.id)) return { id: "merged", label: "merged" };
  if (repFor(res, c.left) === repFor(res, c.right) && res.repOf.has(c.left)) return { id: "indirect", label: "same person via another pair" };
  return { id: "separate", label: "separate" };
}

function canSeePair(c) {
  return !personName(c.left).withheld && !personName(c.right).withheld;
}

/** People whose resolved identity at t differs from the default threshold. */
function changedIdentities(res, base) {
  const out = [];
  const seen = new Set();
  const ids = new Set([...res.repOf.keys(), ...base.repOf.keys()]);
  ids.forEach(id => {
    if (seen.has(id)) return;
    const now = clusterOf(res, id).slice().sort();
    const before = clusterOf(base, id).slice().sort();
    if (now.join("|") === before.join("|")) return;
    now.forEach(x => seen.add(x));
    out.push({ rep: repFor(res, id), members: now, before });
  });
  return out;
}

function signalArithmetic(c) {
  const sigs = candidateSignals(c);
  const sum = sigs.reduce((acc, s) => acc + (Number(s.weight) || 0), 0);
  const clamped = Math.min(1, Math.max(0, sum));
  const rows = sigs.map(s => `
    <tr class="${s.weight < 0 ? "neg" : ""}">
      <td class="text-mono res-w">${esc(fmtWeight(Number(s.weight) || 0))}</td>
      <td><code>${esc(s.id)}</code></td>
      <td>${esc(s.label || "")}${s.note ? ` <span class="text-muted">— ${esc(s.note)}</span>` : ""}</td>
    </tr>`).join("");
  const mismatch = typeof c.score === "number" && Math.abs(clamped - c.score) > 0.005;
  return `
    <table class="res-arith">
      <tbody>${rows}</tbody>
      <tfoot><tr><td class="text-mono res-w">= ${esc(fmtScore(typeof c.score === "number" ? c.score : clamped))}</td><td colspan="2">score${sum !== clamped ? ` <span class="text-muted">(sum ${esc(fmtScore(sum))}, clamped to 0–1)</span>` : ""}${mismatch ? ` <span class="text-amber">(seed score differs from the sum of weights: ${esc(fmtScore(clamped))})</span>` : ""}</td></tr></tfoot>
    </table>`;
}

function renderResolutionSidebar() {
  const r = resolutionBlock();
  const ids = [];
  const seen = new Set();
  (r ? r.candidates : []).slice().sort((a, b) => b.score - a.score).forEach(c => [c.left, c.right].forEach(id => { if (!seen.has(id)) { seen.add(id); ids.push(id); } }));
  return `
  <aside class="sidebar">
    <div class="sidebar-section-label">People in candidate pairs</div>
    <div class="sidebar-list">
      ${ids.map(id => {
        const n = personName(id);
        return `
        <div class="sidebar-item ${id === ui.selectedPersonId ? "active" : ""}" data-action="res-select" data-id="${esc(id)}" tabindex="0" role="button">
          <div style="flex:1;overflow:hidden;">
            <div class="item-name">${n.html}</div>
            <div class="item-meta" style="margin:0;">${esc(displayId(id, { withheld: Boolean(n.withheld) }))}</div>
          </div>
        </div>`;
      }).join("")}
      ${ids.length === 0 ? `<div class="empty-state" style="padding:16px;font-size:11px;">No candidate pairs</div>` : ""}
    </div>
  </aside>`;
}

function resolutionChip() {
  const chip = honestyChip("build.resolution");
  if (chip) return chip;
  // Seed without the honesty entry: same label, linked to the glossary's built-in copy.
  return `<a class="dc-honesty dc-honesty-simplified" href="../glossary.html#build.resolution" target="_blank" rel="noopener" title="Our scorer is a transparent weighted sum of a few signals; real entity resolution uses richer models, but also confidence scores and thresholds.">Simplified</a>`;
}

function renderResolutionMain() {
  const r = resolutionBlock();
  if (!r) {
    return `<div class="section-header"><div class="section-title">Entity resolution</div>${resolutionChip()}</div>
      <div class="empty-state"><div>This seed carries no resolution block.</div></div>`;
  }
  const t = ui.resPreview != null ? ui.resPreview : currentThreshold();
  const def = defaultThreshold();
  const perm = thresholdPermission();
  const off = perm.allowed ? "" : " disabled aria-disabled=\"true\"";
  return `
    <div class="section-header">
      <div class="section-title">Entity resolution</div>
      <div class="section-sub">${r.candidates.length} candidate pair${r.candidates.length === 1 ? "" : "s"} · ${persons().length} Persons from the pipeline</div>
      ${resolutionChip()}
    </div>
    <p class="res-lede">The pipeline merged source rows into Persons with deterministic rules (passport, phone, name and date of birth). It also scored pairs of <em>different</em> Persons that might be the same individual. Lower the threshold and the browser merges every pair that scores at or above it.</p>
    <div class="res-controls">
      <label for="res-threshold" class="res-label">Merge threshold</label>
      <input type="range" id="res-threshold" min="${esc(minThreshold())}" max="${MAX_THRESHOLD}" step="0.01" value="${esc(t)}"
             aria-valuetext="${esc(fmtScore(t))}" aria-describedby="res-threshold-help${perm.allowed ? "" : " res-threshold-why"}"${off}>
      <output id="res-threshold-value" for="res-threshold" class="res-value">${esc(fmtScore(t))}</output>
      <span class="res-presets" role="group" aria-label="Threshold presets">
        ${[0.55, 0.65, def].filter((v, i, a) => a.indexOf(v) === i).map(v => `<button class="mk-filter ${Math.abs(v - t) < 0.001 ? "active" : ""}" data-action="res-threshold" data-value="${esc(v)}"${off}>${esc(fmtScore(v))}${v === def ? " (default)" : ""}</button>`).join("")}
      </span>
      ${hasResolutionCore() ? `<span class="text-muted res-shared" id="res-threshold-help">Shared with Investigate; every change is logged.</span>`
        : `<span class="text-amber res-shared" id="res-threshold-help">core/resolution.js is not loaded: this threshold applies to this page only and is not logged.</span>`}
      ${perm.allowed ? "" : `<div class="res-locked" id="res-threshold-why" role="note"><span class="res-locked-tag">read only</span> ${esc(perm.reason)}</div>`}
    </div>
    <div id="res-results">${renderResolutionResults(t)}</div>
  `;
}

function renderResolutionResults(t) {
  const r = resolutionBlock();
  const def = defaultThreshold();
  const res = resolveAt(t);
  const base = resolveAt(def);
  const countNow = personCountAt(res);
  const countDef = personCountAt(base);
  const diff = countNow - countDef;
  const changed = changedIdentities(res, base);
  const rows = r.candidates.slice().sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)));

  return `
    ${t > def + 1e-9 ? `<div class="res-fixed-note" role="note"><strong>Above ${esc(fmtScore(def))} nothing splits.</strong> Merges made by the pipeline's deterministic rules are fixed in this build — see each person's resolution record (Lineage tab).</div>` : ""}
    <div class="res-stats" aria-live="polite">
      <span class="info-chip">Persons at <strong>${esc(fmtScore(t))}</strong>: <strong id="res-count">${countNow}</strong></span>
      <span class="info-chip">at default ${esc(fmtScore(def))}: <strong>${countDef}</strong></span>
      <span class="info-chip ${diff ? "text-amber" : ""}">difference: <strong>${diff > 0 ? "+" : ""}${diff}</strong></span>
      <span class="info-chip">merges below the default: <strong>${res.merges.length}</strong></span>
    </div>
    <div class="res-grid">
      <div class="res-left">
        <div class="section-title mb-8">People who changed identity at this threshold</div>
        ${changed.length ? `<ul class="res-changed">${changed.map(ch => {
          const others = ch.members.filter(id => id !== ch.rep);
          const rep = entityById(ch.rep);
          const repRedacted = rep ? redact(rep) : null;
          const tag = repRedacted && repRedacted.properties ? repRedacted.properties.riskTag : null;
          const inherits = tag && !isWithheld(tag) ? others.filter(id => { const e = entityById(id); return !(e && e.properties && e.properties.riskTag); }) : [];
          return `<li>
            ${others.map(personButton).join(", ")} <span class="text-muted">now merged into</span> ${personButton(ch.rep)}
            <span class="text-muted">(${ch.members.length} source identities)</span>
            ${inherits.length ? `<div class="res-inherit">${inherits.map(id => personName(id).html).join(", ")} inherits <code>riskTag: ${esc(tag)}</code> from the watchlisted member.</div>` : ""}
          </li>`;
        }).join("")}</ul>` : `<div class="text-muted mb-12">Nobody: at ${esc(fmtScore(t))} every Person is as the pipeline resolved them.</div>`}

        <div class="section-title mt-16 mb-8">Candidate pairs</div>
        <div class="scroll-x mb-12">
          <table class="data-table res-table">
            <thead><tr><th>Left</th><th>Right</th><th>Score</th><th>Signals (weights)</th><th>Decision at ${esc(fmtScore(t))}</th></tr></thead>
            <tbody>
              ${rows.map(c => {
                const d = decisionOf(c, res, t);
                const sel = ui.selectedPersonId && (c.left === ui.selectedPersonId || c.right === ui.selectedPersonId);
                return `<tr class="res-row res-${d.id} ${sel ? "highlighted" : ""}" data-candidate="${esc(c.id)}">
                  <td>${personButton(c.left)}</td>
                  <td>${personButton(c.right)}</td>
                  <td class="text-mono res-score">${esc(fmtScore(c.score))}</td>
                  <td class="res-sigs">${candidateSignals(c).map(s => `<span class="res-sig ${s.weight < 0 ? "neg" : ""}" title="${esc(s.label || s.id)}">${esc(s.id)} ${esc(fmtWeight(Number(s.weight) || 0))}</span>`).join(" ")}</td>
                  <td><span class="res-decision res-decision-${d.id}" data-decision="${esc(d.id)}">${esc(d.label)}</span>${d.rejection ? `<div class="text-muted res-override">by ${esc(roleLabel(d.rejection.by))}${d.rejection.reason ? (canSeePair(c) ? `: “${esc(d.rejection.reason)}”` : ` <span class="withheld small" title="Free text about people your role cannot see is withheld with them">reason withheld</span>`) : ""}</div>` : ""}</td>
                </tr>`;
              }).join("")}
              ${rows.length === 0 ? `<tr><td colspan="5" class="text-muted">No candidate pairs in this seed.</td></tr>` : ""}
            </tbody>
          </table>
        </div>

        <div class="section-title mt-16 mb-8">The scorer's weights</div>
        <p class="text-muted mb-8">Score = sum of the weights of the signals a pair shows, clamped to 0–1. The pipeline builder chose these numbers. Which one would you change, and who would pay for it?</p>
        <table class="data-table res-weights">
          <thead><tr><th>Signal</th><th>Weight</th><th>Meaning</th><th>Note</th></tr></thead>
          <tbody>
            ${signalDefs().map(s => `<tr class="${s.weight < 0 ? "neg" : ""}"><td><code>${esc(s.id)}</code></td><td class="text-mono res-w">${esc(fmtWeight(Number(s.weight) || 0))}</td><td>${esc(s.label || "")}</td><td class="text-muted">${esc(s.note || "")}</td></tr>`).join("")}
          </tbody>
        </table>
        ${r.note || r.discussion ? `<p class="res-weights-note" data-res-note><span class="ret-discussion-kicker">Discussion</span> ${esc(r.note || r.discussion)}</p>` : ""}
      </div>
      <div class="res-right">${renderMergeExplanation(t, res)}</div>
    </div>
  `;
}

/** The merge chain for a person: DC.resolution.explain when present, else the merged pairs of its cluster. */
function explainChain(personId, res) {
  if (core("resolution", "explain")) {
    const list = safe("resolution.explain", () => window.DC.resolution.explain(personId), null);
    if (Array.isArray(list)) {
      return list.filter(x => x && x.candidate).map(x => {
        const c = typeof x.candidate === "string" ? (resolutionBlock().candidates.find(k => k.id === x.candidate) || { id: x.candidate }) : x.candidate;
        return Object.assign({}, c, { signals: x.signals || c.signals, score: typeof x.score === "number" ? x.score : c.score });
      });
    }
  }
  const members = new Set(clusterOf(res, personId));
  return res.merges.map(m => m.candidate).filter(c => members.has(c.left) || members.has(c.right));
}

function unmergeTarget(id) {
  return `../demo/index.html#object=${encodeURIComponent(id)}&dataset=${encodeURIComponent(ui.datasetKey)}`;
}

function unmergeActionType() {
  const roleId = currentRoleId();
  if (!core("actions", "applicable") || !core("actions", "applyAction")) return { type: null, allowed: false };
  const list = safe("actions.applicable", () => window.DC.actions.applicable("Person", roleId), null);
  const type = Array.isArray(list) ? list.find(a => a && a.id === "act-unmerge-person") : null;
  return { type: type || null, allowed: Boolean(type) };
}

function unmergeControls(c, rep) {
  const link = `<a class="link-btn" href="${esc(unmergeTarget(rep))}" target="_blank" rel="noopener" data-action="res-unmerge-link" data-id="${esc(c.id)}">Unmerge in Investigate →</a>`;
  const { type } = unmergeActionType();
  if (!type) return `<div class="res-unmerge">${link}</div>`;
  const params = Array.isArray(type.parameters) ? type.parameters : [];
  const fields = params.filter(p => !/candidate/i.test(p.id)).map(p => {
    const fid = `res-param-${esc(c.id)}-${esc(p.id)}`;
    if (p.type === "boolean") return `<label class="res-param"><input type="checkbox" id="${fid}" data-param="${esc(p.id)}"> ${esc(p.label || p.id)}</label>`;
    if (p.type === "enum") return `<label class="res-param" for="${fid}">${esc(p.label || p.id)}<select id="${fid}" data-param="${esc(p.id)}">${(p.options || []).map(o => { const v = typeof o === "object" ? o.id || o.value : o; const l = typeof o === "object" ? o.label || v : o; return `<option value="${esc(v)}">${esc(l)}</option>`; }).join("")}</select></label>`;
    return `<label class="res-param" for="${fid}">${esc(p.label || p.id)}${p.required ? " *" : ""}<input type="text" id="${fid}" data-param="${esc(p.id)}" ${p.minLength ? `minlength="${esc(p.minLength)}"` : ""} placeholder="${p.minLength ? `at least ${esc(p.minLength)} characters` : ""}"></label>`;
  }).join("");
  return `
    <form class="res-unmerge" data-candidate="${esc(c.id)}" data-object="${esc(rep)}" onsubmit="return false">
      ${fields}
      <button type="button" class="mk-remove" data-action="res-unmerge" data-id="${esc(c.id)}" data-object="${esc(rep)}">Unmerge (Action: ${esc(type.label || "Unmerge person")})</button>
      <span class="text-muted">or</span> ${link}
    </form>`;
}

function renderMergeExplanation(t, res) {
  const id = ui.selectedPersonId;
  const head = `<div class="section-title mb-8">Merge explanation</div>`;
  if (!id || !entityById(id)) {
    return `<div class="res-explain">${head}<div class="text-muted">Select a person (a name in the table or the sidebar) to see which signals would merge them, and how the score adds up.</div></div>`;
  }
  const n = personName(id);
  if (n.withheld) {
    return `<div class="res-explain">${head}<div class="res-explain-title">${n.html} <span class="text-muted text-mono">${esc(displayId(id, { withheld: true }))}</span></div>${whyLine(n.withheld)}</div>`;
  }
  const cluster = clusterOf(res, id);
  const rep = repFor(res, id);
  const chain = cluster.length > 1 ? explainChain(id, res) : [];
  const r = resolutionBlock();
  const pairs = r.candidates.filter(c => c.left === id || c.right === id).sort((a, b) => b.score - a.score);
  const chainIds = new Set(chain.map(c => c.id));
  const others = pairs.filter(c => !chainIds.has(c.id));
  const pairCard = (c, merged) => {
    const d = decisionOf(c, res, t);
    const verdict = d.id === "rejected"
      ? `<span class="res-decision res-decision-rejected">rejected by override</span> <span class="text-muted">— kept apart at every threshold${d.rejection.by ? ` (by ${esc(roleLabel(d.rejection.by))}${d.rejection.ts ? `, ${esc(formatTs(d.rejection.ts))}` : ""})` : ""}</span>`
      : merged || d.id === "merged"
        ? `<span class="res-decision res-decision-merged">merged</span> <span class="text-muted">${esc(fmtScore(c.score))} ≥ ${esc(fmtScore(t))}</span>`
        : `<span class="res-decision res-decision-separate">separate</span> <span class="text-muted">${esc(fmtScore(c.score))} &lt; ${esc(fmtScore(t))}; would merge at ${esc(fmtScore(c.score))} or lower</span>`;
    return `
      <div class="res-pair" data-candidate="${esc(c.id)}">
        <div class="res-pair-head">${personButton(c.left, { hint: false })} <span class="text-muted">↔</span> ${personButton(c.right, { hint: false })} <span class="text-mono text-muted">${esc(displayId(c.id, { withheld: !canSeePair(c) }))}${c.block && canSeePair(c) ? ` · block ${esc(c.block)}` : ""}</span></div>
        ${signalArithmetic(c)}
        <div class="res-verdict">${verdict}</div>
        ${c.explanation && canSeePair(c) ? `<div class="res-expl-text">${esc(c.explanation)}</div>` : ""}
        ${(merged || d.id === "merged") && d.id !== "rejected" ? unmergeControls(c, rep) : ""}
      </div>`;
  };
  return `
    <div class="res-explain" aria-live="polite">
      ${head}
      <div class="res-explain-title">${n.html} <span class="text-muted text-mono">${esc(displayId(id))}</span></div>
      <div class="res-explain-status">${cluster.length > 1
        ? `At ${esc(fmtScore(t))} this is one of <strong>${cluster.length}</strong> source identities merged into ${rep === id ? "this person (the cluster representative)" : personButton(rep)}.`
        : `At ${esc(fmtScore(t))} this is a separate Person.`}</div>
      ${chain.length ? `<div class="res-sub">Merge chain</div>${chain.map(c => pairCard(c, true)).join("")}` : ""}
      ${others.length ? `<div class="res-sub">${chain.length ? "Other candidate pairs" : "Candidate pairs involving this person"}</div>${others.map(c => pairCard(c, false)).join("")}` : ""}
      ${!pairs.length && !chain.length ? `<div class="text-muted">No candidate pairs involve this person.</div>` : ""}
    </div>`;
}

/** Refresh only the results under the slider (keeps the slider element during a drag). */
function previewThreshold(t) {
  ui.resPreview = t;
  const out = el("res-threshold-value");
  if (out) out.textContent = fmtScore(t);
  const host = el("res-results");
  if (host) host.innerHTML = renderResolutionResults(t);
}

/** Fallback when neither the core nor the seed states the rule (FIXROUND §2 D). */
const THRESHOLD_ROLES = ["fin-analyst", "dpo"];

/** true / false for one role, from the core rule, the role object or the seed, else the fallback list. */
function thresholdRuleFor(roleId) {
  for (const fn of ["canSetThreshold", "canChangeThreshold", "mayChangeThreshold", "thresholdAllowed"]) {
    if (core("resolution", fn)) {
      const r = safe(`resolution.${fn}`, () => window.DC.resolution[fn](roleId), null);
      if (typeof r === "boolean") return r;
      if (r && typeof r === "object" && typeof r.allowed === "boolean") return r.allowed;
    }
  }
  const role = roleObject(roleId);
  for (const key of ["canSetThreshold", "canChangeThreshold"]) if (role && typeof role[key] === "boolean") return role[key];
  const g = governance();
  const list = g && (g.thresholdRoles || (g.resolution && g.resolution.thresholdRoles));
  if (Array.isArray(list)) return list.includes(roleId);
  const block = resolutionBlock();
  if (block && Array.isArray(block.thresholdRoles)) return block.thresholdRoles.includes(roleId);
  return THRESHOLD_ROLES.includes(roleId);
}

function thresholdPermission() {
  const roleId = currentRoleId();
  if (!roleId) return { allowed: true, reason: "" };
  const allowed = thresholdRuleFor(roleId) !== false;
  const who = allRoles().filter(r => thresholdRuleFor(r.id) !== false).map(r => r.label);
  return {
    allowed,
    reason: allowed ? "" : `Only ${who.length ? who.join(" and ") : "authorised roles"} may change the merge threshold. Your role (${roleLabel(roleId)}) can read the merges at the current value, ${fmtScore(currentThreshold())}, but not move it.`,
  };
}

function commitThreshold(t) {
  ui.resPreview = null;
  const before = currentThreshold();
  if (!thresholdPermission().allowed) {
    // The control is disabled; if a change still arrives (keyboard, devtools), refuse and log it.
    logEvent({ kind: "resolution", verb: "resolution.setThreshold", payload: { from: before, to: roundT(t), outcome: "refused", role: currentRoleId() } });
    render();
    return;
  }
  setThreshold(t);
  if (!hasResolutionCore() && roundT(before) !== roundT(t)) {
    logEvent({ kind: "resolution", verb: "resolution.threshold.local", payload: { from: before, to: roundT(t), shared: false } });
  }
  render();
}

async function runUnmerge(candidateId, objectId) {
  const { type } = unmergeActionType();
  if (!type) return;
  const form = document.querySelector(`form.res-unmerge[data-candidate="${CSS.escape(candidateId)}"]`);
  const params = {};
  (type.parameters || []).forEach(p => {
    if (/candidate/i.test(p.id)) { params[p.id] = candidateId; return; }
    const input = form ? form.querySelector(`[data-param="${CSS.escape(p.id)}"]`) : null;
    if (!input) return;
    params[p.id] = p.type === "boolean" ? input.checked : input.value;
  });
  if (!("candidateId" in params)) params.candidateId = candidateId;
  let result = null;
  try {
    // The override lives in shared governance, so Build has no data of its own to change.
    result = await window.DC.actions.applyAction("act-unmerge-person", objectId, params, { staged: false, apply: () => {} });
  } catch (error) {
    console.warn("[build] unmerge did not complete", error);
  }
  // F-19: only the Action writes the override (core/actions.js calls DC.resolution.reject with
  // the Action instance id). Build never writes one itself, whatever the outcome.
  const applied = Boolean(result && result.outcome === "applied");
  if (!applied && result && result.outcome) console.info("[build] unmerge not applied:", result.outcome);
  overridesMemo = null;
  resolveCache.clear();
  render();
  refreshAuditStrip();
}
