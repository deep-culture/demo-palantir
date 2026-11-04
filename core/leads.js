/*
 * core/leads.js — the address-confidence score of a lead (spec §4.8, F8; contract §1, §3, §5).
 *
 * Classic script; attaches window.DC.leads. Load after governance, session, markings, purposes.
 * Shared by Investigate (Leads tab, map layer) and Build (the leads dataset); DC.ui.leadFormula renders it.
 *
 *   FORMULA                       "score = 100 · min(1, Σ weight_i · exp(−ageDays_i / 365))" (the exact
 *                                 string the pipeline stores with each lead)
 *   decay(ageDays)                exp(−ageDays / 365)
 *   contribution(component)       100 · weight · decay(ageDays), in score points
 *   score(components)             100 · min(1, Σ weight · decay), rounded to 0.1 — the code path the
 *                                 formula string describes (recomputed, never read from lead.score)
 *   best(components)              the component with the largest contribution (its address is the lead's)
 *   split(lead, {roleId, purposeCheck = true}) -> {visible, withheld: [{component, reason, missing, rule}],
 *       fullScore, visibleScore, best, canKnowFull}
 *     reason "marking": the role lacks the component's marking (markings a DPO removed at the ontology
 *       or upstream do not count). The role must not learn the component's numbers or address.
 *     reason "rule": Karlsruhe mode is on and a purpose rule (R2: healthcare data with a law-enforcement
 *       session purpose) removes a component the role could otherwise see. The role may see what
 *       was removed, so canKnowFull is true when every withheld component was removed by a rule.
 *   key(component)                stable identity of a component within a lead
 */
(function () {
  "use strict";

  const DC = (window.DC = window.DC || {});
  const FORMULA = "score = 100 · min(1, Σ weight_i · exp(−ageDays_i / 365))";

  function num(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function decay(ageDays) {
    return Math.exp(-Math.max(0, num(ageDays, 0)) / 365);
  }

  function contribution(component) {
    return 100 * num(component && component.weight, 0) * decay(component && component.ageDays);
  }

  function score(components) {
    const sum = (components || []).reduce((total, component) => total + num(component.weight, 0) * decay(component.ageDays), 0);
    return Math.round(1000 * Math.min(1, sum)) / 10;
  }

  function best(components) {
    let top = null;
    (components || []).forEach((component) => {
      if (!top || contribution(component) > contribution(top)) top = component;
    });
    return top;
  }

  function key(component) {
    return [component.source, component.marking, component.address || "", component.ageDays].join("|");
  }

  function removedMarkings() {
    return DC.markings && DC.markings.removedAtOntology ? DC.markings.removedAtOntology() : new Set();
  }

  function split(lead, options) {
    const opts = options || {};
    const roleId = opts.roleId || (DC.session ? DC.session.get().role : "");
    const components = (lead && Array.isArray(lead.components) ? lead.components : []).filter(Boolean);
    const removed = removedMarkings();
    const active = Boolean(DC.governance && DC.governance.isActive() && DC.markings);
    const visible = [];
    const withheld = [];
    components.forEach((component) => {
      const markings = [component.marking].filter((marking) => marking && !removed.has(marking));
      const missing = active ? DC.markings.missing(roleId, markings) : [];
      if (missing.length) {
        withheld.push({ component, reason: "marking", missing, rule: null });
        return;
      }
      if (opts.purposeCheck !== false && DC.purposes && DC.purposes.enabled()) {
        const purposes = DC.purposes.purposesForMarkings([component.marking]);
        const result = DC.purposes.check("view", { dataPurposes: purposes });
        if (!result.allowed && result.effect === "block") {
          withheld.push({ component, reason: "rule", missing: [], rule: result.rule, purposes, sessionPurpose: result.sessionPurpose });
          return;
        }
      }
      visible.push(component);
    });
    return {
      visible,
      withheld,
      fullScore: score(components),
      visibleScore: score(visible),
      best: best(visible),
      canKnowFull: withheld.length > 0 && withheld.every((item) => item.reason === "rule"),
    };
  }

  DC.leads = { FORMULA, decay, contribution, score, best, split, key };
})();
