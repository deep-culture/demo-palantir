// demo/js/render/object-sets.js — Object sets tab (spec §4.11 F11): list, members, versions with a diff, sharing.
import { escapeHtml } from "../util.js";
import { core, ui } from "../state.js";
import { currentRoleId } from "../governance.js";
import { entityById } from "../derive.js";
import { hiddenSetCount, selectedSet, setsActive, splitMembers, visibleSets } from "../object-sets.js";
import { honestyChip } from "./common.js";

function roleLabel(id) {
  return core.governance?.role(id)?.label || id;
}

function memberChip(id, set, removable) {
  const entity = entityById(id);
  return `<span class="set-member" data-member="${escapeHtml(id)}"><span class="muted">${escapeHtml(entity.type)}</span> ${escapeHtml(entity.label)}${
    removable ? `<button class="set-member-x" title="Remove from set" aria-label="Remove ${escapeHtml(entity.label)}" data-action="set-remove-member" data-id="${escapeHtml(set.id)}" data-member="${escapeHtml(id)}">×</button>` : ""
  }</span>`;
}

function idsLine(ids) {
  const split = splitMembers(ids);
  const shown = split.visible.map((id) => escapeHtml(entityById(id).label));
  return `${shown.join(", ") || "—"}${split.merged.length ? ` · ${split.merged.length} merged into another person` : ""}${split.withheld ? ` · <span class="chip-withheld">${split.withheld} withheld</span>` : ""}`;
}

function renderVersions(set) {
  const last = set.versions.length;
  const from = Math.min(Math.max(1, ui.setDiff.from || Math.max(1, last - 1)), last);
  const to = Math.min(Math.max(1, ui.setDiff.to || last), last);
  const diff = core.objectSets.diff(set, from, to);
  const options = (selected) => set.versions.map((v) => `<option value="${v.v}" ${v.v === selected ? "selected" : ""}>v${v.v}</option>`).join("");
  return `
    <h4>Versions</h4>
    <table class="set-versions"><thead><tr><th>v</th><th>When</th><th>By</th><th>Added</th><th>Removed</th></tr></thead><tbody>
      ${set.versions
        .map(
          (v) => `<tr><td>v${v.v}</td><td>${escapeHtml(new Date(v.ts).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" }))}</td><td>${escapeHtml(roleLabel(v.by))}</td><td>${(v.added || []).length}</td><td>${(v.removed || []).length}</td></tr>`
        )
        .join("")}
    </tbody></table>
    <div class="set-diff" data-set-diff="${from}-${to}">
      <label>Compare <select aria-label="Compare version" data-scope="set-diff" data-field="from">${options(from)}</select></label>
      <label>with <select aria-label="with version" data-scope="set-diff" data-field="to">${options(to)}</select></label>
      <div class="set-diff-row set-diff-added"><strong>+ ${diff.added.length} added</strong> ${idsLine(diff.added)}</div>
      <div class="set-diff-row set-diff-removed"><strong>− ${diff.removed.length} removed</strong> ${idsLine(diff.removed)}</div>
    </div>`;
}

function renderSharing(set) {
  const roles = core.governance?.get().roles || [];
  const owner = core.objectSets.canEdit ? core.objectSets.canEdit(set, currentRoleId()) : set.createdBy === currentRoleId();
  return `
    <h4>Shared with roles <span class="muted">(simulated)</span></h4>
    <div class="set-share">
      ${roles
        .filter((role) => role.id !== set.createdBy)
        .map(
          (role) => `<label><input type="checkbox" data-scope="set-share" data-id="${escapeHtml(set.id)}" data-role="${escapeHtml(role.id)}" ${(set.sharedWith || []).includes(role.id) ? "checked" : ""} ${owner ? "" : "disabled"}> ${escapeHtml(role.label)}</label>`
        )
        .join("")}
    </div>
    <p class="microcopy">${owner ? "Each role sees only the members its markings allow; the rest are counted as withheld." : `Only the creating role (${escapeHtml(roleLabel(set.createdBy))}) and the data protection officer change the sharing.`}</p>`;
}

function renderDetail(set) {
  if (!set) {
    return `<div class="property-card"><div class="empty-state">No object set yet. Save one from the Graph explorer (current view or search), from a rule in Analytics, or from an agent answer.</div></div>`;
  }
  const split = splitMembers(set.memberIds);
  const selected = ui.entityPicked ? entityById(ui.selectedEntityId) : null;
  const editable = core.objectSets.canEdit ? core.objectSets.canEdit(set, currentRoleId()) : true;
  return `
    <div class="property-card set-detail" data-set="${escapeHtml(set.id)}">
      <div class="list-item-title"><h3>${escapeHtml(set.name)}</h3><span class="muted">${escapeHtml(set.id)}</span></div>
      <p class="microcopy">Created by ${escapeHtml(roleLabel(set.createdBy))} from ${escapeHtml(set.source)} · ${set.memberIds.length} members · version ${set.versions.length}</p>
      <div class="chip-row">
        <span class="chip">${escapeHtml(`${split.visible.length} visible to your role`)}</span>
        ${split.merged.length ? `<span class="chip">${escapeHtml(`${split.merged.length} merged into another person at this threshold`)}</span>` : ""}
        ${split.withheld ? `<span class="chip chip-withheld" data-set-withheld="${split.withheld}">${escapeHtml(`${split.withheld} withheld`)}</span>` : ""}
      </div>
      ${editable ? "" : `<p class="set-viewonly" role="note" data-set-viewonly="true">View only: ${escapeHtml(roleLabel(set.createdBy))} shared this set with your role. Only the creating role and the data protection officer can change or delete it. Its membership may have been chosen from data your role cannot see (source: ${escapeHtml(set.source)}).</p>`}
      <div class="set-members">${split.visible.map((id) => memberChip(id, set, editable)).join("") || `<span class="muted">No member is visible to your role.</span>`}</div>
      <div class="inline-actions">
        ${editable ? `<button class="button-secondary" data-action="set-add-selected" data-id="${escapeHtml(set.id)}" ${selected ? "" : "disabled"}>${escapeHtml(selected ? `Add selected: ${selected.label}` : "Add selected object (select one first)")}</button>
        <button class="button-secondary" data-action="set-add-rule" data-id="${escapeHtml(set.id)}">Add hits of the selected rule</button>` : ""}
        <button class="button-primary" data-action="set-summarise" data-id="${escapeHtml(set.id)}">Summarise this set (agent)</button>
        ${editable ? `<button class="ghost-button" data-action="set-delete" data-id="${escapeHtml(set.id)}">Delete set</button>` : ""}
      </div>
      ${renderVersions(set)}
      ${renderSharing(set)}
    </div>`;
}

export function renderObjectSetsTool() {
  const header = `<div class="panel-header"><div><h2>Object sets${honestyChip("inv.object-sets")}</h2>
    <p class="microcopy">Saved lists of objects. Every change is a new version; sharing is by role. A list decides who gets looked at next.</p></div></div>`;
  if (!setsActive()) return `<div class="panel">${header}<div class="empty-state">Object sets need core/objectsets.js.</div></div>`;
  const sets = visibleSets();
  const set = selectedSet();
  const hidden = hiddenSetCount();
  return `
    <div class="panel">
      ${header}
      <div class="sets-layout">
        <div class="card-stack">
          <div class="property-card">
            <h3>Sets your role can open</h3>
            <div class="stack-list">
              ${sets
                .map((item) => {
                  const split = splitMembers(item.memberIds);
                  return `<button class="scenario-card ${set && item.id === set.id ? "active" : ""}" data-action="select-set" data-id="${escapeHtml(item.id)}">
                    <div class="list-item-title"><span>${escapeHtml(item.name)}</span><span class="muted">v${item.versions.length}</span></div>
                    <div class="microcopy">${escapeHtml(`${item.memberIds.length} members · ${split.withheld} withheld · by ${roleLabel(item.createdBy)}${(item.sharedWith || []).length ? ` · shared with ${item.sharedWith.map(roleLabel).join(", ")}` : ""}`)}</div>
                  </button>`;
                })
                .join("") || `<div class="fact-item">None yet.</div>`}
            </div>
            ${hidden ? `<p class="microcopy">${escapeHtml(`${hidden} other set${hidden === 1 ? " exists" : "s exist"} in this dataset, not shared with your role.`)}</p>` : ""}
          </div>
        </div>
        <div class="card-stack">${renderDetail(set)}</div>
      </div>
    </div>`;
}
