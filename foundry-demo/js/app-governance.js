/*
 * foundry-demo/js/app-governance.js: Build (Foundry-style), governance glue to the shared core, marking rendering, withheld-means-withheld helpers.
 *
 * One of the classic scripts that make up the Build app (split from the former 3,100-line app.js, review F-24).
 * They are loaded in order by foundry-demo/index.html and share one global script scope: top-level
 * functions, const and let declared in one file are visible in the others. Only app.js runs code at load
 * (init()); the other files only declare, apart from the UI state set up in js/app-state.js.
 */
"use strict";
// ------------------------------------------------------------------ governance (contract §6)
function governance() {
  const fromCore = core("governance", "get") ? safe("governance.get", () => window.DC.governance.get(), null) : null;
  return fromCore || seedData.governance || null;
}

function hasGovernanceCore() {
  return Boolean(core("session", "get") && core("markings", "canSee") && governance());
}

function currentRoleId() {
  if (!core("session", "get") || !governance()) return null;
  const session = safe("session.get", () => window.DC.session.get(), null);
  return session && session.role ? session.role : null;
}

function roleObject(id) {
  if (!id) return null;
  if (core("governance", "role")) {
    const r = safe("governance.role", () => window.DC.governance.role(id), null);
    if (r) return r;
  }
  const g = governance();
  return g && Array.isArray(g.roles) ? g.roles.find(r => r.id === id) || null : null;
}

function roleLabel(id) {
  const r = roleObject(id);
  return r ? r.label || r.id : id;
}

function allRoles() {
  const g = governance();
  return g && Array.isArray(g.roles) ? g.roles : [];
}

function canSee(roleId, markings) {
  if (!roleId || !core("markings", "canSee")) return true;
  return safe("markings.canSee", () => window.DC.markings.canSee(roleId, markings || []), true);
}

function rolesThatCanSee(markings) {
  if (!core("markings", "canSee")) return [];
  return allRoles().filter(r => canSee(r.id, markings));
}

const DEFAULT_MARKING_LABELS = {
  OPEN: "Open", PII: "Personal data", FIN: "Financial", TELECOM: "Telecom",
  HEALTH: "Health", "LE-SENSITIVE": "Law-enforcement sensitive",
};

function markingDefs() {
  const g = governance();
  return g && Array.isArray(g.markings) ? g.markings : [];
}

function markingDef(id) {
  const def = markingDefs().find(m => m.id === id);
  const fallbackColour = "--mk-" + String(id).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    id,
    label: (def && def.label) || DEFAULT_MARKING_LABELS[id] || id,
    description: (def && def.description) || "",
    colour: def && /^--[a-z0-9-]+$/i.test(def.colour || "") ? def.colour : fallbackColour,
  };
}

function markingColour(id) {
  return `var(${markingDef(id).colour}, var(--mk-unknown))`;
}

/** Every marking id that appears anywhere in the current seed (legend order follows governance). */
function knownMarkingIds() {
  const ids = new Set(markingDefs().map(m => m.id));
  getDatasets().forEach(d => (d.markings || []).forEach(m => ids.add(m)));
  return Array.from(ids);
}

function hasMarkings() {
  return getDatasets().some(d => Array.isArray(d.markings) && d.markings.length > 0);
}

function readGovernanceState() {
  if (!store) return {};
  const value = safe("store.get governance", () => store.get(store.key("governance"), {}), {});
  return value && typeof value === "object" ? value : {};
}

function markingOverrides() {
  const list = readGovernanceState().markingOverrides;
  return Array.isArray(list) ? list : [];
}

/**
 * Effective markings of a dataset as [{id, inheritedFrom, sources}], from
 * DC.markings.effectiveDatasetMarkings (which applies the overrides) when available, else the
 * seed's markings. inheritedFrom is null for a marking the dataset carries itself (a raw
 * source), else the raw dataset id(s) from markingProvenance.
 */
function effectiveMarkings(ds) {
  if (!ds) return [];
  let list = Array.isArray(ds.markings) ? ds.markings : [];
  if (core("markings", "effectiveDatasetMarkings")) {
    const result = safe("markings.effectiveDatasetMarkings", () => window.DC.markings.effectiveDatasetMarkings(ds, datasetsById()), null);
    if (Array.isArray(result)) list = result;
  }
  return list
    .map(m => (typeof m === "string" ? { id: m } : m))
    .filter(m => m && m.id)
    .map(m => {
      const { own, sources } = provenanceOf(ds, m.id);
      const inheritedFrom = m.inheritedFrom !== undefined ? m.inheritedFrom : (own ? null : (sources[0] || "upstream"));
      return { id: m.id, inheritedFrom: inheritedFrom || null, sources };
    });
}

/**
 * Where a marking on ds comes from: own = carried by ds itself (a raw source, or ds listed in its
 * own markingProvenance); sources = the raw dataset ids it was inherited from.
 */
function provenanceOf(ds, markingId) {
  const prov = (ds.markingProvenance || {})[markingId];
  const list = Array.isArray(prov) ? prov : [];
  const derived = Boolean(ds.producedBy) || Array.isArray(ds.inputs);
  return { own: !derived || list.includes(ds.id), sources: list.filter(id => id !== ds.id) };
}

/** Markings the seed declares on ds that are no longer effective, with the override that removed them. */
function removedMarkings(ds) {
  if (!ds || !Array.isArray(ds.markings)) return [];
  const effective = new Set(effectiveMarkings(ds).map(m => m.id));
  const ancestors = datasetAncestors(ds);
  const overrides = markingOverrides();
  return ds.markings.filter(m => !effective.has(m)).map(m => {
    const own = overrides.find(o => o.datasetId === ds.id && o.removed === m);
    const upstream = own ? null : overrides.find(o => o.removed === m && ancestors.has(o.datasetId));
    return { id: m, override: own || upstream || null, upstream: Boolean(upstream) };
  });
}

function effectiveIds(ds) { return effectiveMarkings(ds).map(m => m.id); }

function isWithheld(value) {
  if (core("markings", "isWithheld")) return Boolean(safe("markings.isWithheld", () => window.DC.markings.isWithheld(value), false));
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Array.isArray(value.withheld);
}

function redact(entity) {
  const roleId = currentRoleId();
  if (!entity || !roleId || !core("markings", "redactEntity")) return entity;
  return safe("markings.redactEntity", () => window.DC.markings.redactEntity(entity, roleId), entity) || entity;
}

function objectWithheld(redacted) {
  return redacted && Array.isArray(redacted._withheld) && redacted._withheld.length ? redacted._withheld : null;
}

function honestyChip(id) {
  if (!core("ui", "honestyChip")) return "";
  const html = safe("ui.honestyChip", () => window.DC.ui.honestyChip(id), "");
  return typeof html === "string" ? html : "";
}

function logEvent(event) {
  if (!core("audit", "logEvent") || !governance()) return;
  const payload = Object.assign({ surface: SURFACE }, event);
  safe("audit.logEvent", () => {
    const p = window.DC.audit.logEvent(payload);
    if (p && typeof p.then === "function") p.then(refreshAuditStrip, (error) => console.warn("[build] audit.logEvent rejected", error));
    else refreshAuditStrip();
  }, null);
}

// ------------------------------------------------------------------ marking rendering
function markingBadge(m, opts) {
  opts = opts || {};
  const def = markingDef(m.id || m);
  const id = def.id;
  const inherited = Boolean(m.inheritedFrom);
  const title = inherited
    ? `${def.label}: inherited from ${(m.sources && m.sources.length ? m.sources : [m.inheritedFrom]).join(", ")}`
    : `${def.label}${def.description ? " — " + def.description : ""}`;
  const cls = ["mk-badge", inherited ? "inherited" : "", opts.removed ? "removed" : "", opts.small ? "small" : ""].filter(Boolean).join(" ");
  return `<span class="${cls}" style="--mk-c:${markingColour(id)}" title="${esc(title)}">${esc(id)}${opts.removed ? `<span class="mk-removed-tag">removed</span>` : ""}</span>`;
}

function markingBadges(list, opts) {
  if (!list || !list.length) return `<span class="text-muted">none</span>`;
  return list.map(m => markingBadge(typeof m === "string" ? { id: m } : m, opts)).join(" ");
}

function withheldCell(markings) {
  const ids = (markings || []).join(", ");
  const who = rolesThatCanSee(markings).map(r => r.label).join(", ");
  // Same text and data-withheld attribute as DC.ui.withheldCell; Build keeps its dark-theme class and tooltip.
  return `<span class="withheld" data-withheld="${esc((markings || []).join(" "))}" title="${esc(who ? "Visible to: " + who : "Not visible to any role")}">withheld — marking ${esc(ids)}</span>`;
}

function whyLine(markings) {
  const roleId = currentRoleId();
  const who = rolesThatCanSee(markings).map(r => r.label);
  // The sentence comes from the core (DC.markings.whyWithheld), so both apps explain it alike;
  // the markup stays Build's (dark workspace).
  const sentence = core("markings", "whyWithheld") ? safe("markings.whyWithheld", () => window.DC.markings.whyWithheld(markings, roleId), "") : "";
  if (sentence) return `<div class="why-line"><strong>Why can't I see this?</strong> ${esc(sentence)}</div>`;
  return `<div class="why-line"><strong>Why can't I see this?</strong> It carries ${markings.map(m => `<code>${esc(m)}</code>`).join(", ")}, which your role (${esc(roleLabel(roleId))}) cannot see.
    ${who.length ? `Roles that can: ${esc(who.join(", "))}.` : "No role can see it."}</div>`;
}

function displayValue(v) {
  if (isWithheld(v)) return withheldCell(v.withheld);
  return esc(typeof v === "object" && v !== null ? JSON.stringify(v) : v);
}

// ------------------------------------------------------------------ withheld means withheld (FIXROUND §2 A4, §3)
// A role that cannot see a source must not learn that the source holds a row about this object:
// being in the clinic data is itself health data. Withheld sources are shown as a count and the
// marking, never by dataset name or row number. Display IDs that embed a phone number are masked
// for roles without TELECOM, and withheld objects show their type only. The real IDs stay in the
// data-* attributes the app dispatches on.

/** Markings of a dataset the current role lacks ([] when it may see the rows). */
function lackingMarkings(ds) {
  const roleId = currentRoleId();
  if (!roleId || !ds) return [];
  return effectiveIds(ds).filter(m => !canSee(roleId, [m]));
}

/** Dataset a lineage or mergedFrom reference points at ("norm_mobile_pings", "ping:PG-0002", …). */
const MERGED_PREFIX_STEMS = { ping: "mobile_pings", pings: "mobile_pings", flight: "flight_manifests", company: "company_registry", watchlist: "watchlist", clinic: "clinic_registrations", bank: "bank_transactions", txn: "bank_transactions" };
function datasetForRecordRef(ref) {
  const prefix = String(ref || "").split(":")[0].toLowerCase();
  const stem = MERGED_PREFIX_STEMS[prefix] || prefix;
  const datasets = getDatasets();
  return datasets.find(d => d.producedBy === "normalize_sources" && stemOf(d.id) === stem)
    || datasets.find(d => d.producedBy === "normalize_sources" && stemOf(d.id).includes(stem))
    || datasets.find(d => !d.producedBy && stemOf(d.id).includes(stem))
    || null;
}

/** "2 sources withheld — marking HEALTH" chip (no dataset name, no row numbers). */
function withheldSources(count, markings, noun) {
  const n = Number(count) || 0;
  const word = noun || "source";
  const ids = Array.from(new Set(markings || [])).join(", ");
  const who = rolesThatCanSee(markings).map(r => r.label).join(", ");
  return `<span class="withheld" data-withheld-sources="${n}" title="${esc(who ? "Visible to: " + who : "Not visible to any role")}">${n} ${esc(word)}${n === 1 ? "" : "s"} withheld — marking ${esc(ids)}</span>`;
}

function signalNote() {
  return `<div class="signal-note"><strong>Absence is a signal.</strong> The withheld line names the marking, so it still tells you that a source of that kind holds data about this record. A real platform would have to decide whether even that may be shown.</div>`;
}

/** Phone numbers in the seed, digits only (Device, Person and ping rows). */
let phoneKey = null;
let phoneDigits = new Set();
function knownPhoneDigits() {
  if (phoneKey === ui.datasetKey) return phoneDigits;
  phoneKey = ui.datasetKey;
  phoneDigits = new Set();
  const add = (v) => { const d = String(v || "").replace(/\D/g, ""); if (d.length >= 7) phoneDigits.add(d); };
  getEntities().forEach(e => { const p = e.properties || {}; add(p.phoneNumber); add(p.phone); });
  getDatasets().forEach(d => (d.sampleRows || []).forEach(r => { if (r && typeof r === "object") { add(r.phone_number); add(r.phoneNumber); } }));
  return phoneDigits;
}

function idEmbedsPhone(id) {
  const runs = String(id || "").match(/\d{7,}/g) || [];
  const known = knownPhoneDigits();
  return runs.some(run => known.has(run) || run.length >= 10);
}

/** Masks the phone-number digits in an ID: person::c-silva-30131994523 -> person::c-silva-•••. */
function maskPhoneDigits(id) {
  const known = knownPhoneDigits();
  return String(id).replace(/\d{7,}/g, run => (known.has(run) || run.length >= 10 ? "•••" : run));
}

function roleLacks(marking) {
  const roleId = currentRoleId();
  return Boolean(roleId) && !canSee(roleId, [marking]);
}

/**
 * The ID as the current role may see it. opts.withheld: the object itself is withheld, so only
 * its type is shown (residential Location IDs embed the address). A core helper, if the
 * Investigate builder added one, is preferred.
 */
function displayId(id, opts) {
  const raw = String(id == null ? "" : id);
  if (!raw) return "";
  if (opts && opts.withheld) return `${raw.split("::")[0]}::•••`;
  for (const [mod, fn] of [["markings", "displayId"], ["ui", "displayId"], ["markings", "maskId"]]) {
    if (core(mod, fn)) {
      const v = safe(`${mod}.${fn}`, () => window.DC[mod][fn](raw, currentRoleId()), null);
      if (typeof v === "string" && v) return v;
    }
  }
  return roleLacks("TELECOM") && idEmbedsPhone(raw) ? maskPhoneDigits(raw) : raw;
}

function idIsMasked(id, opts) { return displayId(id, opts) !== String(id == null ? "" : id); }

/** Visible / total objects, links and datasets with visible rows, for the header. */
const countsCache = new Map();
function visibleCounts() {
  const roleId = currentRoleId();
  const entities = getEntities();
  const edges = getEdges();
  const datasets = getDatasets();
  const total = { objects: entities.length, links: edges.length, datasets: datasets.length };
  if (!roleId || !core("markings", "canSee")) return { visible: null, total };
  const removed = Array.from(removedAtOntology()).sort().join(",");
  const key = `${ui.datasetKey}|${roleId}|${removed}|${JSON.stringify(markingOverrides().map(o => [o.datasetId, o.removed]))}`;
  if (countsCache.has(key)) return countsCache.get(key);
  const visibleIds = new Set(entities.filter(e => !objectWithheld(redact(e))).map(e => e.id));
  const edgeOk = (edge) => {
    if (core("markings", "edgeVisible")) return safe("markings.edgeVisible", () => window.DC.markings.edgeVisible(edge, roleId), true);
    return canSee(roleId, (edge.markings || []).filter(m => !removedAtOntology().has(m)));
  };
  const links = edges.filter(edge => visibleIds.has(edge.source) && visibleIds.has(edge.target) && edgeOk(edge)).length;
  const out = { visible: { objects: visibleIds.size, links, datasets: datasets.filter(d => !lackingMarkings(d).length).length }, total };
  if (countsCache.size > 40) countsCache.clear();
  countsCache.set(key, out);
  return out;
}
