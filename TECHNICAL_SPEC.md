# Technical Specification

This document specifies the current implementation of the Palantir-style classroom demo in this repository. It is intended as an engineering handoff and design reference for further development.

## 1. Purpose

The system demonstrates a simplified Palantir-like stack built around an explicit ontology and a set of analyst-facing tools.

It is designed to show how multiple messy sources can be:

1. ingested and normalized,
2. resolved into a shared entity/relationship model,
3. explored through graph, investigation, analytics, natural-language, and geospatial workflows,
4. scaled from a small starter dataset to a larger simulator dataset without changing the conceptual model.

## 2. System goals

### 2.1 Functional goals

- Provide synthetic multi-source data for classroom demos.
- Generate a browser-ready ontology state from those sources.
- Allow direct editing of entity types, properties, relationships, mappings, instances, and edges.
- Support analyst workflows:
  - investigation scenarios,
  - rule-based analytics,
  - local natural-language copilot,
  - geospatial map exploration.
- Support both a small and larger dataset through one static browser application.

### 2.2 Non-goals

- This is **not** a production multi-user platform.
- This is **not** a secure backend service.
- This does **not** use a real LLM or remote AI service.
- This does **not** implement fine-grained access control, lineage storage, workflow orchestration, or distributed compute.

## 3. High-level architecture

The system is intentionally simple:

```text
synthetic_data/*                -> raw classroom datasets
scripts/generate_synthetic_sources.py
scripts/build_ontology_seed.py  -> browser-ready ontology seed
demo/index.html                 -> static shell
demo/seed.js                    -> bundled seed catalog
demo/app.js                     -> application logic
demo/styles.css                 -> presentation layer
```

Runtime model:

1. Raw CSV/JSONL files are generated offline.
2. `build_ontology_seed.py` converts raw data into an ontology payload.
3. The payload is emitted as JavaScript into `demo/seed.js`.
4. `demo/app.js` loads that payload into browser memory.
5. All editing, analysis, copilot responses, and map behavior run client-side.
6. State is persisted in `localStorage`, keyed by dataset.

## 4. Repository structure

### 4.1 Data generation

- `scripts/generate_synthetic_sources.py`
  - generates linked synthetic datasets
  - supports at least:
    - `starter`
    - `simulator`

### 4.2 Ontology seed generation

- `scripts/build_ontology_seed.py`
  - reads raw synthetic data
  - performs entity resolution and graph construction
  - writes bundled browser seed output

### 4.3 Demo UI

- `demo/index.html`
  - static entry point
  - loads `seed.js`, then `app.js`

- `demo/app.js`
  - state initialization
  - entity/edge lookup helpers
  - graph derivation
  - analytics rules
  - investigation scenario generation
  - copilot interpretation
  - geospatial map derivation
  - rendering and event handling

- `demo/styles.css`
  - all layout, panel, graph, copilot, and map styling

## 5. Data sources

The demo currently uses five linked sources per dataset:

1. `watchlist.csv`
2. `company_registry.csv`
3. `flight_manifests.csv`
4. `bank_transactions.csv`
5. `mobile_location_pings.jsonl`

### 5.1 Starter dataset

The starter dataset is small enough for classroom explanation and manual inspection.

### 5.2 Simulator dataset

The simulator dataset preserves the same shape but scales row counts substantially.

## 6. Ontology model

The ontology is declared in `build_ontology_seed.py` as static metadata and then applied to generated entities and edges.

### 6.1 Entity types

Current entity types:

- `Person`
- `Company`
- `BankAccount`
- `Device`
- `Flight`
- `Airport`
- `Location`
- `WatchlistRecord`

Each entity type contains:

- `id`
- `name`
- `description`
- `color`
- `properties[]`

Each property contains:

- `id`
- `label`
- `type`
- `required`
- `description`

### 6.2 Relationship types

Current relationship types:

- `LISTED_ON`
- `DIRECTS`
- `BENEFICIALLY_OWNS`
- `REGISTERED_AT`
- `OWNS_ACCOUNT`
- `HAS_CORP_ACCOUNT`
- `TRANSFERRED_TO`
- `BOOKED_ON`
- `DEPARTED_FROM`
- `ARRIVED_AT`
- `USES_DEVICE`
- `OBSERVED_AT`

Each relationship type contains:

- `id`
- `label`
- `sourceType`
- `targetType`
- `description`
- `color`

## 7. Seed payload contract

The browser consumes a seed payload with the following top-level shape:

```js
{
  metadata: {...},
  sources: [...],
  ontology: {
    entityTypes: [...],
    relationshipTypes: [...]
  },
  mappings: [...],
  entities: [...],
  edges: [...]
}
```

### 7.1 Bundled seed catalog

`demo/seed.js` currently exports:

```js
window.ontologySeedCatalog = {
  starter: {...},
  simulator: {...}
};

window.ontologySeed = window.ontologySeedCatalog["starter"];
```

This allows the browser app to switch datasets without a backend call.

### 7.2 Source descriptors

Each source descriptor includes:

- `id`
- `name`
- `file`
- `description`
- `recordCount`
- `fields[]`

### 7.3 Entity instances

Each entity contains:

- `id`
- `type`
- `label`
- `properties`
- `sourceIds`

### 7.4 Edge instances

Each edge contains:

- `id`
- `type`
- `source`
- `target`
- `label`
- `properties`

## 8. Identity and entity resolution

Entity resolution is intentionally lightweight and explicit.

### 8.1 Person resolution

Resolution order in `SeedBuilder.ensure_person()`:

1. passport ID
2. phone number
3. normalized `name + dob`
4. alias lookup

Person aliases are accumulated and normalized for future matching.

### 8.2 Company resolution

Companies are keyed by registry `company_id` or company name fallback.

### 8.3 Bank account resolution

Accounts are keyed by `account_id`.

### 8.4 Device resolution

Devices are keyed by `device_id`.

### 8.5 Airport resolution

Airports are keyed by code and enriched from a static coordinate table.

### 8.6 Location resolution

Locations are keyed by normalized label.

## 9. Edge construction rules

### 9.1 Watchlist

- `Person -> LISTED_ON -> WatchlistRecord`

### 9.2 Company registry

- `Person -> DIRECTS -> Company`
- `Person -> BENEFICIALLY_OWNS -> Company`
- `Company -> REGISTERED_AT -> Location`

### 9.3 Flights

- `Person -> BOOKED_ON -> Flight`
- `Flight -> DEPARTED_FROM -> Airport`
- `Flight -> ARRIVED_AT -> Airport`

### 9.4 Banking

- `Person -> OWNS_ACCOUNT -> BankAccount`
- `Company -> HAS_CORP_ACCOUNT -> BankAccount`
- `BankAccount -> TRANSFERRED_TO -> BankAccount`

Transfers are aggregated by account pair and store:

- `count`
- `totalAmountUsd`
- `lastTxnTs`
- `sampleReference`

### 9.5 Mobile location

- `Person -> USES_DEVICE -> Device`
- `Device -> OBSERVED_AT -> Location`

Observation edges are aggregated by device/location pair and store:

- `sightingCount`
- `firstSeen`
- `lastSeen`
- `source`

## 10. Identifier conventions

### 10.1 Entity IDs

Generated as:

```text
{type_lowercase}::{slug(external_key)}
```

Examples:

- `person::p8842101`
- `company::co-101`

### 10.2 Edge IDs

Generated as:

```text
{relationship_lowercase}::{slug(dedupe_key)}
```

## 11. Application runtime model

The application is a static client-side SPA implemented without a framework.

### 11.1 Entry point

`demo/index.html` loads:

1. `seed.js`
2. `app.js`

### 11.2 State model

Primary runtime state:

- `data`
  - mutable dataset-specific ontology state
- `seedData`
  - dataset baseline
- `derived`
  - lookup maps and edge indexes
- `analysisState`
  - analytics, investigations, and ephemeral action log
- `copilotState`
  - prompt and generated answer
- `ui`
  - current tab, selections, filters, map state, graph state

### 11.3 Persistence

Browser persistence uses `localStorage`.

Storage key format:

```text
ontology-studio-demo-v2:{datasetKey}
```

Each dataset is persisted independently.

## 12. Derived indexes

`buildDerivedState()` constructs:

- `entityTypeMap`
- `relationshipMap`
- `mappingMap`
- `entityMap`
- `edgesBySource`
- `edgesByTarget`
- `typeCounts`

These indexes are used to avoid repeated full scans during render and analysis.

## 13. UI modules

### 13.1 Ontology editing tools

- Entity Types
- Properties
- Relationships
- Source Mappings
- Instance Editor
- Graph Explorer

These tools operate directly on the in-memory `data` object.

### 13.2 Investigation workspace

Generated from analytics hits and graph neighborhoods.

Contains:

- scenario cards
- summary and severity
- **recommended actions** — entity-aware action buttons with a live action log
- saved graph paths
- timeline
- transfer summary
- place summary

The action log is ephemeral: it is held in `analysisState.actionLog` and not persisted to `localStorage`. It is in-memory only and is lost on page reload. It is **not** cleared by `switchDataset()` or by the `reset-state` handler, so entries logged against same-ID scenarios (e.g. `scenario-watchlist-lead`) can carry across a dataset switch within the same session. Each log entry stores `{ ts, scenarioId, scenarioTitle, action }`.

### 13.3 Analytics workspace

Rule-driven rankings over the current ontology graph.

### 13.4 AI Copilot

Natural-language interface implemented with local prompt interpretation and graph synthesis.

No-result state displays:

- **"How this copilot is grounded"** card with a `⬡ Ontology-grounded` badge and four explanatory fact items
- **"Without the ontology vs. with it"** static comparison card — a raw CSV row alongside the equivalent linked ontology answer

Result state displays the answer card with a **grounding summary** line showing entity and relationship counts traversed, making the grounding claim verifiable rather than asserted.

### 13.5 Map workspace

Geospatial view implemented with a Leaflet map, OpenStreetMap tiles, and ontology-driven overlays.

## 14. Analytics rules

`buildAnalytics()` currently derives four rule groups:

### 14.1 Watchlist operators

Ranks risk-tagged people using:

- graph degree
- company count
- device count
- transfer value

### 14.2 Address hubs

Ranks locations using:

- registered company count
- observed people count
- observed device count

### 14.3 Travel-finance overlap

Ranks people using:

- flight count
- device count
- transfer value

### 14.4 Shared booking artifacts

Groups manifest rows by:

- booking reference
- payment-card suffix

Then ranks groups by:

- number of linked people
- number of flights

## 15. Investigation generation

`buildInvestigations()` converts high-value analytics hits into guided case scenarios.

Current scenario templates:

1. risk-tagged operator
2. shared address hub
3. shared booking cluster
4. travel + money movement

Each scenario stores:

- `id`
- `title`
- `summary`
- `severity`
- `score`
- `facts[]`
- `actions[]` — entity-aware action strings generated by `scenarioActions()`
- `focusEntityIds[]`
- `graph`
- `paths[]`
- `timeline[]`
- `places[]`
- `transfers[]`

### 15.1 Actions design

`scenarioActions(scenarioId, focusEntityIds)` generates entity-aware action strings by looking up focal entity labels from `derived.entityMap` at build time. Labels are interpolated directly into the action strings so that buttons reference the actual entity name (e.g. *"Escalate Kareem Haddad to Intelligence Unit"* rather than a generic template).

Actions are scenario-type-specific:

| Scenario | Focus type | Example actions |
|---|---|---|
| `scenario-watchlist-lead` | Person | Escalate, flag accounts, request border watch |
| `scenario-address-hub` | Location | Field surveillance, property registry, vehicle cross-reference |
| `scenario-booking-cluster` | Mixed | Travel history, payment instrument flag, border agency notification |
| `scenario-travel-finance` | Person | Financial intelligence report, travel authority coordination, account freeze |

Clicking an action button dispatches `execute-scenario-action`, which appends a `{ ts, scenarioId, scenarioTitle, action }` entry to `analysisState.actionLog` and triggers a re-render.

## 16. Graph algorithms

### 16.1 Subgraph extraction

`buildSubgraph(focusEntityIds, maxDepth, maxNodes)` performs a bounded breadth-first traversal around focal entities.

Used by:

- investigation scenarios
- copilot answer graph

### 16.2 Path summarization

`buildPathSummaries()` traverses the bounded graph and produces readable path strings such as:

```text
Person -> BOOKED_ON -> Flight -> ARRIVED_AT -> Airport
```

### 16.3 Timeline derivation

`buildTimeline()` converts:

- flight departures,
- company incorporation dates,
- transfer timestamps,
- location observations,
- watchlist links

into a sorted temporal sequence.

## 17. AI copilot design

The copilot is deliberately local and explicit.

### 17.1 Non-LLM design

The system does **not** call an external model.

Instead it:

1. tokenizes the query,
2. scores entity matches,
3. scores rule matches,
4. scores scenario matches,
5. selects focal entities,
6. builds a bounded answer graph,
7. synthesizes a response from structured evidence.

### 17.2 Query pipeline

Key functions:

- `normalizeText()`
- `queryTokens()`
- `collectEntityMatches()`
- `collectRuleMatches()`
- `collectScenarioMatches()`
- `summarizeEntityForCopilot()`
- `buildCopilotResponse()`

### 17.3 Copilot output

Each answer may include:

- summary paragraph(s)
- evidence lines
- focus entities
- recommended scenario
- recommended analytics rule
- answer graph
- suggested follow-up questions
- **grounding summary** — `"{n} entities matched · {n} relationships traversed · answer grounded in ontology"` derived from `result.graph`

### 17.4 Trust model

Because the copilot is graph-grounded, it is more explainable than a free-form generative answer, but it is still heuristic and only as good as the underlying links. The grounding summary and `⬡ Ontology-grounded` badge make this verifiable: students can compare the entity count in the summary against the answer graph nodes.

## 18. Map design

The map is a dedicated geospatial workspace.

### 18.1 Inputs

Map data is derived from:

- `Location` nodes with `lat/lon`
- `Airport` nodes with `lat/lon`
- `Flight` edges connecting airports
- current scope:
  - whole dataset
  - selected scenario
  - copilot answer

### 18.2 Place derivation

`buildMapPlaces()` computes:

- marker label
- place type / site category
- city / country context
- coordinates
- related edge count
- summary detail
- linked companies/people/devices/travelers

### 18.3 Route derivation

`buildMapRoutes()` groups flights by departure/arrival airport pair and computes:

- route count
- passenger count
- example flight numbers

### 18.4 Basemap

The primary renderer uses:

- Leaflet for map lifecycle and overlays
- OpenStreetMap raster tiles for the geographic basemap
- circle markers for ontology places
- polyline overlays for flight corridors

### 18.5 Rendering

`initializeLeafletMap()`:

1. creates the Leaflet instance,
2. mounts the OpenStreetMap tile layer,
3. draws route overlays from `buildMapRoutes()`,
4. draws place markers from `buildMapPlaces()`,
5. binds popups and selection handlers back into app state.

If Leaflet is unavailable, the app retains the older SVG renderer as a lightweight fallback.

## 19. Rendering model

The UI follows a full re-render strategy:

1. update state,
2. recompute derived state,
3. regenerate HTML via template strings,
4. replace `root.innerHTML`.

This is acceptable because:

- datasets are modest,
- the app is classroom-oriented,
- state and rendering remain easy to understand.

## 20. Event handling

Events are delegated from the root DOM node:

- `click`
- `change`
- `input`

Behavior is dispatched using `data-action` and `data-scope` attributes.

Notable actions added in this release:

- `execute-scenario-action` — appends to `analysisState.actionLog` and re-renders

This avoids per-component event wiring and keeps the app framework-free.

## 21. File-level responsibilities

### 21.1 `generate_synthetic_sources.py`

Responsible for:

- generating starter and simulator raw source files
- embedding realistic joins and inconsistencies

### 21.2 `build_ontology_seed.py`

Responsible for:

- ontology metadata
- source ingestion
- identity resolution
- entity and edge generation
- writing bundled seed catalog

### 21.3 `app.js`

Responsible for:

- state management
- all derived graph logic
- analytics
- scenario creation and entity-aware action generation (`scenarioActions()`)
- action log state (`analysisState.actionLog`)
- copilot grounding UI (badge, comparison card, grounding summary)
- guided tour walkthrough including Critical Perspectives step and `bullets[]` rendering
- map
- rendering
- interactions

### 21.4 `styles.css`

Responsible for:

- visual hierarchy
- layout
- graph styling
- map styling
- copilot and scenario styling
- action log (`.action-log`, `.action-log-entry`, `.action-log-ts`, `.action-log-empty`)
- grounding indicators (`.grounding-badge`, `.grounding-summary`)
- before/after comparison card (`.comparison-row`, `.comparison-label`, `.comparison-pre`)
- walkthrough bullets (`.walkthrough-bullets`)

## 22. Build and run

### 22.1 Build seed

```bash
python3 scripts/build_ontology_seed.py --output demo/seed.js
```

### 22.2 Serve demo

```bash
python3 -m http.server 8123 --directory demo
```

### 22.3 Generate or regenerate datasets

```bash
python3 scripts/generate_synthetic_sources.py --profile starter --output synthetic_data/starter
python3 scripts/generate_synthetic_sources.py --profile simulator --output synthetic_data/simulator
```

## 23. Validation approach

Current validation is lightweight and static:

- Python syntax checks for scripts
- JavaScript syntax check for `app.js`
- static HTTP smoke test

There is currently no automated browser test suite.

## 24. Performance characteristics

### 24.1 Strengths

- no network round-trips after page load
- no backend dependency
- simple derived indexes
- bounded graph views for large datasets

### 24.2 Current constraints

- rendering uses full HTML replacement
- many helpers still scan arrays
- copilot matching is heuristic and string-based
- map markers and routes are capped only indirectly through scope and filtering

## 25. Security and privacy model

Current model is minimal and demo-oriented:

- all data is local synthetic data
- no authentication
- no authorization
- no multi-user separation beyond browser-local state

This is acceptable for the classroom demo but not for production.

## 26. Known limitations

- no backend persistence beyond `localStorage`
- no collaboration or shared sessions
- no real lineage graph or audit log — the investigation action log is ephemeral (in-memory only, not persisted)
- no true semantic search or LLM-backed reasoning
- no map tile provider or real GIS stack
- no advanced entity resolution confidence scoring
- no streaming ingestion or job orchestration
- no schema migration/version system

## 27. Extension points

### 27.1 Backend/API layer

Possible next step:

- move seed payload behind a JSON API
- separate read model from client state

### 27.2 Real AI layer

Possible next step:

- replace heuristic copilot with an LLM-backed orchestration layer
- keep graph-grounded retrieval and evidence assembly

### 27.3 Stronger ontology management

Possible next step:

- add schema versioning
- add validation rules and cardinality constraints
- add ontology import/export contracts

### 27.4 Better map stack

Possible next step:

- add a tile-based map library
- support clustering, polygons, and temporal playback

### 27.5 Investigation workflows

Possible next step:

- add case notes
- add alert queues
- add analyst tasks
- add saved views
- **persist the action log** to `localStorage` per dataset, with tamper-evident checksums to simulate a real audit trail

## 28. Recommended future refactors

1. Extract data derivation logic from `app.js` into standalone modules.
2. Split rendering by workspace instead of one monolithic controller.
3. Introduce typed contracts for seed payloads.
4. Add automated tests for:
   - seed generation,
   - entity resolution,
   - analytics scoring,
   - copilot query routing,
   - map route derivation.
5. Replace repeated array scans with precomputed indexes for more relations.

## 29. Summary

The current implementation is a **static, framework-free, browser-based investigation demo** built around an explicit ontology. Its core design choices are:

- keep the ontology central,
- keep data local and inspectable,
- derive multiple analyst workflows from one graph,
- scale the same model across starter and simulator datasets,
- prefer transparent heuristics over hidden magic,
- surface the actions and audit model as first-class pedagogical concepts,
- ground the AI copilot visibly and verifiably rather than asserting it.

That makes it well suited for teaching how a Palantir-style system works at the architectural level, while remaining small enough for students to inspect end-to-end.
