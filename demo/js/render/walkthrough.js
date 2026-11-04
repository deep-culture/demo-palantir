// demo/js/render/walkthrough.js — Guided tour steps and card.
import { escapeHtml } from "../util.js";
import { data, derived, walkthroughState } from "../state.js";

export const WALKTHROUGH_STEPS = [
  {
    title: "Welcome to Investigate (Gotham-style)",
    desc: "This system unifies messy data sources — watchlists, flights, bank transfers, company registries, and location pings — into a single linked model. The header shows how many objects and links your role can see in the current dataset; the strip under it shows your role.",
    tab: null,
  },
  {
    title: "Step 1 — Explore Object types",
    desc: "Object types are the building blocks of the ontology: Person, Company, BankAccount, Device, Flight, Airport, Location, WatchlistRecord. Each type has a colour, an ID, and a set of typed properties.",
    tab: "entity-types",
  },
  {
    title: "Step 2 — See How Sources Map to Objects",
    desc: "Backing datasets describe how each CSV or JSONL column becomes an ontology property. This is where raw data is declared as part of the shared model.",
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
    title: "Step 5 — Ask the Agent (simulated AIP)",
    desc: "The agent anchors plain-English questions to objects in the graph. It is a rule-based stand-in for an AIP chatbot, so it cannot invent objects. A real AIP chatbot uses a large language model with tools: it can be wrong, which is why its edits are staged for a person to review.",
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

export function renderWalkthroughCard() {
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
