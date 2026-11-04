// demo/js/derive.js — Lookups over the role's view (buildDerivedState), relationship helpers, subgraphs, paths,
// timeline, places and transfers.
import { currencyFormatter } from "./util.js";
import { data, derived } from "./state.js";
import { isWithheldValue, telecomEdgeAllowed } from "./governance.js";

export function buildDerivedState() {
  const entityTypeMap = new Map((data.ontology?.entityTypes || []).map((entityType) => [entityType.id, entityType]));
  const relationshipMap = new Map((data.ontology?.relationshipTypes || []).map((relationship) => [relationship.id, relationship]));
  const mappingMap = new Map((data.mappings || []).map((mapping) => [mapping.id, mapping]));
  const entityMap = new Map((data.entities || []).map((entity) => [entity.id, entity]));
  const edgesBySource = new Map();
  const edgesByTarget = new Map();
  const typeCounts = new Map();

  (data.entities || []).forEach((entity) => {
    typeCounts.set(entity.type, (typeCounts.get(entity.type) || 0) + 1);
  });

  (data.edges || []).forEach((edge) => {
    pushMapArray(edgesBySource, edge.source, edge);
    pushMapArray(edgesByTarget, edge.target, edge);
  });

  return {
    entityTypeMap,
    relationshipMap,
    mappingMap,
    entityMap,
    edgesBySource,
    edgesByTarget,
    typeCounts,
  };
}

export function pushMapArray(map, key, value) {
  if (!map.has(key)) {
    map.set(key, []);
  }
  map.get(key).push(value);
}

export function entityTypeById(id) {
  return derived.entityTypeMap.get(id);
}

export function relationshipById(id) {
  return derived.relationshipMap.get(id);
}

export function mappingById(id) {
  return derived.mappingMap.get(id);
}

export function entityById(id) {
  return derived.entityMap.get(id);
}

export function entitiesForType(typeId) {
  return (data.entities || []).filter((entity) => entity.type === typeId);
}

export function outgoingEdges(entityId, relationshipId) {
  const edges = derived.edgesBySource.get(entityId) || [];
  return relationshipId ? edges.filter((edge) => edge.type === relationshipId) : edges;
}

export function incomingEdges(entityId, relationshipId) {
  const edges = derived.edgesByTarget.get(entityId) || [];
  return relationshipId ? edges.filter((edge) => edge.type === relationshipId) : edges;
}

export function edgesForEntity(entityId) {
  return [...outgoingEdges(entityId), ...incomingEdges(entityId)];
}

export function degree(entityId) {
  return edgesForEntity(entityId).length;
}

export function entityProperty(entity, propertyId) {
  const value = entity?.properties?.[propertyId];
  return isWithheldValue(value) ? "" : String(value ?? "");
}

export function numericProperty(entity, propertyId) {
  const value = Number(entity?.properties?.[propertyId]);
  return Number.isFinite(value) ? value : null;
}

export function entityLabel(entityId) {
  return entityById(entityId)?.label || entityId;
}

export function entityCount(typeId) {
  return derived.typeCounts.get(typeId) || 0;
}

export function relatedTargets(entityId, relationshipId) {
  return outgoingEdges(entityId, relationshipId)
    .map((edge) => entityById(edge.target))
    .filter(Boolean);
}

export function relatedSources(entityId, relationshipId) {
  return incomingEdges(entityId, relationshipId)
    .map((edge) => entityById(edge.source))
    .filter(Boolean);
}

export function personCompanies(personId) {
  const companies = new Map();
  ["DIRECTS", "BENEFICIALLY_OWNS"].forEach((relationshipId) => {
    relatedTargets(personId, relationshipId).forEach((company) => companies.set(company.id, company));
  });
  return [...companies.values()];
}

export function personDevices(personId) {
  return relatedTargets(personId, "USES_DEVICE");
}

export function personFlights(personId) {
  return relatedTargets(personId, "BOOKED_ON");
}

export function personAccounts(personId) {
  const accounts = new Map();
  relatedTargets(personId, "OWNS_ACCOUNT").forEach((account) => accounts.set(account.id, account));
  personCompanies(personId).forEach((company) => {
    relatedTargets(company.id, "HAS_CORP_ACCOUNT").forEach((account) => accounts.set(account.id, account));
  });
  return [...accounts.values()];
}

export function deviceLocations(deviceId) {
  return relatedTargets(deviceId, "OBSERVED_AT");
}

export function locationPeople(locationId) {
  const people = new Map();
  incomingEdges(locationId, "OBSERVED_AT").forEach((edge) => {
    incomingEdges(edge.source, "USES_DEVICE").forEach((useEdge) => {
      const person = entityById(useEdge.source);
      if (person) {
        people.set(person.id, person);
      }
    });
  });
  return [...people.values()];
}

export function totalTransferValue(accounts) {
  const seenEdges = new Set();
  let total = 0;
  accounts.forEach((account) => {
    [...outgoingEdges(account.id, "TRANSFERRED_TO"), ...incomingEdges(account.id, "TRANSFERRED_TO")].forEach((edge) => {
      if (seenEdges.has(edge.id)) {
        return;
      }
      seenEdges.add(edge.id);
      total += Number(edge.properties?.totalAmountUsd || 0);
    });
  });
  return total;
}

export function buildSubgraph(focusEntityIds, maxDepth, maxNodes) {
  const queue = focusEntityIds.filter((entityId) => entityById(entityId)).map((entityId) => ({ entityId, depth: 0 }));
  const visitedNodes = new Set(queue.map((item) => item.entityId));
  const visitedEdges = new Set();

  while (queue.length) {
    const current = queue.shift();
    if (current.depth >= maxDepth) {
      continue;
    }
    edgesForEntity(current.entityId).forEach((edge) => {
      if (visitedEdges.size >= maxNodes * 3 || !telecomEdgeAllowed(edge)) {
        return;
      }
      visitedEdges.add(edge.id);
      const neighborId = edge.source === current.entityId ? edge.target : edge.source;
      if (!visitedNodes.has(neighborId) && visitedNodes.size < maxNodes) {
        visitedNodes.add(neighborId);
        queue.push({ entityId: neighborId, depth: current.depth + 1 });
      }
    });
  }

  const nodes = [...visitedNodes]
    .map((entityId) => entityById(entityId))
    .filter(Boolean)
    .sort((left, right) => `${left.type}:${left.label}`.localeCompare(`${right.type}:${right.label}`));
  const edges = [...visitedEdges]
    .map((edgeId) => (data.edges || []).find((edge) => edge.id === edgeId))
    .filter((edge) => edge && visitedNodes.has(edge.source) && visitedNodes.has(edge.target))
    .sort((left, right) => `${left.type}:${left.source}:${left.target}`.localeCompare(`${right.type}:${right.source}:${right.target}`));

  return { nodes, edges };
}

export function buildPathSummaries(focusEntityIds, graph) {
  const graphEdgeSet = new Set(graph.edges.map((edge) => edge.id));
  const adjacency = new Map();

  graph.edges.forEach((edge) => {
    pushMapArray(adjacency, edge.source, { edge, nextId: edge.target });
    pushMapArray(adjacency, edge.target, { edge, nextId: edge.source });
  });

  const summaries = [];
  const seenPairs = new Set();

  focusEntityIds.forEach((focusEntityId) => {
    const focusEntity = entityById(focusEntityId);
    if (!focusEntity) {
      return;
    }
    const queue = [{ entityId: focusEntityId, path: [focusEntity.label], visited: new Set([focusEntityId]), depth: 0 }];
    while (queue.length && summaries.length < 8) {
      const current = queue.shift();
      (adjacency.get(current.entityId) || []).forEach((link) => {
        if (current.depth >= 3 || current.visited.has(link.nextId) || !graphEdgeSet.has(link.edge.id)) {
          return;
        }
        const nextEntity = entityById(link.nextId);
        if (!nextEntity) {
          return;
        }
        const relationship = relationshipById(link.edge.type);
        const nextPath = current.path.concat([relationship?.label || link.edge.type, nextEntity.label]);
        const pairKey = `${focusEntityId}:${nextEntity.id}`;
        if (nextEntity.id !== focusEntityId && !seenPairs.has(pairKey)) {
          seenPairs.add(pairKey);
          summaries.push(nextPath.join(" -> "));
        }
        queue.push({
          entityId: nextEntity.id,
          path: nextPath,
          visited: new Set([...current.visited, nextEntity.id]),
          depth: current.depth + 1,
        });
      });
    }
  });

  return summaries.slice(0, 6);
}

export function buildTimeline(graph) {
  const graphNodeIds = new Set(graph.nodes.map((node) => node.id));
  const events = [];

  graph.nodes.forEach((node) => {
    if (node.type === "Flight" && entityProperty(node, "departureTs")) {
      const passengers = relatedSources(node.id, "BOOKED_ON").map((person) => person.label).slice(0, 3).join(", ");
      const departureAirport = relatedTargets(node.id, "DEPARTED_FROM")[0]?.label || "";
      const arrivalAirport = relatedTargets(node.id, "ARRIVED_AT")[0]?.label || "";
      events.push({
        ts: entityProperty(node, "departureTs"),
        title: `${entityProperty(node, "flightNumber")} booked`,
        detail: `${passengers || "Passenger"} from ${departureAirport || "?"} to ${arrivalAirport || "?"}`,
      });
    }
    if (node.type === "Company" && entityProperty(node, "incorporationDate")) {
      events.push({
        ts: entityProperty(node, "incorporationDate"),
        title: `${node.label} incorporated`,
        detail: entityProperty(node, "jurisdiction") || "Registry event",
      });
    }
  });

  graph.edges.forEach((edge) => {
    if (edge.type === "TRANSFERRED_TO" && edge.properties?.lastTxnTs) {
      events.push({
        ts: String(edge.properties.lastTxnTs),
        title: "Transfer activity",
        detail: `${entityLabel(edge.source)} -> ${entityLabel(edge.target)} · ${currencyFormatter.format(Number(edge.properties.totalAmountUsd || 0))}`,
      });
    }
    if (edge.type === "OBSERVED_AT" && edge.properties?.lastSeen) {
      events.push({
        ts: String(edge.properties.lastSeen),
        title: "Location observation",
        detail: `${entityLabel(edge.source)} seen at ${entityLabel(edge.target)} (${edge.properties.sightingCount || "1"} sightings)`,
      });
    }
    if (edge.type === "LISTED_ON" && graphNodeIds.has(edge.source)) {
      const riskTag = entityProperty(entityById(edge.target), "riskTag");
      events.push({
        ts: "",
        title: "Watchlist linkage",
        detail: `${entityLabel(edge.source)} linked to ${entityLabel(edge.target)}${riskTag ? ` (${riskTag})` : ""}`,
      });
    }
  });

  return events
    .sort((left, right) => {
      if (left.ts && right.ts) return String(left.ts).localeCompare(String(right.ts));
      if (left.ts) return -1;
      if (right.ts) return 1;
      return left.title.localeCompare(right.title);
    })
    .slice(0, 14);
}

export function buildPlaces(graph) {
  return graph.nodes
    .filter((node) => node.type === "Location" || node.type === "Airport")
    .map((node) => ({
      id: node.id,
      label: node.label,
      type: node.type,
      lat: entityProperty(node, "lat"),
      lon: entityProperty(node, "lon"),
      relatedCount: graph.edges.filter((edge) => edge.source === node.id || edge.target === node.id).length,
      detail:
        node.type === "Location"
          ? `${locationPeople(node.id).length} people, ${relatedSources(node.id, "REGISTERED_AT").length} companies, ${relatedSources(node.id, "OBSERVED_AT").length} device nodes`
          : `${relatedSources(node.id, "DEPARTED_FROM").length} departures, ${relatedSources(node.id, "ARRIVED_AT").length} arrivals`,
    }))
    .sort((left, right) => right.relatedCount - left.relatedCount)
    .slice(0, 10);
}

export function buildTransfers(graph) {
  return graph.edges
    .filter((edge) => edge.type === "TRANSFERRED_TO")
    .map((edge) => ({
      id: edge.id,
      sourceLabel: entityLabel(edge.source),
      targetLabel: entityLabel(edge.target),
      totalAmountUsd: Number(edge.properties?.totalAmountUsd || 0),
      count: Number(edge.properties?.count || 1),
      lastTxnTs: String(edge.properties?.lastTxnTs || ""),
    }))
    .sort((left, right) => right.totalAmountUsd - left.totalAmountUsd)
    .slice(0, 10);
}
