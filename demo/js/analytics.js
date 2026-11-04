// demo/js/analytics.js — Rule-based analytics and the investigation scenarios built from them.
import { currencyFormatter, slugify } from "./util.js";
import { derived } from "./state.js";
import { withheldAround } from "./governance.js";
import {
  buildPathSummaries,
  buildPlaces,
  buildSubgraph,
  buildTimeline,
  buildTransfers,
  degree,
  entitiesForType,
  entityById,
  entityProperty,
  incomingEdges,
  locationPeople,
  personAccounts,
  personCompanies,
  personDevices,
  personFlights,
  relatedSources,
  totalTransferValue,
} from "./derive.js";

export function scenarioSeverity(score) {
  if (score >= 9) return "High";
  if (score >= 5) return "Medium";
  return "Low";
}

export function buildAnalytics() {
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

export function createScenario(id, title, summary, focusEntityIds, score, facts, actions) {
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
    withheld: withheldAround(graph.nodes.map((node) => node.id)),
  };
}

export function scenarioActions(scenarioId, focusEntityIds) {
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

export function buildInvestigations(analytics) {
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
