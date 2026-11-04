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
      label = String(honestyId).startsWith("inv.") ? "Mirrors Gotham" : String(honestyId).startsWith("build.") ? "Mirrors Foundry" : "Mirrors Palantir";
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
    if (payload.outcome) parts.push(payload.outcome);
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
      <span class="dc-strip-spacer"></span>
      ${auditLink}
    </div>`;
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
    withheldCell,
    whyLine,
    escapeHtml,
    describeEvent,
  };
})();
