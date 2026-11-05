// demo/js/render/action-drawer.js — The Action drawer (form → role check → Checkpoint → purpose rules →
// before/after diff → writeback preview), the scenario "Action drawer" card, the inspector's Actions
// section, the External systems panel and the "Watchlist operators" footnote (spec §4.5, F5).
import { displayId } from "../disclosure.js";
import { escapeHtml } from "../util.js";
import { core, ui } from "../state.js";
import { currentRole, isWithheldValue } from "../governance.js";
import { entityById } from "../derive.js";
import {
  actionGate,
  actionsActive,
  actionTypesFor,
  canRun,
  drawerObject,
  previewAction,
  riskTaggedByActions,
} from "../actions-ui.js";
import { honestyChip } from "./common.js";

const ACTION_OBJECT_TYPES = ["Person", "BankAccount"];

function roleLabel(id) {
  const role = core.governance && core.governance.role(id);
  return role ? role.label : id;
}

function shortTime(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function show(value) {
  if (value === undefined || value === null || value === "") return `<span class="muted">—</span>`;
  if (isWithheldValue(value)) return core.ui.withheldCell(value.withheld);
  return escapeHtml(String(value));
}

// ── drawer ──
function renderParam(param, drawer) {
  const id = `ad-param-${param.id}`;
  const value = drawer.params[param.id] ?? "";
  const error = drawer.tried ? drawer.errors[param.id] : "";
  const label = `${escapeHtml(param.label || param.id)}${param.required ? ` <span class="muted">(required)</span>` : ""}${param.minLength ? ` <span class="muted">· at least ${param.minLength} characters</span>` : ""}`;
  let control;
  if (/candidate/i.test(param.id)) {
    // Filled from the merges applied to this object; shown, not typed.
    control = value
      ? `<input type="text" id="${id}" value="${escapeHtml(value)}" readonly class="readonly-param" aria-describedby="${id}-err"><p class="microcopy">Filled in from the merge currently applied to this person.</p>`
      : `<p class="microcopy" id="${id}">This person is not merged with anyone at the current threshold.</p>`;
    return `<div class="field"><label for="${id}">${label}</label>${control}<div class="field-error" id="${id}-err" role="alert">${error ? escapeHtml(error) : ""}</div></div>`;
  }
  if (param.type === "enum") {
    control = `<select id="${id}" data-scope="action-param" data-field="${escapeHtml(param.id)}" ${error ? 'aria-invalid="true"' : ""}>
        <option value="">— choose —</option>
        ${(param.options || []).map((option) => `<option value="${escapeHtml(option)}" ${option === value ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}
      </select>`;
  } else if (param.type === "boolean") {
    return `<div class="field field-inline"><input type="checkbox" id="${id}" data-scope="action-param" data-field="${escapeHtml(param.id)}" ${value === true ? "checked" : ""}><label for="${id}">${escapeHtml(param.label || param.id)}</label></div>`;
  } else {
    control = `<textarea id="${id}" rows="2" data-scope="action-param" data-field="${escapeHtml(param.id)}" ${error ? 'aria-invalid="true"' : ""} aria-describedby="${id}-err">${escapeHtml(value)}</textarea>`;
  }
  return `<div class="field"><label for="${id}">${label}</label>${control}<div class="field-error" id="${id}-err" role="alert">${error ? escapeHtml(error) : ""}</div></div>`;
}

function renderDiff(planned) {
  const keys = Object.keys(planned.after);
  const rows = keys.map(
    (key) => `<tr><th scope="row"><code>${escapeHtml(key)}</code></th><td class="diff-before">${show(planned.before[key])}</td><td class="diff-after">${show(planned.after[key])}</td></tr>`
  );
  planned.created.forEach((item) => {
    if (item.link) rows.push(`<tr class="diff-created"><th scope="row">+ link</th><td class="diff-before"><span class="muted">—</span></td><td class="diff-after"><code>${escapeHtml(item.link)}</code> → ${escapeHtml(String(item.target).replace("created:", "new "))}</td></tr>`);
    else rows.push(`<tr class="diff-created"><th scope="row">+ object</th><td class="diff-before"><span class="muted">—</span></td><td class="diff-after">${escapeHtml(item.type)} ${escapeHtml(Object.entries(item.properties).map(([k, v]) => `${k}=${v || "—"}`).join(", "))}</td></tr>`);
  });
  planned.deleted.forEach((item) => {
    rows.push(`<tr class="diff-deleted"><th scope="row">− ${escapeHtml(item.link || "object")}</th><td class="diff-before">${escapeHtml(`${item.type} ${item.label}`)}</td><td class="diff-after"><span class="muted">deleted</span></td></tr>`);
  });
  if (!rows.length) return `<p class="microcopy">No change to the ontology: this Action only notifies an external system.</p>`;
  return `<table class="action-diff"><thead><tr><th></th><th>Before</th><th>After</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

function renderWritebacks(list, delivered) {
  if (!list.length) return `<p class="microcopy">No writeback.</p>`;
  return `<div class="dc-systems writeback-preview">${list
    .map((item) => `<div><span class="wb-system">→ ${escapeHtml(item.systemLabel || (core.actions.system(item.system) || {}).label || item.system)}</span>${delivered ? ` <span class="wb-state">delivered ${escapeHtml(shortTime(item.deliveredTs || item.ts))}</span>` : ` <span class="wb-state">as it would be sent</span>`}<pre>${escapeHtml(item.message)}</pre></div>`)
    .join("")}</div>`;
}

function renderResult(result) {
  if (!result) return "";
  if (result.outcome === "applied" && result.instance) {
    const instance = result.instance;
    const writebacks = instance.writebacks.map((item) => ({ ...item, systemLabel: (core.actions.system(item.system) || {}).label }));
    return `<div class="action-result action-result-ok" role="status">
        <strong>Applied</strong> · <code>${escapeHtml(instance.id)}</code> by ${escapeHtml(roleLabel(instance.role))}${instance.checkpointRecordId ? ` under Checkpoint record <code>${escapeHtml(instance.checkpointRecordId)}</code>` : ""}.
        ${renderDiff({ before: instance.before, after: instance.after, created: [], deleted: [] })}
        ${renderWritebacks(writebacks, true)}
        <p class="microcopy">Return to Analytics: rules read the changed ontology on the next render.</p>
      </div>`;
  }
  const texts = {
    invalid: "Fix the fields marked above.",
    cancelled: "Cancelled at the Checkpoint. Nothing changed; the cancellation is logged.",
    refused: result.message || "Not permitted for your role. This attempt has been logged.",
    blocked: `Blocked by rule ${result.rule ? result.rule.id : ""}. This attempt has been logged.`,
    "not-applicable": `${result.message || "This Action does not apply here."} This attempt has been logged.`,
    busy: "Another Checkpoint is open.",
  };
  return `<div class="action-result action-result-no" role="alert">${escapeHtml(texts[result.outcome] || result.outcome)}</div>`;
}

export function renderActionDrawer() {
  const drawer = ui.actionDrawer;
  if (!drawer.open || !actionsActive()) return "";
  const entity = drawerObject();
  if (!entity) return "";
  const types = actionTypesFor(entity.type);
  const actionType = types.find((item) => item.id === drawer.typeId) || null;
  const role = currentRole();
  const merge = entity._merge;
  let body = `<p class="microcopy">No Action types for ${escapeHtml(entity.type)} objects.</p>`;
  if (actionType && drawer.result && drawer.result.outcome === "applied") {
    // After a run the drawer shows what happened, not a fresh preview.
    body = `
      <section class="action-form" aria-label="${escapeHtml(actionType.label)}">
        <h3>${escapeHtml(actionType.label)}</h3>
        ${renderResult(drawer.result)}
        <div class="inline-actions">
          <button class="button-secondary" data-action="select-action-type" data-type-id="${escapeHtml(actionType.id)}">Run another</button>
          <button class="button-primary" data-action="close-action-drawer">Close</button>
        </div>
      </section>`;
  } else if (actionType) {
    const allowed = canRun(actionType);
    const planned = previewAction(actionType, entity);
    const gate = actionGate(actionType, entity);
    const blocked = !gate.result.allowed && gate.result.effect === "block";
    const checkpointId = core.actions.checkpointFor(actionType);
    const checkpoint = checkpointId && core.governance.checkpoint(checkpointId);
    const purposeStep = !gate.result.enabled
      ? `<span>Karlsruhe mode is off: nothing is blocked; the purposes involved are logged.</span> ${(gate.result.purposes || []).map(core.ui.purposeChip).join(" ")}`
      : blocked
        ? core.ui.blockedCard(gate.result, { operation: "action", buttonAttrs: 'data-action="action-exception"' })
        : `<span>Allowed under the purpose rules${drawer.exceptRules.length ? ` (exception for ${escapeHtml(drawer.exceptRules.join(", "))}, record <code>${escapeHtml(drawer.exceptionRecordId || "")}</code>)` : ""}.</span> ${(gate.result.purposes || []).map(core.ui.purposeChip).join(" ")}`;
    body = `
      <section class="action-form" aria-label="${escapeHtml(actionType.label)}">
        <h3>${escapeHtml(actionType.label)}${actionType.sensitive ? ` <span class="chip chip-sensitive">sensitive</span>` : ""}</h3>
        <p class="microcopy">${escapeHtml(actionType.description || "")}</p>
        ${(actionType.parameters || []).map((param) => renderParam(param, drawer)).join("")}
        <ol class="action-steps">
          <li class="${allowed ? "step-ok" : "step-no"}"><span class="step-label">Role check</span> ${allowed
            ? `Your role (${escapeHtml(role ? role.label : "")}) may run this Action.`
            : `Your role (${escapeHtml(role ? role.label : "")}) cannot run this Action. Roles allowed: ${escapeHtml((actionType.allowedRoles || []).map(roleLabel).join(", "))}.`}</li>
          <li><span class="step-label">Checkpoint</span> ${checkpoint ? `<code>${escapeHtml(checkpoint.id)}</code>: you will be asked to state a purpose before anything changes.` : "None for this Action type."}</li>
          <li class="${blocked ? "step-no" : ""}"><span class="step-label">Purpose rules</span> ${purposeStep}</li>
          <li><span class="step-label">Before / after</span>${renderDiff(planned)}</li>
          <li><span class="step-label">Writeback</span>${renderWritebacks(planned.writebacks, false)}</li>
        </ol>
        ${planned.problems.map((text) => `<div class="action-problem" role="note">${escapeHtml(text)}</div>`).join("")}
        ${planned.notes.map((text) => `<div class="microcopy action-note">${escapeHtml(text)}</div>`).join("")}
        <div class="inline-actions">
          <button class="button-primary" data-action="run-action" ${allowed && !blocked && !planned.problems.length ? "" : "disabled"}${planned.problems.length ? ` title="This Action does not apply here (see above)"` : ""}>Run action</button>
          <button class="button-secondary" data-action="close-action-drawer">Close</button>
        </div>
        ${renderResult(drawer.result)}
      </section>`;
  }
  return `
    <div class="action-drawer-backdrop" data-action="close-action-drawer" aria-hidden="true"></div>
    <aside class="action-drawer" role="dialog" aria-modal="false" aria-labelledby="action-drawer-title">
      <header class="action-drawer-head dc-on-dark">
        <div class="action-drawer-kicker">Action drawer ${core.ui.honestyChip("inv.actions", { onDark: true })}</div>
        <h2 id="action-drawer-title"><span class="dc-highlight">${escapeHtml(entity.label || entity.id)}</span></h2>
        <div class="action-drawer-sub">${escapeHtml(entity.type)} · <code>${escapeHtml(displayId(entity.id))}</code>${merge ? ` · <span class="merge-chip">${escapeHtml(`merged at ${Number(merge.threshold).toFixed(2)} — ${merge.members.length} source identities`)}</span>` : ""}</div>
        <button class="action-drawer-close" data-action="close-action-drawer" aria-label="Close the Action drawer">×</button>
      </header>
      <div class="action-drawer-body">
        <div class="action-type-list" role="tablist" aria-label="Action types">
          ${types
            .map((item) => {
              const ok = canRun(item);
              return `<button role="tab" aria-selected="${item.id === drawer.typeId}" class="action-type ${item.id === drawer.typeId ? "active" : ""} ${ok ? "" : "not-permitted"}" data-action="select-action-type" data-type-id="${escapeHtml(item.id)}" title="${escapeHtml(ok ? item.description || "" : `Not for your role. Allowed: ${(item.allowedRoles || []).map(roleLabel).join(", ")}`)}">${escapeHtml(item.label)}${ok ? "" : ` <span class="muted">(not for your role)</span>`}</button>`;
            })
            .join("")}
        </div>
        ${body}
      </div>
    </aside>`;
}

// ── buttons that open the drawer ──
function actionButtons(entity) {
  return actionTypesFor(entity.type)
    .map((item) => {
      const ok = canRun(item);
      return `<button class="ghost-button ${ok ? "" : "not-permitted"}" data-action="open-action-drawer" data-id="${escapeHtml(entity.id)}" data-type-id="${escapeHtml(item.id)}" title="${escapeHtml(ok ? item.description || "" : "Not for your role")}">${escapeHtml(item.label)}</button>`;
    })
    .join("");
}

function recentFor(ids) {
  const set = new Set(ids);
  return core.actions
    .log({ datasetId: ui.datasetKey })
    .filter((item) => set.has(item.objectId))
    .slice(-5)
    .reverse();
}

// Investigations: replaces the "Recommended actions" card when the seed defines Action types.
export function renderActionCard(scenario) {
  const focus = scenario.focusEntityIds.map(entityById).filter((entity) => entity && ACTION_OBJECT_TYPES.includes(entity.type));
  const accounts = scenario.graph.nodes.filter((node) => node.type === "BankAccount" && !focus.some((item) => item.id === node.id)).slice(0, 3);
  const objects = focus.slice(0, 3).concat(accounts);
  const recent = recentFor(objects.map((entity) => entity.id));
  return `
    <div class="property-card action-card">
      <h3>Action drawer${honestyChip("inv.actions")}</h3>
      <p class="microcopy">Actions are typed, permissioned and logged: each asks for parameters, checks your role, may stop at a Checkpoint, shows a before/after diff and the message it sends to an external system.</p>
      ${objects.length
        ? objects
            .map(
              (entity) => `<div class="action-card-object"><div class="list-item-title"><span>${escapeHtml(entity.label)}</span><span class="muted">${escapeHtml(entity.type)}</span></div><div class="inline-actions">${actionButtons(entity)}</div></div>`
            )
            .join("")
        : `<div class="action-log-empty">No Person or Bank Account in this case's focus.</div>`}
      <div class="action-log">
        ${recent.length
          ? recent.map((item) => `<div class="action-log-entry"><span class="action-log-ts">${escapeHtml(shortTime(item.ts))}</span> — ${escapeHtml(item.label)} on ${escapeHtml(item.objectLabel)} <span class="muted">(${escapeHtml(roleLabel(item.role))})</span></div>`).join("")
          : `<div class="action-log-empty">No Actions on these objects yet.</div>`}
      </div>
    </div>`;
}

// Inspector: the Actions section for a Person or Bank Account.
export function renderInspectorActions(entity) {
  if (!actionsActive() || !entity || !ACTION_OBJECT_TYPES.includes(entity.type) || !actionTypesFor(entity.type).length) return "";
  return `
    <div class="insight-section inspector-actions">
      <div class="insight-label">Actions ${honestyChip("inv.actions")}</div>
      <div class="inline-actions">${actionButtons(entity)}</div>
    </div>`;
}

// Inspector: the simulated receivers' inboxes (black, monospace).
export function renderExternalSystems() {
  if (!actionsActive()) return "";
  const systems = core.actions.systems();
  if (!systems.length) return "";
  const selected = ui.selectedEntityId || ui.selectedGraphNodeId;
  return `
    <div class="panel dc-systems external-systems" aria-label="External systems">
      <h3>External systems ${core.ui.honestyChip("inv.actions", { onDark: true })}</h3>
      <p class="systems-note">Simulated receivers. In a real deployment a writeback reaches an operational system; here it lands in an inbox.</p>
      ${systems
        .map((system) => {
          const items = core.actions.inbox(system.id).slice(0, 4);
          return `<h4 data-system="${escapeHtml(system.id)}">${escapeHtml(system.label)}</h4>
            <ul class="dc-inbox" data-inbox="${escapeHtml(system.id)}">
              ${items.length
                ? items.map((item) => `<li class="${item.objectId === selected ? "is-mine" : ""}"><time>${escapeHtml(shortTime(item.ts))}</time>${escapeHtml(item.message)}</li>`).join("")
                : `<li class="dc-inbox-empty">empty</li>`}
            </ul>`;
        })
        .join("")}
    </div>`;
}

// Analytics: under "Watchlist operators".
export function renderActionFootnote(rule) {
  if (!actionsActive() || !rule || rule.id !== "watchlist-operators") return "";
  const count = riskTaggedByActions(true).length;
  return `<p class="rule-footnote" data-footnote="actions">* ${escapeHtml(`${count} object${count === 1 ? "" : "s"} risk-tagged by Actions in this session`)}. The rule cannot tell an Action's tag from a source tag: the analysis feeds on what it produced.</p>`;
}
