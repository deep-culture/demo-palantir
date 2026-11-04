// demo/js/render/banners.js — Banners and notes: saved-edits/deep-link banner, withheld notes, phone-search hold.
import { escapeHtml } from "../util.js";
import { core, data, roleView, store, storeNotice, ui } from "../state.js";
import { phoneSearchHeld } from "../governance.js";

export function renderStoreBanner() {
  if (!storeNotice) return "";
  if (storeNotice.kind === "schema-changed") {
    return `
        <div class="store-banner" role="status">
          <p>The data format changed; earlier edits were cleared.</p>
          <div class="store-banner-actions">
            <button class="button-secondary" data-action="dismiss-store-notice">Dismiss</button>
          </div>
        </div>
      `;
  }
  if (storeNotice.kind === "withheld-object") {
    return `
        <div class="store-banner" role="status">
          <div>
            <p>The link pointed to <code>${escapeHtml(storeNotice.objectId)}</code>, which is withheld from your role. ${core.ui.withheldCell(storeNotice.markings)}</p>
            ${core.ui.whyLine(storeNotice.markings, roleView.roleId)}
          </div>
          <div class="store-banner-actions">
            <button class="button-secondary" data-action="dismiss-store-notice">Dismiss</button>
          </div>
        </div>
      `;
  }
  if (storeNotice.kind === "missing-object") {
    return `
        <div class="store-banner" role="status">
          <p>The link pointed to <code>${escapeHtml(storeNotice.objectId)}</code>, which is not in the ${escapeHtml(String(ui.datasetKey).toUpperCase())} dataset.</p>
          <div class="store-banner-actions">
            <button class="button-secondary" data-action="dismiss-store-notice">Dismiss</button>
          </div>
        </div>
      `;
  }
  return `
      <div class="store-banner" role="status">
        <p>The data was regenerated since your last visit. Your earlier edits are saved — restore them, or dismiss to keep the new data.</p>
        <div class="store-banner-actions">
          <button class="button-secondary" data-action="restore-saved-edits">Restore them</button>
          <button class="button-secondary" data-action="dismiss-store-notice">Dismiss</button>
        </div>
      </div>
    `;
}

export function withheldNoteHtml(info, subject) {
  if (!info || (!info.links && !info.objects)) return "";
  const parts = [];
  if (info.objects) parts.push(`${info.objects} linked object${info.objects === 1 ? "" : "s"}`);
  if (info.links) parts.push(`${info.links} link${info.links === 1 ? "" : "s"}`);
  return `
      <div class="withheld-note">
        <div>${core.ui.withheldCell(info.markings)} <span>${escapeHtml(`${parts.join(" and ")} ${subject || ""} withheld from your role`)}</span></div>
        ${info.markings.length ? core.ui.whyLine(info.markings, roleView.roleId) : ""}
      </div>
    `;
}

export function renderPhoneHold(scope, query) {
  if (!phoneSearchHeld(query)) return "";
  return `
      <div class="phone-hold" role="status">
        <span>“${escapeHtml(query.trim())}” looks like a phone number. Searching by phone number needs a Checkpoint.</span>
        <button class="button-secondary" data-action="phone-search" data-scope-name="${escapeHtml(scope)}">Search by phone number…</button>
      </div>
    `;
}
