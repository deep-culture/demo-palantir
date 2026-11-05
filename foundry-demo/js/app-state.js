/*
 * foundry-demo/js/app-state.js: Build (Foundry-style), helpers, persisted UI state, dataset state and derived helpers.
 *
 * One of the classic scripts that make up the Build app (split from the former 3,100-line app.js, review F-24).
 * They are loaded in order by foundry-demo/index.html and share one global script scope: top-level
 * functions, const and let declared in one file are visible in the others. Only app.js runs code at load
 * (init()); the other files only declare, apart from the UI state set up in js/app-state.js.
 */
"use strict";

// Former app.js preamble: storage keys and the UI state store.

// Build (Foundry-style). UI state lives under dc-palantir:foundry:{dataset} (core/store.js,
// REDESIGN_SPEC §6.1–6.2). Foundry treats the pipeline as authoritative, so when the seed is
// regenerated (or the old "foundry-studio-demo-v1" key is migrated) the saved UI state is reset
// silently: no banner.
//
// Governance (PHASE1_CONTRACT §6) comes from the shared core: DC.governance, DC.session,
// DC.audit, DC.markings, DC.checkpoints and DC.ui. Every call goes through core()/safe() so the
// app still works, with the governance features hidden, when a core file or the seed's
// governance block is missing.
const LEGACY_STORAGE_PREFIX = "foundry-studio-demo-v1";
const SURFACE = "build";
const store = window.DC && window.DC.store;
if (!store) console.warn("core/store.js should be loaded before foundry-demo/app.js; UI state will not persist.");
const PAGE_SIZE = 10;

// ------------------------------------------------------------------ helpers
function el(id) { return document.getElementById(id); }
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The core module `name` if it exposes function `fn`, else null. */
function core(name, fn) {
  const mod = window.DC && window.DC[name];
  return mod && typeof mod[fn] === "function" ? mod : null;
}
/** Run fn; on any exception warn once per label and return the fallback. */
const warned = new Set();
function safe(label, fn, fallback) {
  try { return fn(); } catch (error) {
    if (!warned.has(label)) { warned.add(label); console.warn(`[build] ${label} failed; feature hidden`, error); }
    return fallback;
  }
}

function storageKey(datasetKey) {
  return store ? store.key("foundry", datasetKey) : `dc-palantir:foundry:${datasetKey}`;
}

const PERSISTED_FIELDS = ["activeTab", "selectedTransformId", "selectedDatasetId", "selectedEntityId", "lineageEntitySearch", "datasetRowOffset", "markingFilter", "selectedPersonId", "retentionOffset", "selectedLeadId"];

function loadUiState(datasetKey) {
  if (!store) return {};
  const key = storageKey(datasetKey);
  const result = store.loadVersioned(key, catalog[datasetKey] || {}, {
    legacyKey: `${LEGACY_STORAGE_PREFIX}:${datasetKey}`,
  });
  // Silent reset: drop any stale copy instead of offering to restore it.
  if (result.hasStale) store.dismissStale(key);
  const saved = result.data && typeof result.data === "object" ? result.data : {};
  const out = {};
  PERSISTED_FIELDS.forEach((field) => { if (field in saved) out[field] = saved[field]; });
  return out;
}

function saveUiState() {
  try {
    const toSave = {};
    PERSISTED_FIELDS.forEach((field) => { toSave[field] = ui[field]; });
    if (store) store.saveVersioned(storageKey(ui.datasetKey), catalog[ui.datasetKey] || {}, toSave);
  } catch (_) {}
}

// ------------------------------------------------------------------ state
const catalog = window.foundrySeedCatalog || { starter: window.foundrySeed || {} };
const datasetKeys = Object.keys(catalog);

let ui = {
  datasetKey: "starter",
  activeTab: "pipelines",
  selectedTransformId: "",
  selectedDatasetId: "",
  selectedEntityId: "",
  lineageEntitySearch: "",
  datasetRowOffset: 0,
  markingFilter: "",
  selectedPersonId: "",        // Resolution tab: person whose merge explanation is shown
  resPreview: null,            // Resolution tab: threshold shown while the slider is dragged
  highlightDatasetRow: null,   // { datasetId, rowIndex }
  retentionOffset: 0,          // Datasets tab: retention clock, in days after the data's as-of date (F12)
  retPreview: null,            // retention offset shown while the slider is dragged
  selectedLeadId: "",          // Datasets tab (leads dataset) and Lineage tab: lead whose formula is shown
};

// Restore persisted ui for default dataset
ui.datasetKey = datasetKeys.includes("starter") ? "starter" : datasetKeys[0];
Object.assign(ui, loadUiState(ui.datasetKey));

let seedData = catalog[ui.datasetKey] || {};

// ------------------------------------------------------------------ derived helpers
function getTransforms() {
  return (seedData.pipeline || {}).transforms || [];
}

function getDatasets() {
  return seedData.datasets || [];
}

function getDataset(id) {
  return getDatasets().find(d => d.id === id);
}

function getEntities() {
  return seedData.entities || [];
}

function getEdges() {
  return seedData.edges || [];
}

function getLineage() {
  return seedData.lineage || {};
}

function getTransform(id) {
  return getTransforms().find(t => t.id === id);
}

/** Dataset by id first, then by name (lineage refers to datasets by id). */
function findDataset(ref) {
  return getDataset(ref) || getDatasets().find(d => d.name === ref) || null;
}

/**
 * Display name. Raw source datasets in the current seed carry the name of their normalised
 * counterpart (watchlist.csv is named "norm_watchlist"), so raw datasets show their id instead.
 */
function dsName(ds, fallback) {
  if (!ds || (!ds.id && !ds.name)) return fallback || "";
  if (!ds.producedBy && ds.name && ds.name !== ds.id && /^norm_/.test(ds.name)) return ds.id;
  return ds.name || ds.id;
}

function datasetsById() {
  const out = {};
  getDatasets().forEach(d => { out[d.id] = d; });
  return out;
}

/** Datasets written by transform t: the declared output if it is a dataset, else every dataset whose producedBy is t. */
function transformOutputs(t) {
  const own = getDatasets().filter(d => d.producedBy === t.id);
  if (own.length) return own;
  const declared = getDataset(t.output);
  return declared ? [declared] : [];
}

function stemOf(id) {
  return String(id || "").replace(/\.(csv|jsonl|json)$/i, "").replace(/^(raw|norm|resolved)_/, "");
}

/**
 * Upstream datasets of ds. Prefers an explicit ds.inputs; otherwise the producing transform's
 * inputs. A transform with several outputs (normalize_sources writes one dataset per source)
 * is split by name: norm_watchlist ← watchlist.csv, norm_mobile_pings ← mobile_location_pings.jsonl.
 */
const parentsCache = new Map();
function datasetParents(ds) {
  if (!ds) return [];
  const cacheKey = ui.datasetKey + "|" + ds.id;
  if (parentsCache.has(cacheKey)) return parentsCache.get(cacheKey);
  let parents = [];
  if (Array.isArray(ds.inputs)) {
    parents = ds.inputs.filter(id => getDataset(id));
  } else if (ds.producedBy) {
    const t = getTransform(ds.producedBy);
    const inputs = t ? (t.inputs || []).filter(id => getDataset(id)) : [];
    parents = inputs;
    if (t && inputs.length > 1 && transformOutputs(t).length > 1) {
      const stem = stemOf(ds.id);
      let match = inputs.filter(id => stemOf(id) === stem);
      if (match.length !== 1) match = inputs.filter(id => stemOf(id).split("_")[0] === stem.split("_")[0]);
      if (match.length === 1) parents = match;
    }
  }
  parentsCache.set(cacheKey, parents);
  return parents;
}

function datasetAncestors(ds) {
  const seen = new Set();
  const stack = datasetParents(ds).slice();
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    datasetParents(getDataset(id)).forEach(p => stack.push(p));
  }
  return seen;
}

function datasetDepth(ds, guard) {
  guard = guard || new Set();
  if (!ds || guard.has(ds.id)) return 0;
  guard.add(ds.id);
  const parents = datasetParents(ds);
  if (!parents.length) return 0;
  return 1 + Math.max(...parents.map(id => datasetDepth(getDataset(id), guard)));
}
