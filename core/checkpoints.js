/*
 * core/checkpoints.js — purpose justification before sensitive operations (spec §4.3, F3).
 *
 * Classic script; attaches window.DC.checkpoints. Load after governance, session, audit.
 *
 *   DC.checkpoints.withCheckpoint(checkpointIdOrTrigger, {surface, objectIds, datasetId, summary}, fn)
 *     -> Promise<{outcome, record, result}>
 *
 *   Looks the checkpoint up by id ("cp-export") or by trigger ("export.json").
 *   - Role not in allowedRoles: shows refusalText, writes a "checkpoint" event with
 *     outcome "refused"; fn never runs.
 *   - Otherwise shows the modal (purple header, the prompt, justification, purpose dropdown with the
 *     role's purposes, Continue / Cancel). Default validation: justification not empty — that is the
 *     lesson. With flags.strictCheckpoints (or checkpoint.requiresPurpose) a purpose is required, and
 *     strict also needs >= 40 characters.
 *   - Continue writes the "checkpoint" event (outcome "continued") and only then runs fn(record).
 *     Cancel / Esc writes outcome "cancelled".
 *   - No checkpoint defined (older seed without governance): fn runs directly, outcome "no-checkpoint".
 *
 *   record = {recordId: "cpr-YYYYMMDD-NNNN", checkpointId, trigger, promptText, justification,
 *             purpose, outcome, objectIds, datasetId, summary, eventId}
 *   The audit event: kind "checkpoint", verb = trigger, checkpointId = recordId,
 *   payload = {checkpoint, promptText, justification, purpose, outcome, summary}.
 *   Pass record.recordId as checkpointId on the event of the operation itself, so they join.
 *
 * Additions: isOpen(), STRICT_MIN_LENGTH.
 */
(function () {
  "use strict";

  const DC = (window.DC = window.DC || {});
  const STRICT_MIN_LENGTH = 40;
  let openDialog = null;
  let dialogCounter = 0;

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function recordId() {
    const now = new Date();
    const day = now.toISOString().slice(0, 10).replace(/-/g, "");
    const count = DC.audit ? DC.audit.readEvents({ kind: "checkpoint" }).length + 1 : 1;
    return `cpr-${day}-${String(count).padStart(4, "0")}`;
  }

  function focusables(container) {
    return [...container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
      (element) => !element.disabled && element.offsetParent !== null
    );
  }

  function trapKeys(dialog, onEscape) {
    return (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onEscape();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables(dialog);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    };
  }

  function mount(html, onEscape) {
    const previousFocus = document.activeElement;
    const backdrop = document.createElement("div");
    backdrop.className = "dc-modal-backdrop";
    backdrop.innerHTML = html;
    document.body.appendChild(backdrop);
    const dialog = backdrop.querySelector(".dc-modal");
    const handler = trapKeys(dialog, onEscape);
    document.addEventListener("keydown", handler, true);
    openDialog = backdrop;
    return {
      backdrop,
      dialog,
      close() {
        document.removeEventListener("keydown", handler, true);
        backdrop.remove();
        openDialog = null;
        if (previousFocus && document.contains(previousFocus) && typeof previousFocus.focus === "function") {
          previousFocus.focus();
        }
      },
    };
  }

  function header(id, title) {
    const chip = DC.ui && DC.ui.honestyChip ? DC.ui.honestyChip("session.checkpoints", { onDark: true }) : "";
    return `
      <header class="dc-modal-head dc-on-dark">
        <div class="dc-modal-kicker">Checkpoint ${chip}</div>
        <h2 id="${id}-title"><span class="dc-highlight">${escapeHtml(title)}</span></h2>
      </header>`;
  }

  function itemsBlock(context) {
    const ids = (context.objectIds || []).filter(Boolean);
    if (!context.summary && !ids.length && !context.datasetId) return "";
    const shown = ids.slice(0, 6).map((id) => `<code>${escapeHtml(id)}</code>`).join(" ");
    return `
      <div class="dc-modal-items">
        <div class="dc-modal-label">Items involved</div>
        ${context.summary ? `<div>${escapeHtml(context.summary)}</div>` : ""}
        ${context.datasetId ? `<div>Dataset <code>${escapeHtml(context.datasetId)}</code></div>` : ""}
        ${ids.length ? `<div class="dc-modal-ids">${shown}${ids.length > 6 ? ` <span>+${ids.length - 6} more</span>` : ""}</div>` : ""}
      </div>`;
  }

  function writeRecord(checkpoint, context, fields) {
    const record = {
      recordId: recordId(),
      checkpointId: checkpoint.id,
      trigger: checkpoint.trigger || checkpoint.id,
      promptText: fields.promptText,
      justification: fields.justification || "",
      purpose: fields.purpose || null,
      outcome: fields.outcome,
      objectIds: (context.objectIds || []).filter(Boolean),
      datasetId: context.datasetId || null,
      summary: context.summary || "",
      eventId: null,
    };
    if (!DC.audit) return Promise.resolve(record);
    return DC.audit
      .logEvent({
        surface: context.surface,
        kind: "checkpoint",
        verb: record.trigger,
        objectIds: record.objectIds,
        datasetId: record.datasetId,
        checkpointId: record.recordId,
        payload: {
          checkpoint: checkpoint.id,
          promptText: record.promptText,
          justification: record.justification,
          purpose: record.purpose,
          outcome: record.outcome,
          summary: record.summary,
        },
      })
      .then((event) => {
        record.eventId = event ? event.id : null;
        return record;
      });
  }

  function showRefusal(checkpoint, context, role) {
    const id = `dc-cp-${(dialogCounter += 1)}`;
    const text = checkpoint.refusalText || "Your role cannot perform this operation. This attempt has been logged.";
    return new Promise((resolve) => {
      let view = null;
      let recordPromise = null;
      const finish = () => {
        view.close();
        recordPromise.then(resolve);
      };
      view = mount(
        `<div class="dc-modal dc-modal-refusal" role="alertdialog" aria-modal="true" aria-labelledby="${id}-title" aria-describedby="${id}-prompt" data-checkpoint="${escapeHtml(checkpoint.id)}">
          ${header(id, "Not permitted for your role")}
          <div class="dc-modal-body">
            <p class="dc-modal-prompt" id="${id}-prompt">${escapeHtml(text)}</p>
            <p class="dc-modal-note">Role: ${escapeHtml(role ? role.label : DC.session.get().role)}. Roles allowed: ${escapeHtml(
              (checkpoint.allowedRoles || []).map((roleId) => (DC.governance.role(roleId) || { label: roleId }).label).join(", ") || "none"
            )}.</p>
            ${itemsBlock(context)}
          </div>
          <footer class="dc-modal-foot"><button type="button" class="dc-btn dc-btn-primary" data-dc="ok">OK</button></footer>
        </div>`,
        finish
      );
      view.dialog.querySelector('[data-dc="ok"]').addEventListener("click", finish);
      view.dialog.querySelector('[data-dc="ok"]').focus();
      // The text recorded is the text shown.
      view.promptText = view.dialog.querySelector(".dc-modal-prompt").textContent;
      recordPromise = writeRecord(checkpoint, context, { promptText: view.promptText, outcome: "refused" });
    });
  }

  function showPrompt(checkpoint, context, role, session) {
    const id = `dc-cp-${(dialogCounter += 1)}`;
    const strict = Boolean(session.flags && session.flags.strictCheckpoints);
    const needsPurpose = strict || Boolean(checkpoint.requiresPurpose);
    const minLength = Number(checkpoint.minLength) || 0;
    const purposes = ((role && role.purposes) || []).map((purposeId) => DC.governance.purpose(purposeId) || { id: purposeId, label: purposeId });
    const preselect = session.purpose && purposes.some((purpose) => purpose.id === session.purpose) ? session.purpose : "";
    return new Promise((resolve) => {
      let view = null;
      let busy = false;
      const cancel = () => {
        if (busy) return;
        busy = true;
        const promptText = view.dialog.querySelector(".dc-modal-prompt").textContent;
        const justification = view.dialog.querySelector("textarea").value;
        const purpose = view.dialog.querySelector("select").value || null;
        view.close();
        writeRecord(checkpoint, context, { promptText, justification, purpose, outcome: "cancelled" }).then((record) =>
          resolve({ outcome: "cancelled", record })
        );
      };
      view = mount(
        `<div class="dc-modal" role="dialog" aria-modal="true" aria-labelledby="${id}-title" aria-describedby="${id}-prompt" data-checkpoint="${escapeHtml(checkpoint.id)}">
          ${header(id, "State your purpose")}
          <form class="dc-modal-body" novalidate>
            <p class="dc-modal-prompt" id="${id}-prompt">${escapeHtml(checkpoint.prompt || "State the purpose of this operation.")}</p>
            ${itemsBlock(context)}
            <label class="dc-modal-label" for="${id}-just">Justification</label>
            <textarea id="${id}-just" rows="3" data-dc="justification" placeholder="Why do you need this?"></textarea>
            <label class="dc-modal-label" for="${id}-purpose">Purpose${needsPurpose ? " (required)" : ""}</label>
            <select id="${id}-purpose" data-dc="purpose">
              <option value="">— none —</option>
              ${purposes.map((purpose) => `<option value="${escapeHtml(purpose.id)}" ${purpose.id === preselect ? "selected" : ""}>${escapeHtml(purpose.label)}</option>`).join("")}
            </select>
            ${strict ? `<p class="dc-modal-note dc-modal-strict">Strict checkpoints are on: choose a purpose and write at least ${STRICT_MIN_LENGTH} characters.</p>` : ""}
            <p class="dc-modal-error" role="alert" aria-live="assertive" data-dc="error"></p>
            <p class="dc-modal-note">The prompt as shown, your justification, the purpose and the items are written to the audit log before the operation runs. Role: ${escapeHtml(role ? role.label : session.role)}.</p>
            <footer class="dc-modal-foot">
              <button type="button" class="dc-btn" data-dc="cancel">Cancel</button>
              <button type="submit" class="dc-btn dc-btn-primary" data-dc="continue">Continue</button>
            </footer>
          </form>
        </div>`,
        cancel
      );
      const form = view.dialog.querySelector("form");
      const textarea = view.dialog.querySelector("textarea");
      const select = view.dialog.querySelector("select");
      const error = view.dialog.querySelector('[data-dc="error"]');
      view.dialog.querySelector('[data-dc="cancel"]').addEventListener("click", cancel);
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (busy) return;
        const justification = textarea.value.trim();
        const purpose = select.value || null;
        let problem = "";
        if (!justification) problem = "Write a justification to continue.";
        else if (needsPurpose && !purpose) problem = "Choose a purpose to continue.";
        else if (strict && justification.length < STRICT_MIN_LENGTH)
          problem = `Strict checkpoints need at least ${STRICT_MIN_LENGTH} characters (you wrote ${justification.length}).`;
        else if (minLength && justification.length < minLength)
          problem = `This checkpoint needs at least ${minLength} characters (you wrote ${justification.length}).`;
        if (problem) {
          error.textContent = problem;
          textarea.setAttribute("aria-invalid", "true");
          (needsPurpose && !purpose && justification ? select : textarea).focus();
          return;
        }
        busy = true;
        view.dialog.querySelectorAll("button").forEach((button) => (button.disabled = true));
        const promptText = view.dialog.querySelector(".dc-modal-prompt").textContent;
        writeRecord(checkpoint, context, { promptText, justification, purpose, outcome: "continued" }).then((record) => {
          view.close();
          resolve({ outcome: "continued", record });
        });
      });
      textarea.focus();
    });
  }

  async function withCheckpoint(checkpointIdOrTrigger, context, fn) {
    const ctx = { surface: (DC.session && DC.session.surface()) || "unknown", ...(context || {}) };
    const run = typeof fn === "function" ? fn : () => undefined;
    const checkpoint = DC.governance && DC.governance.checkpoint(checkpointIdOrTrigger);
    if (!checkpoint) {
      const result = await run(null);
      return { outcome: "no-checkpoint", record: null, result };
    }
    if (openDialog) return { outcome: "busy", record: null, result: undefined };
    const session = DC.session.get();
    const role = DC.governance.role(session.role);
    if (!(checkpoint.allowedRoles || []).includes(session.role)) {
      const record = await showRefusal(checkpoint, ctx, role);
      return { outcome: "refused", record, result: undefined };
    }
    const answer = await showPrompt(checkpoint, ctx, role, session);
    if (answer.outcome !== "continued") return { outcome: answer.outcome, record: answer.record, result: undefined };
    const result = await run(answer.record);
    return { outcome: "continued", record: answer.record, result };
  }

  DC.checkpoints = {
    STRICT_MIN_LENGTH,
    withCheckpoint,
    isOpen: () => Boolean(openDialog),
  };
})();
