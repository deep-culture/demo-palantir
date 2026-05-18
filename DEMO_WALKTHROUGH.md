# Demo Walkthrough

This document is a speaker guide for the Palantir-style demo in this repository. It is designed for a live classroom walkthrough where you start with ontology design, move into investigation workflows, add natural-language analysis, and finish with geospatial exploration.

## 1. Start the demo

From the repository root:

```bash
python3 scripts/build_ontology_seed.py --output demo/seed.js
python3 -m http.server 8123 --directory demo
```

Open:

```text
http://127.0.0.1:8123
```

## 2. Recommended storyline

Use this sequence:

1. **Ontology first** - show that the system is not just dashboards; it is a model of the world.
2. **Investigation second** - show how linked data becomes an analyst workflow.
3. **AI copilot third** - show how natural language can pull the graph together.
4. **Map last** - show how movement, co-location, and place-based overlap become visible spatially.
5. **Scale to simulator** - switch from `starter` to `simulator` to show the same model surviving at larger volume.

## 3. Live walkthrough

## 3.1 Opening: what students are looking at

Start on the **starter** dataset.

Point out:

- the dataset switcher
- the entity, relationship, and edge counts
- the tabs: **AI Copilot**, **Investigations**, **Analytics**, **Map**, and the ontology editors

Talking point:

> We are not starting with a report. We are starting with an ontology that lets us unify travel, banking, devices, companies, watchlists, and locations into one operational model.

## 3.2 Ontology tour

Go to:

1. **Entity Types**
2. **Properties**
3. **Relationships**
4. **Source Mappings**

Show:

- `Person`, `Company`, `BankAccount`, `Device`, `Flight`, `Airport`, `Location`, `WatchlistRecord`
- links like `DIRECTS`, `BENEFICIALLY_OWNS`, `BOOKED_ON`, `TRANSFERRED_TO`, `USES_DEVICE`, `OBSERVED_AT`
- how CSV and JSONL fields map into ontology objects

Good thing to say:

> The important move is that raw source columns become durable objects and relationships. Once that happens, every workflow above this layer can reuse the same model.

Optional interaction:

- rename a property label or relationship description
- show the JSON inspector update
- reset the dataset afterward if needed

## 3.3 Investigation workflow

Go to **Investigations**.

Walk through these scenario cards:

1. **Trace the risk-tagged operator**
2. **Investigate the shared address hub**
3. **Follow the shared booking cluster**
4. **Connect travel with money movement**

For each scenario, point out:

- the summary and severity
- **recommended actions** — entity-aware action buttons that log a timestamped entry when clicked
- saved graph paths
- timeline
- transfer summary
- location panel

Suggested narration:

> This is where ontology turns into operations. The student is no longer looking at isolated rows. They are following a case with people, companies, routes, accounts, and places all in one surface. The "Recommended Actions" card shows that the point of the system is not just analysis — it is decision-making. In a real deployment, each button would be permissioned and every click would be written to an immutable audit log.

## 3.4 Analytics layer

Go to **Analytics**.

Show the rule buckets:

- **Watchlist operators**
- **Address hubs**
- **Travel-finance overlap**
- **Shared booking artifacts**

Talking point:

> These are simple rules, but they already show why linked data matters. The system can rank interesting actors and places because the ontology has already done the hard work of joining messy sources.

## 3.5 AI copilot

Go to **AI Copilot**.

Before running a query, point out:

- the **"How this copilot is grounded"** card with the green `⬡ Ontology-grounded` badge
- the **"Without the ontology vs. with it"** comparison card — show the raw CSV row on the left and the linked ontology answer on the right

Good thing to say:

> Before we even ask a question, the UI is making an argument: the same transaction that is nearly meaningless as a CSV row becomes actionable the moment it is connected to a person, a company, and a location through the ontology.

Use these prompts:

```text
Bring together Kareem Haddad across companies, flights, transfers, and devices
Which address connects the most companies and people?
Who looks riskiest in the current dataset?
Show me travel and money movement around Elena Markovic
Find shared booking artifacts and co-travel patterns
```

Show that the copilot:

- identifies focal entities
- synthesizes linked evidence
- recommends a matching investigation scenario or rule
- provides quick jumps into graph and investigation views
- displays a grounding summary — entity and relationship counts — at the bottom of each answer

Important framing:

> In this demo, the AI layer is grounded in the ontology and graph. It is not inventing an answer from nowhere; it is assembling one from linked evidence already in the system. The grounding summary at the bottom of each answer shows exactly how many entities and relationships were traversed — students can verify every claim.

## 3.6 Map workflow

Go to **Map**.

Use the map in three passes:

1. **Whole dataset**
2. **Selected scenario**
3. **Copilot answer**

Show:

- airport markers
- address and observation markers
- flight routes
- hotspot list
- route activity table
- drilldown on a selected place

Good places to click:

- **14 Seabright Ave, Limassol**
- **Larnaca International Airport**
- **Dubai International Airport**

Talking point:

> Spatial context is a key part of this kind of platform. The same ontology that powers graph analysis also powers map analysis: shared places, travel routes, and co-location all become first-class evidence.

## 3.7 Scale up

Switch from **starter** to **simulator**.

Say:

> Nothing conceptually changes. The same ontology, the same workflows, and the same investigation surfaces now operate over a much larger synthetic dataset.

Then show:

- counts in the top bar increase
- analytics still surface results
- copilot still answers in the same pattern
- map remains usable because the UI scopes and filters the view

## 3.8 Critical perspectives

The guided tour ends with a **Critical Perspectives** step. Do not skip this.

Read the three bullet points aloud and invite a short discussion:

- ICE immigration enforcement — same architecture, different mission
- Predictive policing and bias — what happens when historical data encodes discrimination
- Palantir's counter-argument — structured, audited systems versus unstructured raw database access

Good framing:

> A serious understanding of this technology requires engaging with the controversy, not just the capability. The audit log you just saw in the Investigations tab is one answer to the civil liberties concern — but it only works if the oversight body actually has access to it and the power to act.

## 4. Suggested 10-15 minute classroom flow

1. **1-2 min** - explain the goal: unify messy sources into an operational model
2. **2-3 min** - ontology and source mappings
3. **3 min** - investigations and analytics — including the Recommended Actions card
4. **2-3 min** - AI copilot — grounding callout, comparison card, grounding summary
5. **2-3 min** - map and geospatial reasoning
6. **1 min** - switch to simulator and discuss scaling
7. **2 min** - Critical Perspectives step — invite one question from the room

## 5. Key teaching messages

- A Palantir-style system is built around an **ontology**, not just charts
- The ontology lets the same data support **search, graph, AI, workflows, and maps**
- Investigation quality improves when data is linked across **people, companies, devices, flights, accounts, and places**
- Natural language is most useful when it is **grounded in structured entities and relationships** — the grounding summary makes this verifiable, not just claimed
- **Actions are first-class objects**: the point of the system is decision-making and accountability, not just pattern recognition
- Geospatial views matter because location is often the bridge between otherwise separate data sources
- The same capability that fights financial crime can be turned toward immigration enforcement or political surveillance — **the technology and the ethics cannot be separated**

## 6. Good student questions to invite

- Which fields are strong identifiers and which are weak identifiers?
- Where is entity resolution happening in this demo?
- Which relationships are inferred versus directly observed?
- Why does a shared address become important?
- What changes when we move from starter to simulator?
- How trustworthy should a natural-language answer be if the underlying links are weak?
- Who has access to the action log, and what power do they have to act on it?
- If the analytics rules score people by connection count, what false positives does that create?
- Does the "grounded AI" framing fully address the hallucination concern, or does it just move the problem to the quality of entity resolution?

## 7. Reset and recovery

If the state gets messy during class:

- use **Reset dataset** in the UI, or
- rebuild the seed and restart the server:

```bash
python3 scripts/build_ontology_seed.py --output demo/seed.js
python3 -m http.server 8123 --directory demo
```

## 8. Optional extension ideas

- let students add a new relationship type and discuss its analytic impact
- ask students to write their own copilot prompts
- compare the same case in **starter** and **simulator**
- ask students which additional sources would make the ontology more realistic
- ask students to design a bias audit for the analytics rules
- debate: under what governance conditions would the action log actually protect civil liberties?
