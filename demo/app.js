(function () {
  const BASE_STORAGE_KEY = "ontology-studio-demo-v2";
  const MAX_GRAPH_NODES = 84;
  const DEFAULT_MAP_VIEW = { center: [39, 16], zoom: 3 };
  const numberFormatter = new Intl.NumberFormat("en-US");
  const currencyFormatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
  const ANALYST_TOOLS = {
    copilot: "AI Copilot",
    investigations: "Investigations",
    analytics: "Analytics",
    map: "Map",
  };

  const SCHEMA_TOOLS = {
    "entity-types": "Entity Types",
    properties: "Properties",
    relationships: "Relationships",
    mappings: "Source Mappings",
    instances: "Instance Editor",
    graph: "Graph Explorer",
  };

  const TOOL_LABELS = { ...ANALYST_TOOLS, ...SCHEMA_TOOLS };

  const WALKTHROUGH_STEPS = [
    {
      title: "Welcome to the Ontology Studio",
      desc: "This system unifies messy data sources — watchlists, flights, bank transfers, company registries, and location pings — into a single linked model. The header shows how many entities and relationships are in the current dataset.",
      tab: null,
    },
    {
      title: "Step 1 — Explore Entity Types",
      desc: "Entity Types are the building blocks of the ontology: Person, Company, BankAccount, Device, Flight, Airport, Location, WatchlistRecord. Each type has a colour, an ID, and a set of typed properties.",
      tab: "entity-types",
    },
    {
      title: "Step 2 — See How Sources Map to Objects",
      desc: "Source Mappings describe how each CSV or JSONL column becomes an ontology property. This is where raw data is declared as part of the shared model.",
      tab: "mappings",
    },
    {
      title: "Step 3 — Surface Patterns with Analytics",
      desc: "Rule-based analytics automatically rank the most suspicious actors and places: watchlist operators, address hubs, travel-finance overlaps, and shared booking artifacts.",
      tab: "analytics",
    },
    {
      title: "Step 4 — Follow a Guided Investigation",
      desc: "Investigations turn top analytics hits into guided case scenarios with a graph, timeline, transfer summary, and location panel. Click a scenario card to explore it.",
      tab: "investigations",
    },
    {
      title: "Step 5 — Ask the AI Copilot",
      desc: "The copilot anchors plain-English questions to real entities in the graph. It is grounded — unlike a general LLM, it only references entities and edges that exist in the current dataset. Every answer is assembled from linked evidence, not generated from training data.",
      tab: "copilot",
    },
    {
      title: "Step 6 — Explore the Map",
      desc: "The geospatial view shows airports, observed addresses, and flight corridors derived from the same ontology. Click a marker to see which people, companies, and devices are linked to that place.",
      tab: "map",
    },
    {
      title: "Step 7 — Scale Up to Simulator",
      desc: "Switch the dataset selector to SIMULATOR. The same ontology, rules, investigations, and map now operate over a much larger synthetic dataset — nothing conceptually changes.",
      tab: null,
    },
    {
      title: "Critical Perspectives",
      desc: "Palantir systems are powerful — and contested. These questions belong in any serious classroom discussion.",
      tab: null,
      bullets: [
        "This same system architecture was used in ICE immigration enforcement operations, raising questions about how ontologies built for intelligence get repurposed.",
        "Palantir's Gotham product was central to early predictive policing debates — civil liberties groups argued it encodes bias into analyst workflows.",
        "Palantir's counter-argument: structured, permissioned, audited systems are better for rights than unstructured analyst access to raw databases. The debate is real and unresolved.",
      ],
    },
  ];

  const datasetCatalog = normalizeSeedCatalog(window.ontologySeedCatalog || { starter: window.ontologySeed || {} });
  const datasetKeys = Object.keys(datasetCatalog);
  const defaultDatasetKey = datasetCatalog.starter ? "starter" : datasetKeys[0];
  const COPILOT_EXAMPLES = [
    "Bring together Kareem Haddad across companies, flights, transfers, and devices",
    "Which address connects the most companies and people?",
    "Who looks riskiest in the current dataset?",
    "Show me travel and money movement around Elena Markovic",
    "Find shared booking artifacts and co-travel patterns",
  ];
  const COPILOT_STOP_WORDS = new Set([
    "about", "across", "also", "analyst", "and", "around", "bring", "current", "data", "dataset", "for",
    "from", "give", "have", "into", "like", "me", "most", "natural", "show", "tell", "that", "the", "their",
    "them", "these", "this", "those", "through", "together", "use", "what", "which", "who", "with",
  ]);

  let seedData = clone(datasetCatalog[defaultDatasetKey] || {});
  let data = loadState(defaultDatasetKey);
  let derived = buildDerivedState();
  let analysisState = { analytics: [], investigations: [], actionLog: [] };
  let copilotState = { query: "", result: null };
  let mapRuntime = { map: null, markerLayer: null, routeLayer: null };
  let walkthroughState = { active: false, step: 0 };

  const ui = {
    datasetKey: defaultDatasetKey,
    activeTool: "investigations",
    selectedEntityTypeId: "",
    selectedRelationshipId: "",
    selectedMappingId: "",
    selectedEntityId: "",
    selectedGraphNodeId: "",
    selectedScenarioId: "",
    selectedAnalyticsRuleId: "",
    selectedMapNodeId: "",
    graphMode: "instance",
    graphTypeFilter: "all",
    graphSearch: "",
    mapScope: "dataset",
    mapPlaceFilter: "all",
    mapSearch: "",
    mapViewCenter: [...DEFAULT_MAP_VIEW.center],
    mapViewZoom: DEFAULT_MAP_VIEW.zoom,
    mapViewDirty: false,
    inspectorMode: "insight",
  };

  const root = document.getElementById("app");
  root.addEventListener("click", handleClick);
  root.addEventListener("change", handleChange);
  root.addEventListener("input", handleInput);

  render();

  function normalizeSeedCatalog(rawCatalog) {
    const catalog = {};
    Object.entries(rawCatalog || {}).forEach(([datasetKey, seed]) => {
      if (!seed || typeof seed !== "object") {
        return;
      }
      const copy = clone(seed);
      copy.metadata = copy.metadata || {};
      copy.metadata.dataset = copy.metadata.dataset || datasetKey;
      catalog[datasetKey] = copy;
    });
    return catalog;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function slugify(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "item";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function truncate(value, max = 18) {
    const text = String(value ?? "");
    return text.length > max ? `${text.slice(0, max - 1)}...` : text;
  }

  function storageKey(datasetKey) {
    return `${BASE_STORAGE_KEY}:${datasetKey}`;
  }

  function loadState(datasetKey) {
    try {
      const raw = localStorage.getItem(storageKey(datasetKey));
      if (raw) {
        return JSON.parse(raw);
      }
    } catch (error) {
      console.warn("Failed to load saved ontology state.", error);
    }
    return clone(datasetCatalog[datasetKey] || {});
  }

  function persist() {
    try {
      localStorage.setItem(storageKey(ui.datasetKey), JSON.stringify(data));
    } catch (error) {
      console.warn("Failed to save ontology state.", error);
    }
  }

  function switchDataset(datasetKey) {
    if (!datasetCatalog[datasetKey]) {
      return;
    }
    ui.datasetKey = datasetKey;
    seedData = clone(datasetCatalog[datasetKey]);
    data = loadState(datasetKey);
    ui.graphSearch = "";
    ui.graphTypeFilter = "all";
    ui.graphMode = "instance";
    ui.selectedScenarioId = "";
    ui.selectedAnalyticsRuleId = "";
    ui.selectedGraphNodeId = "";
    ui.selectedEntityTypeId = "";
    ui.selectedRelationshipId = "";
    ui.selectedMappingId = "";
    ui.selectedEntityId = "";
    ui.selectedMapNodeId = "";
    ui.mapScope = "dataset";
    ui.mapPlaceFilter = "all";
    ui.mapSearch = "";
    ui.mapViewCenter = [...DEFAULT_MAP_VIEW.center];
    ui.mapViewZoom = DEFAULT_MAP_VIEW.zoom;
    ui.mapViewDirty = false;
    copilotState = { query: "", result: null };
    render();
  }

  function buildDerivedState() {
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

  function pushMapArray(map, key, value) {
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push(value);
  }

  function entityTypeById(id) {
    return derived.entityTypeMap.get(id);
  }

  function relationshipById(id) {
    return derived.relationshipMap.get(id);
  }

  function mappingById(id) {
    return derived.mappingMap.get(id);
  }

  function entityById(id) {
    return derived.entityMap.get(id);
  }

  function entitiesForType(typeId) {
    return (data.entities || []).filter((entity) => entity.type === typeId);
  }

  function outgoingEdges(entityId, relationshipId) {
    const edges = derived.edgesBySource.get(entityId) || [];
    return relationshipId ? edges.filter((edge) => edge.type === relationshipId) : edges;
  }

  function incomingEdges(entityId, relationshipId) {
    const edges = derived.edgesByTarget.get(entityId) || [];
    return relationshipId ? edges.filter((edge) => edge.type === relationshipId) : edges;
  }

  function edgesForEntity(entityId) {
    return [...outgoingEdges(entityId), ...incomingEdges(entityId)];
  }

  function degree(entityId) {
    return edgesForEntity(entityId).length;
  }

  function entityProperty(entity, propertyId) {
    return String(entity?.properties?.[propertyId] ?? "");
  }

  function numericProperty(entity, propertyId) {
    const value = Number(entity?.properties?.[propertyId]);
    return Number.isFinite(value) ? value : null;
  }

  function entityLabel(entityId) {
    return entityById(entityId)?.label || entityId;
  }

  function entityCount(typeId) {
    return derived.typeCounts.get(typeId) || 0;
  }

  function relatedTargets(entityId, relationshipId) {
    return outgoingEdges(entityId, relationshipId)
      .map((edge) => entityById(edge.target))
      .filter(Boolean);
  }

  function relatedSources(entityId, relationshipId) {
    return incomingEdges(entityId, relationshipId)
      .map((edge) => entityById(edge.source))
      .filter(Boolean);
  }

  function personCompanies(personId) {
    const companies = new Map();
    ["DIRECTS", "BENEFICIALLY_OWNS"].forEach((relationshipId) => {
      relatedTargets(personId, relationshipId).forEach((company) => companies.set(company.id, company));
    });
    return [...companies.values()];
  }

  function personDevices(personId) {
    return relatedTargets(personId, "USES_DEVICE");
  }

  function personFlights(personId) {
    return relatedTargets(personId, "BOOKED_ON");
  }

  function personAccounts(personId) {
    const accounts = new Map();
    relatedTargets(personId, "OWNS_ACCOUNT").forEach((account) => accounts.set(account.id, account));
    personCompanies(personId).forEach((company) => {
      relatedTargets(company.id, "HAS_CORP_ACCOUNT").forEach((account) => accounts.set(account.id, account));
    });
    return [...accounts.values()];
  }

  function deviceLocations(deviceId) {
    return relatedTargets(deviceId, "OBSERVED_AT");
  }

  function locationPeople(locationId) {
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

  function totalTransferValue(accounts) {
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

  function scenarioSeverity(score) {
    if (score >= 9) return "High";
    if (score >= 5) return "Medium";
    return "Low";
  }

  function buildAnalytics() {
    const analytics = [];
    const people = entitiesForType("Person");
    const locations = entitiesForType("Location");
    const flights = entitiesForType("Flight");

    const watchlistHits = people
      .filter((person) => entityProperty(person, "riskTag"))
      .map((person) => {
        const companies = personCompanies(person.id);
        const accounts = personAccounts(person.id);
        const devices = personDevices(person.id);
        const transferValue = totalTransferValue(accounts);
        const score = degree(person.id) + companies.length + devices.length + Math.round(transferValue / 2500);
        return {
          id: `watchlist-${person.id}`,
          label: person.label,
          focusEntityIds: [person.id],
          score,
          detail: `${companies.length} companies, ${accounts.length} accounts, ${devices.length} devices, ${currencyFormatter.format(transferValue)} linked transfers`,
        };
      })
      .sort((left, right) => right.score - left.score);

    analytics.push({
      id: "watchlist-operators",
      title: "Watchlist operators",
      description: "Risk-tagged people with broad graph reach across travel, devices, companies, and accounts.",
      severity: scenarioSeverity(watchlistHits[0]?.score || 0),
      hits: watchlistHits.slice(0, 8),
    });

    const locationHits = locations
      .map((location) => {
        const registeredCompanies = relatedSources(location.id, "REGISTERED_AT");
        const observedDevices = relatedSources(location.id, "OBSERVED_AT");
        const observedPeople = locationPeople(location.id);
        const score = registeredCompanies.length * 2 + observedPeople.length + observedDevices.length;
        return {
          id: `location-${location.id}`,
          label: location.label,
          focusEntityIds: [location.id],
          score,
          detail: `${registeredCompanies.length} registered companies, ${observedPeople.length} people via devices, ${observedDevices.length} observed devices`,
        };
      })
      .filter((hit) => hit.score >= 4)
      .sort((left, right) => right.score - left.score);

    analytics.push({
      id: "address-hubs",
      title: "Address hubs",
      description: "Locations where company registrations and device sightings overlap strongly.",
      severity: scenarioSeverity(locationHits[0]?.score || 0),
      hits: locationHits.slice(0, 8),
    });

    const travelFinanceHits = people
      .map((person) => {
        const accounts = personAccounts(person.id);
        const flightsForPerson = personFlights(person.id);
        const devices = personDevices(person.id);
        const transferValue = totalTransferValue(accounts);
        const score = flightsForPerson.length + devices.length + Math.round(transferValue / 2000);
        return {
          id: `travel-finance-${person.id}`,
          label: person.label,
          focusEntityIds: [person.id],
          score,
          detail: `${flightsForPerson.length} flights, ${accounts.length} linked accounts, ${currencyFormatter.format(transferValue)} in transfers`,
        };
      })
      .filter((hit) => hit.score >= 4)
      .sort((left, right) => right.score - left.score);

    analytics.push({
      id: "travel-finance-overlap",
      title: "Travel-finance overlap",
      description: "People whose travel history, linked accounts, and transfers suggest operational coordination.",
      severity: scenarioSeverity(travelFinanceHits[0]?.score || 0),
      hits: travelFinanceHits.slice(0, 8),
    });

    const bookingGroups = new Map();
    flights.forEach((flight) => {
      const bookingReference = entityProperty(flight, "bookingReference");
      const paymentCardLast4 = entityProperty(flight, "paymentCardLast4");
      const key = bookingReference ? `Booking ${bookingReference}` : paymentCardLast4 ? `Card ${paymentCardLast4}` : "";
      if (!key) {
        return;
      }
      if (!bookingGroups.has(key)) {
        bookingGroups.set(key, { key, people: new Map(), flights: new Map() });
      }
      const group = bookingGroups.get(key);
      group.flights.set(flight.id, flight);
      incomingEdges(flight.id, "BOOKED_ON").forEach((edge) => {
        const person = entityById(edge.source);
        if (person) {
          group.people.set(person.id, person);
        }
      });
    });

    const bookingHits = [...bookingGroups.values()]
      .map((group) => ({
        id: `booking-${slugify(group.key)}`,
        label: group.key,
        focusEntityIds: [...group.people.keys()],
        score: group.people.size * 2 + group.flights.size,
        detail: `${group.people.size} linked people across ${group.flights.size} manifest rows`,
      }))
      .filter((hit) => hit.focusEntityIds.length > 1)
      .sort((left, right) => right.score - left.score);

    analytics.push({
      id: "shared-booking-artifacts",
      title: "Shared booking artifacts",
      description: "Multiple people reusing booking references or payment artifacts across manifest rows.",
      severity: scenarioSeverity(bookingHits[0]?.score || 0),
      hits: bookingHits.slice(0, 8),
    });

    return analytics;
  }

  function buildSubgraph(focusEntityIds, maxDepth, maxNodes) {
    const queue = focusEntityIds.filter((entityId) => entityById(entityId)).map((entityId) => ({ entityId, depth: 0 }));
    const visitedNodes = new Set(queue.map((item) => item.entityId));
    const visitedEdges = new Set();

    while (queue.length) {
      const current = queue.shift();
      if (current.depth >= maxDepth) {
        continue;
      }
      edgesForEntity(current.entityId).forEach((edge) => {
        if (visitedEdges.size >= maxNodes * 3) {
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

  function buildPathSummaries(focusEntityIds, graph) {
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

  function buildTimeline(graph) {
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

  function buildPlaces(graph) {
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

  function buildTransfers(graph) {
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

  function graphForMapScope() {
    if (ui.mapScope === "scenario") {
      return analysisState.investigations.find((scenario) => scenario.id === ui.selectedScenarioId)?.graph || { nodes: [], edges: [] };
    }
    if (ui.mapScope === "copilot") {
      return copilotState.result?.graph || { nodes: [], edges: [] };
    }
    return { nodes: data.entities || [], edges: data.edges || [] };
  }

  function buildMapPlaces(graph) {
    return graph.nodes
      .filter((node) => (node.type === "Location" || node.type === "Airport") && numericProperty(node, "lat") !== null && numericProperty(node, "lon") !== null)
      .map((node) => {
        const connectedEdges = graph.edges.filter((edge) => edge.source === node.id || edge.target === node.id);
        const registeredCompanies = node.type === "Location" ? relatedSources(node.id, "REGISTERED_AT") : [];
        const observedDevices = node.type === "Location" ? relatedSources(node.id, "OBSERVED_AT") : [];
        const observedPeople = node.type === "Location" ? locationPeople(node.id) : [];
        const departures = node.type === "Airport" ? relatedSources(node.id, "DEPARTED_FROM") : [];
        const arrivals = node.type === "Airport" ? relatedSources(node.id, "ARRIVED_AT") : [];
        const routeFlights = [...departures, ...arrivals];
        const travelers = new Map();
        routeFlights.forEach((flight) => {
          relatedSources(flight.id, "BOOKED_ON").forEach((person) => travelers.set(person.id, person));
        });
        const locationType = node.type === "Location" ? entityProperty(node, "locationType") || "Location" : "Airport";
        const city = entityProperty(node, "city") || "";
        const country = entityProperty(node, "country") || "";
        const context = [locationType, city, country].filter(Boolean).join(" • ");
        return {
          id: node.id,
          label: node.label,
          type: node.type,
          lat: numericProperty(node, "lat"),
          lon: numericProperty(node, "lon"),
          color: entityTypeById(node.type)?.color || "#94a3b8",
          locationType,
          city,
          country,
          context,
          relatedCount: connectedEdges.length,
          detail:
            node.type === "Location"
              ? `${registeredCompanies.length} companies, ${observedPeople.length} people, ${observedDevices.length} devices`
              : `${departures.length} departures, ${arrivals.length} arrivals, ${travelers.size} travelers`,
          companies: registeredCompanies,
          devices: observedDevices,
          people: observedPeople,
          departures,
          arrivals,
          travelers: [...travelers.values()],
        };
      });
  }

  function buildMapRoutes(graph) {
    const routes = new Map();
    graph.nodes
      .filter((node) => node.type === "Flight")
      .forEach((flight) => {
        const departure = relatedTargets(flight.id, "DEPARTED_FROM")[0];
        const arrival = relatedTargets(flight.id, "ARRIVED_AT")[0];
        if (!departure || !arrival) {
          return;
        }
        const fromLat = numericProperty(departure, "lat");
        const fromLon = numericProperty(departure, "lon");
        const toLat = numericProperty(arrival, "lat");
        const toLon = numericProperty(arrival, "lon");
        if ([fromLat, fromLon, toLat, toLon].some((value) => value === null)) {
          return;
        }
        const key = `${departure.id}:${arrival.id}`;
        if (!routes.has(key)) {
          routes.set(key, {
            id: key,
            fromId: departure.id,
            fromLabel: departure.label,
            fromLat,
            fromLon,
            toId: arrival.id,
            toLabel: arrival.label,
            toLat,
            toLon,
            flightCount: 0,
            passengerCount: 0,
            flightNumbers: new Set(),
          });
        }
        const route = routes.get(key);
        route.flightCount += 1;
        route.flightNumbers.add(entityProperty(flight, "flightNumber"));
        route.passengerCount += relatedSources(flight.id, "BOOKED_ON").length;
      });

    return [...routes.values()]
      .map((route) => ({
        ...route,
        flightNumbers: [...route.flightNumbers].filter(Boolean).slice(0, 3),
      }))
      .sort((left, right) => right.flightCount - left.flightCount || right.passengerCount - left.passengerCount)
      .slice(0, 60);
  }

  function projectMapPoint(lat, lon, width, height) {
    return {
      x: ((lon + 180) / 360) * width,
      y: ((90 - lat) / 180) * height,
    };
  }

  function buildMapData() {
    const graph = graphForMapScope();
    const search = normalizeText(ui.mapSearch);
    let places = buildMapPlaces(graph);
    if (ui.mapPlaceFilter !== "all") {
      places = places.filter((place) => place.type === ui.mapPlaceFilter);
    }
    if (search) {
      places = places.filter((place) => normalizeText(`${place.label} ${place.context} ${place.detail}`).includes(search));
    }

    places = places.sort((left, right) => right.relatedCount - left.relatedCount).slice(0, 40);
    const visiblePlaceIds = new Set(places.map((place) => place.id));
    const routes = buildMapRoutes(graph).filter((route) => visiblePlaceIds.has(route.fromId) || visiblePlaceIds.has(route.toId));
    const selectedPlace = places.find((place) => place.id === ui.selectedMapNodeId) || places[0] || null;
    return {
      graph,
      places,
      routes,
      selectedPlace,
      summary: {
        scope:
          ui.mapScope === "scenario"
            ? "Scenario scope"
            : ui.mapScope === "copilot"
              ? "Copilot scope"
              : "Dataset scope",
      },
    };
  }

  function renderMapSvg(mapData) {
    const width = 960;
    const height = 480;
    const gridLines = [];
    for (let lon = -120; lon <= 120; lon += 60) {
      const point = projectMapPoint(0, lon, width, height);
      gridLines.push(`<line class="map-grid-line" x1="${point.x}" y1="0" x2="${point.x}" y2="${height}"></line>`);
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      const point = projectMapPoint(lat, 0, width, height);
      gridLines.push(`<line class="map-grid-line" x1="0" y1="${point.y}" x2="${width}" y2="${point.y}"></line>`);
    }

    const routes = mapData.routes
      .map((route) => {
        const from = projectMapPoint(route.fromLat, route.fromLon, width, height);
        const to = projectMapPoint(route.toLat, route.toLon, width, height);
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const curveOffset = Math.min(80, Math.max(24, Math.abs(dx) * 0.14 + Math.abs(dy) * 0.08));
        const cx = (from.x + to.x) / 2;
        const cy = Math.min(from.y, to.y) - curveOffset;
        return `
          <path class="map-route" d="M ${from.x} ${from.y} Q ${cx} ${cy} ${to.x} ${to.y}"></path>
        `;
      })
      .join("");

    const markers = mapData.places
      .map((place) => {
        const point = projectMapPoint(place.lat, place.lon, width, height);
        const radius = Math.max(6, Math.min(14, 5 + place.relatedCount * 0.4));
        const selected = mapData.selectedPlace?.id === place.id ? "selected" : "";
        return `
          <g class="map-marker ${selected}" data-action="select-map-node" data-id="${escapeHtml(place.id)}" transform="translate(${point.x}, ${point.y})">
            <circle r="${radius}" fill="${escapeHtml(place.color)}"></circle>
            <text x="${radius + 6}" y="4">${escapeHtml(truncate(place.label, 24))}</text>
          </g>
        `;
      })
      .join("");

    return `
      <svg viewBox="0 0 ${width} ${height}">
        <rect x="0" y="0" width="${width}" height="${height}" class="map-surface"></rect>
        ${gridLines.join("")}
        ${routes}
        ${markers}
      </svg>
    `;
  }

  function destroyLeafletMap() {
    if (mapRuntime.map) {
      mapRuntime.map.remove();
    }
    mapRuntime = { map: null, markerLayer: null, routeLayer: null };
  }

  function mapPopupHtml(place) {
    return `
      <div class="map-popup">
        <strong>${escapeHtml(place.label)}</strong>
        ${place.context ? `<div>${escapeHtml(place.context)}</div>` : ""}
        <div>${escapeHtml(place.detail)}</div>
      </div>
    `;
  }

  function syncMapViewport() {
    if (!mapRuntime.map) {
      return;
    }
    const center = mapRuntime.map.getCenter();
    ui.mapViewCenter = [center.lat, center.lng];
    ui.mapViewZoom = mapRuntime.map.getZoom();
    ui.mapViewDirty = true;
  }

  function initializeLeafletMap(mapData) {
    const container = document.getElementById("leaflet-map");
    if (!container || !mapData.places.length) {
      return;
    }
    if (!window.L) {
      container.innerHTML = renderMapSvg(mapData);
      return;
    }

    destroyLeafletMap();
    mapRuntime.map = window.L.map(container, {
      zoomControl: true,
      scrollWheelZoom: true,
      attributionControl: false,
    });

    window.L.control.attribution({ prefix: false }).addTo(mapRuntime.map);

    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(mapRuntime.map);

    mapRuntime.routeLayer = window.L.layerGroup().addTo(mapRuntime.map);
    mapRuntime.markerLayer = window.L.layerGroup().addTo(mapRuntime.map);

    mapData.routes.forEach((route) => {
      window.L.polyline(
        [
          [route.fromLat, route.fromLon],
          [route.toLat, route.toLon],
        ],
        {
          color: "#38bdf8",
          weight: Math.min(7, 2 + route.flightCount * 0.6),
          opacity: 0.55,
          dashArray: "8 6",
        }
      )
        .bindTooltip(`${route.fromLabel} -> ${route.toLabel} · ${route.flightCount} flights · ${route.passengerCount} passengers`)
        .addTo(mapRuntime.routeLayer);
    });

    let selectedMarker = null;
    mapData.places.forEach((place) => {
      const radius = Math.max(6, Math.min(14, 5 + place.relatedCount * 0.4));
      const marker = window.L.circleMarker([place.lat, place.lon], {
        radius,
        color: place.color,
        fillColor: place.color,
        fillOpacity: mapData.selectedPlace?.id === place.id ? 0.95 : 0.72,
        weight: mapData.selectedPlace?.id === place.id ? 3 : 1.5,
      })
        .bindPopup(mapPopupHtml(place))
        .on("click", () => {
          ui.selectedMapNodeId = place.id;
          setTimeout(() => render(), 0);
        })
        .addTo(mapRuntime.markerLayer);
      if (mapData.selectedPlace?.id === place.id) {
        selectedMarker = marker;
      }
    });

    if (!ui.mapViewDirty && mapData.places.length > 1) {
      const bounds = window.L.latLngBounds(mapData.places.map((place) => [place.lat, place.lon]));
      mapRuntime.map.fitBounds(bounds.pad(0.18));
      ui.mapViewCenter = [mapRuntime.map.getCenter().lat, mapRuntime.map.getCenter().lng];
      ui.mapViewZoom = mapRuntime.map.getZoom();
    } else if (mapData.places.length === 1 && !ui.mapViewDirty) {
      mapRuntime.map.setView([mapData.places[0].lat, mapData.places[0].lon], 7);
      ui.mapViewCenter = [mapData.places[0].lat, mapData.places[0].lon];
      ui.mapViewZoom = 7;
    } else {
      mapRuntime.map.setView(ui.mapViewCenter, ui.mapViewZoom);
    }

    mapRuntime.map.on("moveend", syncMapViewport);
    if (selectedMarker) {
      selectedMarker.openPopup();
    }
  }

  function createScenario(id, title, summary, focusEntityIds, score, facts, actions) {
    const graph = buildSubgraph(focusEntityIds, 2, 24);
    return {
      id,
      title,
      summary,
      severity: scenarioSeverity(score),
      score,
      facts,
      actions: actions || [],
      focusEntityIds,
      graph,
      paths: buildPathSummaries(focusEntityIds, graph),
      timeline: buildTimeline(graph),
      places: buildPlaces(graph),
      transfers: buildTransfers(graph),
    };
  }

  function scenarioActions(scenarioId, focusEntityIds) {
    const focusEntities = focusEntityIds.map((id) => derived.entityMap.get(id)).filter(Boolean);
    const personEntity = focusEntities.find((e) => e.type === "Person");
    const locationEntity = focusEntities.find((e) => e.type === "Location");
    const personLabel = personEntity?.label || "subject";
    const locationLabel = locationEntity?.label || "location";
    if (scenarioId === "scenario-watchlist-lead") {
      return [
        `Escalate ${personLabel} to Intelligence Unit`,
        `Flag all accounts linked to ${personLabel}`,
        `Request border intercept watch on ${personLabel}`,
      ];
    }
    if (scenarioId === "scenario-address-hub") {
      return [
        `Request field surveillance at ${locationLabel}`,
        `Query property registry for ${locationLabel}`,
        `Cross-reference vehicle registrations at ${locationLabel}`,
      ];
    }
    if (scenarioId === "scenario-booking-cluster") {
      return [
        "Pull full travel history for booking group",
        "Flag shared payment instrument for financial review",
        "Notify border agency of co-travel cluster",
      ];
    }
    if (scenarioId === "scenario-travel-finance") {
      return [
        `Submit financial intelligence report for ${personLabel}`,
        `Coordinate with travel authority on ${personLabel}`,
        "Freeze linked accounts pending review",
      ];
    }
    return ["Escalate for further review", "Flag for supervisor attention", "Log for audit trail"];
  }

  function buildInvestigations(analytics) {
    const analyticsById = new Map(analytics.map((rule) => [rule.id, rule]));
    const scenarios = [];

    const watchlistLead = analyticsById.get("watchlist-operators")?.hits?.[0];
    if (watchlistLead) {
      scenarios.push(
        createScenario(
          "scenario-watchlist-lead",
          "Trace the risk-tagged operator",
          `${watchlistLead.label} is the strongest risk-tagged connector in the current ontology graph.`,
          watchlistLead.focusEntityIds,
          watchlistLead.score,
          [
            watchlistLead.detail,
            "Use the timeline to walk from watchlist identity through travel, companies, and account activity.",
          ],
          scenarioActions("scenario-watchlist-lead", watchlistLead.focusEntityIds)
        )
      );
    }

    const addressHub = analyticsById.get("address-hubs")?.hits?.[0];
    if (addressHub) {
      scenarios.push(
        createScenario(
          "scenario-address-hub",
          "Investigate the shared address hub",
          `${addressHub.label} concentrates registrations and device-linked observations in one place.`,
          addressHub.focusEntityIds,
          addressHub.score,
          [
            addressHub.detail,
            "Ask students why this address becomes a high-value node even before advanced analytics.",
          ],
          scenarioActions("scenario-address-hub", addressHub.focusEntityIds)
        )
      );
    }

    const bookingCluster = analyticsById.get("shared-booking-artifacts")?.hits?.[0];
    if (bookingCluster) {
      scenarios.push(
        createScenario(
          "scenario-booking-cluster",
          "Follow the shared booking cluster",
          `${bookingCluster.label} ties multiple people together through reused booking artifacts.`,
          bookingCluster.focusEntityIds,
          bookingCluster.score,
          [
            bookingCluster.detail,
            "Compare the booking links with nearby transfers and location activity.",
          ],
          scenarioActions("scenario-booking-cluster", bookingCluster.focusEntityIds)
        )
      );
    }

    const travelFinanceLead = analyticsById.get("travel-finance-overlap")?.hits?.[0];
    if (travelFinanceLead) {
      scenarios.push(
        createScenario(
          "scenario-travel-finance",
          "Connect travel with money movement",
          `${travelFinanceLead.label} combines flight activity with linked account transfers and device evidence.`,
          travelFinanceLead.focusEntityIds,
          travelFinanceLead.score,
          [
            travelFinanceLead.detail,
            "Use this case to show how an ontology turns separate feeds into one investigation surface.",
          ],
          scenarioActions("scenario-travel-finance", travelFinanceLead.focusEntityIds)
        )
      );
    }

    return scenarios;
  }

  function normalizeText(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function queryTokens(query) {
    return [...new Set(normalizeText(query).split(/\s+/).filter((token) => token && token.length > 2 && !COPILOT_STOP_WORDS.has(token)))];
  }

  function entitySearchText(entity) {
    return normalizeText(`${entity.label} ${entity.type} ${Object.values(entity.properties || {}).join(" ")}`);
  }

  function collectEntityMatches(query) {
    const normalizedQuery = normalizeText(query);
    const tokens = queryTokens(query);
    return (data.entities || [])
      .map((entity) => {
        const labelText = normalizeText(entity.label);
        const propText = normalizeText(Object.values(entity.properties || {}).join(" "));
        let score = 0;
        if (normalizedQuery && labelText.includes(normalizedQuery)) {
          score += 8;
        }
        if (normalizedQuery && propText.includes(normalizedQuery)) {
          score += 4;
        }
        tokens.forEach((token) => {
          if (labelText.includes(token)) {
            score += 3;
          } else if (propText.includes(token)) {
            score += 1;
          }
        });
        if (entity.type === "Person" && /(who|person|people|watchlist|risk)/.test(normalizedQuery)) {
          score += 1;
        }
        if (entity.type === "Location" && /(address|where|location|place)/.test(normalizedQuery)) {
          score += 1;
        }
        if (entity.type === "Company" && /(company|owner|director|shell)/.test(normalizedQuery)) {
          score += 1;
        }
        if (entity.type === "BankAccount" && /(bank|money|transfer|payment|account)/.test(normalizedQuery)) {
          score += 1;
        }
        if (entity.type === "Flight" && /(flight|travel|booking|trip|co travel)/.test(normalizedQuery)) {
          score += 1;
        }
        return { entity, score, searchText: `${labelText} ${propText}`.trim() };
      })
      .filter((match) => match.score > 0)
      .sort((left, right) => right.score - left.score || left.entity.label.localeCompare(right.entity.label))
      .slice(0, 8);
  }

  function collectRuleMatches(query, focusEntityIds) {
    const normalizedQuery = normalizeText(query);
    const tokens = queryTokens(query);
    return analysisState.analytics
      .map((rule) => {
        let score = 0;
        const ruleText = normalizeText(`${rule.title} ${rule.description}`);
        if (normalizedQuery && ruleText.includes(normalizedQuery)) {
          score += 4;
        }
        tokens.forEach((token) => {
          if (ruleText.includes(token)) {
            score += 1;
          }
        });
        rule.hits.forEach((hit) => {
          if ((hit.focusEntityIds || []).some((entityId) => focusEntityIds.includes(entityId))) {
            score += 3;
          }
        });
        return { rule, score };
      })
      .filter((match) => match.score > 0)
      .sort((left, right) => right.score - left.score || right.rule.hits.length - left.rule.hits.length)
      .slice(0, 4);
  }

  function collectScenarioMatches(query, focusEntityIds) {
    const normalizedQuery = normalizeText(query);
    const tokens = queryTokens(query);
    return analysisState.investigations
      .map((scenario) => {
        let score = 0;
        const scenarioText = normalizeText(`${scenario.title} ${scenario.summary} ${(scenario.facts || []).join(" ")}`);
        if (normalizedQuery && scenarioText.includes(normalizedQuery)) {
          score += 4;
        }
        tokens.forEach((token) => {
          if (scenarioText.includes(token)) {
            score += 1;
          }
        });
        if ((scenario.focusEntityIds || []).some((entityId) => focusEntityIds.includes(entityId))) {
          score += 4;
        }
        return { scenario, score };
      })
      .filter((match) => match.score > 0)
      .sort((left, right) => right.score - left.score || right.scenario.score - left.scenario.score)
      .slice(0, 4);
  }

  function summarizeEntityForCopilot(entity) {
    if (!entity) {
      return { headline: "", evidence: [] };
    }
    if (entity.type === "Person") {
      const companies = personCompanies(entity.id);
      const accounts = personAccounts(entity.id);
      const flights = personFlights(entity.id);
      const devices = personDevices(entity.id);
      const watchlistRecord = relatedTargets(entity.id, "LISTED_ON")[0];
      const locations = new Map();
      devices.forEach((device) => {
        deviceLocations(device.id).forEach((location) => locations.set(location.id, location));
      });
      return {
        headline: `${entity.label} links ${companies.length} companies, ${accounts.length} accounts, ${flights.length} flights, and ${devices.length} devices.`,
        evidence: [
          entityProperty(entity, "riskTag") ? `${entity.label} carries risk tag "${entityProperty(entity, "riskTag")}".` : "",
          watchlistRecord ? `${entity.label} maps to watchlist record ${watchlistRecord.label}.` : "",
          companies.length ? `Connected companies: ${companies.slice(0, 4).map((company) => company.label).join(", ")}.` : "",
          flights.length ? `Travel evidence: ${flights.slice(0, 3).map((flight) => entityProperty(flight, "flightNumber")).join(", ")}.` : "",
          locations.size ? `Observed places: ${[...locations.values()].slice(0, 4).map((location) => location.label).join(", ")}.` : "",
          accounts.length ? `Linked transfer volume: ${currencyFormatter.format(totalTransferValue(accounts))}.` : "",
        ].filter(Boolean),
      };
    }
    if (entity.type === "Company") {
      const directors = relatedSources(entity.id, "DIRECTS");
      const owners = relatedSources(entity.id, "BENEFICIALLY_OWNS");
      const address = relatedTargets(entity.id, "REGISTERED_AT")[0];
      const accounts = relatedTargets(entity.id, "HAS_CORP_ACCOUNT");
      return {
        headline: `${entity.label} is registered in ${entityProperty(entity, "jurisdiction") || "an unknown jurisdiction"} and is linked to ${accounts.length} corporate accounts.`,
        evidence: [
          directors.length ? `Directors: ${directors.map((person) => person.label).join(", ")}.` : "",
          owners.length ? `Beneficial owners: ${owners.map((person) => person.label).join(", ")}.` : "",
          address ? `Registered address: ${address.label}.` : "",
          accounts.length ? `Corporate transfer volume: ${currencyFormatter.format(totalTransferValue(accounts))}.` : "",
        ].filter(Boolean),
      };
    }
    if (entity.type === "Location") {
      const companies = relatedSources(entity.id, "REGISTERED_AT");
      const devices = relatedSources(entity.id, "OBSERVED_AT");
      const people = locationPeople(entity.id);
      return {
        headline: `${entity.label} acts as a hub with ${companies.length} registered companies, ${people.length} people, and ${devices.length} observed devices.`,
        evidence: [
          companies.length ? `Registered companies: ${companies.slice(0, 4).map((company) => company.label).join(", ")}.` : "",
          people.length ? `Observed people: ${people.slice(0, 4).map((person) => person.label).join(", ")}.` : "",
          entityProperty(entity, "cellTower") ? `Cell tower code: ${entityProperty(entity, "cellTower")}.` : "",
        ].filter(Boolean),
      };
    }
    if (entity.type === "BankAccount") {
      const owners = [...relatedSources(entity.id, "OWNS_ACCOUNT"), ...relatedSources(entity.id, "HAS_CORP_ACCOUNT")];
      const outgoing = outgoingEdges(entity.id, "TRANSFERRED_TO");
      const incoming = incomingEdges(entity.id, "TRANSFERRED_TO");
      const total = [...outgoing, ...incoming].reduce((sum, edge) => sum + Number(edge.properties?.totalAmountUsd || 0), 0);
      return {
        headline: `${entity.label} is tied to ${owners.length} owners and ${outgoing.length + incoming.length} transfer links.`,
        evidence: [
          owners.length ? `Owners: ${owners.map((owner) => owner.label).join(", ")}.` : "",
          outgoing.length ? `Outgoing transfers hit ${outgoing.length} accounts.` : "",
          incoming.length ? `Incoming transfers arrive from ${incoming.length} accounts.` : "",
          total ? `Total linked value: ${currencyFormatter.format(total)}.` : "",
        ].filter(Boolean),
      };
    }
    if (entity.type === "Device") {
      const people = relatedSources(entity.id, "USES_DEVICE");
      const locations = relatedTargets(entity.id, "OBSERVED_AT");
      return {
        headline: `${entity.label} connects ${people.length} people to ${locations.length} observed places.`,
        evidence: [
          people.length ? `Associated people: ${people.map((person) => person.label).join(", ")}.` : "",
          locations.length ? `Observed places: ${locations.slice(0, 4).map((location) => location.label).join(", ")}.` : "",
          entityProperty(entity, "phoneNumber") ? `Phone number: ${entityProperty(entity, "phoneNumber")}.` : "",
        ].filter(Boolean),
      };
    }
    if (entity.type === "Flight") {
      const people = relatedSources(entity.id, "BOOKED_ON");
      const departure = relatedTargets(entity.id, "DEPARTED_FROM")[0];
      const arrival = relatedTargets(entity.id, "ARRIVED_AT")[0];
      return {
        headline: `${entityProperty(entity, "flightNumber")} carries ${people.length} linked passengers through the ontology.`,
        evidence: [
          people.length ? `Passengers: ${people.map((person) => person.label).join(", ")}.` : "",
          departure ? `Departure: ${departure.label}.` : "",
          arrival ? `Arrival: ${arrival.label}.` : "",
          entityProperty(entity, "bookingReference") ? `Booking reference: ${entityProperty(entity, "bookingReference")}.` : "",
        ].filter(Boolean),
      };
    }
    return {
      headline: `${entity.label} contributes ${degree(entity.id)} connected edges to the current graph.`,
      evidence: [],
    };
  }

  function buildCopilotResponse(query) {
    const trimmedQuery = String(query || "").trim();
    if (!trimmedQuery) {
      return null;
    }

    const entityMatches = collectEntityMatches(trimmedQuery);
    let focusEntityIds = entityMatches.slice(0, 3).map((match) => match.entity.id);
    const ruleMatches = collectRuleMatches(trimmedQuery, focusEntityIds);
    if (!focusEntityIds.length && ruleMatches[0]?.rule?.hits?.[0]?.focusEntityIds?.length) {
      focusEntityIds = ruleMatches[0].rule.hits[0].focusEntityIds.slice(0, 3);
    }
    const scenarioMatches = collectScenarioMatches(trimmedQuery, focusEntityIds);
    if (!focusEntityIds.length && scenarioMatches[0]?.scenario?.focusEntityIds?.length) {
      focusEntityIds = scenarioMatches[0].scenario.focusEntityIds.slice(0, 3);
    }

    const focusEntities = focusEntityIds.map((entityId) => entityById(entityId)).filter(Boolean);
    const focusInsights = focusEntities.map((entity) => ({ entity, ...summarizeEntityForCopilot(entity) }));
    const graph = focusEntityIds.length ? buildSubgraph(focusEntityIds, 2, 20) : { nodes: [], edges: [] };

    let summary = "";
    if (focusInsights.length) {
      summary = focusInsights[0].headline;
      if (focusInsights.length > 1) {
        summary += ` I also found ${focusInsights.length - 1} related focal entities that reinforce the same story.`;
      }
    } else if (ruleMatches.length) {
      summary = `${ruleMatches[0].rule.title} is the strongest match for this question. ${ruleMatches[0].rule.description}`;
    } else if (scenarioMatches.length) {
      summary = `${scenarioMatches[0].scenario.title} is the best existing investigation scenario for this question.`;
    } else {
      summary = "I could not confidently anchor that prompt to a specific entity yet, but the analytics and investigation views still provide useful starting points.";
    }

    const evidence = focusInsights.flatMap((insight) => insight.evidence).slice(0, 8);
    const paragraphs = [
      summary,
      ruleMatches[0]
        ? `Relevant rule hit: ${ruleMatches[0].rule.title} (${ruleMatches[0].rule.hits.length} surfaced hits in this dataset).`
        : "",
      scenarioMatches[0]
        ? `Closest guided case: ${scenarioMatches[0].scenario.title}. Use it to move from the natural-language answer into the investigation workspace.`
        : "",
    ].filter(Boolean);

    return {
      query: trimmedQuery,
      summary,
      paragraphs,
      evidence,
      focusEntityIds,
      focusEntities: focusEntities.map((entity) => ({
        id: entity.id,
        label: entity.label,
        type: entity.type,
        reason: summarizeEntityForCopilot(entity).headline,
      })),
      recommendedScenarioId: scenarioMatches[0]?.scenario?.id || "",
      recommendedRuleId: ruleMatches[0]?.rule?.id || "",
      graph,
      graphStats: `${numberFormatter.format(graph.nodes.length)} nodes · ${numberFormatter.format(graph.edges.length)} edges`,
      suggestedQuestions: [
        focusEntities[0] ? `What locations connect ${focusEntities[0].label} to companies or devices?` : "What address hubs should I investigate next?",
        focusEntities[0] ? `Show the transfer story around ${focusEntities[0].label}` : "Which people combine travel and money movement?",
        "Which existing scenario best explains this pattern?",
      ],
    };
  }

  function runCopilotQuery(query) {
    copilotState.query = query;
    copilotState.result = buildCopilotResponse(query);
    if (copilotState.result?.focusEntityIds?.[0]) {
      ui.selectedGraphNodeId = copilotState.result.focusEntityIds[0];
      ui.selectedEntityId = copilotState.result.focusEntityIds[0];
    }
    render();
  }

  function ensureUiSelection() {
    if (!entityTypeById(ui.selectedEntityTypeId)) {
      ui.selectedEntityTypeId = data.ontology?.entityTypes?.[0]?.id || "";
    }
    if (!relationshipById(ui.selectedRelationshipId)) {
      ui.selectedRelationshipId = data.ontology?.relationshipTypes?.[0]?.id || "";
    }
    if (!mappingById(ui.selectedMappingId)) {
      ui.selectedMappingId = data.mappings?.[0]?.id || "";
    }
    if (!entityById(ui.selectedEntityId)) {
      ui.selectedEntityId = data.entities?.[0]?.id || "";
    }
    if (ui.graphMode === "schema") {
      if (!entityTypeById(ui.selectedGraphNodeId)) {
        ui.selectedGraphNodeId = ui.selectedEntityTypeId;
      }
    } else if (!entityById(ui.selectedGraphNodeId)) {
      ui.selectedGraphNodeId = ui.selectedEntityId;
    }
    if (!analysisState.investigations.find((scenario) => scenario.id === ui.selectedScenarioId)) {
      ui.selectedScenarioId = analysisState.investigations[0]?.id || "";
    }
    if (!analysisState.analytics.find((rule) => rule.id === ui.selectedAnalyticsRuleId)) {
      ui.selectedAnalyticsRuleId = analysisState.analytics[0]?.id || "";
    }
    const visibleMapPlaceIds = new Set(buildMapData().places.map((place) => place.id));
    if (!visibleMapPlaceIds.has(ui.selectedMapNodeId)) {
      ui.selectedMapNodeId = buildMapData().places[0]?.id || "";
    }
  }

  function render() {
    derived = buildDerivedState();
    analysisState.analytics = buildAnalytics();
    analysisState.investigations = buildInvestigations(analysisState.analytics);
    if (copilotState.query) {
      copilotState.result = buildCopilotResponse(copilotState.query);
    }
    ensureUiSelection();

    const focusInfo = captureFocus();

    destroyLeafletMap();
    root.innerHTML = `
      <div class="shell">
        ${renderHeader()}
        ${renderTabs()}
        <div class="layout">
          <section class="workspace">${renderWorkspace()}</section>
          <aside class="inspector">${renderInspector()}</aside>
        </div>
        ${renderWalkthroughCard()}
      </div>
    `;

    restoreFocus(focusInfo);

    if (ui.activeTool === "map") {
      setTimeout(() => {
        const mapData = buildMapData();
        initializeLeafletMap(mapData);
        if (mapRuntime.map) {
          mapRuntime.map.invalidateSize();
        }
      }, 0);
    }
  }

  function captureFocus() {
    const active = document.activeElement;
    if (!active || active === document.body) return null;
    let selector = null;
    if (active.id) {
      selector = "#" + CSS.escape(active.id);
    } else if (active.dataset && active.dataset.scope && active.dataset.field) {
      selector = `${active.tagName.toLowerCase()}[data-scope="${CSS.escape(active.dataset.scope)}"][data-field="${CSS.escape(active.dataset.field)}"]`;
    }
    if (!selector) return null;
    const selStart = typeof active.selectionStart === "number" ? active.selectionStart : null;
    const selEnd = typeof active.selectionEnd === "number" ? active.selectionEnd : null;
    return { selector, selStart, selEnd };
  }

  function restoreFocus(info) {
    if (!info) return;
    const target = document.querySelector(info.selector);
    if (!target) return;
    target.focus();
    if (info.selStart !== null && typeof target.setSelectionRange === "function") {
      try { target.setSelectionRange(info.selStart, info.selEnd); } catch (_) {}
    }
  }

  function renderHeader() {
    const metadata = data.metadata || {};
    const datasetLabels = datasetKeys.map((datasetKey) => {
      const seed = datasetCatalog[datasetKey];
      return {
        key: datasetKey,
        label: seed?.metadata?.dataset ? String(seed.metadata.dataset).toUpperCase() : datasetKey.toUpperCase(),
      };
    });
    const counts = [
      `${data.ontology?.entityTypes?.length || 0} entity types`,
      `${data.ontology?.relationshipTypes?.length || 0} relationship types`,
      `${data.entities?.length || 0} entities`,
      `${data.edges?.length || 0} edges`,
      `${data.mappings?.length || 0} mappings`,
    ];
    return `
      <header class="topbar">
        <div>
          <h1>${escapeHtml(metadata.title || "Ontology Studio Demo")}</h1>
          <p class="subtitle">${escapeHtml(metadata.description || "")}</p>
          <div class="chip-row">
            ${counts.map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join("")}
          </div>
        </div>
        <div class="actions">
          <a class="header-back-link" href="../index.html" title="Back to all demos and docs">← All demos</a>
          <div class="field header-field">
            <label>Dataset</label>
            <select data-scope="dataset" data-field="datasetKey">
              ${datasetLabels
                .map(
                  (dataset) => `
                    <option value="${escapeHtml(dataset.key)}" ${dataset.key === ui.datasetKey ? "selected" : ""}>
                      ${escapeHtml(dataset.label)}
                    </option>
                  `
                )
                .join("")}
            </select>
          </div>
          <button class="walkthrough-launch-btn" data-action="start-walkthrough">▶ Guided tour</button>
          <button class="button-primary" data-action="export-json">Export JSON</button>
          <button class="button-secondary" data-action="reset-state">Reset dataset</button>
        </div>
      </header>
    `;
  }

  function severityClass(severity) {
    if (!severity) return "";
    const s = String(severity).toLowerCase();
    if (s === "high") return "severity-high";
    if (s === "medium") return "severity-medium";
    return "severity-low";
  }

  function renderTabs() {
    const analystButtons = Object.entries(ANALYST_TOOLS)
      .map(
        ([toolId, label]) =>
          `<button class="tab-button analyst-tab ${ui.activeTool === toolId ? "active" : ""}" data-action="switch-tool" data-tool="${toolId}">${escapeHtml(label)}</button>`
      )
      .join("");
    const schemaButtons = Object.entries(SCHEMA_TOOLS)
      .map(
        ([toolId, label]) =>
          `<button class="tab-button ${ui.activeTool === toolId ? "active" : ""}" data-action="switch-tool" data-tool="${toolId}">${escapeHtml(label)}</button>`
      )
      .join("");
    return `
      <nav class="tool-tabs">
        <span class="tab-group-label">Analyst</span>
        <div class="tab-group">${analystButtons}</div>
        <div class="tab-divider"></div>
        <span class="tab-group-label">Schema</span>
        <div class="tab-group">${schemaButtons}</div>
      </nav>
    `;
  }

  function renderWorkspace() {
    switch (ui.activeTool) {
      case "copilot":
        return renderCopilotTool();
      case "investigations":
        return renderInvestigationsTool();
      case "analytics":
        return renderAnalyticsTool();
      case "map":
        return renderMapTool();
      case "entity-types":
        return renderEntityTypesTool();
      case "properties":
        return renderPropertiesTool();
      case "relationships":
        return renderRelationshipsTool();
      case "mappings":
        return renderMappingsTool();
      case "instances":
        return renderInstancesTool();
      case "graph":
        return renderGraphTool();
      default:
        return "";
    }
  }

  function renderInspector() {
    const selection = getInspectorSelection();
    const prompts = data.metadata?.teachingPrompts || [];
    const isInsight = ui.inspectorMode !== "json";
    return `
      <div class="inspector-stack">
        <div class="panel">
          <div class="inspector-toggle-row">
            <h3>${isInsight ? "Insight" : "Raw JSON"}</h3>
            <div style="display:flex;gap:0.4rem">
              <button class="toggle-btn ${isInsight ? "active" : ""}" data-action="inspector-mode" data-mode="insight">Insight</button>
              <button class="toggle-btn ${!isInsight ? "active" : ""}" data-action="inspector-mode" data-mode="json">JSON</button>
            </div>
          </div>
          ${isInsight ? renderInsightPanel(selection) : `<div class="selection-json"><pre>${escapeHtml(JSON.stringify(selection, null, 2))}</pre></div>`}
        </div>
        <div class="panel">
          <h3>Data sources</h3>
          <div class="card-stack">
            ${(data.sources || [])
              .map(
                (source) => `
                  <div class="source-card">
                    <strong>${escapeHtml(source.name)}</strong>
                    <div class="muted">${escapeHtml(source.file)}</div>
                    <div class="microcopy">${escapeHtml(source.description)}</div>
                    <div class="chip-row">
                      <span class="stat-pill">${escapeHtml(`${source.recordCount} records`)}</span>
                      <span class="stat-pill">${escapeHtml(`${source.fields.length} fields`)}</span>
                    </div>
                  </div>
                `
              )
              .join("")}
          </div>
        </div>
        <div class="panel">
          <h3>Teaching prompts</h3>
          <div class="prompt-grid">
            ${prompts
              .map(
                (prompt) => `
                  <div class="prompt-card">
                    <h3>${escapeHtml(prompt)}</h3>
                  </div>
                `
              )
              .join("")}
          </div>
        </div>
      </div>
    `;
  }

  function getInspectorSelection() {
    if (ui.activeTool === "copilot") {
      return copilotState.result || { query: copilotState.query };
    }
    if (ui.activeTool === "map") {
      const mapData = buildMapData();
      return {
        scope: mapData.summary.scope,
        selectedPlace: mapData.selectedPlace,
        routeCount: mapData.routes.length,
        visiblePlaces: mapData.places.length,
      };
    }
    if (ui.activeTool === "investigations") {
      return analysisState.investigations.find((scenario) => scenario.id === ui.selectedScenarioId) || {};
    }
    if (ui.activeTool === "analytics") {
      return analysisState.analytics.find((rule) => rule.id === ui.selectedAnalyticsRuleId) || {};
    }
    if (ui.activeTool === "entity-types" || ui.activeTool === "properties") {
      return entityTypeById(ui.selectedEntityTypeId) || {};
    }
    if (ui.activeTool === "relationships") {
      return relationshipById(ui.selectedRelationshipId) || {};
    }
    if (ui.activeTool === "mappings") {
      return mappingById(ui.selectedMappingId) || {};
    }
    if (ui.activeTool === "instances") {
      return {
        entity: entityById(ui.selectedEntityId) || {},
        connectedEdges: edgesForEntity(ui.selectedEntityId),
      };
    }
    if (ui.graphMode === "schema") {
      return entityTypeById(ui.selectedGraphNodeId) || {};
    }
    return {
      entity: entityById(ui.selectedGraphNodeId) || {},
      connectedEdges: edgesForEntity(ui.selectedGraphNodeId),
    };
  }

  function insightRow(label, value) {
    if (!value) return "";
    return `<div class="insight-section"><div class="insight-label">${escapeHtml(label)}</div><div class="insight-value">${escapeHtml(String(value))}</div></div>`;
  }

  function insightEvidenceList(items) {
    if (!items || !items.length) return "";
    return `<div class="insight-evidence-list">${items.map((item) => `<div class="insight-evidence-item">${escapeHtml(item)}</div>`).join("")}</div>`;
  }

  function renderInsightPanel(selection) {
    const tool = ui.activeTool;

    if (tool === "investigations") {
      const scenario = analysisState.investigations.find((s) => s.id === ui.selectedScenarioId);
      if (!scenario) return `<p class="microcopy">No scenario selected.</p>`;
      const maxScore = Math.max(...analysisState.investigations.map((s) => s.score), 1);
      const pct = Math.round((scenario.score / maxScore) * 100);
      return `
        <div class="insight-section">
          <div class="insight-label">Scenario</div>
          <div class="insight-value" style="font-weight:600">${escapeHtml(scenario.title)}</div>
        </div>
        <div class="insight-section">
          <span class="severity-badge ${severityClass(scenario.severity)}">${escapeHtml(scenario.severity)}</span>
          <div class="score-bar-wrap">
            <div class="score-bar-track"><div class="score-bar-fill" style="width:${pct}%"></div></div>
            <span class="score-label">score ${scenario.score}</span>
          </div>
        </div>
        ${insightRow("Summary", scenario.summary)}
        ${scenario.facts?.length ? `<div class="insight-section"><div class="insight-label">Key facts</div>${insightEvidenceList(scenario.facts)}</div>` : ""}
        <div class="teaching-tip"><strong>Teaching tip</strong>${escapeHtml(scenario.facts?.[1] || "Ask students what additional sources would strengthen this case.")}</div>
      `;
    }

    if (tool === "analytics") {
      const rule = analysisState.analytics.find((r) => r.id === ui.selectedAnalyticsRuleId);
      if (!rule) return `<p class="microcopy">No rule selected.</p>`;
      const topHit = rule.hits[0];
      const maxScore = Math.max(...rule.hits.map((h) => h.score), 1);
      return `
        <div class="insight-section">
          <div class="insight-label">Rule</div>
          <div class="insight-value" style="font-weight:600">${escapeHtml(rule.title)}</div>
        </div>
        <div class="insight-section">
          <span class="severity-badge ${severityClass(rule.severity)}">${escapeHtml(rule.severity)}</span>
          <span class="stat-pill" style="margin-left:0.5rem">${rule.hits.length} hits</span>
        </div>
        ${insightRow("How it works", rule.description)}
        ${topHit ? `
          <div class="insight-section">
            <div class="insight-label">Top hit</div>
            <div class="insight-value" style="font-weight:600">${escapeHtml(topHit.label)}</div>
            <div class="score-bar-wrap">
              <div class="score-bar-track"><div class="score-bar-fill" style="width:${Math.round((topHit.score / maxScore) * 100)}%"></div></div>
              <span class="score-label">score ${topHit.score}</span>
            </div>
            <div class="microcopy" style="margin-top:0.4rem">${escapeHtml(topHit.detail)}</div>
          </div>
        ` : ""}
        <div class="teaching-tip"><strong>Teaching tip</strong>Ask students why these results surface before any manual investigation.</div>
      `;
    }

    if (tool === "copilot") {
      const result = copilotState.result;
      if (!result) return `<p class="microcopy">Ask the copilot a question to see its evidence here.</p>`;
      const focusEntity = result.focusEntities?.[0];
      return `
        ${focusEntity ? `
          <div class="insight-section">
            <div class="insight-label">Primary focus</div>
            <div class="insight-value" style="font-weight:600">${escapeHtml(focusEntity.label)}</div>
            <div class="microcopy">${escapeHtml(focusEntity.type)}</div>
          </div>
          <div class="insight-section">
            <div class="insight-label">Why this entity</div>
            <div class="microcopy">${escapeHtml(focusEntity.reason)}</div>
          </div>
        ` : ""}
        ${result.evidence?.length ? `<div class="insight-section"><div class="insight-label">Linked evidence</div>${insightEvidenceList(result.evidence.slice(0, 5))}</div>` : ""}
        <div class="teaching-tip"><strong>Teaching tip</strong>This answer is assembled from graph links, not generated text. Ask students how it would change if a source link was missing.</div>
      `;
    }

    if (tool === "map") {
      const mapData = buildMapData();
      const place = mapData.selectedPlace;
      if (!place) return `<p class="microcopy">Select a map marker to inspect it.</p>`;
      return `
        ${insightRow("Place", place.label)}
        ${insightRow("Type", place.context || place.type)}
        ${insightRow("Summary", place.detail)}
        ${place.people?.length ? insightRow("Linked people", place.people.slice(0, 4).map((p) => p.label).join(", ")) : ""}
        ${place.companies?.length ? insightRow("Companies here", place.companies.slice(0, 3).map((c) => c.label).join(", ")) : ""}
        ${place.travelers?.length ? insightRow("Travelers", place.travelers.slice(0, 4).map((p) => p.label).join(", ")) : ""}
        <div class="teaching-tip"><strong>Teaching tip</strong>A shared address or airport becomes important because the ontology has already linked companies, devices, and people to it.</div>
      `;
    }

    if (tool === "entity-types" || tool === "properties") {
      const et = entityTypeById(ui.selectedEntityTypeId);
      if (!et) return `<p class="microcopy">No entity type selected.</p>`;
      return `
        <div class="insight-section">
          <div class="insight-label">Entity type</div>
          <div class="insight-value" style="display:flex;align-items:center;gap:0.5rem;font-weight:600">
            <span class="entity-dot" style="background:${escapeHtml(et.color)}"></span>${escapeHtml(et.name)}
          </div>
        </div>
        ${insightRow("Description", et.description)}
        ${insightRow("Instances", String(entityCount(et.id)))}
        <div class="insight-section">
          <div class="insight-label">Properties (${et.properties?.length || 0})</div>
          <div class="insight-evidence-list">${(et.properties || []).map((p) => `<div class="insight-evidence-item">${escapeHtml(p.label)} <span class="muted">(${escapeHtml(p.type)})</span></div>`).join("")}</div>
        </div>
        <div class="teaching-tip"><strong>Teaching tip</strong>Each entity type becomes a durable object in the graph. Properties are the fields that can be searched, filtered, and linked.</div>
      `;
    }

    if (tool === "relationships") {
      const rel = relationshipById(ui.selectedRelationshipId);
      if (!rel) return `<p class="microcopy">No relationship selected.</p>`;
      const edgeCount = (data.edges || []).filter((e) => e.type === rel.id).length;
      return `
        <div class="insight-section">
          <div class="insight-label">Relationship</div>
          <div class="insight-value" style="display:flex;align-items:center;gap:0.5rem;font-weight:600">
            <span class="swatch" style="background:${escapeHtml(rel.color)}"></span>${escapeHtml(rel.label)}
          </div>
        </div>
        ${insightRow("Direction", `${rel.sourceType} → ${rel.targetType}`)}
        ${insightRow("Edge count", String(edgeCount))}
        ${insightRow("Description", rel.description)}
        <div class="teaching-tip"><strong>Teaching tip</strong>Ask: is this relationship directly observed from a source, or inferred from co-occurrence?</div>
      `;
    }

    if (tool === "mappings") {
      const mapping = mappingById(ui.selectedMappingId);
      if (!mapping) return `<p class="microcopy">No mapping selected.</p>`;
      return `
        ${insightRow("Source", mapping.sourceId)}
        ${insightRow("Fields", mapping.sourceFields)}
        ${insightRow("Target type", mapping.targetType)}
        ${insightRow("Rule", mapping.rule)}
        <div class="teaching-tip"><strong>Teaching tip</strong>Source mappings are where raw columns become durable ontology objects. Every field declared here is reusable across all analyst workflows.</div>
      `;
    }

    // instances / graph fallback
    const entity = entityById(ui.selectedEntityId || ui.selectedGraphNodeId);
    if (!entity) return `<p class="microcopy">Select an entity to inspect it.</p>`;
    const et2 = entityTypeById(entity.type);
    const summary = summarizeEntityForCopilot(entity);
    return `
      <div class="insight-section">
        <div class="insight-label">Entity</div>
        <div class="insight-value" style="display:flex;align-items:center;gap:0.5rem;font-weight:600">
          <span class="entity-dot" style="background:${escapeHtml(et2?.color || "#94a3b8")}"></span>${escapeHtml(entity.label)}
        </div>
        <div class="microcopy">${escapeHtml(entity.type)}</div>
      </div>
      ${summary.headline ? `<div class="insight-section"><div class="insight-label">Summary</div><div class="microcopy">${escapeHtml(summary.headline)}</div></div>` : ""}
      ${summary.evidence?.length ? `<div class="insight-section"><div class="insight-label">Evidence</div>${insightEvidenceList(summary.evidence.slice(0, 5))}</div>` : ""}
    `;
  }

  function renderWalkthroughCard() {
    if (!walkthroughState.active) return "";
    const step = WALKTHROUGH_STEPS[walkthroughState.step];
    if (!step) return "";
    const total = WALKTHROUGH_STEPS.length;
    const dots = WALKTHROUGH_STEPS.map((_, i) => {
      let cls = "walkthrough-dot";
      if (i < walkthroughState.step) cls += " done";
      if (i === walkthroughState.step) cls += " current";
      return `<div class="${cls}"></div>`;
    }).join("");
    const isLast = walkthroughState.step === total - 1;
    return `
      <div class="walkthrough-card">
        <div class="walkthrough-header">
          <span class="walkthrough-step-counter">Step ${walkthroughState.step + 1} of ${total}</span>
          <button class="walkthrough-close" data-action="close-walkthrough" title="Close tour">✕</button>
        </div>
        <div class="walkthrough-progress">${dots}</div>
        <div class="walkthrough-title">${escapeHtml(step.title)}</div>
        <p class="walkthrough-desc">${escapeHtml(step.desc)}</p>
        ${step.bullets ? `<ul class="walkthrough-bullets">${step.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>` : ""}
        <div class="walkthrough-actions">
          ${walkthroughState.step > 0 ? `<button class="walkthrough-btn walkthrough-btn-back" data-action="walkthrough-back">← Back</button>` : ""}
          <button class="walkthrough-btn walkthrough-btn-next" data-action="walkthrough-next">${isLast ? "Finish ✓" : "Next →"}</button>
        </div>
      </div>
    `;
  }

  function renderCopilotTool() {
    const result = copilotState.result;
    const resultGraph = result?.graph?.nodes?.length
      ? buildEntityGraph(result.graph.nodes, result.graph.edges, result.focusEntityIds || [], ui.selectedGraphNodeId)
      : null;
    return `
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2>Analyst copilot</h2>
            <p class="microcopy">Ask a plain-English question and the copilot will pull together linked evidence from the ontology, analytics, and investigation graph.</p>
          </div>
        </div>
        <div class="copilot-layout">
          <div class="card-stack">
            <div class="property-card">
              <div class="field">
                <label>Ask a question</label>
                <textarea class="copilot-input" data-scope="copilot" data-field="query" placeholder="Bring together Kareem Haddad across companies, flights, transfers, and devices">${escapeHtml(copilotState.query)}</textarea>
              </div>
              <div class="chip-row">
                ${COPILOT_EXAMPLES.map(
                  (example) => `<button class="ghost-button" data-action="copilot-example" data-query="${escapeHtml(example)}">${escapeHtml(example)}</button>`
                ).join("")}
              </div>
              <div class="inline-actions">
                <button class="button-primary" data-action="run-copilot">Ask copilot</button>
              </div>
            </div>
            ${result ? `
              <div class="property-card">
                <h3>Answer</h3>
                <div class="stack-list">
                  ${result.paragraphs.map((paragraph) => `<div class="fact-item">${escapeHtml(paragraph)}</div>`).join("")}
                </div>
                <div class="grounding-summary microcopy">${escapeHtml(`${result.graph?.nodes?.length || 0} entities matched · ${result.graph?.edges?.length || 0} relationships traversed · answer grounded in ontology`)}</div>
              </div>
              <div class="property-card">
                <h3>Linked evidence</h3>
                <div class="stack-list">
                  ${(result.evidence || []).map((item) => `<div class="fact-item">${escapeHtml(item)}</div>`).join("") || `<div class="fact-item">No evidence extracted yet.</div>`}
                </div>
              </div>
            ` : `
              <div class="property-card">
                <div class="list-item-title">
                  <h3>How this copilot is grounded</h3>
                  <span class="grounding-badge">⬡ Ontology-grounded</span>
                </div>
                <div class="stack-list">
                  <div class="fact-item">Anchors natural-language prompts to people, companies, locations, devices, flights, accounts, analytics hits, and investigation scenarios.</div>
                  <div class="fact-item">Synthesizes cross-source evidence into a short analyst-friendly answer.</div>
                  <div class="fact-item">Lets students jump from plain-English questions into structured ontology and case views.</div>
                  <div class="fact-item">Every entity and edge in an answer exists in the ontology — nothing is generated from training data.</div>
                </div>
              </div>
              <div class="property-card">
                <h3>Without the ontology vs. with it</h3>
                <div class="comparison-row">
                  <div>
                    <div class="comparison-label">Without</div>
                    <pre class="fact-item comparison-pre">bank_transactions.csv row 14:
  account_id: ACC-002
  to_account: ACC-009
  amount: 47000
  ref: TXF-8812</pre>
                  </div>
                  <div>
                    <div class="comparison-label">With ontology</div>
                    <div class="fact-item">Kareem Haddad → OWNS_ACCOUNT → ACC-002 → TRANSFERRED_TO → ACC-009<br><br>ACC-009 is linked to Cyprus Shell Co Ltd (DIRECTS: Kareem Haddad)<br><br>Corroborated by: 3 mobile location pings near Larnaca Airport</div>
                  </div>
                </div>
              </div>
            `}
          </div>
          <div class="card-stack">
            ${result ? `
              <div class="property-card">
                <div class="list-item-title">
                  <h3>Focus entities</h3>
                  <span class="muted">${escapeHtml(result.graphStats || "")}</span>
                </div>
                <div class="entity-jump-grid">
                  ${result.focusEntities.map(
                    (entity) => `
                      <div class="place-card">
                        <div class="list-item-title">
                          <span>${escapeHtml(entity.label)}</span>
                          <span class="muted">${escapeHtml(entity.type)}</span>
                        </div>
                        <div class="microcopy">${escapeHtml(entity.reason)}</div>
                        <div class="inline-actions">
                          <button class="ghost-button" data-action="copilot-jump-entity" data-id="${escapeHtml(entity.id)}">Open in graph</button>
                        </div>
                      </div>
                    `
                  ).join("") || `<div class="fact-item">No focal entities were identified for this prompt.</div>`}
                </div>
              </div>
              <div class="property-card">
                <h3>Answer graph</h3>
                <div class="graph-canvas">
                  ${resultGraph ? resultGraph.svg : `<div class="empty-state">No graph available for this answer.</div>`}
                </div>
              </div>
              <div class="property-card">
                <h3>Quick jumps</h3>
                <div class="inline-actions">
                  ${result.recommendedScenarioId ? `<button class="button-secondary" data-action="copilot-jump-scenario" data-id="${escapeHtml(result.recommendedScenarioId)}">Open matching scenario</button>` : ""}
                  ${result.recommendedRuleId ? `<button class="button-secondary" data-action="copilot-jump-rule" data-id="${escapeHtml(result.recommendedRuleId)}">Open matching rule</button>` : ""}
                </div>
                <div class="stack-list">
                  ${(result.suggestedQuestions || []).map((question) => `<div class="fact-item">${escapeHtml(question)}</div>`).join("")}
                </div>
              </div>
            ` : `
              <div class="property-card">
                <h3>Try asking</h3>
                <div class="stack-list">
                  ${COPILOT_EXAMPLES.map((example) => `<div class="fact-item">${escapeHtml(example)}</div>`).join("")}
                </div>
              </div>
            `}
          </div>
        </div>
      </div>
    `;
  }

  function renderMapTool() {
    const mapData = buildMapData();
    const selectedPlace = mapData.selectedPlace;
    return `
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2>Geospatial map</h2>
            <p class="microcopy">Inspect airports, addresses, and observed places with routes layered on top of the ontology graph.</p>
          </div>
        </div>
        <div class="map-layout">
          <div class="property-card" style="padding:0.75rem">
            <div class="map-controls-row">
              <div class="field">
                <label>Scope</label>
                <select data-scope="map" data-field="scope">
                  <option value="dataset" ${ui.mapScope === "dataset" ? "selected" : ""}>Whole dataset</option>
                  <option value="scenario" ${ui.mapScope === "scenario" ? "selected" : ""}>Selected scenario</option>
                  <option value="copilot" ${ui.mapScope === "copilot" ? "selected" : ""}>Copilot answer</option>
                </select>
              </div>
              <div class="field">
                <label>Markers</label>
                <select data-scope="map" data-field="placeFilter">
                  <option value="all" ${ui.mapPlaceFilter === "all" ? "selected" : ""}>Airports + locations</option>
                  <option value="Airport" ${ui.mapPlaceFilter === "Airport" ? "selected" : ""}>Airports only</option>
                  <option value="Location" ${ui.mapPlaceFilter === "Location" ? "selected" : ""}>Locations only</option>
                </select>
              </div>
              <div class="field">
                <label>Search</label>
                <input value="${escapeHtml(ui.mapSearch)}" placeholder="Search airport or address" data-scope="map" data-field="search">
              </div>
              <div class="chip-row" style="align-items:flex-end;padding-bottom:0.2rem">
                <span class="chip">${escapeHtml(mapData.summary.scope)}</span>
                <span class="chip">${escapeHtml(`${mapData.places.length} places`)}</span>
                <span class="chip">${escapeHtml(`${mapData.routes.length} routes`)}</span>
              </div>
            </div>
            <div class="map-canvas">
              ${mapData.places.length
                ? `<div id="leaflet-map" class="leaflet-map" style="height:560px" aria-label="Geospatial investigation map"></div>`
                : `<div class="empty-state" style="padding:2rem">No mapped places are available for this scope yet.</div>`
              }
            </div>
          </div>
          <div class="map-bottom-row">
            <div class="property-card">
              <h3>Top hotspots</h3>
              <div class="place-list">
                ${mapData.places
                  .slice(0, 8)
                  .map(
                    (place) => `
                      <button class="place-card map-list-button ${selectedPlace?.id === place.id ? "active" : ""}" data-action="select-map-node" data-id="${escapeHtml(place.id)}">
                        <div class="list-item-title">
                          <span><span class="entity-dot" style="background:${escapeHtml(place.color)}"></span>${escapeHtml(place.label)}</span>
                          <span class="muted">${escapeHtml(place.locationType)}</span>
                        </div>
                        ${place.context ? `<div class="microcopy">${escapeHtml(place.context)}</div>` : ""}
                        <div class="microcopy">${escapeHtml(place.detail)}</div>
                      </button>
                    `
                  )
                  .join("")}
              </div>
            </div>
            <div class="property-card">
              <h3>${escapeHtml(selectedPlace?.label || "Selected place")}</h3>
              ${selectedPlace
                ? `
                  <div class="chip-row">
                    <span class="chip">${escapeHtml(selectedPlace.type)}</span>
                    ${selectedPlace.context ? `<span class="chip">${escapeHtml(selectedPlace.context)}</span>` : ""}
                    <span class="chip">${escapeHtml(`${selectedPlace.relatedCount} linked edges`)}</span>
                  </div>
                  <div class="stack-list">
                    <div class="fact-item">${escapeHtml(selectedPlace.detail)}</div>
                    ${selectedPlace.type === "Location"
                      ? `
                        ${selectedPlace.people.length ? `<div class="fact-item">People: ${escapeHtml(selectedPlace.people.slice(0, 5).map((p) => p.label).join(", "))}</div>` : ""}
                        ${selectedPlace.companies.length ? `<div class="fact-item">Companies: ${escapeHtml(selectedPlace.companies.slice(0, 5).map((c) => c.label).join(", "))}</div>` : ""}
                      `
                      : `
                        ${selectedPlace.travelers.length ? `<div class="fact-item">Travelers: ${escapeHtml(selectedPlace.travelers.slice(0, 6).map((p) => p.label).join(", "))}</div>` : ""}
                        <div class="fact-item">Flights: ${escapeHtml(String(selectedPlace.departures.length + selectedPlace.arrivals.length))}</div>
                      `
                    }
                  </div>
                  <div class="inline-actions">
                    <button class="ghost-button" data-action="map-jump-graph" data-id="${escapeHtml(selectedPlace.id)}">Open in graph</button>
                  </div>
                `
                : `<div class="empty-state">Select a place marker to inspect it.</div>`
              }
            </div>
            <div class="property-card">
              <h3>Route activity</h3>
              <div class="table-shell">
                <table>
                  <thead><tr><th>Route</th><th>Flights</th><th>Pax</th></tr></thead>
                  <tbody>
                    ${mapData.routes
                      .slice(0, 10)
                      .map(
                        (route) => `
                          <tr>
                            <td>${escapeHtml(`${route.fromLabel} → ${route.toLabel}`)}</td>
                            <td>${escapeHtml(String(route.flightCount))}</td>
                            <td>${escapeHtml(String(route.passengerCount))}</td>
                          </tr>
                        `
                      )
                      .join("") || `<tr><td colspan="3" class="muted">No routes in this scope.</td></tr>`}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderInvestigationsTool() {
    const selectedScenario = analysisState.investigations.find((scenario) => scenario.id === ui.selectedScenarioId);
    if (!selectedScenario) {
      return `<div class="panel"><div class="empty-state">No investigation scenarios are available for this dataset.</div></div>`;
    }
    const graph = buildEntityGraph(selectedScenario.graph.nodes, selectedScenario.graph.edges, selectedScenario.focusEntityIds, ui.selectedGraphNodeId);
    return `
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2>Investigation workspace</h2>
            <p class="microcopy">Move from ontology design into case analysis using guided scenarios derived from the current graph.</p>
          </div>
        </div>
        <div class="scenario-grid">
          ${analysisState.investigations
            .map(
              (scenario) => `
                <button class="scenario-card ${scenario.id === ui.selectedScenarioId ? "active" : ""}" data-action="select-scenario" data-id="${escapeHtml(scenario.id)}">
                  <div class="list-item-title">
                    <span>${escapeHtml(scenario.title)}</span>
                    <span class="severity-badge ${severityClass(scenario.severity)}">${escapeHtml(scenario.severity)}</span>
                  </div>
                  <div class="microcopy">${escapeHtml(scenario.summary)}</div>
                  <div class="chip-row">
                    <span class="stat-pill">${escapeHtml(`${scenario.graph.nodes.length} nodes`)}</span>
                    <span class="stat-pill">${escapeHtml(`${scenario.graph.edges.length} edges`)}</span>
                  </div>
                </button>
              `
            )
            .join("")}
        </div>
        <div class="case-layout">
          <div class="card-stack">
            <div class="property-card">
              <h3>${escapeHtml(selectedScenario.title)}</h3>
              <p class="microcopy">${escapeHtml(selectedScenario.summary)}</p>
              <div class="chip-row">
                <span class="severity-badge ${severityClass(selectedScenario.severity)}">${escapeHtml(selectedScenario.severity)}</span>
                <span class="chip">${escapeHtml(`score ${selectedScenario.score}`)}</span>
                <span class="chip">${escapeHtml(`${selectedScenario.focusEntityIds.length} focus nodes`)}</span>
              </div>
              <div class="stack-list">
                ${selectedScenario.facts.map((fact) => `<div class="fact-item">${escapeHtml(fact)}</div>`).join("")}
              </div>
            </div>
            <div class="property-card">
              <h3>Recommended Actions</h3>
              <p class="microcopy">In a production system, these actions would be permissioned and audited. Click to log an action.</p>
              <div class="inline-actions">
                ${selectedScenario.actions.map(
                  (actionLabel) => `<button class="ghost-button" data-action="execute-scenario-action" data-scenario-id="${escapeHtml(selectedScenario.id)}" data-scenario-title="${escapeHtml(selectedScenario.title)}" data-action-label="${escapeHtml(actionLabel)}">${escapeHtml(actionLabel)}</button>`
                ).join("")}
              </div>
              <div class="action-log">
                ${analysisState.actionLog.filter((entry) => entry.scenarioId === selectedScenario.id).length
                  ? analysisState.actionLog
                      .filter((entry) => entry.scenarioId === selectedScenario.id)
                      .map((entry) => `<div class="action-log-entry"><span class="action-log-ts">${escapeHtml(entry.ts)}</span> — ${escapeHtml(entry.action)}</div>`)
                      .join("")
                  : `<div class="action-log-empty">No actions taken yet.</div>`
                }
              </div>
            </div>
            <div class="property-card">
              <h3>Saved graph paths</h3>
              <div class="stack-list">
                ${selectedScenario.paths.map((path) => `<div class="fact-item">${escapeHtml(path)}</div>`).join("")}
              </div>
            </div>
            <div class="property-card">
              <h3>Transfer summary</h3>
              <div class="table-shell">
                <table>
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Target</th>
                      <th>Total</th>
                      <th>Events</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${selectedScenario.transfers
                      .map(
                        (transfer) => `
                          <tr>
                            <td>${escapeHtml(transfer.sourceLabel)}</td>
                            <td>${escapeHtml(transfer.targetLabel)}</td>
                            <td>${escapeHtml(currencyFormatter.format(transfer.totalAmountUsd))}</td>
                            <td>${escapeHtml(`${transfer.count}`)}</td>
                          </tr>
                        `
                      )
                      .join("") || `<tr><td colspan="4" class="muted">No transfer edges in this scenario.</td></tr>`}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <div class="card-stack">
            <div class="property-card">
              <h3>Scenario graph</h3>
              <div class="graph-canvas">
                ${graph.svg}
              </div>
            </div>
            <div class="property-card">
              <h3>Timeline</h3>
              <div class="timeline-list">
                ${selectedScenario.timeline
                  .map(
                    (event) => `
                      <div class="timeline-item">
                        <strong>${escapeHtml(event.title)}</strong>
                        <div class="muted">${escapeHtml(event.ts || "Derived relationship")}</div>
                        <div>${escapeHtml(event.detail)}</div>
                      </div>
                    `
                  )
                  .join("")}
              </div>
            </div>
            <div class="property-card">
              <h3>Location panel</h3>
              <div class="place-list">
                ${selectedScenario.places
                  .map(
                    (place) => `
                      <div class="place-card">
                        <div class="list-item-title">
                          <span>${escapeHtml(place.label)}</span>
                          <span class="muted">${escapeHtml(place.type)}</span>
                        </div>
                        <div class="microcopy">${escapeHtml(place.detail)}</div>
                        <div class="chip-row">
                          <span class="stat-pill">${escapeHtml(`${place.relatedCount} connected edges`)}</span>
                          ${place.lat && place.lon ? `<span class="stat-pill">${escapeHtml(`${place.lat}, ${place.lon}`)}</span>` : ""}
                        </div>
                      </div>
                    `
                  )
                  .join("")}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderAnalyticsTool() {
    const selectedRule = analysisState.analytics.find((rule) => rule.id === ui.selectedAnalyticsRuleId);
    if (!selectedRule) {
      return `<div class="panel"><div class="empty-state">No analytics rules are available for this dataset.</div></div>`;
    }
    return `
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2>Rule-based analytics</h2>
            <p class="microcopy">Show students how suspicious patterns emerge from the ontology after data is normalized and linked.</p>
          </div>
        </div>
        <div class="rule-grid">
          ${analysisState.analytics
            .map(
              (rule) => `
                <button class="scenario-card ${rule.id === ui.selectedAnalyticsRuleId ? "active" : ""}" data-action="select-rule" data-id="${escapeHtml(rule.id)}">
                  <div class="list-item-title">
                    <span>${escapeHtml(rule.title)}</span>
                    <span class="severity-badge ${severityClass(rule.severity)}">${escapeHtml(rule.severity)}</span>
                  </div>
                  <div class="microcopy">${escapeHtml(rule.description)}</div>
                  <div class="chip-row">
                    <span class="stat-pill">${escapeHtml(`${rule.hits.length} hits`)}</span>
                  </div>
                </button>
              `
            )
            .join("")}
        </div>
        <div class="case-layout">
          <div class="property-card">
            <h3>${escapeHtml(selectedRule.title)}</h3>
            <p class="microcopy">${escapeHtml(selectedRule.description)}</p>
            <div class="chip-row">
              <span class="severity-badge ${severityClass(selectedRule.severity)}">${escapeHtml(selectedRule.severity)}</span>
              <span class="chip">${escapeHtml(`${selectedRule.hits.length} surfaced hits`)}</span>
            </div>
          </div>
          <div class="property-card">
            <h3>Top hits</h3>
            <div class="table-shell">
              <table>
                <thead>
                  <tr>
                    <th>Entity or artifact</th>
                    <th>Score</th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  ${selectedRule.hits
                    .map(
                      (hit) => `
                        <tr>
                          <td>${escapeHtml(hit.label)}</td>
                          <td>${escapeHtml(String(hit.score))}</td>
                          <td>${escapeHtml(hit.detail)}</td>
                        </tr>
                      `
                    )
                    .join("")}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderEntityTypesTool() {
    const selected = entityTypeById(ui.selectedEntityTypeId);
    if (!selected) {
      return `<div class="panel"><div class="empty-state">No entity types available.</div></div>`;
    }
    return `
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2>Entity type editor</h2>
            <p class="microcopy">Define the ontology objects students can work with.</p>
          </div>
          <button class="button-primary" data-action="add-entity-type">Add entity type</button>
        </div>
        <div class="editor-grid">
          <div class="sidebar-list">
            ${(data.ontology?.entityTypes || [])
              .map(
                (entityType) => `
                  <button class="list-item ${entityType.id === ui.selectedEntityTypeId ? "active" : ""}" data-action="select-entity-type" data-id="${escapeHtml(entityType.id)}">
                    <div class="list-item-title">
                      <span><span class="swatch" style="background:${escapeHtml(entityType.color)}"></span>${escapeHtml(entityType.name)}</span>
                      <span class="muted">${entityCount(entityType.id)}</span>
                    </div>
                    <small>${escapeHtml(entityType.description)}</small>
                  </button>
                `
              )
              .join("")}
          </div>
          <div class="card-stack">
            <div class="property-card">
              <div class="form-grid">
                ${renderField("Entity ID", selected.id, { disabled: true })}
                ${renderField("Display name", selected.name, { scope: "entity-type", field: "name" })}
                ${renderField("Color", selected.color, { scope: "entity-type", field: "color", type: "color" })}
                ${renderField("Instance count", String(entityCount(selected.id)), { disabled: true })}
              </div>
              <div class="field">
                <label>Description</label>
                <textarea data-scope="entity-type" data-field="description">${escapeHtml(selected.description || "")}</textarea>
              </div>
              <div class="inline-actions">
                <button class="button-danger" data-action="delete-entity-type" data-id="${escapeHtml(selected.id)}">Delete entity type</button>
              </div>
            </div>
            <div class="stat-card">
              <h3>Properties on this type</h3>
              <div class="table-shell">
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Label</th>
                      <th>Type</th>
                      <th>Required</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${(selected.properties || [])
                      .map(
                        (property) => `
                          <tr>
                            <td>${escapeHtml(property.id)}</td>
                            <td>${escapeHtml(property.label)}</td>
                            <td>${escapeHtml(property.type)}</td>
                            <td>${property.required ? "Yes" : "No"}</td>
                          </tr>
                        `
                      )
                      .join("")}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderPropertiesTool() {
    const selected = entityTypeById(ui.selectedEntityTypeId);
    if (!selected) {
      return `<div class="panel"><div class="empty-state">No entity type selected.</div></div>`;
    }
    return `
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2>Property editor</h2>
            <p class="microcopy">Shape the fields each entity type exposes in the instance editor and graph detail views.</p>
          </div>
          <div class="actions">
            <select data-scope="properties" data-field="selectedTypeId">
              ${(data.ontology?.entityTypes || [])
                .map(
                  (entityType) => `
                    <option value="${escapeHtml(entityType.id)}" ${entityType.id === ui.selectedEntityTypeId ? "selected" : ""}>
                      ${escapeHtml(entityType.name)}
                    </option>
                  `
                )
                .join("")}
            </select>
            <button class="button-primary" data-action="add-property" data-type-id="${escapeHtml(selected.id)}">Add property</button>
          </div>
        </div>
        <div class="card-stack">
          ${(selected.properties || [])
            .map(
              (property) => `
                <div class="property-card">
                  <div class="form-grid">
                    ${renderField("Property ID", property.id, { scope: "property", propertyId: property.id, field: "id" })}
                    ${renderField("Label", property.label, { scope: "property", propertyId: property.id, field: "label" })}
                    ${renderSelect("Type", property.type, ["string", "number", "date", "datetime"], { scope: "property", propertyId: property.id, field: "type" })}
                    ${renderSelect("Required", String(Boolean(property.required)), ["true", "false"], { scope: "property", propertyId: property.id, field: "required" })}
                  </div>
                  <div class="field">
                    <label>Description</label>
                    <textarea data-scope="property" data-property-id="${escapeHtml(property.id)}" data-field="description">${escapeHtml(property.description || "")}</textarea>
                  </div>
                  <div class="inline-actions">
                    <button class="button-danger" data-action="delete-property" data-type-id="${escapeHtml(selected.id)}" data-property-id="${escapeHtml(property.id)}">Delete property</button>
                  </div>
                </div>
              `
            )
            .join("")}
        </div>
      </div>
    `;
  }

  function renderRelationshipsTool() {
    const selected = relationshipById(ui.selectedRelationshipId);
    if (!selected) {
      return `<div class="panel"><div class="empty-state">No relationship types available.</div></div>`;
    }
    const typeOptions = (data.ontology?.entityTypes || []).map((entityType) => entityType.id);
    return `
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2>Relationship editor</h2>
            <p class="microcopy">Adjust how entity types connect and see the graph explorer update live.</p>
          </div>
          <button class="button-primary" data-action="add-relationship">Add relationship</button>
        </div>
        <div class="editor-grid">
          <div class="sidebar-list">
            ${(data.ontology?.relationshipTypes || [])
              .map(
                (relationship) => `
                  <button class="list-item ${relationship.id === ui.selectedRelationshipId ? "active" : ""}" data-action="select-relationship" data-id="${escapeHtml(relationship.id)}">
                    <div class="list-item-title">
                      <span><span class="swatch" style="background:${escapeHtml(relationship.color)}"></span>${escapeHtml(relationship.label)}</span>
                      <span class="muted">${(data.edges || []).filter((edge) => edge.type === relationship.id).length}</span>
                    </div>
                    <small>${escapeHtml(`${relationship.sourceType} -> ${relationship.targetType}`)}</small>
                  </button>
                `
              )
              .join("")}
          </div>
          <div class="card-stack">
            <div class="property-card">
              <div class="form-grid">
                ${renderField("Relationship ID", selected.id, { disabled: true })}
                ${renderField("Label", selected.label, { scope: "relationship", field: "label" })}
                ${renderSelect("Source type", selected.sourceType, typeOptions, { scope: "relationship", field: "sourceType" })}
                ${renderSelect("Target type", selected.targetType, typeOptions, { scope: "relationship", field: "targetType" })}
                ${renderField("Color", selected.color, { scope: "relationship", field: "color", type: "color" })}
                ${renderField("Edge count", String((data.edges || []).filter((edge) => edge.type === selected.id).length), { disabled: true })}
              </div>
              <div class="field">
                <label>Description</label>
                <textarea data-scope="relationship" data-field="description">${escapeHtml(selected.description || "")}</textarea>
              </div>
              <div class="inline-actions">
                <button class="button-danger" data-action="delete-relationship" data-id="${escapeHtml(selected.id)}">Delete relationship</button>
              </div>
            </div>
            <div class="stat-card">
              <h3>Example edges</h3>
              <div class="table-shell">
                <table>
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Target</th>
                      <th>Properties</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${(data.edges || [])
                      .filter((edge) => edge.type === selected.id)
                      .slice(0, 8)
                      .map(
                        (edge) => `
                          <tr>
                            <td>${escapeHtml(entityLabel(edge.source))}</td>
                            <td>${escapeHtml(entityLabel(edge.target))}</td>
                            <td>${escapeHtml(JSON.stringify(edge.properties || {}))}</td>
                          </tr>
                        `
                      )
                      .join("")}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderMappingsTool() {
    const selected = mappingById(ui.selectedMappingId);
    if (!selected) {
      return `<div class="panel"><div class="empty-state">No mappings configured.</div></div>`;
    }
    return `
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2>Source mapping editor</h2>
            <p class="microcopy">Show how raw source columns become ontology objects, properties, and links.</p>
          </div>
          <button class="button-primary" data-action="add-mapping">Add mapping</button>
        </div>
        <div class="mapping-grid">
          <div class="sidebar-list">
            ${(data.mappings || [])
              .map(
                (mapping) => `
                  <button class="list-item ${mapping.id === ui.selectedMappingId ? "active" : ""}" data-action="select-mapping" data-id="${escapeHtml(mapping.id)}">
                    <div class="list-item-title">
                      <span>${escapeHtml(mapping.sourceId)}</span>
                      <span class="muted">${escapeHtml(mapping.targetType || mapping.relationType || "")}</span>
                    </div>
                    <small>${escapeHtml(mapping.rule)}</small>
                  </button>
                `
              )
              .join("")}
          </div>
          <div class="card-stack">
            <div class="property-card">
              <div class="form-grid">
                ${renderField("Mapping ID", selected.id, { scope: "mapping", field: "id" })}
                ${renderField("Source ID", selected.sourceId, { scope: "mapping", field: "sourceId" })}
                ${renderField("Target type", selected.targetType || "", { scope: "mapping", field: "targetType" })}
                ${renderField("Target property", selected.targetProperty || "", { scope: "mapping", field: "targetProperty" })}
                ${renderField("Relationship type", selected.relationType || "", { scope: "mapping", field: "relationType" })}
                ${renderField("Source fields", selected.sourceFields || "", { scope: "mapping", field: "sourceFields" })}
              </div>
              <div class="field">
                <label>Rule</label>
                <textarea data-scope="mapping" data-field="rule">${escapeHtml(selected.rule || "")}</textarea>
              </div>
              <div class="inline-actions">
                <button class="button-danger" data-action="delete-mapping" data-id="${escapeHtml(selected.id)}">Delete mapping</button>
              </div>
            </div>
            <div class="stat-card">
              <h3>Source columns by file</h3>
              <div class="table-shell">
                <table>
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Columns</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${(data.sources || [])
                      .map(
                        (source) => `
                          <tr>
                            <td>${escapeHtml(source.id)}</td>
                            <td>${escapeHtml((source.fields || []).join(", "))}</td>
                          </tr>
                        `
                      )
                      .join("")}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderInstancesTool() {
    const selectedType = entityTypeById(ui.selectedEntityTypeId);
    const selectedEntity = entityById(ui.selectedEntityId);
    const filteredEntities = entitiesForType(ui.selectedEntityTypeId);
    return `
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2>Instance editor</h2>
            <p class="microcopy">Edit concrete entities and the edges that connect them.</p>
          </div>
          <div class="actions">
            <select data-scope="instances" data-field="selectedTypeId">
              ${(data.ontology?.entityTypes || [])
                .map(
                  (entityType) => `
                    <option value="${escapeHtml(entityType.id)}" ${entityType.id === ui.selectedEntityTypeId ? "selected" : ""}>
                      ${escapeHtml(entityType.name)}
                    </option>
                  `
                )
                .join("")}
            </select>
            <button class="button-primary" data-action="add-entity" data-type-id="${escapeHtml(ui.selectedEntityTypeId)}">Add entity</button>
          </div>
        </div>
        <div class="instance-grid">
          <div class="sidebar-list">
            ${filteredEntities
              .map(
                (entity) => `
                  <button class="list-item ${entity.id === ui.selectedEntityId ? "active" : ""}" data-action="select-entity" data-id="${escapeHtml(entity.id)}">
                    <div class="list-item-title">
                      <span>${escapeHtml(entity.label)}</span>
                      <span class="muted">${escapeHtml(entity.id.split("::")[1] || entity.id)}</span>
                    </div>
                    <small>${escapeHtml(entity.type)}</small>
                  </button>
                `
              )
              .join("")}
          </div>
          ${selectedEntity && selectedType ? renderEntityDetails(selectedEntity, selectedType) : `<div class="empty-state">Select an entity to edit it.</div>`}
          ${selectedEntity ? renderEdgeEditor(selectedEntity) : `<div class="empty-state">Select an entity to edit relationships.</div>`}
        </div>
      </div>
    `;
  }

  function renderEntityDetails(entity, entityType) {
    return `
      <div class="card-stack">
        <div class="property-card">
          <div class="form-grid">
            ${renderField("Entity ID", entity.id, { disabled: true })}
            ${renderField("Label", entity.label, { scope: "entity", entityId: entity.id, field: "label" })}
          </div>
          <h3 class="section-title">Properties</h3>
          <div class="detail-grid single">
            ${(entityType.properties || [])
              .map(
                (property) => `
                  <div class="field">
                    <label>${escapeHtml(property.label)}</label>
                    <input
                      value="${escapeHtml(entity.properties?.[property.id] ?? "")}"
                      data-scope="entity-property"
                      data-entity-id="${escapeHtml(entity.id)}"
                      data-field="${escapeHtml(property.id)}"
                    >
                  </div>
                `
              )
              .join("")}
          </div>
          <div class="inline-actions">
            <button class="button-danger" data-action="delete-entity" data-id="${escapeHtml(entity.id)}">Delete entity</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderEdgeEditor(entity) {
    const outgoing = outgoingEdges(entity.id);
    const incoming = incomingEdges(entity.id);
    const availableRelationships = (data.ontology?.relationshipTypes || []).filter((relationship) => relationship.sourceType === entity.type);
    const defaultRelationship = availableRelationships[0];
    const allowedTargets = defaultRelationship
      ? (data.entities || []).filter((candidate) => candidate.type === defaultRelationship.targetType)
      : [];
    return `
      <div class="card-stack">
        <div class="property-card">
          <h3>Outgoing edges</h3>
          <div class="table-shell">
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Target</th>
                  <th>Details</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${outgoing
                  .map(
                    (edge) => `
                      <tr>
                        <td>${escapeHtml(edge.type)}</td>
                        <td>${escapeHtml(entityLabel(edge.target))}</td>
                        <td>${escapeHtml(JSON.stringify(edge.properties || {}))}</td>
                        <td><button class="ghost-button" data-action="delete-edge" data-id="${escapeHtml(edge.id)}">Remove</button></td>
                      </tr>
                    `
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
          <h3 class="section-title">Add edge</h3>
          <div class="detail-grid">
            <div class="field">
              <label>Relationship type</label>
              <select id="new-edge-type">
                ${availableRelationships
                  .map(
                    (relationship) => `
                      <option value="${escapeHtml(relationship.id)}">${escapeHtml(relationship.label)}</option>
                    `
                  )
                  .join("")}
              </select>
            </div>
            <div class="field">
              <label>Target entity</label>
              <select id="new-edge-target">
                ${allowedTargets
                  .map(
                    (candidate) => `
                      <option value="${escapeHtml(candidate.id)}">${escapeHtml(`${candidate.label} (${candidate.type})`)}</option>
                    `
                  )
                  .join("")}
              </select>
            </div>
          </div>
          <div class="inline-actions">
            <button class="button-primary" data-action="create-edge" data-source-id="${escapeHtml(entity.id)}">Create edge</button>
          </div>
        </div>
        <div class="property-card">
          <h3>Incoming edges</h3>
          <div class="table-shell">
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Source</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                ${incoming
                  .map(
                    (edge) => `
                      <tr>
                        <td>${escapeHtml(edge.type)}</td>
                        <td>${escapeHtml(entityLabel(edge.source))}</td>
                        <td>${escapeHtml(JSON.stringify(edge.properties || {}))}</td>
                      </tr>
                    `
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  function renderGraphTool() {
    const graph = ui.graphMode === "schema" ? buildSchemaGraph() : buildInstanceGraph();
    const counts = [
      graph.truncatedCount ? `${graph.nodes.length} of ${graph.totalNodes} visible nodes` : `${graph.nodes.length} visible nodes`,
      `${graph.edges.length} visible edges`,
      ui.graphMode === "schema" ? "Schema layout" : "Instance layout",
    ];
    return `
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2>Graph explorer</h2>
            <p class="microcopy">Switch between the ontology schema and the seeded instance graph.</p>
          </div>
        </div>
        <div class="graph-shell">
          <div class="graph-controls">
            <div class="field">
              <label>Graph mode</label>
              <select data-scope="graph" data-field="mode">
                <option value="instance" ${ui.graphMode === "instance" ? "selected" : ""}>Instance graph</option>
                <option value="schema" ${ui.graphMode === "schema" ? "selected" : ""}>Schema graph</option>
              </select>
            </div>
            <div class="field">
              <label>Type filter</label>
              <select data-scope="graph" data-field="typeFilter" ${ui.graphMode === "schema" ? "disabled" : ""}>
                <option value="all" ${ui.graphTypeFilter === "all" ? "selected" : ""}>All types</option>
                ${(data.ontology?.entityTypes || [])
                  .map(
                    (entityType) => `
                      <option value="${escapeHtml(entityType.id)}" ${ui.graphTypeFilter === entityType.id ? "selected" : ""}>
                        ${escapeHtml(entityType.name)}
                      </option>
                    `
                  )
                  .join("")}
              </select>
            </div>
            <div class="field">
              <label>Search</label>
              <input value="${escapeHtml(ui.graphSearch)}" placeholder="Filter labels or properties" data-scope="graph" data-field="search">
            </div>
          </div>
          <div class="graph-summary">
            ${counts.map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join("")}
          </div>
          <div class="graph-canvas">
            ${graph.svg}
          </div>
        </div>
      </div>
    `;
  }

  function buildSchemaGraph() {
    const nodes = (data.ontology?.entityTypes || []).map((entityType, index) => ({
      ...entityType,
      x: 80 + (index % 3) * 300,
      y: 80 + Math.floor(index / 3) * 180,
      width: 190,
      height: 56,
    }));
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    const edges = (data.ontology?.relationshipTypes || [])
      .map((relationship) => {
        const sourceNode = nodeMap.get(relationship.sourceType);
        const targetNode = nodeMap.get(relationship.targetType);
        return sourceNode && targetNode ? { ...relationship, sourceNode, targetNode } : null;
      })
      .filter(Boolean);

    const svg = `
      <svg viewBox="0 0 980 720">
        ${edges
          .map((edge) => {
            const x1 = edge.sourceNode.x + edge.sourceNode.width / 2;
            const y1 = edge.sourceNode.y + edge.sourceNode.height / 2;
            const x2 = edge.targetNode.x + edge.targetNode.width / 2;
            const y2 = edge.targetNode.y + edge.targetNode.height / 2;
            const mx = (x1 + x2) / 2;
            const my = (y1 + y2) / 2;
            return `
              <line class="graph-edge" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${escapeHtml(edge.color)}"></line>
              <text class="graph-edge-label" x="${mx}" y="${my - 6}">${escapeHtml(edge.label)}</text>
            `;
          })
          .join("")}
        ${nodes
          .map(
            (node) => `
              <g class="graph-node ${ui.selectedGraphNodeId === node.id ? "selected" : ""}" data-action="select-graph-node" data-node-id="${escapeHtml(node.id)}" transform="translate(${node.x}, ${node.y})">
                <rect rx="18" ry="18" width="${node.width}" height="${node.height}" fill="${escapeHtml(node.color)}"></rect>
                <text x="16" y="26">${escapeHtml(node.name)}</text>
                <text x="16" y="44">${escapeHtml(`${entityCount(node.id)} instances`)}</text>
              </g>
            `
          )
          .join("")}
      </svg>
    `;

    return { nodes, edges, svg, totalNodes: nodes.length };
  }

  function buildEntityGraph(nodes, edges, focusEntityIds, selectedNodeId) {
    const typeOrder = (data.ontology?.entityTypes || []).map((entityType) => entityType.id);
    const visibleTypeIds = typeOrder.filter((typeId) => nodes.some((node) => node.type === typeId));
    const positions = new Map();
    let maxRows = 0;

    visibleTypeIds.forEach((typeId, columnIndex) => {
      const typedNodes = nodes.filter((node) => node.type === typeId).sort((left, right) => left.label.localeCompare(right.label));
      maxRows = Math.max(maxRows, typedNodes.length);
      typedNodes.forEach((node, rowIndex) => {
        const entityType = entityTypeById(typeId);
        positions.set(node.id, {
          x: 80 + columnIndex * 220,
          y: 90 + rowIndex * 72,
          width: 150,
          height: 34,
          color: entityType?.color || "#475569",
        });
      });
    });

    const width = Math.max(980, visibleTypeIds.length * 240 + 120);
    const height = Math.max(560, maxRows * 72 + 120);
    const focusSet = new Set(focusEntityIds);
    const svg = `
      <svg viewBox="0 0 ${width} ${height}">
        ${visibleTypeIds
          .map((typeId, columnIndex) => `<text x="${95 + columnIndex * 220}" y="42" class="graph-edge-label">${escapeHtml(entityTypeById(typeId)?.name || typeId)}</text>`)
          .join("")}
        ${edges
          .map((edge) => {
            const source = positions.get(edge.source);
            const target = positions.get(edge.target);
            const relationship = relationshipById(edge.type);
            if (!source || !target || !relationship) {
              return "";
            }
            return `
              <line
                class="graph-edge"
                x1="${source.x + source.width}"
                y1="${source.y + source.height / 2}"
                x2="${target.x}"
                y2="${target.y + target.height / 2}"
                stroke="${escapeHtml(relationship.color)}"
              ></line>
            `;
          })
          .join("")}
        ${nodes
          .map((node) => {
            const position = positions.get(node.id);
            if (!position) {
              return "";
            }
            const isSelected = selectedNodeId === node.id || focusSet.has(node.id);
            return `
              <g class="graph-node ${isSelected ? "selected" : ""}" data-action="select-graph-node" data-node-id="${escapeHtml(node.id)}" transform="translate(${position.x}, ${position.y})">
                <rect rx="14" ry="14" width="${position.width}" height="${position.height}" fill="${escapeHtml(position.color)}"></rect>
                <text x="12" y="22">${escapeHtml(truncate(node.label, 20))}</text>
              </g>
            `;
          })
          .join("")}
      </svg>
    `;

    return { svg };
  }

  function buildInstanceGraph() {
    const search = ui.graphSearch.trim().toLowerCase();
    let nodes = (data.entities || []).filter((entity) => ui.graphTypeFilter === "all" || entity.type === ui.graphTypeFilter);
    if (search) {
      nodes = nodes.filter((entity) => {
        const props = Object.values(entity.properties || {}).join(" ").toLowerCase();
        return entity.label.toLowerCase().includes(search) || props.includes(search);
      });
    }

    nodes = nodes.sort((left, right) => {
      const degreeDelta = degree(right.id) - degree(left.id);
      if (degreeDelta) {
        return degreeDelta;
      }
      return left.label.localeCompare(right.label);
    });

    const totalNodes = nodes.length;
    const truncatedNodes = nodes.slice(0, MAX_GRAPH_NODES);
    const visibleIds = new Set(truncatedNodes.map((node) => node.id));
    const edges = (data.edges || []).filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target));
    const graph = buildEntityGraph(truncatedNodes, edges, [], ui.selectedGraphNodeId);

    return {
      nodes: truncatedNodes,
      edges,
      svg: graph.svg,
      totalNodes,
      truncatedCount: totalNodes > truncatedNodes.length,
    };
  }

  function renderField(label, value, config = {}) {
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

  function renderSelect(label, value, options, config = {}) {
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

  function handleClick(event) {
    const actionTarget = event.target.closest("[data-action]");
    if (!actionTarget) {
      return;
    }
    const { action } = actionTarget.dataset;

    if (action === "start-walkthrough") {
      walkthroughState.active = true;
      walkthroughState.step = 0;
      render();
      return;
    }

    if (action === "close-walkthrough") {
      walkthroughState.active = false;
      render();
      return;
    }

    if (action === "walkthrough-next") {
      const nextStep = walkthroughState.step + 1;
      if (nextStep >= WALKTHROUGH_STEPS.length) {
        walkthroughState.active = false;
      } else {
        walkthroughState.step = nextStep;
        const targetTab = WALKTHROUGH_STEPS[nextStep].tab;
        if (targetTab) {
          ui.activeTool = targetTab;
          if (targetTab === "graph") {
            ui.selectedGraphNodeId = ui.graphMode === "schema" ? ui.selectedEntityTypeId : ui.selectedEntityId;
          }
        }
      }
      render();
      return;
    }

    if (action === "walkthrough-back") {
      const prevStep = walkthroughState.step - 1;
      if (prevStep >= 0) {
        walkthroughState.step = prevStep;
        const targetTab = WALKTHROUGH_STEPS[prevStep].tab;
        if (targetTab) {
          ui.activeTool = targetTab;
        }
      }
      render();
      return;
    }

    if (action === "inspector-mode") {
      ui.inspectorMode = actionTarget.dataset.mode;
      render();
      return;
    }

    if (action === "switch-tool") {
      ui.activeTool = actionTarget.dataset.tool;
      if (ui.activeTool === "graph") {
        ui.selectedGraphNodeId = ui.graphMode === "schema" ? ui.selectedEntityTypeId : ui.selectedEntityId;
      }
      render();
      return;
    }

    if (action === "run-copilot") {
      runCopilotQuery(copilotState.query);
      return;
    }

    if (action === "copilot-example") {
      runCopilotQuery(actionTarget.dataset.query || "");
      return;
    }

    if (action === "copilot-jump-entity") {
      ui.activeTool = "graph";
      ui.graphMode = "instance";
      ui.selectedGraphNodeId = actionTarget.dataset.id;
      ui.selectedEntityId = actionTarget.dataset.id;
      render();
      return;
    }

    if (action === "copilot-jump-scenario") {
      ui.activeTool = "investigations";
      ui.selectedScenarioId = actionTarget.dataset.id;
      const scenario = analysisState.investigations.find((item) => item.id === ui.selectedScenarioId);
      ui.selectedGraphNodeId = scenario?.focusEntityIds?.[0] || ui.selectedGraphNodeId;
      render();
      return;
    }

    if (action === "copilot-jump-rule") {
      ui.activeTool = "analytics";
      ui.selectedAnalyticsRuleId = actionTarget.dataset.id;
      render();
      return;
    }

    if (action === "select-map-node") {
      ui.selectedMapNodeId = actionTarget.dataset.id;
      render();
      return;
    }

    if (action === "map-jump-graph") {
      ui.activeTool = "graph";
      ui.graphMode = "instance";
      ui.selectedGraphNodeId = actionTarget.dataset.id;
      render();
      return;
    }

    if (action === "select-scenario") {
      ui.selectedScenarioId = actionTarget.dataset.id;
      const scenario = analysisState.investigations.find((item) => item.id === ui.selectedScenarioId);
      ui.selectedGraphNodeId = scenario?.focusEntityIds?.[0] || ui.selectedGraphNodeId;
      render();
      return;
    }

    if (action === "execute-scenario-action") {
      const { scenarioId, scenarioTitle, actionLabel } = actionTarget.dataset;
      const ts = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
      analysisState.actionLog.push({ ts, scenarioId, scenarioTitle, action: actionLabel });
      render();
      return;
    }

    if (action === "select-rule") {
      ui.selectedAnalyticsRuleId = actionTarget.dataset.id;
      render();
      return;
    }

    if (action === "select-entity-type") {
      ui.selectedEntityTypeId = actionTarget.dataset.id;
      ui.selectedEntityId = entitiesForType(ui.selectedEntityTypeId)[0]?.id || ui.selectedEntityId;
      persistAndRender();
      return;
    }

    if (action === "add-entity-type") {
      const name = `New Type ${data.ontology.entityTypes.length + 1}`;
      const newType = {
        id: slugify(name),
        name,
        description: "Describe what this entity type represents.",
        color: randomColor(data.ontology.entityTypes.length),
        properties: [{ id: "name", label: "Name", type: "string", required: true, description: "Primary display label." }],
      };
      data.ontology.entityTypes.push(newType);
      ui.selectedEntityTypeId = newType.id;
      persistAndRender();
      return;
    }

    if (action === "delete-entity-type") {
      deleteEntityType(actionTarget.dataset.id);
      persistAndRender();
      return;
    }

    if (action === "add-property") {
      const type = entityTypeById(actionTarget.dataset.typeId);
      if (!type) return;
      const propertyId = `property${type.properties.length + 1}`;
      type.properties.push({ id: propertyId, label: `Property ${type.properties.length + 1}`, type: "string", required: false, description: "" });
      (data.entities || []).filter((entity) => entity.type === type.id).forEach((entity) => {
        entity.properties[propertyId] = "";
      });
      persistAndRender();
      return;
    }

    if (action === "delete-property") {
      deleteProperty(actionTarget.dataset.typeId, actionTarget.dataset.propertyId);
      persistAndRender();
      return;
    }

    if (action === "select-relationship") {
      ui.selectedRelationshipId = actionTarget.dataset.id;
      render();
      return;
    }

    if (action === "add-relationship") {
      const sourceType = data.ontology.entityTypes[0]?.id || "";
      const targetType = data.ontology.entityTypes[1]?.id || sourceType;
      const relationship = {
        id: `REL_${data.ontology.relationshipTypes.length + 1}`,
        label: `NEW_RELATIONSHIP_${data.ontology.relationshipTypes.length + 1}`,
        sourceType,
        targetType,
        description: "Describe what this edge means.",
        color: randomColor(data.ontology.relationshipTypes.length + 4),
      };
      data.ontology.relationshipTypes.push(relationship);
      ui.selectedRelationshipId = relationship.id;
      persistAndRender();
      return;
    }

    if (action === "delete-relationship") {
      deleteRelationship(actionTarget.dataset.id);
      persistAndRender();
      return;
    }

    if (action === "select-mapping") {
      ui.selectedMappingId = actionTarget.dataset.id;
      render();
      return;
    }

    if (action === "add-mapping") {
      const mapping = {
        id: `mapping-${data.mappings.length + 1}`,
        sourceId: "new_source.csv",
        sourceFields: "field_a, field_b",
        targetType: "Person",
        targetProperty: "canonicalName",
        relationType: "",
        rule: "Describe how this source becomes ontology data.",
      };
      data.mappings.push(mapping);
      ui.selectedMappingId = mapping.id;
      persistAndRender();
      return;
    }

    if (action === "delete-mapping") {
      data.mappings = data.mappings.filter((mapping) => mapping.id !== actionTarget.dataset.id);
      persistAndRender();
      return;
    }

    if (action === "select-entity") {
      ui.selectedEntityId = actionTarget.dataset.id;
      ui.selectedGraphNodeId = actionTarget.dataset.id;
      render();
      return;
    }

    if (action === "add-entity") {
      addEntity(actionTarget.dataset.typeId);
      persistAndRender();
      return;
    }

    if (action === "delete-entity") {
      deleteEntity(actionTarget.dataset.id);
      persistAndRender();
      return;
    }

    if (action === "create-edge") {
      createEdge(actionTarget.dataset.sourceId);
      persistAndRender();
      return;
    }

    if (action === "delete-edge") {
      data.edges = data.edges.filter((edge) => edge.id !== actionTarget.dataset.id);
      persistAndRender();
      return;
    }

    if (action === "select-graph-node") {
      ui.selectedGraphNodeId = actionTarget.dataset.nodeId;
      if (entityById(actionTarget.dataset.nodeId)) {
        ui.selectedEntityId = actionTarget.dataset.nodeId;
      } else if (entityTypeById(actionTarget.dataset.nodeId)) {
        ui.selectedEntityTypeId = actionTarget.dataset.nodeId;
      }
      render();
      return;
    }

    if (action === "reset-state") {
      try {
        localStorage.removeItem(storageKey(ui.datasetKey));
      } catch (error) {
        console.warn("Failed to clear saved state.", error);
      }
      data = clone(datasetCatalog[ui.datasetKey]);
      seedData = clone(datasetCatalog[ui.datasetKey]);
      copilotState = { query: "", result: null };
      render();
      return;
    }

    if (action === "export-json") {
      exportJson();
    }
  }

  function handleChange(event) {
    const target = event.target;
    const scope = target.dataset.scope;
    if (!scope) {
      return;
    }

    if (scope === "dataset") {
      switchDataset(target.value);
      return;
    }

    if (scope === "entity-type") {
      const entityType = entityTypeById(ui.selectedEntityTypeId);
      if (!entityType) return;
      entityType[target.dataset.field] = target.value;
      persistAndRender();
      return;
    }

    if (scope === "properties") {
      ui.selectedEntityTypeId = target.value;
      ui.selectedEntityId = entitiesForType(ui.selectedEntityTypeId)[0]?.id || ui.selectedEntityId;
      render();
      return;
    }

    if (scope === "property") {
      updateProperty(target.dataset.propertyId, target.dataset.field, target.value);
      persistAndRender();
      return;
    }

    if (scope === "relationship") {
      const relationship = relationshipById(ui.selectedRelationshipId);
      if (!relationship) return;
      relationship[target.dataset.field] = target.value;
      persistAndRender();
      return;
    }

    if (scope === "mapping") {
      const mapping = mappingById(ui.selectedMappingId);
      if (!mapping) return;
      mapping[target.dataset.field] = target.value;
      persistAndRender();
      return;
    }

    if (scope === "instances") {
      ui.selectedEntityTypeId = target.value;
      ui.selectedEntityId = entitiesForType(ui.selectedEntityTypeId)[0]?.id || ui.selectedEntityId;
      render();
      return;
    }

    if (scope === "entity") {
      const entity = entityById(target.dataset.entityId || ui.selectedEntityId);
      if (!entity) return;
      entity[target.dataset.field] = target.value;
      persistAndRender();
      return;
    }

    if (scope === "graph") {
      if (target.dataset.field === "mode") {
        ui.graphMode = target.value;
        ui.selectedGraphNodeId = ui.graphMode === "schema" ? ui.selectedEntityTypeId : ui.selectedEntityId;
      }
      if (target.dataset.field === "typeFilter") {
        ui.graphTypeFilter = target.value;
      }
      if (target.dataset.field === "search") {
        ui.graphSearch = target.value;
      }
      render();
      return;
    }

    if (scope === "map") {
      if (target.dataset.field === "scope") {
        ui.mapScope = target.value;
        ui.selectedMapNodeId = "";
        ui.mapViewCenter = [...DEFAULT_MAP_VIEW.center];
        ui.mapViewZoom = DEFAULT_MAP_VIEW.zoom;
        ui.mapViewDirty = false;
      }
      if (target.dataset.field === "placeFilter") {
        ui.mapPlaceFilter = target.value;
        ui.selectedMapNodeId = "";
        ui.mapViewCenter = [...DEFAULT_MAP_VIEW.center];
        ui.mapViewZoom = DEFAULT_MAP_VIEW.zoom;
        ui.mapViewDirty = false;
      }
      if (target.dataset.field === "search") {
        ui.mapSearch = target.value;
        ui.mapViewCenter = [...DEFAULT_MAP_VIEW.center];
        ui.mapViewZoom = DEFAULT_MAP_VIEW.zoom;
        ui.mapViewDirty = false;
      }
      render();
      return;
    }
  }

  function handleInput(event) {
    const target = event.target;
    const scope = target.dataset.scope;
    if (!scope) {
      return;
    }
    if (scope === "entity-property") {
      const entity = entityById(target.dataset.entityId);
      if (!entity) return;
      entity.properties[target.dataset.field] = target.value;
      if (["canonicalName", "companyName", "label", "name"].includes(target.dataset.field)) {
        entity.label = target.value || entity.label;
      }
      persist();
      return;
    }
    if (scope === "copilot") {
      copilotState.query = target.value;
      if (!copilotState.query.trim()) {
        copilotState.result = null;
      }
      render();
      return;
    }
    if (scope === "map") {
      if (target.dataset.field === "search") {
        ui.mapSearch = target.value;
        render();
      }
      return;
    }
    if (scope === "graph") {
      ui.graphSearch = target.value;
      render();
    }
  }

  function updateProperty(propertyId, field, value) {
    const entityType = entityTypeById(ui.selectedEntityTypeId);
    if (!entityType) {
      return;
    }
    const property = entityType.properties.find((item) => item.id === propertyId);
    if (!property) {
      return;
    }
    if (field === "id") {
      const nextId = slugify(value).replace(/-/g, "");
      if (!nextId || entityType.properties.some((item) => item.id === nextId && item !== property)) {
        return;
      }
      (data.entities || []).filter((entity) => entity.type === entityType.id).forEach((entity) => {
        entity.properties[nextId] = entity.properties[property.id] ?? "";
        delete entity.properties[property.id];
      });
      property.id = nextId;
      return;
    }
    if (field === "required") {
      property.required = value === "true";
      return;
    }
    property[field] = value;
  }

  function deleteEntityType(typeId) {
    const entityIdsToRemove = new Set((data.entities || []).filter((entity) => entity.type === typeId).map((entity) => entity.id));
    const relationshipsToRemove = new Set(
      (data.ontology?.relationshipTypes || [])
        .filter((relationship) => relationship.sourceType === typeId || relationship.targetType === typeId)
        .map((relationship) => relationship.id)
    );
    data.ontology.entityTypes = data.ontology.entityTypes.filter((entityType) => entityType.id !== typeId);
    data.ontology.relationshipTypes = data.ontology.relationshipTypes.filter((relationship) => !relationshipsToRemove.has(relationship.id));
    data.entities = data.entities.filter((entity) => entity.type !== typeId);
    data.edges = data.edges.filter(
      (edge) => !entityIdsToRemove.has(edge.source) && !entityIdsToRemove.has(edge.target) && !relationshipsToRemove.has(edge.type)
    );
    data.mappings = data.mappings.filter((mapping) => mapping.targetType !== typeId);
  }

  function deleteProperty(typeId, propertyId) {
    const entityType = entityTypeById(typeId);
    if (!entityType) return;
    entityType.properties = entityType.properties.filter((property) => property.id !== propertyId);
    (data.entities || []).filter((entity) => entity.type === typeId).forEach((entity) => {
      delete entity.properties[propertyId];
    });
  }

  function deleteRelationship(relationshipId) {
    data.ontology.relationshipTypes = data.ontology.relationshipTypes.filter((relationship) => relationship.id !== relationshipId);
    data.edges = data.edges.filter((edge) => edge.type !== relationshipId);
    data.mappings = data.mappings.map((mapping) => (mapping.relationType === relationshipId ? { ...mapping, relationType: "" } : mapping));
  }

  function addEntity(typeId) {
    const entityType = entityTypeById(typeId);
    if (!entityType) return;
    const nextIndex = (data.entities || []).filter((entity) => entity.type === typeId).length + 1;
    const entity = {
      id: `${typeId.toLowerCase()}::manual-${nextIndex}`,
      type: typeId,
      label: `${entityType.name} ${nextIndex}`,
      properties: Object.fromEntries((entityType.properties || []).map((property) => [property.id, ""])),
      sourceIds: ["manual-edit"],
    };
    if (entity.properties.name !== undefined) {
      entity.properties.name = entity.label;
    }
    data.entities.push(entity);
    ui.selectedEntityId = entity.id;
    ui.selectedGraphNodeId = entity.id;
  }

  function deleteEntity(entityId) {
    data.entities = data.entities.filter((entity) => entity.id !== entityId);
    data.edges = data.edges.filter((edge) => edge.source !== entityId && edge.target !== entityId);
  }

  function createEdge(sourceId) {
    const relationshipId = document.getElementById("new-edge-type")?.value;
    const targetId = document.getElementById("new-edge-target")?.value;
    const relationship = relationshipById(relationshipId);
    const source = entityById(sourceId);
    const target = entityById(targetId);
    if (!relationship || !source || !target) {
      return;
    }
    if (source.type !== relationship.sourceType || target.type !== relationship.targetType) {
      return;
    }
    data.edges.push({
      id: `${relationship.id.toLowerCase()}::${slugify(`${sourceId}-${targetId}-${data.edges.length + 1}`)}`,
      type: relationship.id,
      source: sourceId,
      target: targetId,
      label: relationship.label,
      properties: { provenance: "manual-edit" },
    });
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ontology-demo-${ui.datasetKey}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function persistAndRender() {
    persist();
    render();
  }

  function randomColor(index) {
    const palette = ["#3b82f6", "#8b5cf6", "#14b8a6", "#f59e0b", "#ef4444", "#ec4899", "#10b981", "#64748b"];
    return palette[index % palette.length];
  }
})();
