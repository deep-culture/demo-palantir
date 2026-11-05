/*
 * core/ui.js — shared UI pieces: session strip, audit strip, honesty chips, marking chips.
 *
 * Classic script; attaches window.DC.ui. Load last among core/*.js. Styles: core/core.css.
 *
 *   DC.ui.renderSessionStrip(el, {surface})   role selector + description, purpose, strict toggle,
 *                                             audit count, Oversight link
 *   DC.ui.renderAuditStrip(el, {surface})     last three events + count + link (aria-live)
 *   DC.ui.honestyChip(honestyId)              -> HTML string; links to glossary.html#<id>
 *
 * Options (additions): theme: "light" | "dark" (default: light for investigate, dark otherwise; sets
 * class dc-strip-light / dc-strip-dark on el), oversightHref (default "../audit/index.html"),
 * onRoleChange(roleId) called after the role is set.
 * Strips redraw themselves when the session, the audit log or the governance block changes (also
 * from other tabs). Calling render again on a new element is fine: detached elements are dropped.
 *
 * Additions: configure({glossaryHref, oversightHref}), markingChip(id), withheldCell(markings),
 * whyLine(markings, roleId), escapeHtml(text), describeEvent(event).
 *
 * Phase 2 (contract §6):
 *   DC.ui.karlsruheToggle(options?)             the session strip shows a "Karlsruhe mode" checkbox
 *                                               (data-dc="karlsruhe") whenever DC.purposes has rules;
 *                                               with the mode on, the session purpose shows as a chip
 *                                               (or "no purpose — R1 blocks analysis")
 *   DC.ui.discussionCard(id)                    -> HTML: purple collapsible "Discussion" card (summary,
 *                                               questions, sources, disclaimer); open/closed state
 *                                               survives re-renders
 *   DC.ui.discussionCardsFor(surfaceId | [ids], {exclude}?) -> HTML for every discussion attached
 *   Additions: purposeChip(purposeId), blockedCard(checkResult, {buttonAttrs, operation, exception})
 *     -> red "Blocked by rule R2" card with the rule text, the purposes involved and a
 *     "Request exception" button carrying buttonAttrs (the app wires the click).
 *
 * Phase 3 (contract §5):
 *   Session strip "Failure mode (instructor)" select (data-dc="failure-mode"): none / fabricated link /
 *     overreach / approve all → DC.session.setFailureMode. Shown where the agent lives (surface
 *     "investigate", or options.failureMode: true); hidden with options.failureMode: false.
 *   DC.ui.leadFormula(lead, visibleComponents, options?) -> HTML: the formula with the numbers filled in,
 *     one row per component with its marking chip. Components of lead.components missing from
 *     visibleComponents are withheld: hatched, with no weight, age, contribution or address (the role
 *     must not learn them), and the card shows "score from visible sources" and "n components
 *     withheld". options.withheld = [{component, reason: "rule", rule}] (from DC.leads.split) marks
 *     components a purpose rule removed: those keep their numbers (struck through), and the full score
 *     is shown next to the visible one ("score without withheld sources"). options.showFull forces the
 *     full score (for a role that can see every withheld marking). options.compact drops the table.
 *   DC.ui.leadScore(components)   the score code path (DC.leads.score when loaded)
 *
 * Fix round (contract §2):
 *   Session strip "Instructor mode" checkbox (data-dc="instructor", off by default, logged). Strict
 *     checkpoints and Failure mode are shown only while it is on (their values persist when hidden).
 *   leadFormula: a component withheld by marking is shown as "1 source withheld (marking X)" without
 *     naming its dataset, with a note that showing a marking is itself a signal.
 *   blockedCard: shows rule.note (what the rule abstracts) when the seed carries it; the exception
 *     button reads "Request a self-certified exception" with EXCEPTION_LABEL under it.
 *   EXCEPTION_LABEL, displayId(id) (DC.markings.displayId), describeEvent masks phone-embedded ids.
 */
(function () {
  "use strict";

  const DC = (window.DC = window.DC || {});
  const config = { glossaryHref: "../glossary.html", oversightHref: "../audit/index.html" };
  const strips = new Map(); // element -> {type, options}
  let stripCounter = 0;
  let listening = false;

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  const EXCEPTION_LABEL = "Self-certified exception: takes effect now, recorded for review by the data protection officer.";

  function displayId(id) {
    return DC.markings && DC.markings.displayId ? DC.markings.displayId(id) : String(id ?? "");
  }

  const KIND_LABELS = { mirrors: "Mirrors", simplified: "Simplified", extension: "Teaching extension" };

  function honestyChip(honestyId, options) {
    const entry = DC.governance && DC.governance.honesty(honestyId);
    if (!entry) return "";
    let label = KIND_LABELS[entry.kind] || entry.kind || "Label";
    if (entry.kind === "mirrors") {
      // The Action model is Foundry's kinetic layer even where Investigate shows it (spec §4.5).
      const platform = { "inv.actions": "Mirrors Foundry" };
      label = platform[honestyId] || (String(honestyId).startsWith("inv.") ? "Mirrors Gotham" : String(honestyId).startsWith("build.") ? "Mirrors Foundry" : "Mirrors Palantir");
    }
    const dark = options && options.onDark ? " dc-honesty-on-dark" : "";
    return `<a class="dc-honesty dc-honesty-${escapeHtml(entry.kind || "other")}${dark}" href="${escapeHtml(config.glossaryHref)}#${escapeHtml(
      honestyId
    )}" title="${escapeHtml(entry.text || "")}" data-honesty="${escapeHtml(honestyId)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`;
  }

  function markingChip(markingId) {
    const marking = DC.governance && DC.governance.marking(markingId);
    const colour = marking && marking.colour ? `var(${marking.colour}, var(--mk-open))` : "var(--mk-open)";
    const title = marking ? `${marking.label}: ${marking.description || ""}` : markingId;
    return `<span class="dc-marking" style="--mk:${escapeHtml(colour)}" title="${escapeHtml(title)}">${escapeHtml(markingId)}</span>`;
  }

  function withheldCell(markings) {
    const list = (markings || []).filter(Boolean);
    return `<span class="dc-withheld" data-withheld="${escapeHtml(list.join(" "))}">withheld — marking ${escapeHtml(list.join(", ") || "?")}</span>`;
  }

  function whyLine(markings, roleId) {
    if (!DC.markings) return "";
    const role = roleId || (DC.session && DC.session.get().role);
    return `<p class="dc-why"><strong>Why can't I see this?</strong> ${escapeHtml(DC.markings.whyWithheld(markings, role))}</p>`;
  }

  function shortTime(iso) {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function describeEvent(event) {
    const parts = [event.verb || event.kind];
    const payload = event.payload || {};
    if (payload.label && event.kind === "action") parts.push(payload.label);
    if (event.verb === "agent.tool" && payload.tool) parts.push(`${payload.n}. ${payload.tool}${payload.denied ? " (denied)" : ""}`);
    if (event.verb === "action.approveAll") parts.push(`${payload.count} edit${payload.count === 1 ? "" : "s"}`);
    if (event.kind === "objectset" && payload.name) parts.push(`“${String(payload.name).slice(0, 32)}”`);
    if (payload.outcome && event.verb !== "agent.tool") parts.push(payload.outcome);
    if (payload.rule) parts.push(`rule ${payload.rule}`);
    if (event.kind === "resolution" && payload.to !== undefined) parts.push(`${payload.from} → ${payload.to}`);
    if (payload.query) parts.push(`“${String(payload.query).slice(0, 40)}”`);
    if (event.kind === "role" && payload.to) parts.push(`→ ${payload.to}`);
    if (event.objectIds && event.objectIds.length) parts.push(event.objectIds.length === 1 ? displayId(event.objectIds[0]) : `${event.objectIds.length} objects`);
    return parts.join(" · ");
  }

  // ── strips ──
  function themeClass(options) {
    const theme = options.theme || (options.surface === "investigate" ? "light" : "dark");
    return theme === "light" ? "dc-strip-light" : "dc-strip-dark";
  }

  function sessionStripHtml(element, options) {
    const id = element.dataset.dcStripId;
    const session = DC.session.get();
    const governanceActive = DC.governance && DC.governance.isActive();
    const total = DC.audit ? DC.audit.count() : 0;
    const mine = DC.audit ? DC.audit.readEvents({ sessionId: session.sessionId }).length : 0;
    const href = options.oversightHref || config.oversightHref;
    const auditLink = `<a class="dc-strip-link" href="${escapeHtml(href)}" data-dc="oversight-link">${escapeHtml(
      `${total} audit event${total === 1 ? "" : "s"}`
    )} <span class="dc-strip-sub">(${mine} this session)</span> · Oversight →</a>`;
    if (!governanceActive) {
      return `<div class="dc-strip-inner">
        <span class="dc-strip-note">No governance block in this dataset: every object is visible and no checkpoints apply.</span>
        <span class="dc-strip-spacer"></span>${auditLink}</div>`;
    }
    const governance = DC.governance.get();
    const role = DC.governance.role(session.role);
    const purposes = ((role && role.purposes) || []).map((purposeId) => DC.governance.purpose(purposeId) || { id: purposeId, label: purposeId });
    return `<div class="dc-strip-inner">
      <div class="dc-strip-group">
        <label for="${id}-role">Role</label>
        <select id="${id}-role" data-dc="role">
          ${governance.roles.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === session.role ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}
        </select>
        ${honestyChip("session.roles", { onDark: themeClass(options) === "dc-strip-dark" })}
      </div>
      <div class="dc-strip-group dc-strip-desc">
        <span>${escapeHtml((role && role.description) || "")}</span>
        <span class="dc-strip-marks" aria-label="Markings this role sees">sees ${((role && role.markingsVisible) || []).map(markingChip).join("") || "nothing"}</span>
      </div>
      <div class="dc-strip-group">
        <label for="${id}-purpose">Purpose</label>
        <select id="${id}-purpose" data-dc="purpose">
          <option value="">— none —</option>
          ${purposes.map((purpose) => `<option value="${escapeHtml(purpose.id)}" ${purpose.id === session.purpose ? "selected" : ""}>${escapeHtml(purpose.label)}</option>`).join("")}
        </select>
      </div>
      ${karlsruheGroup(id, session, options)}
      <div class="dc-strip-group dc-strip-instructor${session.flags.instructor ? " is-on" : ""}">
        <input type="checkbox" id="${id}-instructor" data-dc="instructor" ${session.flags.instructor ? "checked" : ""}>
        <label for="${id}-instructor" class="dc-strip-toggle" title="Shows the instructor controls (Strict checkpoints, Failure mode, Clear audit). Toggling is logged.">Instructor mode</label>
      </div>
      ${session.flags.instructor ? `<div class="dc-strip-group dc-strip-strict">
        <input type="checkbox" id="${id}-strict" data-dc="strict" ${session.flags.strictCheckpoints ? "checked" : ""}>
        <label for="${id}-strict" class="dc-strip-toggle">Strict checkpoints <span class="dc-strip-sub">(instructor)</span></label>
        ${honestyChip("session.checkpoints", { onDark: themeClass(options) === "dc-strip-dark" })}
      </div>` : ""}
      ${session.flags.instructor ? failureModeGroup(id, session, options) : ""}
      <span class="dc-strip-spacer"></span>
      ${auditLink}
    </div>`;
  }

  function karlsruheGroup(id, session, options) {
    if (!DC.purposes || !DC.purposes.isActive()) return "";
    const on = DC.purposes.enabled();
    const dark = themeClass(options) === "dc-strip-dark";
    const purposeState = on
      ? session.purpose
        ? `<span class="dc-strip-sub">session purpose</span> ${purposeChip(session.purpose)}`
        : `<span class="dc-purpose-missing">no purpose — R1 blocks analysis</span>`
      : "";
    return `<div class="dc-strip-group dc-strip-karlsruhe${on ? " is-on" : ""}">
        <input type="checkbox" id="${id}-karlsruhe" data-dc="karlsruhe" ${on ? "checked" : ""}>
        <label for="${id}-karlsruhe" class="dc-strip-toggle">Karlsruhe mode</label>
        ${honestyChip("inv.karlsruhe", { onDark: dark })}
        ${purposeState}
      </div>`;
  }

  const FAILURE_LABELS = { none: "none", "fabricated-link": "fabricated link", overreach: "overreach", "approve-all": "approve all" };
  function failureModeGroup(id, session, options) {
    const show = options.failureMode !== undefined ? Boolean(options.failureMode) : options.surface === "investigate";
    if (!show || !DC.session.setFailureMode) return "";
    const mode = (session.flags && session.flags.failureMode) || "none";
    return `<div class="dc-strip-group dc-strip-failure${mode !== "none" ? " is-on" : ""}">
        <label for="${id}-failure">Failure mode <span class="dc-strip-sub">(instructor)</span></label>
        <select id="${id}-failure" data-dc="failure-mode" title="Scripted agent failure for the next run (spec §4.7). Students see that a mode is set.">
          ${(DC.session.FAILURE_MODES || Object.keys(FAILURE_LABELS)).map((value) => `<option value="${escapeHtml(value)}" ${value === mode ? "selected" : ""}>${escapeHtml(FAILURE_LABELS[value] || value)}</option>`).join("")}
        </select>
      </div>`;
  }

  // ── leads (F8): the formula with the numbers filled in ──
  function localDecay(ageDays) {
    return Math.exp(-Math.max(0, Number(ageDays) || 0) / 365);
  }

  function leadScore(components) {
    if (DC.leads && DC.leads.score) return DC.leads.score(components);
    const sum = (components || []).reduce((total, item) => total + (Number(item.weight) || 0) * localDecay(item.ageDays), 0);
    return Math.round(1000 * Math.min(1, sum)) / 10;
  }

  function componentKey(component) {
    return DC.leads && DC.leads.key ? DC.leads.key(component) : [component.source, component.marking, component.address || "", component.ageDays].join("|");
  }

  function fmt(value, digits) {
    const n = Number(value);
    return Number.isFinite(n) ? n.toFixed(digits) : "—";
  }

  function sourceLabel(source) {
    return String(source || "")
      .replace(/\.(csv|jsonl)$/, "")
      .replace(/^(raw|norm)_/, "")
      .replace(/_/g, " ");
  }

  // The markings that hide a component from the current role (only those: naming the others could
  // reveal the source category). Falls back to every marking of the component.
  function withheldMarkings(component) {
    const all = DC.leads && DC.leads.componentMarkings ? DC.leads.componentMarkings(component) : [component.marking].filter(Boolean);
    if (!DC.markings || !DC.session) return all;
    const removed = DC.markings.removedAtOntology ? DC.markings.removedAtOntology() : new Set();
    const lacking = DC.markings.missing(DC.session.get().role, all.filter((marking) => !removed.has(marking)));
    return lacking.length ? lacking : all;
  }

  function leadFormula(lead, visibleComponents, options) {
    if (!lead) return "";
    const opts = options || {};
    const all = (lead.components || []).filter(Boolean);
    const shownKeys = new Set((visibleComponents || all).map(componentKey));
    const ruleOf = new Map((opts.withheld || []).filter((item) => item && item.reason === "rule").map((item) => [componentKey(item.component), item]));
    const visible = all.filter((component) => shownKeys.has(componentKey(component)));
    const hidden = all.filter((component) => !shownKeys.has(componentKey(component)));
    const byRule = hidden.filter((component) => ruleOf.has(componentKey(component)));
    const byMarking = hidden.filter((component) => !ruleOf.has(componentKey(component)));
    const visibleScore = leadScore(visible);
    const fullScore = leadScore(all);
    const knowFull = Boolean(opts.showFull) || (hidden.length > 0 && byMarking.length === 0);
    const formula = lead.formula || (DC.leads && DC.leads.FORMULA) || "score = 100 · min(1, Σ weight_i · exp(−ageDays_i / 365))";
    const row = (component) => {
      const decay = localDecay(component.ageDays);
      const points = 100 * (Number(component.weight) || 0) * decay;
      const rule = ruleOf.get(componentKey(component));
      if (!shownKeys.has(componentKey(component)) && !rule) {
        const marks = withheldMarkings(component);
        return `<tr class="dc-lead-withheld" data-withheld="marking">
          <td>1 source withheld</td><td>${marks.map(markingChip).join("")}</td>
          <td colspan="5" class="dc-lead-hatch">withheld (marking ${escapeHtml(marks.join(", ") || "?")}): your role does not see this source, its dataset, its age, its weight or its address</td></tr>`;
      }
      const struck = rule ? " dc-lead-struck" : "";
      return `<tr class="${rule ? "dc-lead-withheld dc-lead-rule" : ""}" data-component="${escapeHtml(component.source)}"${rule ? ` data-withheld="rule" data-rule="${escapeHtml(rule.rule ? rule.rule.id : "")}"` : ""}>
        <td>${escapeHtml(sourceLabel(component.source))}${rule ? ` <span class="dc-lead-rule-chip">removed by rule ${escapeHtml(rule.rule ? rule.rule.id : "")}</span>` : ""}</td>
        <td>${(DC.leads && DC.leads.componentMarkings ? DC.leads.componentMarkings(component) : [component.marking]).map(markingChip).join("")}</td>
        <td class="num${struck}">${fmt(component.weight, 2)}</td>
        <td class="num${struck}">${escapeHtml(String(component.ageDays ?? "—"))}</td>
        <td class="num${struck}">${fmt(decay, 3)}</td>
        <td class="num${struck}">${fmt(points, 1)}</td>
        <td class="${struck.trim()}">${escapeHtml(component.address || "—")}</td></tr>`;
    };
    const terms = visible.map((component) => `${fmt(component.weight, 2)}·exp(−${escapeHtml(String(component.ageDays))}/365)`).join(" + ") || "0";
    const sumLine = `= 100 · min(1, ${terms}) = <strong data-lead-score="visible">${fmt(visibleScore, 1)}</strong>`;
    const signalNote = byMarking.length
      ? `<p class="dc-lead-signal">Showing that a source is withheld, and its marking, is itself a signal: being listed in a health dataset is health data. The tool names the marking but not the dataset.</p>`
      : "";
    const withheldNote = hidden.length
      ? `<p class="dc-lead-note" data-lead-withheld="${hidden.length}"><strong>Score from visible sources: ${fmt(visibleScore, 1)}</strong> · ${hidden.length} component${hidden.length === 1 ? "" : "s"} withheld${
          knowFull ? ` · full score <span data-lead-score="full">${fmt(fullScore, 1)}</span> (score without withheld sources: ${fmt(visibleScore, 1)})` : ""
        }${byRule.length ? ` · ${byRule.length} removed by a purpose rule (Karlsruhe mode): score your markings allow <span data-lead-score="before-rule">${fmt(leadScore(visible.concat(byRule)), 1)}</span>, after the rule ${fmt(visibleScore, 1)}` : ""}</p>`
      : "";
    const table = opts.compact
      ? ""
      : `<table class="dc-lead-table"><thead><tr><th>Source</th><th>Marking</th><th>Weight</th><th>Age (days)</th><th>Decay</th><th>Points</th><th>Address</th></tr></thead>
        <tbody>${all.map(row).join("") || `<tr><td colspan="7">No address sources.</td></tr>`}</tbody></table>`;
    return `<div class="dc-lead-formula" data-lead="${escapeHtml(lead.id || "")}">
      <code class="dc-lead-code">${escapeHtml(formula)}</code>
      ${table}
      <p class="dc-lead-sum mono">${sumLine}</p>
      ${withheldNote}
      ${signalNote}
      ${lead.asOf ? `<p class="dc-lead-asof">Ages are counted to the dataset date ${escapeHtml(lead.asOf)}.</p>` : ""}
    </div>`;
  }

  let standaloneWired = false;
  function wireStandaloneToggle() {
    if (standaloneWired) return;
    standaloneWired = true;
    document.addEventListener("change", (event) => {
      const control = event.target;
      if (!control || !control.matches || !control.matches('input[data-dc="karlsruhe"]')) return;
      if (control.closest(".dc-session-strip") || !DC.purposes) return; // strips handle their own
      DC.purposes.setEnabled(control.checked);
    });
  }

  function purposeChip(purposeId) {
    if (!purposeId) return "";
    const purpose = (DC.governance && DC.governance.purpose(purposeId)) || { id: purposeId, label: purposeId };
    const basis = purpose.legalBasis ? ` · ${purpose.legalBasis}` : "";
    return `<span class="dc-purpose" data-purpose="${escapeHtml(purpose.id)}" title="${escapeHtml(`Purpose: ${purpose.label}${basis}`)}">${escapeHtml(purpose.label || purpose.id)}</span>`;
  }

  // ── purpose rules: the red "Blocked by rule" card ──
  function blockedCard(result, options) {
    if (!result || !result.rule) return "";
    const opts = options || {};
    const rule = result.rule;
    const purposes = (result.purposes || []).map(purposeChip).join(" ");
    let why;
    if (rule.requires === "sessionPurpose") {
      why = "This session has no stated purpose. Choose one in the session strip, or request an exception.";
    } else if (rule.incompatible) {
      const clash = (result.purposes || []).filter((purpose) => (rule.incompatible.data || []).includes(purpose));
      why = `The data involved was collected for ${clash.map((p) => (DC.governance && DC.governance.purpose(p) ? DC.governance.purpose(p).label : p)).join(", ") || "another purpose"}; this session's purpose is ${
        result.sessionPurpose ? (DC.governance && DC.governance.purpose(result.sessionPurpose) ? DC.governance.purpose(result.sessionPurpose).label : result.sessionPurpose) : "none"
      }.`;
    } else {
      why = "This operation needs a Checkpoint first.";
    }
    // The seed's editorial placeholder ("[to verify …]") is never shown to students.
    const note = (DC.purposes ? DC.purposes.legalBasisNote() : "").replace(/\s*\[to verify[^\]]*\]/gi, "").trim();
    const exception = opts.exception
      ? `<p class="dc-blocked-exception">Self-certified exception granted under Checkpoint record <code>${escapeHtml(opts.exception)}</code>; recorded for review by the data protection officer.</p>`
      : opts.buttonAttrs !== undefined
        ? `<button type="button" class="dc-btn dc-btn-blocked" ${opts.buttonAttrs}>Request a self-certified exception</button><p class="dc-blocked-selfcert">${escapeHtml(EXCEPTION_LABEL)}</p>`
        : "";
    return `<div class="dc-blocked" role="alert" data-rule="${escapeHtml(rule.id)}" data-operation="${escapeHtml(opts.operation || result.operation || "")}">
      <div class="dc-blocked-head"><span class="dc-blocked-title">Blocked by rule ${escapeHtml(rule.id)}</span>${honestyChip("inv.karlsruhe")}</div>
      <p class="dc-blocked-rule">${escapeHtml(rule.text || "")}</p>
      ${rule.note ? `<p class="dc-blocked-abstracts"><strong>What this rule abstracts:</strong> ${escapeHtml(rule.note)}</p>` : ""}
      <p class="dc-blocked-why">${escapeHtml(why)}</p>
      ${purposes ? `<p class="dc-blocked-purposes">Data purposes: ${purposes}${result.sessionPurpose ? ` · session: ${purposeChip(result.sessionPurpose)}` : ""}</p>` : ""}
      ${note ? `<p class="dc-blocked-note">${escapeHtml(note)}</p>` : ""}
      ${exception}
    </div>`;
  }

  // ── discussion cards (spec §5.4) ──
  const openDiscussions = new Set();
  let toggleListening = false;
  function listenToggles() {
    if (toggleListening) return;
    toggleListening = true;
    document.addEventListener(
      "toggle",
      (event) => {
        const card = event.target;
        if (!card || !card.classList || !card.classList.contains("dc-discussion")) return;
        if (card.open) openDiscussions.add(card.dataset.discussion);
        else openDiscussions.delete(card.dataset.discussion);
      },
      true
    );
  }

  function hostOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch (_) {
      return url;
    }
  }

  function discussionCard(id) {
    const item = DC.governance && DC.governance.discussion ? DC.governance.discussion(id) : null;
    if (!item) return "";
    listenToggles();
    const questions = (item.questions || []).filter(Boolean);
    const sources = (item.sources || []).filter(Boolean);
    return `<details class="dc-discussion" data-discussion="${escapeHtml(item.id)}" ${openDiscussions.has(item.id) ? "open" : ""}>
      <summary><span class="dc-discussion-kicker">Discussion</span><span class="dc-discussion-title">${escapeHtml(item.title || item.id)}</span></summary>
      <div class="dc-discussion-body">
        ${item.summary ? `<p>${escapeHtml(item.summary)}</p>` : ""}
        ${questions.length ? `<ol class="dc-discussion-questions">${questions.map((q) => `<li>${escapeHtml(q)}</li>`).join("")}</ol>` : ""}
        ${sources.length ? `<p class="dc-discussion-sources">Sources: ${sources.map((url) => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(hostOf(url))}</a>`).join(", ")}</p>` : ""}
        <p class="dc-discussion-disclaimer">${escapeHtml(item.disclaimer || "Discussion material about real institutions and public reporting. Nothing here simulates a real person.")}</p>
      </div>
    </details>`;
  }

  function discussionCardsFor(surfaceIds, options) {
    if (!DC.governance) return "";
    const wanted = new Set(Array.isArray(surfaceIds) ? surfaceIds : [surfaceIds]);
    const exclude = new Set((options && options.exclude) || []);
    return (DC.governance.get().discussions || [])
      .filter((item) => !exclude.has(item.id) && (item.attachedTo || []).some((surface) => wanted.has(surface)))
      .map((item) => discussionCard(item.id))
      .join("");
  }

  function auditStripHtml(element, options) {
    const events = DC.audit ? DC.audit.readEvents() : [];
    const last = events.slice(-3).reverse();
    const href = options.oversightHref || config.oversightHref;
    return `<div class="dc-audit-inner">
      <span class="dc-audit-title">Audit log</span>
      <ol class="dc-audit-last" aria-live="polite" aria-label="Latest audit events">
        ${last.length
          ? last.map((event) => `<li><time>${escapeHtml(shortTime(event.ts))}</time> <span class="dc-audit-role">${escapeHtml(event.role)}</span> ${escapeHtml(describeEvent(event))}</li>`).join("")
          : "<li>No events yet. Every search, view, expansion and export is written here.</li>"}
      </ol>
      <span class="dc-audit-count">${escapeHtml(`${events.length} event${events.length === 1 ? "" : "s"}`)}</span>
      <a class="dc-strip-link" href="${escapeHtml(href)}">Open Oversight →</a>
    </div>`;
  }

  function draw(element) {
    const entry = strips.get(element);
    if (!entry) return;
    if (!document.contains(element)) {
      strips.delete(element);
      return;
    }
    const focusedDc = element.contains(document.activeElement) ? document.activeElement.dataset.dc : null;
    element.innerHTML = entry.type === "session" ? sessionStripHtml(element, entry.options) : auditStripHtml(element, entry.options);
    if (focusedDc) {
      const again = element.querySelector(`[data-dc="${focusedDc}"]`);
      if (again) again.focus();
    }
  }

  function redrawAll() {
    [...strips.keys()].forEach(draw);
  }

  function listen() {
    if (listening) return;
    listening = true;
    if (DC.session) DC.session.onChange(redrawAll);
    if (DC.audit) DC.audit.onChange(redrawAll);
    if (DC.governance) DC.governance.onInit(redrawAll);
  }

  function register(element, type, options) {
    if (!element) return;
    const opts = { ...(options || {}) };
    if (opts.surface && DC.session && !DC.session.surface()) DC.session.setSurface(opts.surface);
    if (!element.dataset.dcStripId) element.dataset.dcStripId = `dc-strip-${(stripCounter += 1)}`;
    element.classList.add(type === "session" ? "dc-session-strip" : "dc-audit-strip", themeClass(opts));
    element.classList.remove(themeClass(opts) === "dc-strip-light" ? "dc-strip-dark" : "dc-strip-light");
    if (type === "audit") element.setAttribute("role", "region");
    if (type === "audit") element.setAttribute("aria-label", "Audit log");
    if (!strips.has(element) && type === "session") {
      element.addEventListener("change", (event) => {
        const control = event.target.closest("[data-dc]");
        if (!control) return;
        const current = strips.get(element);
        if (control.dataset.dc === "role") {
          DC.session.setRole(control.value);
          if (current && typeof current.options.onRoleChange === "function") current.options.onRoleChange(control.value);
        } else if (control.dataset.dc === "purpose") {
          DC.session.setPurpose(control.value || null);
        } else if (control.dataset.dc === "instructor") {
          DC.session.setFlag("instructor", control.checked);
        } else if (control.dataset.dc === "strict") {
          DC.session.setFlag("strictCheckpoints", control.checked);
        } else if (control.dataset.dc === "karlsruhe" && DC.purposes) {
          DC.purposes.setEnabled(control.checked);
        } else if (control.dataset.dc === "failure-mode" && DC.session.setFailureMode) {
          DC.session.setFailureMode(control.value);
        }
      });
    }
    strips.set(element, { type, options: opts });
    // Drop strips whose elements were replaced by a re-render.
    [...strips.keys()].forEach((key) => {
      if (key !== element && !document.contains(key)) strips.delete(key);
    });
    listen();
    draw(element);
  }

  DC.ui = {
    configure(values) {
      Object.assign(config, values || {});
    },
    renderSessionStrip: (element, options) => register(element, "session", options),
    renderAuditStrip: (element, options) => register(element, "audit", options),
    honestyChip,
    markingChip,
    purposeChip,
    blockedCard,
    discussionCard,
    discussionCardsFor,
    leadFormula,
    leadScore,
    // Part of renderSessionStrip; also callable to place the toggle elsewhere (wired document-wide).
    karlsruheToggle(options) {
      wireStandaloneToggle();
      const session = DC.session.get();
      return karlsruheGroup(`dc-kt-${(stripCounter += 1)}`, session, options || {});
    },
    withheldCell,
    whyLine,
    displayId,
    EXCEPTION_LABEL,
    escapeHtml,
    describeEvent,
  };
})();
