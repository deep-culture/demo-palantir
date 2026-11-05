// demo/js/disclosure.js — What a "withheld" placeholder may still reveal (fix round, contract §2 A4).
//
// - displayId(id): ids that embed a phone number (person::c-silva-30131994523) are shown with the digits
//   masked to roles without TELECOM (DC.markings.displayId). The real id stays internal.
// - splitRefs(refs): resolution.mergedFrom references ("ping:PG-0002", "clinic:REG-0014") are filtered
//   by the marking of their source dataset; withheld ones are only counted ("2 records withheld"),
//   so the role does not learn which records, or which category, a person was matched from.
// - linkLabel / citeLabel: readable labels for citation chips (object label, or link type and target).
import { core, data, roleView } from "./state.js";
import { lackingMarkings } from "./governance.js";

export function displayId(id) {
  return core.markings && core.markings.displayId ? core.markings.displayId(id) : String(id ?? "");
}

// Record-reference prefixes used by the pipeline, mapped to their source dataset.
const REF_SOURCES = {
  ping: "mobile_location_pings.jsonl",
  flight: "flight_manifests.csv",
  company: "company_registry.csv",
  watchlist: "watchlist.csv",
  clinic: "clinic_registrations.csv",
  bank: "bank_transactions.csv",
  txn: "bank_transactions.csv",
};

function sourceOfRef(ref) {
  const prefix = String(ref || "").split(":")[0];
  const sources = (data && data.sources) || [];
  const id = REF_SOURCES[prefix];
  return sources.find((source) => source.id === id) || sources.find((source) => String(source.id).startsWith(prefix)) || null;
}

export function refMarkings(ref) {
  const source = sourceOfRef(ref);
  return source ? (source.markings || []).filter(Boolean) : [];
}

// {shown: [ref], withheld: n, markings: [marking]} for the current role.
export function splitRefs(refs) {
  const shown = [];
  const markings = new Set();
  let withheld = 0;
  (refs || []).filter(Boolean).forEach((ref) => {
    const lacking = roleView && roleView.active ? lackingMarkings(refMarkings(ref)) : [];
    if (lacking.length) {
      withheld += 1;
      lacking.forEach((marking) => markings.add(marking));
    } else shown.push(ref);
  });
  return { shown, withheld, markings: [...markings].sort() };
}

export function withheldRefsText(split) {
  if (!split || !split.withheld) return "";
  return `${split.withheld} record${split.withheld === 1 ? "" : "s"} withheld (marking ${split.markings.join(", ")})`;
}

function entityLabelOf(id) {
  const entity = (data.entities || []).find((item) => item.id === id);
  return entity ? entity.label : "";
}

export function linkLabel(edge) {
  const source = entityLabelOf(edge.source) || "?";
  const target = entityLabelOf(edge.target) || "?";
  return `${source} ${edge.type} ${target}`;
}

// Citation chip text: an object's label, a link's "type → target", or (for an id that resolves to nothing,
// e.g. a fabricated link) the id itself.
export function citeLabel(id) {
  const entity = (data.entities || []).find((item) => item.id === id);
  if (entity) return entity.label;
  const edge = (data.edges || []).find((item) => item.id === id);
  if (edge) return `${edge.type} → ${entityLabelOf(edge.target) || "?"}`;
  return displayId(id);
}

// A role-safe copy of any value for the JSON inspector and the export: mergedFrom lists keep only the
// references the role may see (plus a count), and phone-embedded ids are masked for roles without TELECOM.
export function safeForRole(value) {
  const walk = (item) => {
    if (Array.isArray(item)) return item.map(walk);
    if (!item || typeof item !== "object") return item;
    const out = {};
    Object.entries(item).forEach(([key, entry]) => {
      if (key === "mergedFrom" && Array.isArray(entry)) {
        const split = splitRefs(entry);
        out.mergedFrom = split.shown;
        if (split.withheld) out.mergedFromWithheld = { count: split.withheld, markings: split.markings };
      } else out[key] = walk(entry);
    });
    if (out.resolution && out.resolution.method === "ping-only" && roleView && roleView.active && lackingMarkings(["TELECOM"]).length) {
      out.resolution = { ...out.resolution, method: "withheld", note: out.resolution.note ? "withheld (marking TELECOM)" : out.resolution.note };
    }
    return out;
  };
  const copy = walk(value);
  if (!(core.markings && core.markings.hidesPhoneIds && core.markings.hidesPhoneIds())) return copy;
  return JSON.parse(JSON.stringify(copy ?? null).replace(/\d{9,}/g, "•••••"));
}
