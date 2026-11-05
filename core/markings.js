/*
 * core/markings.js — who may see which object, property, link and dataset.
 *
 * Classic script; attaches window.DC.markings. Load after store, governance, session, audit.
 * Spec §4.1–4.2, §6.3; contract §3, §5–6.
 *
 *   canSee(roleId, markings)              true iff every marking is in role.markingsVisible
 *   redactEntity(entity, roleId)          copy; a hidden property becomes {withheld: [markings]};
 *                                         a hidden object becomes {id, type, label: "", properties: {},
 *                                         markings, _withheld: [markings]} (label and values dropped)
 *   edgeVisible(edge, roleId)             canSee on the link's own markings (callers also drop links
 *                                         whose endpoints are hidden)
 *   removedAtOntology()                   Set of markings a DPO override removed from the ontology
 *                                         datasets (ontology_entities / ontology_edges) or upstream
 *   effectiveDatasetMarkings(ds, byId)    string[]: ds.markings minus overrides, applied through
 *                                         markingProvenance (and through inputs when known)
 *   removeMarking({datasetId, marking, checkpointRecordId})  -> Promise<override|null>
 *                                         writes the override and a "marking" event; refused (and
 *                                         logged) for roles without canRemoveMarkings
 *
 * Additions:
 *   missing(roleId, markings)             markings the role lacks (markings removed at the ontology by a
 *                                         DPO override do not count, so canSee/missing agree with
 *                                         redactEntity and DC.leads.split everywhere — review F-02)
 *   rolesThatCanSee(markings)             role objects that hold all of them
 *   whyWithheld(markings, roleId)         one sentence for the "Why can't I see this?" line
 *   isWithheld(value)                     true for a {withheld: […]} placeholder
 *   explainDatasetMarkings(ds, byId)      [{id, origins: [datasetId], removed: bool, removedBy: override|null}]
 *   registerDatasets(byId, {transforms})  give core the Build DAG; recomputes the ontology removals
 *   overrides(), clearOverrides(reason), onChange(cb), ONTOLOGY_DATASETS
 *
 * Fix round (contract §2 A4, A5):
 *   restoreMarking({datasetId, marking, checkpointRecordId, surface})  -> Promise<override|null>
 *                                         drops the override (the marking applies again), recomputes the
 *                                         ontology removals and logs "marking.restore" (outcome restored |
 *                                         refused | not-found). Same role rule as removeMarking.
 *   requestRestore({datasetId, marking, surface})  runs Checkpoint cp-marking-restore (trigger
 *                                         "marking.restore"), then restoreMarking with the record id
 *                                         -> withCheckpoint's {outcome, record, result}
 *   displayId(id, roleId?)                an id shown to a role without TELECOM has any run of 9+ digits
 *                                         (a phone number: person::c-silva-30131994523) masked as "•••••".
 *                                         The real id stays internal (data attributes, joins, the log).
 *   hidesPhoneIds(roleId?)                true when displayId masks for that role
 *   hidesPersonalIds(roleId?)             true for roles without PII: person/location/device/watchlist ids become type::•••tag
 *
 * Overrides live in dc-palantir:governance {markingOverrides: [{datasetId, removed, by,
 * checkpointRecordId, ts, buildId}], ontologyRemoved: [marking…]}. ontologyRemoved is computed by
 * the Build app (which has the DAG) when a marking is removed, so Investigate can honour it without
 * loading the 8 MB Build seed. Removed markings are ignored by redactEntity/edgeVisible.
 */
(function () {
  "use strict";

  const DC = (window.DC = window.DC || {});
  const store = DC.store;
  const GOV_KEY = "dc-palantir:governance";
  const ONTOLOGY_DATASETS = ["ontology_entities", "ontology_edges"];
  const listeners = [];
  let memoryState = { markingOverrides: [] };
  let lineage = { byId: null, inputsOf: null };

  // ── state ──
  // Parsed once per stored value: missing() / canSee() consult the removals on every call (review F-02).
  let cache = { raw: undefined, value: null };
  function readStored() {
    if (!store) return memoryState;
    let raw = null;
    try {
      raw = window.localStorage ? window.localStorage.getItem(GOV_KEY) : null;
    } catch (_) {
      raw = null;
    }
    if (raw !== cache.raw) cache = { raw, value: store.get(GOV_KEY, null) };
    return cache.value;
  }

  function readState() {
    const value = readStored();
    const state = value && typeof value === "object" ? value : {};
    return { ...state, markingOverrides: Array.isArray(state.markingOverrides) ? state.markingOverrides : [] };
  }

  // Writes only the keys this module owns, re-reading the rest (review F-21).
  function writeState(state) {
    const own = { markingOverrides: state.markingOverrides, ontologyRemoved: state.ontologyRemoved };
    if (own.ontologyRemoved === undefined) delete own.ontologyRemoved;
    memoryState = { ...memoryState, ...own };
    if (store) store.patch(GOV_KEY, (current) => ({ ...current, ...own }));
  }

  function notify(source) {
    listeners.slice().forEach((callback) => {
      try {
        callback({ source });
      } catch (error) {
        console.error("[DC.markings] listener failed", error);
      }
    });
  }

  // ── roles ──
  function governanceActive() {
    return Boolean(DC.governance && DC.governance.isActive());
  }

  function asList(markings) {
    return Array.isArray(markings) ? markings.filter(Boolean) : [];
  }

  // Review F-02: markings a DPO removed at the ontology (or upstream) do not count, for every caller.
  function missing(roleId, markings) {
    const list = effective(markings);
    if (!governanceActive() || !list.length) return [];
    const role = DC.governance.role(roleId);
    const visible = new Set((role && role.markingsVisible) || []);
    return [...new Set(list.filter((marking) => !visible.has(marking)))];
  }

  function canSee(roleId, markings) {
    return missing(roleId, markings).length === 0;
  }

  function rolesThatCanSee(markings) {
    if (!governanceActive()) return [];
    return DC.governance.get().roles.filter((role) => canSee(role.id, markings));
  }

  function effective(markings) {
    const removed = removedAtOntology();
    return asList(markings).filter((marking) => !removed.has(marking));
  }

  function whyWithheld(markings, roleId) {
    const list = asList(markings);
    const role = DC.governance && DC.governance.role(roleId);
    const labels = list.map((id) => {
      const marking = DC.governance && DC.governance.marking(id);
      return marking ? `${id} (${marking.label})` : id;
    });
    const could = rolesThatCanSee(list).map((item) => item.label);
    const who = role ? role.label : roleId;
    return `Your role (${who}) does not hold the ${labels.join(" and ")} marking${list.length > 1 ? "s" : ""}. ${
      could.length ? `Roles that could see it: ${could.join(", ")}.` : "No role holds it."
    }`;
  }

  function isWithheld(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Array.isArray(value.withheld);
  }

  function redactEntity(entity, roleId) {
    if (!entity || typeof entity !== "object") return entity;
    const objectMissing = missing(roleId, effective(entity.markings));
    if (objectMissing.length) {
      return {
        id: entity.id,
        type: entity.type,
        label: "",
        properties: {},
        markings: asList(entity.markings).slice(),
        sourceMarkings: asList(entity.sourceMarkings).slice(),
        _withheld: objectMissing,
      };
    }
    const copy = { ...entity, properties: { ...(entity.properties || {}) } };
    const withheldProps = [];
    Object.entries(entity.propertyMarkings || {}).forEach(([property, markings]) => {
      const lacking = missing(roleId, effective(markings));
      if (lacking.length && property in copy.properties) {
        copy.properties[property] = { withheld: lacking };
        withheldProps.push(property);
      }
    });
    if (withheldProps.length) copy._withheldProps = withheldProps;
    return copy;
  }

  function edgeVisible(edge, roleId) {
    return Boolean(edge) && canSee(roleId, effective(edge.markings));
  }

  // ── datasets and overrides ──
  function overrides() {
    return readState().markingOverrides.slice();
  }

  function removedAtOntology() {
    const state = readState();
    const removed = new Set(asList(state.ontologyRemoved));
    state.markingOverrides.forEach((override) => {
      if (ONTOLOGY_DATASETS.includes(override.datasetId) && override.removed) removed.add(override.removed);
    });
    return removed;
  }

  function buildInputsOf(byId, transforms) {
    const inputsOf = {};
    (Array.isArray(transforms) ? transforms : []).forEach((transform) => {
      const outputs = Array.isArray(transform.outputs) ? transform.outputs : [transform.output];
      outputs.filter(Boolean).forEach((output) => {
        inputsOf[output] = [...new Set([...(inputsOf[output] || []), ...asList(transform.inputs)])];
      });
    });
    Object.values(byId || {}).forEach((dataset) => {
      if (dataset && Array.isArray(dataset.inputs) && !inputsOf[dataset.id]) inputsOf[dataset.id] = dataset.inputs.slice();
    });
    return Object.keys(inputsOf).length ? inputsOf : null;
  }

  function explainDatasetMarkings(dataset, datasetsById, options) {
    if (!dataset) return [];
    const byId = datasetsById || lineage.byId || {};
    const inputsOf = (options && options.transforms && buildInputsOf(byId, options.transforms)) || lineage.inputsOf || buildInputsOf(byId, null);
    const all = overrides();
    const removedAt = (datasetId, marking) => all.find((item) => item.datasetId === datasetId && item.removed === marking) || null;
    const memo = new Map();

    // Does marking survive on datasetId? With a DAG: removed here, or every input that carries it
    // has lost it (a dataset that originates the marking keeps it unless removed here). Without a
    // DAG: removed here, or removed at every origin listed in markingProvenance.
    function survives(datasetId, marking, depth) {
      const key = `${datasetId}|${marking}`;
      if (memo.has(key)) return memo.get(key);
      memo.set(key, true); // cycle guard
      const node = byId[datasetId];
      let result = true;
      if (removedAt(datasetId, marking)) {
        result = false;
      } else if (depth < 64) {
        const inputs = inputsOf && inputsOf[datasetId];
        const carrying = (inputs || []).filter((input) => asList(byId[input] && byId[input].markings).includes(marking));
        if (inputs && carrying.length) {
          const origins = asList(node && node.markingProvenance && node.markingProvenance[marking]);
          const originatesHere = origins.includes(datasetId);
          result = originatesHere || carrying.some((input) => survives(input, marking, depth + 1));
        } else if (!inputs) {
          const origins = asList(node && node.markingProvenance && node.markingProvenance[marking]).filter((origin) => origin !== datasetId);
          if (origins.length) result = origins.some((origin) => !removedAt(origin, marking));
        }
      }
      memo.set(key, result);
      return result;
    }

    return asList(dataset.markings).map((marking) => {
      const kept = survives(dataset.id, marking, 0);
      const origins = asList(dataset.markingProvenance && dataset.markingProvenance[marking]);
      const direct = removedAt(dataset.id, marking);
      const upstream = kept ? null : direct || all.find((item) => item.removed === marking && origins.includes(item.datasetId)) || all.find((item) => item.removed === marking) || null;
      return { id: marking, origins, removed: !kept, removedBy: upstream };
    });
  }

  function effectiveDatasetMarkings(dataset, datasetsById, options) {
    return explainDatasetMarkings(dataset, datasetsById, options)
      .filter((item) => !item.removed)
      .map((item) => item.id);
  }

  function recomputeOntologyRemoved() {
    if (!lineage.byId) return false;
    const removed = new Set();
    ONTOLOGY_DATASETS.forEach((id) => {
      const dataset = lineage.byId[id];
      if (!dataset) return;
      explainDatasetMarkings(dataset, lineage.byId).forEach((item) => {
        if (item.removed) removed.add(item.id);
      });
    });
    const state = readState();
    const next = [...removed].sort();
    if (JSON.stringify(asList(state.ontologyRemoved).slice().sort()) === JSON.stringify(next)) return false;
    writeState({ ...state, ontologyRemoved: next });
    return true;
  }

  function registerDatasets(datasetsById, options) {
    const byId = Array.isArray(datasetsById) ? Object.fromEntries(datasetsById.map((d) => [d.id, d])) : datasetsById || {};
    lineage = { byId, inputsOf: buildInputsOf(byId, options && options.transforms) };
    if (recomputeOntologyRemoved()) notify("local");
  }

  function removeMarking(request) {
    const { datasetId, marking, checkpointRecordId } = request || {};
    if (request && request.datasetsById) registerDatasets(request.datasetsById, { transforms: request.transforms });
    const session = DC.session ? DC.session.get() : { role: "unknown" };
    const role = DC.governance && DC.governance.role(session.role);
    const surface = (request && request.surface) || (DC.session && DC.session.surface()) || "build";
    const log = (payload) =>
      DC.audit
        ? DC.audit.logEvent({ surface, kind: "marking", verb: "marking.remove", datasetId, checkpointId: checkpointRecordId || null, payload })
        : Promise.resolve(null);
    if (governanceActive() && !(role && role.canRemoveMarkings)) {
      return log({ marking, outcome: "refused" }).then(() => null);
    }
    const state = readState();
    const override = {
      datasetId: String(datasetId || ""),
      removed: String(marking || ""),
      by: session.role,
      checkpointRecordId: checkpointRecordId || null,
      ts: new Date().toISOString(),
      buildId: (request && request.buildId) || null,
    };
    const list = state.markingOverrides.filter((item) => !(item.datasetId === override.datasetId && item.removed === override.removed));
    writeState({ ...state, markingOverrides: list.concat([override]) });
    recomputeOntologyRemoved();
    return log({ marking, outcome: "removed" }).then(() => {
      notify("local");
      return override;
    });
  }

  function restoreMarking(request) {
    const { datasetId, marking, checkpointRecordId } = request || {};
    const session = DC.session ? DC.session.get() : { role: "unknown" };
    const role = DC.governance && DC.governance.role(session.role);
    const surface = (request && request.surface) || (DC.session && DC.session.surface()) || "build";
    const log = (payload) =>
      DC.audit
        ? DC.audit.logEvent({ surface, kind: "marking", verb: "marking.restore", datasetId, checkpointId: checkpointRecordId || null, payload })
        : Promise.resolve(null);
    if (governanceActive() && !(role && role.canRemoveMarkings)) {
      return log({ marking, outcome: "refused" }).then(() => null);
    }
    const state = readState();
    const found = state.markingOverrides.find((item) => item.datasetId === String(datasetId || "") && item.removed === String(marking || ""));
    if (!found) return log({ marking, outcome: "not-found" }).then(() => null);
    const list = state.markingOverrides.filter((item) => item !== found);
    // Without the Build DAG (Investigate, Oversight) the marking comes back at the ontology unless
    // another override still removes it somewhere; with the DAG it is recomputed exactly.
    const stillRemoved = list.some((item) => item.removed === found.removed);
    const ontologyRemoved = asList(state.ontologyRemoved).filter((item) => item !== found.removed || stillRemoved);
    writeState({ ...state, markingOverrides: list, ontologyRemoved });
    recomputeOntologyRemoved();
    return log({ marking, outcome: "restored", removedBy: found.by, removedAt: found.ts, removalRecordId: found.checkpointRecordId || null }).then(() => {
      notify("local");
      return found;
    });
  }

  const RESTORE_CHECKPOINT = {
    id: "cp-marking-restore",
    trigger: "marking.restore",
    prompt: "You are restoring a marking. Everything derived from this dataset will again be withheld from roles without it. State why.",
    requiresPurpose: true,
    allowedRoles: ["dpo"],
    minLength: 20,
    refusalText: "Your role cannot restore markings. This attempt has been logged.",
  };

  function requestRestore(request) {
    const req = request || {};
    const context = { surface: req.surface, datasetId: req.datasetId, objectIds: [], summary: `Restore ${req.marking} on ${req.datasetId}` };
    // Seeds built before the fix round lack cp-marking-restore: use the contract's definition (§1).
    const definition = (DC.governance && DC.governance.checkpoint("marking.restore")) || RESTORE_CHECKPOINT;
    return DC.checkpoints.withCheckpoint(definition, context, (record) =>
      restoreMarking({ ...req, checkpointRecordId: record ? record.recordId : null })
    );
  }

  // ── display ids (A4): phone numbers embedded in ids ──
  const PHONE_RUN = /\d{9,}/g;
  function hidesPhoneIds(roleId) {
    if (!governanceActive()) return false;
    const role = roleId || (DC.session ? DC.session.get().role : "");
    return !removedAtOntology().has("TELECOM") && !canSee(role, ["TELECOM"]);
  }

  // Roles without PII (auditor, contractor): ids that name a person, place, device or watchlist entry carry
  // passport numbers, names and dates of birth (person::p8842101, person::clara-silva-1977-11-25), so the whole
  // key is replaced by a short stable tag. The same id always maps to the same tag, so filters still work.
  const PERSONAL_ID = /^(person|location|device|watchlistrecord)::|person[-:]/;
  function hidesPersonalIds(roleId) {
    if (!governanceActive()) return false;
    const role = roleId || (DC.session ? DC.session.get().role : "");
    return !removedAtOntology().has("PII") && !canSee(role, ["PII"]);
  }
  function shortTag(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, "0").slice(0, 4);
  }
  function displayId(id, roleId) {
    const text = String(id ?? "");
    if (PERSONAL_ID.test(text) && hidesPersonalIds(roleId)) {
      const cut = text.indexOf("::");
      return `${cut > 0 ? text.slice(0, cut) : "id"}::•••${shortTag(text)}`;
    }
    if (!PHONE_RUN.test(text)) return text;
    PHONE_RUN.lastIndex = 0;
    return hidesPhoneIds(roleId) ? text.replace(PHONE_RUN, "•••••") : text;
  }

  function clearOverrides(reason) {
    // Keep the other governance keys (threshold, resolutionOverrides, actionLog, …).
    writeState({ ...readState(), markingOverrides: [], ontologyRemoved: [] });
    notify("local");
    return DC.audit
      ? DC.audit.logEvent({ kind: "marking", verb: "marking.clearOverrides", payload: { reason: String(reason || "") } })
      : Promise.resolve(null);
  }

  window.addEventListener("storage", (event) => {
    if (event.key === GOV_KEY) notify("storage");
  });

  DC.markings = {
    KEY: GOV_KEY,
    ONTOLOGY_DATASETS,
    canSee,
    missing,
    rolesThatCanSee,
    whyWithheld,
    isWithheld,
    redactEntity,
    edgeVisible,
    removedAtOntology,
    effectiveDatasetMarkings,
    explainDatasetMarkings,
    registerDatasets,
    removeMarking,
    restoreMarking,
    requestRestore,
    displayId,
    hidesPhoneIds,
    hidesPersonalIds,
    overrides,
    clearOverrides,
    onChange(callback) {
      if (typeof callback === "function") listeners.push(callback);
    },
  };
})();
