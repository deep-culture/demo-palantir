/*
 * foundry-demo/js/app-lineage.js: Build (Foundry-style), Lineage tab.
 *
 * One of the classic scripts that make up the Build app (split from the former 3,100-line app.js, review F-24).
 * They are loaded in order by foundry-demo/index.html and share one global script scope: top-level
 * functions, const and let declared in one file are visible in the others. Only app.js runs code at load
 * (init()); the other files only declare, apart from the UI state set up in js/app-state.js.
 */
"use strict";
// ------------------------------------------------------------------ lineage tab
/** Markings removed by a DPO override at ontology_entities or upstream (contract §6). */
function removedAtOntology() {
  if (!core("markings", "removedAtOntology")) return new Set();
  const result = safe("markings.removedAtOntology", () => window.DC.markings.removedAtOntology(), null);
  if (result instanceof Set) return result;
  return new Set(Array.isArray(result) ? result : []);
}

function entityMarkingBadges(list, removed) {
  if (!list || !list.length) return `<span class="text-muted">none</span>`;
  return list.map(m => markingBadge({ id: m }, { removed: removed.has(m) })).join(" ");
}

function renderEntityMarkings(entity, redacted) {
  const has = Array.isArray(entity.markings) || Array.isArray(entity.sourceMarkings) || entity.propertyMarkings;
  if (!has) return "";
  const roleId = currentRoleId();
  const propMarks = entity.propertyMarkings && typeof entity.propertyMarkings === "object" ? entity.propertyMarkings : {};
  const hiddenObject = objectWithheld(redacted);
  const removed = removedAtOntology();
  return `
    <div class="section-title mb-8">Markings</div>
    <table class="prop-table gov-table mb-12">
      <tbody>
        <tr><td>markings</td><td>${entityMarkingBadges(entity.markings || [], removed)} <span class="text-muted">needed to see that this object exists</span></td></tr>
        ${Array.isArray(entity.sourceMarkings) ? `<tr><td>sourceMarkings</td><td>${entityMarkingBadges(entity.sourceMarkings, removed)} <span class="text-muted">union of the datasets that contributed${removed.size ? "; markings tagged “removed” were lifted upstream by the data protection officer" : ""}</span></td></tr>` : ""}
        ${Object.entries(propMarks).map(([prop, ms]) => {
          const visible = roleId ? canSee(roleId, ms) && !hiddenObject : true;
          return `<tr><td>${esc(prop)}</td><td>${entityMarkingBadges(ms || [], removed)}${roleId ? ` <span class="${visible ? "text-muted" : "text-amber"}">${visible ? "visible to your role" : "withheld from your role"}</span>` : ""}</td></tr>`;
        }).join("")}
      </tbody>
    </table>`;
}

/** Leads as Lineage sidebar items ({e: {id, type: "Lead"}, v: label}); leads are not ontology objects. */
function leadLineageItems() {
  return allLeads().filter(l => l && l.id).map(l => {
    const v = leadView(l);
    return { e: { id: l.id, type: "Lead" }, v: v.person.withheld ? { text: "", withheld: v.person.withheld } : { text: `${v.person.text} · lead`, withheld: null } };
  });
}

function renderLineageMain() {
  const eid = ui.selectedEntityId;
  const chip = honestyChip("build.lineage");
  const lead = eid && /^lead::/.test(eid) ? leadById(eid) : null;
  if (lead) return renderLeadLineage(lead);
  if (!eid) {
    return `
    <div class="section-header"><div class="section-title">Lineage</div>${chip}</div>
    <div class="empty-state">
      <div class="empty-icon">⬡</div>
      <div>Search and select an object in the sidebar to view its lineage</div>
    </div>`;
  }

  const entities = getEntities();
  const entity = entities.find(e => e.id === eid);
  if (!entity) {
    return `<div class="empty-state"><div>Object not found: ${esc(eid)}</div></div>`;
  }
  const redacted = redact(entity);
  const hiddenObject = objectWithheld(redacted);

  const lineage = getLineage()[eid] || {};
  const transforms = getTransforms();
  const producedByTransform = transforms.find(t => t.id === lineage.producedBy)
    || transforms.find(t => t.output && (t.output === lineage.producedBy || t.id === lineage.producedBy))
    || { name: lineage.producedBy || "unknown", id: lineage.producedBy || "" };

  const sourceRows = lineage.sourceRows || [];
  const fieldProv = lineage.fieldProvenance || {};

  // Group source rows by dataset; datasets the role cannot open are counted by marking only.
  const byDataset = {};
  const withheldSrc = new Map(); // "HEALTH" -> Set of dataset refs
  sourceRows.forEach(ref => {
    const ds = ref.dataset || "unknown";
    const lacking = lackingMarkings(findDataset(ds));
    if (lacking.length) {
      const k = lacking.join(", ");
      if (!withheldSrc.has(k)) withheldSrc.set(k, new Set());
      withheldSrc.get(k).add(ds);
      return;
    }
    byDataset[ds] = byDataset[ds] || [];
    byDataset[ds].push(ref);
  });

  // Per-field provenance table rows (values read through the role's redaction)
  const props = redacted.properties || {};
  const fieldProvRows = [];
  const allFields = new Set([...Object.keys(props), ...Object.keys(fieldProv)]);
  allFields.forEach(field => {
    const val = hiddenObject ? { withheld: hiddenObject } : props[field];
    const refs = fieldProv[field] || [];
    const hidden = new Map(); // markings -> count of refs into datasets the role cannot open
    refs.forEach(ref => {
      const lacking = lackingMarkings(findDataset(ref.dataset));
      if (lacking.length) { const k = lacking.join(", "); hidden.set(k, (hidden.get(k) || 0) + 1); return; }
      fieldProvRows.push({ field, val, ref });
    });
    hidden.forEach((n, k) => fieldProvRows.push({ field, val, ref: null, withheld: { count: n, markings: k.split(", ") } }));
    if (!refs.length && val !== undefined && val !== null && val !== "") {
      fieldProvRows.push({ field, val, ref: null });
    }
  });
  const anyWithheldSource = withheldSrc.size > 0 || fieldProvRows.some(r => r.withheld);
  const idShown = displayId(eid, { withheld: Boolean(hiddenObject) });
  const idMasked = idShown !== eid;

  const label = hiddenObject || isWithheld(redacted.label) ? "" : (redacted.label || "");
  const titleHtml = label ? esc(label) : withheldCell(hiddenObject || (redacted.label && redacted.label.withheld) || []);
  const gothamHref = `../demo/index.html#object=${encodeURIComponent(eid)}&dataset=${encodeURIComponent(ui.datasetKey)}`;
  // A masked ID must not reappear in a visible link target, so the link becomes a button.
  const crossLink = idMasked
    ? `<button class="link-btn" data-action="open-investigate" data-id="${esc(eid)}" style="font-size:12px;">View ${label ? esc(label) : "this object"} in Investigate (Gotham-style) →</button>`
    : `<a href="${esc(gothamHref)}" target="_blank" rel="noopener" class="link-btn" style="font-size:12px;">
    View ${label ? esc(label) : "this object"} in Investigate (Gotham-style) →
  </a>`;

  return `
    <div class="section-header">
      <div class="section-title">${titleHtml}</div>
      <div class="section-sub"><span class="entity-type">${esc(entity.type)}</span> &nbsp; <span data-display-id title="${esc(idMasked ? (hiddenObject ? "ID withheld with the object" : "This ID contains a phone number (TELECOM); masked for your role") : "")}">${esc(idShown)}</span></div>
      ${chip}
    </div>
    ${hiddenObject ? whyLine(hiddenObject) : ""}

    <div class="section-title mb-8">Object properties</div>
    <table class="prop-table mb-12">
      <tbody>
        <tr><td>id</td><td>${esc(idShown)}${idMasked && !hiddenObject ? ` <span class="text-muted">(phone digits masked: TELECOM)</span>` : ""}</td></tr>
        <tr><td>type</td><td>${esc(entity.type)}</td></tr>
        ${Object.entries(props).map(([k, v]) => `
          <tr><td>${esc(k)}</td><td>${hiddenObject ? withheldCell(hiddenObject) : displayValue(v)}</td></tr>
        `).join("")}
      </tbody>
    </table>
    ${renderEntityMarkings(entity, redacted)}
    ${hiddenObject ? "" : renderResolution(entity)}

    <div class="section-title mb-8">Upstream source rows</div>
    <div class="lineage-tree mb-12">
      <div class="tree-node">
        <span class="tree-icon">◈</span>
        <span class="tree-label">${label ? esc(label) : esc(idShown)}</span>
        <span class="tree-meta">&nbsp;— ${esc(entity.type)}</span>
      </div>
      <div class="tree-children">
        <div class="tree-node">
          <span class="tree-icon">⬡</span>
          <span class="tree-label">
            ${lineage.producedBy
              ? `<button class="link-btn" data-action="goto-transform" data-id="${esc(producedByTransform.id || lineage.producedBy)}">${esc(producedByTransform.name || lineage.producedBy)}</button>`
              : "<span class='text-muted'>unknown transform</span>"
            }
          </span>
          <span class="tree-meta">&nbsp;transform</span>
        </div>
        <div class="tree-children">
          ${Object.entries(byDataset).map(([dsRef, refs]) => {
            const dsObj = findDataset(dsRef) || {};
            const rowNums = [...new Set(refs.map(r => r.row))].sort((a, b) => a - b);
            return `
              <div class="tree-node">
                <span class="tree-icon">▤</span>
                <span class="tree-label">
                  <button class="link-btn" data-action="goto-dataset" data-id="${esc(dsObj.id || dsRef)}">${esc(dsName(dsObj, dsRef))}</button>
                </span>
                ${dsObj.id && Array.isArray(dsObj.markings) ? `<span class="tree-marks">${markingBadges(effectiveMarkings(dsObj), { small: true })}</span>` : ""}
                <span class="tree-meta">&nbsp;rows: ${rowNums.join(", ")}</span>
              </div>`;
          }).join("")}
          ${Array.from(withheldSrc.entries()).map(([k, set]) => `
              <div class="tree-node tree-withheld">
                <span class="tree-icon">▤</span>
                ${withheldSources(set.size, k.split(", "))}
                <span class="tree-meta">&nbsp;dataset and row numbers hidden from your role</span>
              </div>`).join("")}
          ${sourceRows.length === 0
            ? `<div class="tree-node"><span class="tree-meta">No source rows recorded: ${esc(producedByTransform.name || lineage.producedBy || "the pipeline")} keeps no row lineage for ${esc(entity.type)} objects in this seed${transformInputsText(producedByTransform)}.</span></div>` : ""}
        </div>
      </div>
    </div>
    ${anyWithheldSource ? signalNote() : ""}

    <div class="section-title mb-8">Per-field provenance</div>
    <div class="scroll-x mb-12">
      <table class="data-table">
        <thead>
          <tr>
            <th>Field</th>
            <th>Value</th>
            <th>Source dataset</th>
            <th>Source row</th>
            <th>Source field</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          ${fieldProvRows.map(({ field, val, ref, withheld }) => {
            if (withheld) {
              return `<tr class="prov-withheld"><td>${esc(field)}</td><td>${displayValue(val)}</td><td colspan="4">${withheldSources(withheld.count, withheld.markings, "source row")}</td></tr>`;
            }
            const dsObj = ref ? (findDataset(ref.dataset) || {}) : {};
            const rowIdx = ref ? ref.row : null;
            return `<tr class="${ref ? "clickable" : ""}"
                        ${ref ? `data-action="goto-dataset-row" data-id="${esc(dsObj.id || ref.dataset || "")}" data-row="${rowIdx}"` : ""}>
              <td>${esc(field)}</td>
              <td>${displayValue(val)}</td>
              <td>${ref ? `<button class="link-btn" data-action="goto-dataset" data-id="${esc(dsObj.id || ref.dataset || "")}">${esc(dsName(dsObj, ref.dataset || ""))}</button>` : ""}</td>
              <td>${ref && rowIdx != null ? rowIdx : ""}</td>
              <td>${ref ? esc(ref.field || "") : ""}</td>
              <td>${ref ? esc(ref.note || "") : ""}</td>
            </tr>`;
          }).join("")}
          ${fieldProvRows.length === 0
            ? `<tr><td colspan="6" class="text-muted" style="padding:8px;">No field provenance recorded</td></tr>` : ""}
        </tbody>
      </table>
    </div>

    <div class="mt-8">${crossLink}</div>
  `;
}

/** " (it reads a, b and c)" for the no-row-lineage message, or "". */
function transformInputsText(t) {
  const inputs = t && Array.isArray(t.inputs) ? t.inputs : [];
  if (!inputs.length) return "";
  const names = inputs.map(id => dsName(getDataset(id), id));
  return `; it reads ${names.length > 3 ? names.slice(0, 3).join(", ") + ` and ${names.length - 3} more` : names.join(", ")}`;
}
