/*
 * core/resolution.js — client-side entity resolution over the pipeline's candidate pairs (spec §4.6, F6;
 * contract §2, §6).
 *
 * Classic script; attaches window.DC.resolution. Load after store, governance, session, audit.
 *
 * The seed's Persons are what the pipeline resolved; that is what the default threshold (0.75) means.
 * The seed also carries cross-person candidate pairs with transparent scores. Pairs scoring at or above
 * the threshold are merged here (union-find), unless a resolution override rejects them.
 *
 *   DC.resolution.init(seedResolution, {watchlisted}?)   catalog[ds].resolution (call per dataset)
 *   DC.resolution.threshold() / setThreshold(t)          dc-palantir:governance.threshold; logged
 *                                                        (kind "resolution", verb "resolution.setThreshold")
 *   DC.resolution.resolveAt(t?)  -> {threshold, clusters: Map(rep -> [ids]), repOf: Map(id -> rep),
 *                                    merges: [{candidate, rep}], rejected: [candidate], below: [candidate]}
 *                                   only ids that take part in a merge appear in clusters/repOf
 *   DC.resolution.overrides() / reject(candidateId, reason)   resolutionOverrides
 *                                   [{candidateId, decision: "reject", by, reason, ts}]; logged
 *                                   ("resolution.unmerge"); honoured at every threshold
 *   DC.resolution.explain(personId, t?) -> [{candidate, signals: [{id, weight, label, note}], score, rep}]
 *                                   the merges that built this person's cluster, strongest first
 *
 * Representative of a cluster: the lowest-sorting watchlisted id, or else the lowest id. Watchlisted ids
 * come from init(…, {watchlisted}) or setWatchlisted(ids) (Investigate passes the risk-tagged Persons).
 *
 * Additions:
 *   isActive(), config() {defaultThreshold, minThreshold, maxThreshold, signals, candidates}
 *   signal(id), candidate(id), candidatesFor(personId, t?) -> [{candidate, decision: "merged" |
 *     "below" | "rejected", signals}], setWatchlisted(ids), restore(candidateId, reason) (drops an
 *   override; logged "resolution.restore"), clearOverrides(reason), onChange(cb) (threshold or overrides
 *   changed, here or in another tab), FIXED_NOTE, MAX_THRESHOLD (0.95).
 *   setThreshold(t, {log: false}) skips the audit event (e.g. while a slider is dragged; log on release).
 *
 * Fix round (contract §2 D): only some roles may move the shared threshold.
 *   canSetThreshold(roleId?) -> {allowed, reason}   roles with canSetThreshold: true in the seed, or else
 *                                   THRESHOLD_ROLES (fin-analyst, dpo). Without governance: allowed.
 *   setThreshold(t) by any other role changes nothing, logs "resolution.setThreshold" with outcome
 *   "refused" (and the value attempted) and resolves to {refused: true, reason}.
 *   reject / restore by a role outside act-unmerge-person's allowedRoles (fallback fin-analyst, dpo) are
 *   refused and logged (outcome "refused"); canUnmerge(roleId?) (review F-19).
 *   representative(ids) -> id      the representative the clusters use (lowest watchlisted, else lowest id);
 *                                   apps name a merged person after it (Investigate and Build agree).
 */
(function () {
  "use strict";

  const DC = (window.DC = window.DC || {});
  const store = DC.store;
  const GOV_KEY = "dc-palantir:governance";
  const MAX_THRESHOLD = 0.95;
  const THRESHOLD_ROLES = ["fin-analyst", "dpo"];
  const FIXED_NOTE =
    "Merges made by the pipeline's deterministic rules are fixed in this build — see each person's resolution record.";
  const listeners = [];
  let seed = null;
  let watchlisted = new Set();
  let memo = { key: "", value: null };
  let memoryState = {};
  let lastSeen = "";

  // ── state ──
  function readState() {
    const value = store ? store.get(GOV_KEY, null) : memoryState;
    return value && typeof value === "object" ? value : {};
  }

  function writeState(patch) {
    memoryState = { ...memoryState, ...patch };
    if (store) store.patch(GOV_KEY, (current) => ({ ...current, ...patch })); // review F-21
    lastSeen = fingerprint();
  }

  function fingerprint() {
    const state = readState();
    return JSON.stringify([state.threshold ?? null, state.resolutionOverrides || []]);
  }

  function notify(source) {
    memo = { key: "", value: null };
    listeners.slice().forEach((callback) => {
      try {
        callback({ source, threshold: threshold() });
      } catch (error) {
        console.error("[DC.resolution] listener failed", error);
      }
    });
  }

  function num(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function round(value) {
    return Math.round(value * 100) / 100;
  }

  // ── seed ──
  function init(seedResolution, options) {
    const source = seedResolution && typeof seedResolution === "object" ? seedResolution : null;
    seed = source
      ? {
          defaultThreshold: num(source.defaultThreshold, 0.75),
          minThreshold: num(source.minThreshold, 0.3),
          maxThreshold: num(source.maxThreshold, MAX_THRESHOLD),
          signals: (Array.isArray(source.signals) ? source.signals : []).filter((item) => item && item.id),
          candidates: (Array.isArray(source.candidates) ? source.candidates : []).filter((item) => item && item.id && item.left && item.right),
        }
      : null;
    if (options && options.watchlisted) setWatchlisted(options.watchlisted);
    memo = { key: "", value: null };
    lastSeen = fingerprint();
    return seed;
  }

  function setWatchlisted(ids) {
    const next = new Set(Array.isArray(ids) || ids instanceof Set ? [...ids] : []);
    if (next.size === watchlisted.size && [...next].every((id) => watchlisted.has(id))) return;
    watchlisted = next;
    memo = { key: "", value: null };
  }

  function clamp(value) {
    if (!seed) return num(value, 0.75);
    return round(Math.min(seed.maxThreshold, Math.max(seed.minThreshold, num(value, seed.defaultThreshold))));
  }

  function threshold() {
    const stored = readState().threshold;
    if (!seed) return typeof stored === "number" ? stored : 0.75;
    return clamp(typeof stored === "number" ? stored : seed.defaultThreshold);
  }

  function overrides() {
    const list = readState().resolutionOverrides;
    return Array.isArray(list) ? list.slice() : [];
  }

  function rejectedIds() {
    return new Set(overrides().filter((item) => item.decision === "reject").map((item) => item.candidateId));
  }

  function log(verb, payload, objectIds) {
    if (!DC.audit) return Promise.resolve(null);
    return DC.audit.logEvent({ kind: "resolution", verb, objectIds: objectIds || [], payload: payload || {} });
  }

  function canSetThreshold(roleId) {
    const governance = DC.governance;
    if (!governance || !governance.isActive()) return { allowed: true, reason: "" };
    const id = roleId || (DC.session ? DC.session.get().role : "");
    const roles = governance.get().roles;
    const flagged = roles.filter((role) => role.canSetThreshold === true).map((role) => role.id);
    const allowedIds = flagged.length ? flagged : THRESHOLD_ROLES.filter((roleIdItem) => governance.role(roleIdItem));
    if (allowedIds.includes(id)) return { allowed: true, reason: "" };
    const role = governance.role(id);
    const labels = allowedIds.map((item) => (governance.role(item) ? governance.role(item).label : item));
    return {
      allowed: false,
      reason: `Your role (${role ? role.label : id}) cannot change the shared resolution threshold: it decides who becomes one person for every role. Roles allowed: ${labels.join(", ")}. Trying is logged.`,
    };
  }

  function setThreshold(value, options) {
    const previous = threshold();
    const next = clamp(value);
    const permission = canSetThreshold();
    if (!permission.allowed) {
      return log("resolution.setThreshold", { from: previous, to: previous, attempted: next, outcome: "refused" }).then(() => ({ refused: true, reason: permission.reason }));
    }
    if (next === previous) {
      if (typeof readState().threshold !== "number") writeState({ threshold: next });
      return Promise.resolve(null);
    }
    writeState({ threshold: next });
    const result = resolveAt(next);
    notify("local");
    if (options && options.log === false) return Promise.resolve(null);
    return log("resolution.setThreshold", {
      from: previous,
      to: next,
      merges: result.merges.length,
      mergedCandidates: result.merges.map((merge) => merge.candidate.id),
    });
  }

  // ── union-find ──
  function resolveAt(t) {
    const at = t === undefined || t === null ? threshold() : clamp(t);
    const rejected = rejectedIds();
    const key = `${at}|${[...rejected].sort().join(",")}|${[...watchlisted].sort().join(",")}|${seed ? seed.candidates.length : 0}`;
    if (memo.key === key && memo.value) return memo.value;
    const parent = new Map();
    const find = (id) => {
      if (!parent.has(id)) parent.set(id, id);
      let rootId = id;
      while (parent.get(rootId) !== rootId) rootId = parent.get(rootId);
      let walk = id;
      while (parent.get(walk) !== rootId) {
        const next = parent.get(walk);
        parent.set(walk, rootId);
        walk = next;
      }
      return rootId;
    };
    const accepted = [];
    const rejectedList = [];
    const below = [];
    const candidates = seed ? seed.candidates.slice().sort((a, b) => num(b.score, 0) - num(a.score, 0) || String(a.id).localeCompare(String(b.id))) : [];
    candidates.forEach((candidate) => {
      if (num(candidate.score, 0) < at) {
        below.push(candidate);
      } else if (rejected.has(candidate.id)) {
        rejectedList.push(candidate);
      } else {
        accepted.push(candidate);
        const a = find(candidate.left);
        const b = find(candidate.right);
        if (a !== b) parent.set(b, a);
      }
    });
    const groups = new Map();
    accepted.forEach((candidate) => {
      [candidate.left, candidate.right].forEach((id) => {
        const rootId = find(id);
        if (!groups.has(rootId)) groups.set(rootId, new Set());
        groups.get(rootId).add(id);
      });
    });
    const clusters = new Map();
    const repOf = new Map();
    groups.forEach((members) => {
      const ids = [...members].sort();
      const listed = ids.filter((id) => watchlisted.has(id));
      const rep = listed.length ? listed[0] : ids[0];
      clusters.set(rep, ids);
      ids.forEach((id) => repOf.set(id, rep));
    });
    const merges = accepted.map((candidate) => ({ candidate, rep: repOf.get(candidate.left) }));
    const value = { threshold: at, clusters, repOf, merges, rejected: rejectedList, below };
    memo = { key, value };
    return value;
  }

  function representative(ids) {
    const list = [...new Set(Array.isArray(ids) ? ids : [])].sort();
    const listed = list.filter((id) => watchlisted.has(id));
    return listed.length ? listed[0] : list[0] || null;
  }

  function signalsOf(candidate) {
    const byId = new Map(((seed && seed.signals) || []).map((item) => [item.id, item]));
    return (candidate.signals || []).map((id) => byId.get(id) || { id, weight: 0, label: id, note: "" });
  }

  function explain(personId, t) {
    const result = resolveAt(t);
    const rep = result.repOf.get(personId);
    if (!rep) return [];
    return result.merges
      .filter((merge) => merge.rep === rep)
      .map((merge) => ({ candidate: merge.candidate, signals: signalsOf(merge.candidate), score: num(merge.candidate.score, 0), rep }));
  }

  function candidatesFor(personId, t) {
    if (!seed) return [];
    const result = resolveAt(t);
    const members = new Set(result.clusters.get(result.repOf.get(personId)) || [personId]);
    const merged = new Set(result.merges.map((merge) => merge.candidate.id));
    const rejected = new Set(result.rejected.map((candidate) => candidate.id));
    return seed.candidates
      .filter((candidate) => members.has(candidate.left) || members.has(candidate.right))
      .map((candidate) => ({
        candidate,
        decision: merged.has(candidate.id) ? "merged" : rejected.has(candidate.id) ? "rejected" : "below",
        signals: signalsOf(candidate),
      }))
      .sort((a, b) => num(b.candidate.score, 0) - num(a.candidate.score, 0));
  }

  function candidate(id) {
    return (seed && seed.candidates.find((item) => item.id === id)) || null;
  }

  // Review F-19: an unmerge is the act-unmerge-person Action's decision; only its allowed roles may write
  // a resolution override (any other role's attempt is logged and changes nothing).
  function canUnmerge(roleId) {
    const governance = DC.governance;
    if (!governance || !governance.isActive()) return true;
    const type = DC.actions && DC.actions.type ? DC.actions.type("act-unmerge-person") : null;
    const allowed = type && Array.isArray(type.allowedRoles) ? type.allowedRoles : THRESHOLD_ROLES;
    return allowed.includes(roleId || (DC.session ? DC.session.get().role : ""));
  }

  function reject(candidateId, reason, options) {
    const found = candidate(candidateId);
    const session = DC.session ? DC.session.get() : { role: "unknown" };
    if (!canUnmerge(session.role)) {
      return log("resolution.unmerge", { candidateId: String(candidateId), reason: String(reason || ""), outcome: "refused" }, found ? [found.left, found.right] : []).then(() => null);
    }
    const override = {
      candidateId: String(candidateId),
      decision: "reject",
      by: (options && options.by) || session.role,
      reason: String(reason || ""),
      ts: new Date().toISOString(),
    };
    if (options && options.actionId) override.actionId = options.actionId;
    const list = overrides().filter((item) => item.candidateId !== override.candidateId);
    writeState({ resolutionOverrides: list.concat([override]) });
    notify("local");
    return log(
      "resolution.unmerge",
      { candidateId: override.candidateId, reason: override.reason, score: found ? found.score : null, threshold: threshold(), actionId: override.actionId || null },
      found ? [found.left, found.right] : []
    ).then(() => override);
  }

  function restore(candidateId, reason) {
    const found = candidate(candidateId);
    if (!canUnmerge()) return log("resolution.restore", { candidateId, reason: String(reason || ""), outcome: "refused" }, found ? [found.left, found.right] : []).then(() => null);
    const list = overrides();
    const next = list.filter((item) => item.candidateId !== candidateId);
    if (next.length === list.length) return Promise.resolve(null);
    writeState({ resolutionOverrides: next });
    notify("local");
    return log("resolution.restore", { candidateId, reason: String(reason || "") }, found ? [found.left, found.right] : []);
  }

  function clearOverrides(reason) {
    writeState({ resolutionOverrides: [] });
    notify("local");
    return log("resolution.clearOverrides", { reason: String(reason || "") });
  }

  window.addEventListener("storage", (event) => {
    if (event.key !== GOV_KEY) return;
    const now = fingerprint();
    if (now === lastSeen) return;
    lastSeen = now;
    notify("storage");
  });

  DC.resolution = {
    KEY: GOV_KEY,
    FIXED_NOTE,
    MAX_THRESHOLD,
    init,
    isActive: () => Boolean(seed && seed.candidates.length),
    config: () => seed,
    threshold,
    setThreshold,
    canSetThreshold,
    canUnmerge,
    THRESHOLD_ROLES,
    representative,
    resolveAt,
    overrides,
    reject,
    restore,
    clearOverrides,
    explain,
    candidatesFor,
    candidate,
    signal: (id) => ((seed && seed.signals) || []).find((item) => item.id === id) || null,
    setWatchlisted,
    onChange(callback) {
      if (typeof callback === "function") listeners.push(callback);
    },
  };
})();
