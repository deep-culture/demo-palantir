// demo/js/render/resolution.js — Merged persons in Investigate (spec §4.6, F6): the "merged at 0.55 — 2 source
// identities" chip, the merge explanation (DC.resolution.explain) with signals and conflicting values,
// the Unmerge person Action, and the header's threshold chip.
import { escapeHtml } from "../util.js";
import { core, roleView } from "../state.js";
import { mergeChipText, resolutionActive } from "../resolution-view.js";
import { actionsActive, canRun } from "../actions-ui.js";

export function mergeChip(entity) {
  if (!entity || !entity._merge) return "";
  return `<span class="merge-chip" data-merged="${escapeHtml(entity.id)}" title="${escapeHtml(entity._merge.members.map((member) => `${member.label} (${member.id})`).join(" + "))}">${escapeHtml(mergeChipText(entity._merge))}</span>`;
}

function signalText(signal) {
  const weight = Number(signal.weight || 0);
  const sign = weight < 0 ? "−" : "+";
  return `<li class="${weight < 0 ? "signal-negative" : ""}" title="${escapeHtml(signal.note || "")}"><code>${escapeHtml(signal.id)}</code> ${escapeHtml(signal.label && signal.label !== signal.id ? signal.label : "")} <strong>${sign}${Math.abs(weight).toFixed(2)}</strong></li>`;
}

export function renderMergeSection(entity) {
  if (!entity || !entity._merge || !resolutionActive()) return "";
  const merge = entity._merge;
  const chain = core.resolution.explain(entity.id);
  const conflicts = Object.entries(merge.conflicts || {}).filter(([key]) => key !== "aliases");
  const unmerge = actionsActive() && core.actions.type("act-unmerge-person");
  return `
    <div class="insight-section merge-section">
      <div class="insight-label">Merged person</div>
      ${mergeChip(entity)}
      <div class="microcopy">Source identities: ${merge.members.map((member) => `${escapeHtml(member.label)} <code>${escapeHtml(member.id)}</code>${member.riskTag ? ` <span class="muted">(riskTag ${escapeHtml(member.riskTag)})</span>` : ""}`).join(" + ")}.</div>
      <div class="merge-explain">
        <div class="insight-label">Merge explanation</div>
        ${chain
          .map(
            (item) => `<div class="merge-step">
              <div><code>${escapeHtml(item.candidate.id)}</code> score <strong>${item.score.toFixed(2)}</strong> ≥ threshold ${Number(merge.threshold).toFixed(2)}</div>
              <ul class="signal-list">${item.signals.map(signalText).join("")}</ul>
              ${item.candidate.explanation ? `<div class="microcopy">${escapeHtml(item.candidate.explanation)}</div>` : ""}
            </div>`
          )
          .join("")}
      </div>
      ${conflicts.length
        ? `<div class="merge-conflicts"><div class="insight-label">Conflicting values (the representative's is shown)</div>${conflicts
            .map(([key, values]) => `<div><code>${escapeHtml(key)}</code>: ${values.map((value) => escapeHtml(value)).join(" | ")}</div>`)
            .join("")}</div>`
        : ""}
      <div class="microcopy">The watchlisted member's risk tag wins; links of every member now point to <code>${escapeHtml(entity.id)}</code>.</div>
      ${unmerge
        ? `<div class="inline-actions"><button class="button-secondary" data-action="open-action-drawer" data-id="${escapeHtml(entity.id)}" data-type-id="act-unmerge-person" ${canRun(unmerge) ? "" : `title="Not for your role"`}>Unmerge person…</button></div>`
        : ""}
    </div>`;
}

// Header chip: the shared threshold (set in Build → Resolution) and the merges it makes here.
export function renderThresholdChip() {
  if (!resolutionActive() || !roleView.resolution || !roleView.resolution.active) return "";
  const info = roleView.resolution;
  const config = core.resolution.config();
  const merged = info.mergedById.size;
  const isDefault = config && Number(info.threshold) === Number(config.defaultThreshold);
  const text = `resolution threshold ${Number(info.threshold).toFixed(2)}${isDefault ? " (default)" : ""} · ${merged} merged ${merged === 1 ? "person" : "people"}`;
  return `<span class="chip chip-threshold" data-threshold="${escapeHtml(String(info.threshold))}" title="${escapeHtml(core.resolution.FIXED_NOTE)}">${escapeHtml(text)}</span>`;
}
