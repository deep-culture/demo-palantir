/*
 * audit/oversight.js — the Oversight page (spec §3.2, §4.4 F4).
 *
 * Reads the shared audit log (dc-palantir:audit) written by Investigate and Build. Deliberately
 * outside both working surfaces: oversight is not a tab for the analyst. Opens only for roles with
 * canOpenOversight (DPO, auditor); every open and every refusal is itself logged.
 *
 * Shows: hash-chain status, a filterable event table, a per-object timeline, Checkpoint records,
 * a redaction toggle (the Raffinaderij exhibit), CSV/JSON export and the instructor "Clear audit".
 * Phase 2 (audit/oversight-actions.js): Action history with before/after and writebacks, resolution
 * events, the "exception records only" Checkpoint filter, and the Raffinaderij discussion card.
 * Fix round (audit/oversight-governance.js): marking overrides with Restore for the DPO, exceptions to
 * review; the chain status names truncation and head removal and claims a cap drop only when the cap was
 * reached; Clear audit shows only in Instructor mode and needs a 10-character reason (core enforces it);
 * phone-embedded object ids are masked for roles without TELECOM.
 * Phase 3 (audit/oversight-agent.js): agent runs (tool-call events grouped by run), bulk approvals
 * (action.approveAll with its count), object-set events; an "Agent run" filter (payload.runId).
 */
(function () {
  "use strict";

  const DC = window.DC || {};
  const MAX_ROWS = 500;
  const catalog = window.ontologySeedCatalog || {};
  const seed = catalog.starter || catalog[Object.keys(catalog)[0]] || {};
  DC.governance.init(seed.governance || null);
  if (DC.purposes && DC.purposes.registerSources) DC.purposes.registerSources(seed.sources || []);
  if (DC.purposes) DC.purposes.init((seed.governance && seed.governance.purposeRules) || []);
  if (DC.actions) DC.actions.init((seed.ontology && seed.ontology.actionTypes) || [], (seed.ontology && seed.ontology.externalSystems) || []);
  if (DC.resolution) DC.resolution.init(seed.resolution || null);
  DC.session.setSurface("oversight");
  DC.ui.configure({ oversightHref: "./index.html" });

  const state = {
    filters: { kind: "", role: "", surface: "", verb: "", objectId: "", runId: "" },
    redacted: false,
    exceptionsOnly: false,
    chain: null, // {ok, brokenAt, count, dropped}
    clearReason: "",
    notice: "",
  };
  const loggedOpen = new Set(); // role ids whose open/refusal was logged on this page load

  const root = document.getElementById("app");
  const esc = DC.ui.escapeHtml;

  // ── helpers ──
  function roleLabel(id) {
    const role = DC.governance.role(id);
    return role ? role.label : id;
  }

  function canOpen() {
    if (!DC.governance.isActive()) return true;
    const role = DC.session.role();
    return Boolean(role && role.canOpenOversight);
  }

  function formatTime(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso || "";
    return `${date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} ${date.toLocaleTimeString("en-GB")}`;
  }

  // Checkpoint events by record id, so an operation's row can show the justification it relied on.
  function checkpointIndex(events) {
    const index = new Map();
    events.forEach((event) => {
      if (event.kind === "checkpoint" && event.checkpointId) index.set(event.checkpointId, event);
    });
    return index;
  }

  function justificationFor(event, index) {
    const payload = event.payload || {};
    if (event.kind === "checkpoint") return payload.justification || "";
    if (payload.reason) return payload.reason;
    const record = event.checkpointId && index.get(event.checkpointId);
    return record ? (record.payload || {}).justification || "" : "";
  }

  function outcomeOf(event) {
    return (event.payload || {}).outcome || "";
  }

  function filteredEvents(all) {
    const f = state.filters;
    const verb = f.verb.trim().toLowerCase();
    return all.filter((event) => {
      if (f.kind && event.kind !== f.kind) return false;
      if (f.role && event.role !== f.role) return false;
      if (f.surface && event.surface !== f.surface) return false;
      if (verb && !String(event.verb || "").toLowerCase().includes(verb)) return false;
      if (f.objectId && !(event.objectIds || []).some((id) => id === f.objectId || DC.ui.displayId(id) === f.objectId)) return false;
      if (f.runId && !runMatches(event, f.runId)) return false;
      return true;
    });
  }

  // Phase 3: an agent run's events carry payload.runId (bulk approvals: payload.runIds).
  function runMatches(event, runId) {
    const payload = event.payload || {};
    return payload.runId === runId || (Array.isArray(payload.runIds) && payload.runIds.includes(runId));
  }

  function runIds(all) {
    return [...new Set(all.filter((event) => event.verb === "agent.query").map((event) => (event.payload || {}).runId).filter(Boolean))].reverse();
  }

  // Raffinaderij exhibit: about 99% of cells blacked out, the same cells every time.
  function keepVisible(key) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < key.length; index += 1) {
      hash ^= key.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash % 100 === 0;
  }

  function cell(content, key, extraClass = "") {
    const redact = state.redacted && !keepVisible(key);
    return `<td class="${extraClass}${redact ? " redacted" : ""}"${redact ? ' aria-label="redacted"' : ""}>${redact ? `<span>${content}</span>` : content}</td>`;
  }

  function cellInline(content, key) {
    const redact = state.redacted && !keepVisible(key);
    return redact ? `<span class="redacted-inline" aria-label="redacted"><span>${content}</span></span>` : content;
  }

  function isException(event) {
    return ((event.payload || {}).tags || []).includes("exception");
  }

  function objectButtons(ids) {
    const list = ids || [];
    if (!list.length) return "";
    const shown = list.slice(0, 3).map((id) => `<button type="button" class="obj-link" data-action="filter-object" data-id="${esc(DC.ui.displayId(id))}">${esc(DC.ui.displayId(id))}</button>`);
    return shown.join(" ") + (list.length > 3 ? ` <span class="muted">+${list.length - 3}</span>` : "");
  }

  function options(values, selected, allLabel, labelFn = (value) => value) {
    return [`<option value="">${esc(allLabel)}</option>`]
      .concat(values.map((value) => `<option value="${esc(value)}" ${value === selected ? "selected" : ""}>${esc(labelFn(value))}</option>`))
      .join("");
  }

  function uniq(events, field) {
    return [...new Set(events.map((event) => event[field]).filter(Boolean))].sort();
  }

  // ── logging the page's own use ──
  function logOpen() {
    const session = DC.session.get();
    if (loggedOpen.has(session.role)) return;
    loggedOpen.add(session.role);
    const allowed = canOpen();
    DC.audit.logEvent({ surface: "oversight", kind: "view", verb: "oversight.open", payload: { outcome: allowed ? "granted" : "refused" } });
  }

  // ── rendering ──
  function renderHeader() {
    return `
      <header class="topbar dc-band dc-on-dark">
        <a href="https://deep-culture.org/" title="Deep Culture project (opens in a new tab)" target="_blank" rel="noopener"><img class="dc-logo" src="../brand/logo-green-lines.png" alt="Deep Culture"></a>
        <div>
          <h1><span class="dc-highlight">Oversight</span></h1>
          <p class="subtitle">Who did what, under which role, and why. This page reads the one audit log both apps write to. It sits outside them on purpose: oversight is not a tab for the analyst.</p>
        </div>
        <nav class="actions" aria-label="Other surfaces">
          <a class="dc-home" href="../index.html#" title="Back to the home page"><span class="dc-home-icon" aria-hidden="true">⌂</span> Home</a>
          <a class="header-link" href="../demo/index.html">Investigate</a>
          <a class="header-link" href="../foundry-demo/index.html">Build</a>
        </nav>
      </header>
      <div id="session-slot"></div>
    `;
  }

  function renderRefusal() {
    const role = DC.session.role();
    const allowed = DC.governance.get().roles.filter((item) => item.canOpenOversight).map((item) => item.label);
    return `
      <main class="oversight-main">
        <section class="panel refusal" role="alert">
          <h2><span class="dc-highlight">Not for your role</span></h2>
          <p>Your role (${esc(role ? role.label : DC.session.get().role)}) cannot open Oversight. This attempt has been logged.</p>
          <p class="muted">Oversight opens for: ${esc(allowed.join(", ") || "nobody")}. Switch role in the strip above to continue — and notice that the switch is logged too.</p>
        </section>
      </main>
    `;
  }

  function renderStatus(all) {
    const chain = state.chain;
    let status = `<span class="chain chain-pending">Verifying hash chain…</span>`;
    if (chain && chain.ok) {
      const drops = [];
      if (chain.capDropped) drops.push(`${chain.capDropped} older events dropped (cap ${DC.audit.CAP} reached)`);
      if (chain.quotaDropped) drops.push(`${chain.quotaDropped} older events dropped (browser storage full)`);
      status = `<span class="chain chain-ok" data-chain="ok">Hash chain verified · ${chain.count} event${chain.count === 1 ? "" : "s"}${drops.length ? ` · ${drops.join(" · ")}` : ""}</span>`;
    } else if (chain) {
      status = `<span class="chain chain-broken" data-chain="broken" data-problem="${esc(chain.problem || "")}">${esc(chain.message || `Hash chain broken at ${chain.brokenAt} — an event was changed or removed`)}</span>`;
    }
    const alg = all.length ? all[all.length - 1].alg : "";
    return `
      <section class="panel status-row">
        <div class="status-main">
          ${status}
          ${alg ? `<span class="muted">${esc(alg === "sha256" ? "SHA-256" : "FNV-1a fallback (no crypto.subtle)")}</span>` : ""}
          ${DC.ui.honestyChip("oversight.audit", { onDark: true })}
        </div>
        <div class="status-actions">
          <label class="toggle"><input type="checkbox" data-action="toggle-redaction" ${state.redacted ? "checked" : ""}> Redact (Raffinaderij exhibit)</label>
          <button type="button" class="dc-btn" data-action="export-csv">Export CSV</button>
          <button type="button" class="dc-btn" data-action="export-json">Export JSON</button>
        </div>
        <p class="caption">Raffinaderij: the Dutch police investigations platform built on Palantir software since 2012. Buro Jansen &amp; Janssen first appealed for its documents in 2019; released after a 2023 court ruling, they came back about 99% redacted, and de Volkskrant reported on them. This page models tamper evidence; it is not tamper-proof storage.</p>
      </section>
    `;
  }

  function renderFilters(all) {
    const f = state.filters;
    const objectIds = [...new Set(all.flatMap((event) => (event.objectIds || []).map((id) => DC.ui.displayId(id))))].sort();
    return `
      <section class="panel filters" aria-label="Filters">
        <label>Kind <select data-filter="kind">${options(uniq(all, "kind"), f.kind, "All kinds")}</select></label>
        <label>Role <select data-filter="role">${options(uniq(all, "role"), f.role, "All roles", roleLabel)}</select></label>
        <label>Surface <select data-filter="surface">${options(uniq(all, "surface"), f.surface, "All surfaces")}</select></label>
        <label>Verb <input data-filter="verb" value="${esc(f.verb)}" placeholder="e.g. expand"></label>
        <label>Agent run <select data-filter="runId">${options(runIds(all), f.runId, "All runs")}</select></label>
        <label>Object <input data-filter="objectId" list="object-ids" value="${esc(f.objectId)}" placeholder="e.g. person::n5538219"></label>
        <datalist id="object-ids">${objectIds.map((id) => `<option value="${esc(id)}"></option>`).join("")}</datalist>
        <button type="button" class="dc-btn" data-action="clear-filters">Clear filters</button>
      </section>
    `;
  }

  function renderTimeline(events, index) {
    const objectId = state.filters.objectId;
    if (!objectId) return "";
    const touching = events.filter((event) => (event.objectIds || []).includes(objectId));
    const roles = [...new Set(touching.map((event) => event.role))];
    return `
      <section class="panel timeline" aria-label="Object timeline">
        <h2><span class="dc-highlight">Everyone who touched <code>${esc(objectId)}</code></span></h2>
        <p class="muted">${touching.length} event${touching.length === 1 ? "" : "s"} by ${roles.length} role${roles.length === 1 ? "" : "s"}${roles.length ? `: ${esc(roles.map(roleLabel).join(", "))}` : ""}. This list is itself a record about this person or thing. Who may read it?</p>
        <ol class="timeline-list">
          ${touching
            .map((event) => {
              const why = justificationFor(event, index);
              const key = `${event.id}:tl`;
              const redact = state.redacted && !keepVisible(key);
              return `<li class="${redact ? "redacted" : ""}"><span><time>${esc(formatTime(event.ts))}</time> <strong>${esc(roleLabel(event.role))}</strong> ${esc(event.verb)}${outcomeOf(event) ? ` (${esc(outcomeOf(event))})` : ""} on ${esc(event.surface)}${why ? ` — “${esc(why)}”` : ""}</span></li>`;
            })
            .join("") || "<li>No events.</li>"}
        </ol>
      </section>
    `;
  }

  function renderTable(events, index) {
    const rows = events.slice(-MAX_ROWS).reverse();
    return `
      <section class="panel" aria-label="Audit events">
        <div class="panel-head">
          <h2><span class="dc-highlight">Audit log</span></h2>
          <span class="muted">${events.length} matching event${events.length === 1 ? "" : "s"}${events.length > MAX_ROWS ? ` · newest ${MAX_ROWS} shown` : ""}</span>
        </div>
        <div class="table-wrap">
          <table class="audit-table">
            <thead><tr><th>#</th><th>Time</th><th>Role</th><th>Surface</th><th>Kind</th><th>Verb</th><th>Objects</th><th>Justification</th></tr></thead>
            <tbody>
              ${rows
                .map((event) => {
                  const outcome = outcomeOf(event);
                  return `<tr data-event="${esc(event.id)}" data-kind="${esc(event.kind)}">
                    ${cell(esc(event.id), `${event.id}:id`, "mono nowrap")}
                    ${cell(esc(formatTime(event.ts)), `${event.id}:ts`, "nowrap")}
                    ${cell(esc(roleLabel(event.role)), `${event.id}:role`)}
                    ${cell(esc(event.surface), `${event.id}:surface`)}
                    ${cell(`<span class="kind kind-${esc(event.kind)}">${esc(event.kind)}</span>`, `${event.id}:kind`)}
                    ${cell(`${esc(event.verb)}${outcome ? ` <span class="outcome outcome-${esc(outcome)}">${esc(outcome)}</span>` : ""}`, `${event.id}:verb`, "mono")}
                    ${cell(objectButtons(event.objectIds), `${event.id}:objects`, "objects")}
                    ${cell(esc(justificationFor(event, index)), `${event.id}:why`)}
                  </tr>`;
                })
                .join("") || `<tr><td colspan="8" class="muted">No events match.</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function renderCheckpoints(events) {
    const records = events.filter((event) => event.kind === "checkpoint" && (!state.exceptionsOnly || isException(event))).slice(-MAX_ROWS).reverse();
    return `
      <section class="panel" aria-label="Checkpoint records">
        <div class="panel-head">
          <h2><span class="dc-highlight">Checkpoint records</span></h2>
          <span class="muted">The prompt exactly as shown, the justification typed, and what happened next.</span>
          <label class="toggle"><input type="checkbox" data-action="toggle-exceptions" ${state.exceptionsOnly ? "checked" : ""}> Exception records only</label>
        </div>
        <div class="table-wrap">
          <table class="audit-table checkpoint-table">
            <thead><tr><th>Record</th><th>Time</th><th>Role</th><th>Checkpoint</th><th>Prompt as shown</th><th>Justification</th><th>Purpose</th><th>Outcome</th><th>Objects</th></tr></thead>
            <tbody>
              ${records
                .map((event) => {
                  const payload = event.payload || {};
                  const k = `${event.id}:cp`;
                  return `<tr data-record="${esc(event.checkpointId || "")}">
                    ${cell(esc(event.checkpointId || ""), `${k}:id`, "mono nowrap")}
                    ${cell(esc(formatTime(event.ts)), `${k}:ts`, "nowrap")}
                    ${cell(esc(roleLabel(event.role)), `${k}:role`)}
                    ${cell(esc(payload.checkpoint || event.verb), `${k}:cp`, "mono")}
                    ${cell(esc(payload.promptText || ""), `${k}:prompt`, "prompt")}
                    ${cell(payload.justification ? `“${esc(payload.justification)}”` : `<span class="muted">—</span>`, `${k}:why`)}
                    ${cell(esc(payload.purpose || "—"), `${k}:purpose`)}
                    ${cell(`<span class="outcome outcome-${esc(payload.outcome || "")}">${esc(payload.outcome || "")}</span>${isException(event) ? ` <span class="outcome outcome-exception">exception${payload.rule ? ` · ${esc(payload.rule)}` : ""}</span>` : ""}`, `${k}:outcome`)}
                    ${cell(objectButtons(event.objectIds), `${k}:objects`, "objects")}
                  </tr>`;
                })
                .join("") || `<tr><td colspan="9" class="muted">${state.exceptionsOnly ? "No exception records." : "No Checkpoint records yet."}</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function renderInstructor() {
    if (!(DC.session.instructorMode && DC.session.instructorMode())) {
      return `<section class="panel instructor" aria-label="Instructor"><p class="muted">Instructor controls (Clear audit) are hidden. Tick <strong>Instructor mode</strong> in the session strip to show them; the toggle is logged.</p></section>`;
    }
    const min = DC.audit.CLEAR_MIN_LENGTH || 10;
    return `
      <section class="panel instructor" aria-label="Instructor">
        <h2><span class="dc-highlight">Instructor</span></h2>
        <p class="muted">Clearing removes every event. The clear itself becomes the first event of the new log, with your reason (at least ${min} characters). Writing an old copy of the log back is detected: the log's newest sequence number is recorded.</p>
        <div class="instructor-row">
          <label>Reason <input data-field="clear-reason" value="${esc(state.clearReason)}" placeholder="e.g. start of seminar group B" minlength="${min}"></label>
          <button type="button" class="dc-btn dc-btn-danger" data-action="clear-audit">Clear audit (instructor)</button>
        </div>
        ${state.notice ? `<p class="notice" role="status">${esc(state.notice)}</p>` : ""}
      </section>
    `;
  }

  function render() {
    const focus = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.filter || document.activeElement.dataset.field : null;
    const caret = document.activeElement && typeof document.activeElement.selectionStart === "number" ? document.activeElement.selectionStart : null;
    logOpen();
    let body;
    if (!canOpen()) {
      body = renderRefusal();
    } else {
      const all = DC.audit.readEvents();
      const index = checkpointIndex(all);
      const events = filteredEvents(all);
      const p2 = window.DCOversight;
      const helpers = { esc, cell, cellInline, formatTime, roleLabel, objectButtons, maxRows: MAX_ROWS };
      body = `
        <main class="oversight-main${state.redacted ? " is-redacted" : ""}">
          ${DC.governance.isActive() ? "" : `<p class="notice">No governance block in the seed: the role gate is off.</p>`}
          ${renderStatus(all)}
          ${p2 ? p2.renderDiscussion() : ""}
          ${window.DCOversightGov ? window.DCOversightGov.renderMarkings(helpers) : ""}
          ${window.DCOversightGov ? window.DCOversightGov.renderExceptions(helpers) : ""}
          ${renderFilters(all)}
          ${renderTimeline(all, index)}
          ${renderTable(events, index)}
          ${p2 ? p2.renderActionHistory(helpers) : ""}
          ${p2 ? p2.renderResolution(helpers) : ""}
          ${p2 && p2.renderAgentPanels ? p2.renderAgentPanels(helpers, state.filters) : ""}
          ${renderCheckpoints(events)}
          ${renderInstructor()}
        </main>
      `;
    }
    root.innerHTML = `${renderHeader()}${body}`;
    DC.ui.renderSessionStrip(document.getElementById("session-slot"), { surface: "oversight", theme: "dark", oversightHref: "./index.html" });
    if (focus) {
      const again = root.querySelector(`[data-filter="${focus}"], [data-field="${focus}"]`);
      if (again) {
        again.focus();
        if (caret !== null && typeof again.setSelectionRange === "function") {
          try {
            again.setSelectionRange(caret, caret);
          } catch (_) {
            /* select elements */
          }
        }
      }
    }
  }

  function verify() {
    DC.audit.verifyChain().then((result) => {
      state.chain = result;
      render();
    });
  }

  // ── export ──
  function download(name, text, type) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  }

  function csvValue(value) {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function exportEvents(format) {
    const all = DC.audit.readEvents();
    const index = checkpointIndex(all);
    const events = filteredEvents(all);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    if (format === "csv") {
      const header = ["id", "ts", "sessionId", "role", "surface", "kind", "verb", "outcome", "objectIds", "datasetId", "checkpointId", "justification", "payload", "prevHash", "hash"];
      const lines = [header.join(",")].concat(
        events.map((event) =>
          [event.id, event.ts, event.sessionId, event.role, event.surface, event.kind, event.verb, outcomeOf(event), (event.objectIds || []).join(" "), event.datasetId, event.checkpointId, justificationFor(event, index), JSON.stringify(event.payload || {}), event.prevHash, event.hash]
            .map(csvValue)
            .join(",")
        )
      );
      download(`audit-${stamp}.csv`, lines.join("\n"), "text/csv");
    } else {
      download(`audit-${stamp}.json`, JSON.stringify({ exportedAt: new Date().toISOString(), filters: state.filters, chain: state.chain, events }, null, 2), "application/json");
    }
    DC.audit.logEvent({ surface: "oversight", kind: "export", verb: `audit.export.${format}`, payload: { count: events.length, filters: { ...state.filters } } });
  }

  // ── events ──
  root.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    if (window.DCOversightGov && window.DCOversightGov.handleClick(target, () => verify())) return;
    if (action === "filter-object") {
      state.filters.objectId = target.dataset.id;
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else if (action === "filter-run") {
      state.filters.runId = target.dataset.id || "";
      render();
    } else if (action === "clear-filters") {
      state.filters = { kind: "", role: "", surface: "", verb: "", objectId: "", runId: "" };
      render();
    } else if (action === "export-csv") {
      exportEvents("csv");
    } else if (action === "export-json") {
      exportEvents("json");
    } else if (action === "clear-audit") {
      const reason = state.clearReason.trim();
      DC.audit.clear(reason).then((result) => {
        if (result && result.refused) {
          state.notice = result.message;
        } else {
          state.clearReason = "";
          state.notice = "Audit log cleared. The clear is the first event of the new log.";
        }
        verify();
      });
    }
  });

  root.addEventListener("change", (event) => {
    const target = event.target;
    if (target.dataset.action === "toggle-exceptions") {
      state.exceptionsOnly = target.checked;
      render();
    } else if (target.dataset.action === "toggle-redaction") {
      state.redacted = target.checked;
      DC.audit.logEvent({ surface: "oversight", kind: "view", verb: "oversight.redaction", payload: { on: state.redacted } });
      render();
    } else if (target.dataset.filter && target.tagName === "SELECT") {
      state.filters[target.dataset.filter] = target.value;
      render();
    }
  });

  root.addEventListener("input", (event) => {
    const target = event.target;
    if (target.dataset.filter && target.tagName === "INPUT") {
      state.filters[target.dataset.filter] = target.value;
      render();
    } else if (target.dataset.field === "clear-reason") {
      state.clearReason = target.value;
    }
  });

  let pending = null;
  function scheduleRefresh() {
    clearTimeout(pending);
    pending = setTimeout(verify, 120);
  }
  DC.audit.onChange(scheduleRefresh);
  DC.session.onChange(() => render());

  render();
  verify();
})();
