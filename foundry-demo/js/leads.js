/*
 * foundry-demo/js/leads.js: lead score helpers for Build (PHASE3_CONTRACT §1, §4).
 *
 * Classic script; attaches window.BuildLeads. Pure functions only: app.js does the rendering.
 *
 *   BuildLeads.FORMULA                     the contract's formula string
 *   BuildLeads.components(lead)            [{source, marking, weight, ageDays, decay, contribution, address}]
 *                                          (accepts an array or a JSON string)
 *   BuildLeads.decay(ageDays)              exp(−ageDays / 365)
 *   BuildLeads.score(components, opts?)    100 · min(1, Σ weight_i · exp(−ageDays_i / 365)); opts.shiftDays
 *                                          ages every component by that many days (the retention clock)
 *   BuildLeads.contribution(c, opts?)      100 · weight · decay, the component's share before the cap
 *   BuildLeads.best(components)            the component with the largest contribution (or null)
 *   BuildLeads.isLead(row)                 row looks like a lead (has components and a personId)
 *   BuildLeads.fmt(x)                      score as text, one decimal at most
 *
 * The browser recomputes the score from the components, so a withheld component visibly changes it.
 */
(function () {
  "use strict";

  const FORMULA = "score = 100 · min(1, Σ weight_i · exp(−ageDays_i / 365))";
  const YEAR = 365;

  function num(x, fallback) {
    const n = typeof x === "string" ? parseFloat(x) : x;
    return typeof n === "number" && Number.isFinite(n) ? n : fallback;
  }

  function components(lead) {
    if (!lead || typeof lead !== "object") return [];
    let list = lead.components;
    if (typeof list === "string") {
      try { list = JSON.parse(list); } catch (_) { list = []; }
    }
    return Array.isArray(list) ? list.filter(c => c && typeof c === "object") : [];
  }

  function decay(ageDays) {
    return Math.exp(-Math.max(0, num(ageDays, 0)) / YEAR);
  }

  function contribution(c, opts) {
    const shift = num(opts && opts.shiftDays, 0);
    return 100 * num(c.weight, 0) * decay(num(c.ageDays, 0) + shift);
  }

  function score(list, opts) {
    const sum = (list || []).reduce((acc, c) => acc + contribution(c, opts) / 100, 0);
    return 100 * Math.min(1, sum);
  }

  function best(list) {
    let top = null;
    (list || []).forEach(c => {
      const v = num(c.contribution, contribution(c));
      if (!top || v > top.v) top = { c, v };
    });
    return top ? top.c : null;
  }

  function isLead(row) {
    return Boolean(row && typeof row === "object" && row.personId && (Array.isArray(row.components) || typeof row.components === "string"));
  }

  function fmt(x) {
    const n = num(x, null);
    if (n === null) return "—";
    const r = Math.round(n * 10) / 10;
    return Number.isInteger(r) ? String(r) : r.toFixed(1);
  }

  window.BuildLeads = { FORMULA, components, decay, contribution, score, best, isLead, fmt };
})();
