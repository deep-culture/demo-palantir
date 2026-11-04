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
    if (payload.outcome) parts.push(payload.outcome);
    if (payload.rule) parts.push(`rule ${payload.rule}`);
    if (event.kind === "resolution" && payload.to !== undefined) parts.push(`${payload.from} → ${payload.to}`);
    if (payload.query) parts.push(`“${String(payload.query).slice(0, 40)}”`);
    if (event.kind === "role" && payload.to) parts.push(`→ ${payload.to}`);
    if (event.objectIds && event.objectIds.length) parts.push(event.objectIds.length === 1 ? event.objectIds[0] : `${event.objectIds.length} objects`);
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
      <div class="dc-strip-group">
        <input type="checkbox" id="${id}-strict" data-dc="strict" ${session.flags.strictCheckpoints ? "checked" : ""}>
        <label for="${id}-strict" class="dc-strip-toggle">Strict checkpoints <span class="dc-strip-sub">(instructor)</span></label>
        ${honestyChip("session.checkpoints", { onDark: themeClass(options) === "dc-strip-dark" })}
      </div>
      ${karlsruheGroup(id, session, options)}
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
    const note = DC.purposes ? DC.purposes.legalBasisNote() : "";
    const exception = opts.exception
      ? `<p class="dc-blocked-exception">Exception granted under Checkpoint record <code>${escapeHtml(opts.exception)}</code>.</p>`
      : opts.buttonAttrs !== undefined
        ? `<button type="button" class="dc-btn dc-btn-blocked" ${opts.buttonAttrs}>Request exception</button>`
        : "";
    return `<div class="dc-blocked" role="alert" data-rule="${escapeHtml(rule.id)}" data-operation="${escapeHtml(opts.operation || result.operation || "")}">
      <div class="dc-blocked-head"><span class="dc-blocked-title">Blocked by rule ${escapeHtml(rule.id)}</span>${honestyChip("inv.karlsruhe")}</div>
      <p class="dc-blocked-rule">${escapeHtml(rule.text || "")}</p>
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
        } else if (control.dataset.dc === "strict") {
          DC.session.setFlag("strictCheckpoints", control.checked);
        } else if (control.dataset.dc === "karlsruhe" && DC.purposes) {
          DC.purposes.setEnabled(control.checked);
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
    // Part of renderSessionStrip; also callable to place the toggle elsewhere (wired document-wide).
    karlsruheToggle(options) {
      wireStandaloneToggle();
      const session = DC.session.get();
      return karlsruheGroup(`dc-kt-${(stripCounter += 1)}`, session, options || {});
    },
    withheldCell,
    whyLine,
    escapeHtml,
    describeEvent,
  };
})();
