// demo/js/agent.js — The simulated AIP agent (rule-based stand-in, ex-copilot): example prompts, query matching
// (collectEntityMatches / collectRuleMatches / collectScenarioMatches, reused by the planner), the per-object
// summary the inspector shows, and the entry point runCopilotQuery (phone-number Checkpoint, then agent-run.js).
import { currencyFormatter, normalizeText } from "./util.js";
import { analysisState, copilotState, data, ui } from "./state.js";
import {
  phoneKey,
  phoneNumbersIn,
  phoneSearchHeld,
  requestPhoneSearch,
  telecomGateActive,
  visiblePropertyValues,
} from "./governance.js";
import {
  degree,
  deviceLocations,
  entityProperty,
  incomingEdges,
  locationPeople,
  outgoingEdges,
  personAccounts,
  personCompanies,
  personDevices,
  personFlights,
  relatedSources,
  relatedTargets,
  totalTransferValue,
} from "./derive.js";
import { runAgent } from "./agent-run.js";

// The four fixed prompts of spec §5.3 S3 (contract §2). The last three fire a scripted failure mode.
export const EXAMPLE_SUMMARY = "Summarise Omar Rahman";
export const EXAMPLE_WATCHLIST = "Who should we add to the watchlist?";
export const EXAMPLE_PHONES = "Show me everyone connected to Kareem Haddad's phones";
export const EXAMPLE_LINK = "What links Omar Rahman to North Quay Logistics?";
export const COPILOT_EXAMPLES = [EXAMPLE_SUMMARY, EXAMPLE_WATCHLIST, EXAMPLE_PHONES, EXAMPLE_LINK];
export const EXAMPLE_FAILURES = { [EXAMPLE_WATCHLIST]: "approve-all", [EXAMPLE_PHONES]: "overreach", [EXAMPLE_LINK]: "fabricated-link" };
export const COPILOT_STOP_WORDS = new Set([
  "about", "across", "also", "analyst", "and", "around", "bring", "current", "data", "dataset", "for",
  "from", "give", "have", "into", "like", "me", "most", "natural", "show", "tell", "that", "the", "their",
  "them", "these", "this", "those", "through", "together", "use", "what", "which", "who", "with",
]);

export function queryTokens(query) {
  return [...new Set(normalizeText(query).split(/\s+/).filter((token) => token && token.length > 2 && !COPILOT_STOP_WORDS.has(token)))];
}

export function entitySearchText(entity) {
  return normalizeText(`${entity.label} ${entity.type} ${visiblePropertyValues(entity).join(" ")}`);
}

export function collectEntityMatches(query, options = {}) {
  const normalizedQuery = normalizeText(query);
  const tokens = queryTokens(query);
  return (data.entities || [])
    .filter((entity) => !options.type || entity.type === options.type)
    .map((entity) => {
      const labelText = normalizeText(entity.label);
      const propText = normalizeText(visiblePropertyValues(entity).join(" "));
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
    .slice(0, options.limit || 8);
}

export function collectRuleMatches(query, focusEntityIds) {
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

export function collectScenarioMatches(query, focusEntityIds) {
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

export function summarizeEntityForCopilot(entity) {
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
    const telecomOpen = !telecomGateActive() || ui.telecomExpanded.has(entity.id);
    if (telecomOpen) {
      devices.forEach((device) => {
        deviceLocations(device.id).forEach((location) => locations.set(location.id, location));
      });
    }
    return {
      headline: `${entity.label} links ${companies.length} companies, ${accounts.length} accounts, ${flights.length} flights, and ${devices.length} devices.`,
      evidence: [
        entityProperty(entity, "riskTag") ? `${entity.label} carries risk tag "${entityProperty(entity, "riskTag")}".` : "",
        watchlistRecord ? `${entity.label} maps to watchlist record ${watchlistRecord.label}.` : "",
        companies.length ? `Connected companies: ${companies.slice(0, 4).map((company) => company.label).join(", ")}.` : "",
        flights.length ? `Travel evidence: ${flights.slice(0, 3).map((flight) => entityProperty(flight, "flightNumber")).join(", ")}.` : "",
        locations.size ? `Observed places: ${[...locations.values()].slice(0, 4).map((location) => location.label).join(", ")}.` : "",
        !telecomOpen && devices.length ? `Places where ${entity.label}'s devices were observed are not shown until the telecom expansion passes a Checkpoint.` : "",
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
        people.length && (!telecomGateActive() || ui.telecomExpanded.has(entity.id))
          ? `Observed people: ${people.slice(0, 4).map((person) => person.label).join(", ")}.`
          : people.length
            ? `${people.length} people observed here via devices; names need the telecom expansion (Checkpoint).`
            : "",
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

// The agent run itself (plan, tools, answer, staged edits, evals) lives in agent-run.js, agent-tools.js and
// agent-plan.js. A question holding a phone number is a phone-number search: Checkpoint first.
export function runCopilotQuery(query) {
  const text = String(query || "");
  copilotState.query = text;
  const held = phoneNumbersIn(text).filter((number) => phoneSearchHeld(number));
  if (held.length) {
    requestPhoneSearch("agent", held[0], () => {
      held.forEach((number) => ui.approvedPhoneQueries.add(phoneKey(number)));
      runAgent(text);
      return 0;
    });
    return;
  }
  runAgent(text);
}
