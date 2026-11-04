// demo/js/resolution-view.js — Entity resolution applied before the role view (spec §4.6, §6.3; contract §2).
// DC.resolution.resolveAt() merges candidate pairs at or above the shared threshold; here each merged
// cluster becomes one Person: the union of the members' properties (the watchlisted member's riskTag
// wins, other conflicts keep the representative's value and are listed), the union of markings and
// sources, and every link remapped to the cluster representative. fullData itself is never changed,
// so an unmerge or a higher threshold restores the separate people.
import { core } from "./state.js";

const EMPTY_INFO = Object.freeze({ active: false, threshold: null, mergedById: new Map(), repOf: new Map(), merges: [] });

export function resolutionActive() {
  return Boolean(core.resolution && core.resolution.isActive());
}

function nonEmpty(value) {
  return value !== undefined && value !== null && value !== "" && !(typeof value === "object" && !Array.isArray(value));
}

function union(...lists) {
  return [...new Set(lists.flat().filter(Boolean))];
}

function splitAliases(value) {
  return String(value || "")
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
}

function mergePersons(rep, members, threshold, merges) {
  const others = members.filter((member) => member.id !== rep.id);
  const keys = union(...members.map((member) => Object.keys(member.properties || {})));
  const properties = {};
  const conflicts = {};
  keys.forEach((key) => {
    const values = [...new Set(members.map((member) => member.properties?.[key]).filter(nonEmpty).map(String))];
    if (key === "aliases") {
      const names = others.map((member) => member.properties?.canonicalName || member.label).filter(Boolean);
      properties[key] = union(splitAliases(rep.properties?.aliases), ...others.map((member) => splitAliases(member.properties?.aliases)), names)
        .filter((alias) => alias !== (rep.properties?.canonicalName || rep.label))
        .join(" | ");
      return;
    }
    const own = rep.properties?.[key];
    if (key === "riskTag") {
      // The representative is the watchlisted member when there is one: its tag wins.
      properties[key] = nonEmpty(own) ? own : values[0] || "";
    } else {
      properties[key] = nonEmpty(own) ? own : values[0] ?? own ?? "";
    }
    if (values.length > 1) conflicts[key] = values;
  });
  const propertyMarkings = {};
  members.forEach((member) => {
    Object.entries(member.propertyMarkings || {}).forEach(([key, markings]) => {
      propertyMarkings[key] = union(propertyMarkings[key] || [], markings || []);
    });
  });
  const resolution = rep.resolution && typeof rep.resolution === "object" ? rep.resolution : {};
  return {
    ...rep,
    properties,
    markings: union(...members.map((member) => member.markings || [])),
    propertyMarkings,
    sourceMarkings: union(...members.map((member) => member.sourceMarkings || [])),
    sourceIds: union(...members.map((member) => member.sourceIds || [])),
    resolution: { ...resolution, mergedFrom: union(resolution.mergedFrom || [], ...others.map((member) => member.resolution?.mergedFrom || [member.id])) },
    _merge: {
      threshold,
      members: members.map((member) => ({ id: member.id, label: member.label, riskTag: member.properties?.riskTag || "" })),
      candidates: merges.map((merge) => merge.candidate.id),
      conflicts,
    },
  };
}

// Returns {data, info}: data is fullData when nothing merges (no copy), else a shallow copy with the
// merged Persons and remapped links. info.mergedById: representative id -> entity._merge.
export function resolveFullData(full) {
  if (!resolutionActive() || !full) return { data: full, info: EMPTY_INFO };
  const resolution = core.resolution;
  const entities = full.entities || [];
  resolution.setWatchlisted(entities.filter((entity) => entity.type === "Person" && nonEmpty(entity.properties?.riskTag)).map((entity) => entity.id));
  const result = resolution.resolveAt();
  const info = { active: true, threshold: result.threshold, mergedById: new Map(), repOf: new Map(), merges: result.merges };
  if (!result.merges.length) return { data: full, info };
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const replaced = new Map(); // member id -> merged entity (rep) or null (absorbed)
  result.clusters.forEach((ids, repId) => {
    const members = ids.map((id) => byId.get(id)).filter((entity) => entity && entity.type === "Person");
    const rep = byId.get(repId);
    if (!rep || members.length < 2) return;
    const merges = result.merges.filter((merge) => merge.rep === repId);
    const merged = mergePersons(rep, members, result.threshold, merges);
    members.forEach((member) => {
      replaced.set(member.id, member.id === repId ? merged : null);
      info.repOf.set(member.id, repId);
    });
    info.mergedById.set(repId, merged._merge);
  });
  if (!replaced.size) return { data: full, info };
  const nextEntities = [];
  entities.forEach((entity) => {
    if (!replaced.has(entity.id)) nextEntities.push(entity);
    else if (replaced.get(entity.id)) nextEntities.push(replaced.get(entity.id));
  });
  const nextEdges = [];
  (full.edges || []).forEach((edge) => {
    const source = info.repOf.get(edge.source) || edge.source;
    const target = info.repOf.get(edge.target) || edge.target;
    if (source === edge.source && target === edge.target) {
      nextEdges.push(edge);
    } else if (source !== target) {
      nextEdges.push({ ...edge, source, target, _remappedFrom: { source: edge.source, target: edge.target } });
    }
  });
  return { data: { ...full, entities: nextEntities, edges: nextEdges }, info };
}

// "merged at 0.55 — 2 source identities"
export function mergeChipText(merge) {
  if (!merge) return "";
  return `merged at ${Number(merge.threshold).toFixed(2)} — ${merge.members.length} source identities`;
}
