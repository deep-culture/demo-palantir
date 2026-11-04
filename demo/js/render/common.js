// demo/js/render/common.js — Shared render helpers: honesty chip, panel header, severity class, form fields.
import { escapeHtml } from "../util.js";
import { core, data } from "../state.js";

export function honestyChip(honestyId) {
  return core.ui && honestyId ? core.ui.honestyChip(honestyId) : "";
}

export function renderPanelHeader(title, honestyId, description, actionsHtml = "") {
  return `
      <div class="panel-header">
        <div>
          <h2>${escapeHtml(title)}${honestyChip(honestyId)}</h2>
          ${description ? `<p class="microcopy">${escapeHtml(description)}</p>` : ""}
        </div>
        ${actionsHtml}
      </div>
    `;
}

export function severityClass(severity) {
  if (!severity) return "";
  const s = String(severity).toLowerCase();
  if (s === "high") return "severity-high";
  if (s === "medium") return "severity-medium";
  return "severity-low";
}

export function renderField(label, value, config = {}) {
  const type = config.type || "text";
  const attrs = [
    `value="${escapeHtml(value ?? "")}"`,
    config.scope ? `data-scope="${escapeHtml(config.scope)}"` : "",
    config.field ? `data-field="${escapeHtml(config.field)}"` : "",
    config.entityId ? `data-entity-id="${escapeHtml(config.entityId)}"` : "",
    config.propertyId ? `data-property-id="${escapeHtml(config.propertyId)}"` : "",
    config.disabled ? "disabled" : "",
    `type="${escapeHtml(type)}"`,
  ]
    .filter(Boolean)
    .join(" ");
  return `
      <div class="field">
        <label>${escapeHtml(label)}</label>
        <input ${attrs}>
      </div>
    `;
}

export function renderSelect(label, value, options, config = {}) {
  return `
      <div class="field">
        <label>${escapeHtml(label)}</label>
        <select
          ${config.scope ? `data-scope="${escapeHtml(config.scope)}"` : ""}
          ${config.field ? `data-field="${escapeHtml(config.field)}"` : ""}
          ${config.propertyId ? `data-property-id="${escapeHtml(config.propertyId)}"` : ""}
        >
          ${options
          .map(
            (option) => `
                <option value="${escapeHtml(option)}" ${String(option) === String(value) ? "selected" : ""}>
                  ${escapeHtml(option)}
                </option>
              `
          )
          .join("")}
        </select>
      </div>
    `;
}
