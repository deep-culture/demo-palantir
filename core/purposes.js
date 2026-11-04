/*
 * core/purposes.js — purpose rules and "Karlsruhe mode" (spec §4.9, F9; contract §4, §6).
 *
 * Classic script; attaches window.DC.purposes. Load after store, governance, session, audit,
 * markings, checkpoints.
 *
 *   DC.purposes.init(rules, {markingPurposes, legalBasisNote}?)   rules = governance.purposeRules
 *   DC.purposes.enabled() / setEnabled(bool)     Karlsruhe mode; stored as session flag "karlsruhe", logged
 *   DC.purposes.check(operation, {dataPurposes, depth, sessionPurpose, except?})
 *       -> {allowed, rule, effect, checkpointId, purposes, sessionPurpose, enabled}
 *     operation: "expand" | "rule" | "action" | "view" (| "agent")
 *     Mode off: always {allowed: true, effect: "log"}; callers still log `purposes`.
 *     Mode on, rules in order: the first "block" rule that applies wins (effect "block",
 *     allowed false); otherwise the first "checkpoint" rule (effect "checkpoint", allowed false,
 *     checkpointId) — the caller runs that Checkpoint and then proceeds; otherwise allowed.
 *     `except: ["R2"]` skips rules for which an exception was granted.
 *
 * Additions:
 *   isActive()                        rules present
 *   rules(), rule(id), legalBasisNote()
 *   purposesForMarkings(markings)     ["healthcare", …] via the marking → purpose map
 *   dataPurposesOf(items)             union over entities/links: markings ∪ sourceMarkings
 *   registerSources(datasets)         derive the marking → purpose map from dataset descriptors
 *                                     ({markings, purpose, markingProvenance}); HEALTH ⇒ healthcare
 *                                     is always present
 *   requestException(result, context, fn)   Checkpoint "cp-exception" (records tagged "exception");
 *                                     fn(record) runs only when it is passed -> withCheckpoint result
 *   onChange(cb)                      mode toggled (here or in another tab)
 *
 * Seeds without purposeRules: isActive() is false, check() always allows; the toggle is hidden.
 */
(function () {
  "use strict";

  const DC = (window.DC = window.DC || {});
  const FLAG = "karlsruhe";
  const DEFAULT_MARKING_PURPOSES = { HEALTH: ["healthcare"] };
  let rulesList = [];
  let note = "";
  let markingPurposes = { ...DEFAULT_MARKING_PURPOSES };
  let explicit = false;
  const listeners = [];

  function asList(value) {
    return Array.isArray(value) ? value.filter(Boolean) : [];
  }

  function cleanRules(rules) {
    return asList(rules).filter((rule) => rule && typeof rule === "object" && rule.id);
  }

  function init(rules, options) {
    explicit = true;
    rulesList = cleanRules(rules);
    const opts = options || {};
    if (opts.legalBasisNote !== undefined) note = String(opts.legalBasisNote || "");
    else if (DC.governance && DC.governance.get().legalBasisNote) note = DC.governance.get().legalBasisNote;
    if (opts.markingPurposes) setMarkingPurposes(opts.markingPurposes);
    return rulesList;
  }

  function setMarkingPurposes(map) {
    const next = { ...DEFAULT_MARKING_PURPOSES };
    Object.entries(map || {}).forEach(([marking, purposes]) => {
      next[marking] = [...new Set([...(next[marking] || []), ...asList(Array.isArray(purposes) ? purposes : [purposes])])];
    });
    markingPurposes = next;
  }

  // Only the dataset where a marking originates gives it a purpose (markingProvenance lists itself).
  function registerSources(datasets) {
    const map = {};
    asList(datasets).forEach((dataset) => {
      if (!dataset || !dataset.purpose) return;
      asList(dataset.markings).forEach((marking) => {
        const origins = asList(dataset.markingProvenance && dataset.markingProvenance[marking]);
        if (origins.length && !origins.includes(dataset.id)) return;
        map[marking] = [...new Set([...(map[marking] || []), dataset.purpose])];
      });
    });
    setMarkingPurposes(map);
    return markingPurposes;
  }

  function purposesForMarkings(markings) {
    const out = new Set();
    asList(markings).forEach((marking) => asList(markingPurposes[marking]).forEach((purpose) => out.add(purpose)));
    return [...out].sort();
  }

  function dataPurposesOf(items) {
    const markings = new Set();
    (Array.isArray(items) ? items : [items]).forEach((item) => {
      if (!item || typeof item !== "object") return;
      asList(item.markings).forEach((marking) => markings.add(marking));
      asList(item.sourceMarkings).forEach((marking) => markings.add(marking));
    });
    return purposesForMarkings([...markings]);
  }

  function enabled() {
    if (!rulesList.length || !DC.session) return false;
    return Boolean(DC.session.get().flags[FLAG]);
  }

  function setEnabled(value) {
    if (!DC.session) return Promise.resolve(null);
    return DC.session.setFlag(FLAG, Boolean(value));
  }

  function applies(rule, operation) {
    const ops = asList(rule.operations);
    return !ops.length || ops.includes(operation) || (operation === "agent" && ops.includes("expand"));
  }

  function check(operation, context) {
    const ctx = context || {};
    const purposes = [...new Set(asList(ctx.dataPurposes))].sort();
    const sessionPurpose = ctx.sessionPurpose !== undefined ? ctx.sessionPurpose : DC.session ? DC.session.get().purpose : null;
    const on = enabled();
    const base = { allowed: true, rule: null, effect: on ? "allow" : "log", checkpointId: null, purposes, sessionPurpose: sessionPurpose || null, enabled: on, operation };
    if (!on) return base;
    const except = new Set(asList(ctx.except));
    let checkpointRule = null;
    for (const rule of rulesList) {
      if (except.has(rule.id) || !applies(rule, operation)) continue;
      let hit = false;
      if (rule.requires === "sessionPurpose") {
        hit = !sessionPurpose;
      } else if (rule.incompatible) {
        const data = asList(rule.incompatible.data);
        const session = asList(rule.incompatible.session);
        hit = Boolean(sessionPurpose) && session.includes(sessionPurpose) && purposes.some((purpose) => data.includes(purpose));
      } else if (rule.depthOver !== undefined) {
        hit = Number(ctx.depth || 0) > Number(rule.depthOver);
      }
      if (!hit) continue;
      if (rule.effect === "checkpoint") {
        if (!checkpointRule) checkpointRule = rule;
        continue;
      }
      return { ...base, allowed: false, rule, effect: "block" };
    }
    if (checkpointRule) return { ...base, allowed: false, rule: checkpointRule, effect: "checkpoint", checkpointId: checkpointRule.checkpointId || null };
    return base;
  }

  function requestException(result, context, fn) {
    const ctx = context || {};
    const rule = result && result.rule;
    const summary = ctx.summary || (rule ? `Exception to rule ${rule.id}: ${rule.text}` : "Exception to a purpose rule");
    return DC.checkpoints.withCheckpoint(
      "cp-exception",
      { ...ctx, summary, tags: ["exception"], rule: rule ? rule.id : null, purposes: result ? result.purposes : [] },
      fn
    );
  }

  function notify(source) {
    listeners.slice().forEach((callback) => {
      try {
        callback({ enabled: enabled(), source });
      } catch (error) {
        console.error("[DC.purposes] listener failed", error);
      }
    });
  }

  // Fallback: take the rules from the governance block when the app did not call init().
  if (DC.governance && DC.governance.onInit) {
    DC.governance.onInit((governance) => {
      if (explicit) return;
      rulesList = cleanRules(governance && governance.purposeRules);
      note = (governance && governance.legalBasisNote) || "";
    });
  }
  let lastFlag = null;
  if (DC.session) {
    DC.session.onChange((session, info) => {
      const now = Boolean(session.flags && session.flags[FLAG]);
      if (now !== lastFlag) {
        lastFlag = now;
        notify(info && info.source);
      }
    });
  }

  DC.purposes = {
    FLAG,
    init,
    isActive: () => rulesList.length > 0,
    rules: () => rulesList.slice(),
    rule: (id) => rulesList.find((rule) => rule.id === id) || null,
    legalBasisNote: () => note,
    enabled,
    setEnabled,
    check,
    purposesForMarkings,
    dataPurposesOf,
    registerSources,
    setMarkingPurposes,
    requestException,
    onChange(callback) {
      if (typeof callback === "function") listeners.push(callback);
    },
  };
})();
