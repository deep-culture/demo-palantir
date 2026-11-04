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
demo/index.html                 -> static shell: Investigate (Gotham-style)
demo/seed.js                    -> bundled seed catalog (incl. the governance block)
demo/js/*.js, demo/js/render/   -> application logic (native ES modules, entry js/main.js; §11.4)
demo/styles.css                 -> presentation layer
core/*.js, core/core.css        -> shared governance core on window.DC (both apps + Oversight)
audit/                          -> Oversight page: reads the shared audit log
brand/                          -> shared Deep Culture design (deep-culture.css, Lexend fonts, logos)
vendor/                         -> bundled Leaflet 1.7.1 and marked 4.3.0 (no CDN needed)
```

Runtime model:

1. Raw CSV/JSONL files are generated offline.
2. `build_ontology_seed.py` converts raw data into an ontology payload.
3. The payload is emitted as JavaScript into `demo/seed.js`.
4. `demo/js/main.js` (an ES module) boots the app and `demo/js/state.js` loads that payload into browser memory.
5. All editing, analysis, agent responses, and map behavior run client-side.
6. State is persisted in `localStorage`: edits keyed by dataset, plus the shared session, audit log and governance overrides (§11.3, §30).

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
  - static entry point, titled "Investigate (Gotham-style)"
  - loads `seed.js`, the `core/` scripts, then `js/main.js` as `<script type="module">` (§11.1)

- `demo/js/` — application logic as native ES modules (no bundler, no build step; §11.4)
  - `state.js` constants, the shared mutable state, persistence, dataset switch, role view
  - `derive.js` lookups and graph derivation; `analytics.js` rules and scenarios
  - `agent.js` agent (simulated AIP); `map.js` geospatial derivation, Leaflet and SVG fallback
  - `governance.js` role checks, withheld notes, Checkpoints, audit logging (§30)
  - `render/*.js` one file per tab plus header, inspector, walkthrough, banners
  - `events.js` dispatch tables; `mutations.js` ontology edits and export; `main.js` boot

- `demo/styles.css`
  - all layout, panel, graph, copilot, and map styling

## 5. Data sources

The demo uses six linked sources per dataset, plus a manifest:

1. `watchlist.csv` — marked `LE-SENSITIVE`
2. `company_registry.csv` — `OPEN`
3. `flight_manifests.csv` — `PII`
4. `bank_transactions.csv` — `FIN`
5. `mobile_location_pings.jsonl` — `TELECOM`
6. `clinic_registrations.csv` (Phase 1) — `HEALTH`: `registration_id, patient_name, dob, home_address, home_city, home_country, lat, lon, clinic_code, registered_on, source` (`source = "clinic-ehr"`)
7. `manifest.json` — per dataset `{file, markings, purpose, legalBasis, retentionDays, asOf}`. The values come from `pipeline/governance.py` (`SOURCE_DATASETS`); the builders read the manifest. Legal bases are illustrative.

Clinic rows are health data collected for care. They are only ever *attached* to people who already exist in the other sources (exact name + date of birth); a row that matches nobody creates nothing (§8.7).

### 5.1 Starter dataset

The starter dataset is small enough for classroom explanation and manual inspection. Its 8 clinic rows cover 5 core people (Kareem Haddad, Elena Markovic, Omar Rahman, Sofia Petrov, Daniel Wu) and 3 noise people, all attached.

### 5.2 Simulator dataset

The simulator dataset preserves the same shape but scales row counts substantially. It has 60 clinic rows: the 5 core people (Kareem twice: he moved from Dubai to Limassol), 44 noise people (6 of them registered twice), and 4 patients who appear in no other source and therefore stay unattached. Two clinic rows for two different "Rami Keller"s (different birth dates) attach to the same Person, because the Phase 0 resolver had already merged them by alias: a false merge now carries health data.

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
- `RESIDES_AT` (Phase 1: `Person -> Location`, from clinic rows)

Person gains `homeAddress` and `clinicCode` (both HEALTH-marked); a clinic-derived Location has `locationType: "residential"`. No new object type.

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
  governance: {...},       // Phase 1, §7.1b
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

### 7.1a Metadata and versioning (schema version 3)

Each dataset's `metadata` block carries, besides `title`, `dataset`, `description` and `teachingPrompts`:

- `schemaVersion` — `3`; bumped when a field's meaning changes
- `buildId` — `"sha256:<hex>"`, a deterministic hash over the dataset's raw source files (sorted by name), `scripts/build_ontology_seed.py` and every `pipeline/*.py` file, with line endings normalised to LF (no timestamps)
- `sources` — `{"watchlist.csv": "sha256:<hex>", …}` per raw file
- `builder` — `build_ontology_seed.py@<git short sha>`, or `@dirty` when an input differs from `HEAD`
- `generatedAt` — build time (not part of `buildId`)

Computed by `pipeline/seedmeta.py`, shared with the Foundry builder. The browser compares `schemaVersion`/`buildId` with saved state to detect a regenerated seed (REDESIGN_SPEC §6.2).

`metadata.sources` also lists `clinic_registrations.csv` and `manifest.json`, so editing the manifest changes `buildId`.

### 7.1b Governance block (Phase 1)

`governance` is identical in both seeds and for every dataset key; it is built by `pipeline/governance.py` `governance_block()` (PHASE1_CONTRACT.md §1–§2):

```js
governance: {
  markings:    [{id, label, description, colour}],     // OPEN, PII, FIN, TELECOM, HEALTH, LE-SENSITIVE; colour = CSS var, e.g. "--mk-health"
  roles:       [{id, label, description, markingsVisible, purposes, canApprove, canRemoveMarkings, canOpenOversight}],
  defaultRole: "fin-analyst",
  purposes:    [{id, label}],
  checkpoints: [{id, trigger, prompt, requiresPurpose, allowedRoles, refusalText}],
  honesty:     [{id, kind: "mirrors"|"simplified"|"extension", label, title, text, docUrl}]
}
```

`label` on an honesty entry is the chip text ("Mirrors Foundry", "Simplified", "Teaching extension"); `title` is the surface name; `docUrl` is a source from the research report §G, or `null`. Marking lists are always in the order of `governance.markings`.

### 7.2 Source descriptors

Each source descriptor includes:

- `id`
- `name`
- `file`
- `description`
- `recordCount`
- `fields[]`
- `markings`, `markingProvenance` (`{marking: [id]}`), `purpose`, `legalBasis`, `retentionDays`, `inputPurposes`, `asOf` — from `manifest.json`

### 7.3 Entity instances

Each entity contains:

- `id`
- `type`
- `label`
- `properties`
- `sourceIds`
- `markings` — what a role must be cleared for to see that the object exists
- `propertyMarkings` — `{property: [marking]}`, fixed per object type (present whether or not the object has a value, so a missing value is not itself a signal)
- `sourceMarkings` — union of the markings of every raw dataset that contributed

Rules (PHASE1_CONTRACT.md §3; `pipeline/governance.py` `annotate_objects`):

| Object type | `markings` | `propertyMarkings` | `sourceMarkings` from |
|---|---|---|---|
| Person | `PII` | `phoneNumber: TELECOM`, `riskTag: LE-SENSITIVE`, `passportId: PII`, `homeAddress: HEALTH`, `clinicCode: HEALTH` | datasets of `resolution.mergedFrom`, plus clinic if it has a `RESIDES_AT` link |
| Company | — | — | company registry |
| BankAccount | `FIN` | — | bank transactions |
| Device | `TELECOM` | — | pings |
| Flight | `PII` | `paymentCardLast4: FIN` | flight manifests |
| Airport | — | — | flight manifests |
| Location | — ; `HEALTH` if the target of a `RESIDES_AT` link | — | datasets behind its `REGISTERED_AT` / `OBSERVED_AT` / `RESIDES_AT` links |
| WatchlistRecord | `LE-SENSITIVE` | — | watchlist |

Note that "9 Al Noor Park, Dubai" has `locationType: "residential"` from the registry but is not clinic-derived and is not marked.

Person entities also carry a top-level `resolution` block (§8.1):

```js
resolution: {
  method: "passport" | "phone" | "name+dob" | "alias" | "ping-only",
  confidence: 1.0 | 0.8 | 0.9 | 0.45 | 0.35,   // fixed per method
  mergedFrom: ["watchlist:WL-1001", "company:CO-104:director", "flight:NMF-0008", "ping:NPG-00018"],
  splitRisk: false,
  note: ""                                      // plain-English explanation or ""
}
```

### 7.4 Edge instances

Each edge contains:

- `id`
- `type`
- `source`
- `target`
- `label`
- `properties`
- `markings` — `FIN` for `OWNS_ACCOUNT`, `HAS_CORP_ACCOUNT`, `TRANSFERRED_TO`; `TELECOM` for `USES_DEVICE`, `OBSERVED_AT`; `LE-SENSITIVE` for `LISTED_ON`; `PII` for `BOOKED_ON`; `HEALTH` for `RESIDES_AT`; `[]` otherwise

## 8. Identity and entity resolution

Entity resolution is intentionally lightweight and explicit.

### 8.1 Person resolution

Persons are resolved by the shared `PersonResolver` in `pipeline/resolution.py`, which the Foundry pipeline (step 02) also uses, so both demos have identical entity IDs and identical `(type, source, target)` edge sets. Resolution is greedy, in one fixed pass over watchlist rows, registry directors and owners, flight passengers and mobile pings. Each record matches the first key that hits:

1. passport ID
2. phone number
3. normalized `name + dob`
4. alias lookup (last writer wins)

and otherwise creates a Person. Aliases and observed names are registered for later matching. The greedy order means a weak record seen first can split a person (e.g. "C. Silva" from pings vs. the registry's Clara Silva); these splits are kept as a teaching exhibit and exposed in `resolution`:

- `method` — strongest key that created or anchored the person (`ping-only` = known only from pings)
- `confidence` — fixed per method: passport 1.0, name+dob 0.9, phone 0.8, alias 0.45, ping-only 0.35
- `mergedFrom` — source record references absorbed into the person
- `splitRisk` — `true` when the method is `alias` or `ping-only` and another Person shares a normalised name, alias or surname + first initial
- `note` — e.g. "Created from phone pings observed as 'C. Silva', 'Clara Silva'; may be the same person as Clara Silva (b. 1977-11-25)."

`canonicalName`/`label` is the longest name from a watchlist, registry or flight record; for ping-only persons, the most frequent observed name (first seen on ties). No Person is labelled with its ID.

### 8.2 Company resolution

Companies are keyed by registry `company_id` or company name fallback.

### 8.3 Bank account resolution

Accounts are keyed by `account_id`.

### 8.4 Device resolution

Devices are keyed by `device_id`.

### 8.5 Airport resolution

Airports are keyed by code and enriched from a static coordinate table.

### 8.6 Location resolution

Locations are keyed by normalized label. The generator guarantees that no residential (clinic) address shares a label with a registry or ping location, so a HEALTH-marked residence never hides a public registry address.

### 8.7 Clinic attachment (Phase 1)

After the greedy pass, `resolution.attach_clinic_rows` attaches each clinic row to the Person whose normalised name + date of birth matches exactly (`PersonResolver.attach`). No passport, phone or alias fallback; no new Person; no lookup keys registered; no change to names, `method` or `mergedFrom`. Every Phase 0 entity ID, edge and `resolution` block is therefore unchanged (tested by building with and without the clinic file). Clinic references are deliberately *not* added to `mergedFrom`: the resolution block is unmarked, so `clinic:REG-…` there would reveal a health record to every role. The latest registration (by `registered_on`) supplies `homeAddress` and `clinicCode`.

## 9. Edge construction rules

Edges are built after resolution. An edge from a person-bearing record (watchlist, registry, flight, ping) goes to the person that record was resolved into (`PersonResolver.person_for`); account owners are matched by name against the final resolver state (`PersonResolver.find`).

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

### 9.6 Clinic registrations

- `Person -> RESIDES_AT -> Location` (residential), one per person/address pair, with `asOf` (latest `registered_on`) and `source` (`clinic-ehr`)

Unattached clinic rows produce no Location and no edge. These edges and Locations are built after all others.

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

1. `../vendor/leaflet/leaflet.js`
2. `seed.js`
3. `../core/store.js` (classic script, exposes `window.DC.store`)
4. `../core/governance.js`, `session.js`, `audit.js`, `markings.js`, `checkpoints.js`, `ui.js` (in that order; `window.DC.*`, §30)
5. `js/main.js` as `<script type="module">`; it imports the other modules in `js/` (§11.4)

Stylesheets: `../vendor/leaflet/leaflet.css`, `../brand/deep-culture.css`, `../core/core.css`, `styles.css`.

Serve the repository root over HTTP (local server or GitHub Pages); `file://` is not a supported target (Chromium refuses ES modules from `file://`).

The classic scripts run first and expose globals; the modules read `window.L`, `window.ontologySeedCatalog` and `window.DC` and never write them. `core/` stays classic because Build and Oversight load it too.

### 11.2 State model

Primary runtime state, all declared in `demo/js/state.js` and nowhere else. Other modules import the bindings (ES-module imports are live, read-only views) and mutate objects in place (`ui.activeTool = …`, `fullData.edges = …`); the few rebinds from outside go through setters: `setStoreNotice`, `setFullData`, `setSeedData`, `resetCopilotState`, `setLastViewedId`. `mapRuntime` (the live Leaflet map) lives in `map.js`.

- `fullData`
  - mutable dataset-specific ontology state, every object and property; this is what is persisted
- `data`
  - the current role's view of `fullData`, rebuilt by `rebuildRoleView()` at the start of every
    render, before `buildDerivedState()`. Every reader (analytics, scenarios, agent, map, graph,
    editors) reads `data`; every mutation writes `fullData` (fully visible objects are the same
    object in both, so property edits write straight through)
- `roleView`
  - `{roleId, active, removed, withheldEntities, withheldById, withheldByType, withheldEdges, redactedCount}`
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
  - `telecomExpanded` / `telecomRecords`: objects whose telecom links were opened through a Checkpoint (page session only)
  - `approvedPhoneQueries`: phone numbers searched under a Checkpoint (page session only)

### 11.3 Persistence

Browser persistence uses `localStorage` through `core/store.js` (`window.DC.store`), which wraps every access in `try/catch` and versions stored values against the seed (REDESIGN_SPEC §6.1–6.2).

Storage keys:

```text
dc-palantir:gotham:{datasetKey}          {schemaVersion, buildId, data}   edited ontology
dc-palantir:gotham:{datasetKey}:stale    {schemaVersion, buildId, data, staleSince, reason}
```

Each dataset is persisted independently. `loadState()` calls `DC.store.loadVersioned(key, seed)`:

| Stored value | Result | UI |
|---|---|---|
| nothing | seed | — |
| `schemaVersion` differs from `seed.metadata.schemaVersion` | seed; stored copy (and any stale copy) discarded | banner "The data format changed; earlier edits were cleared." |
| `buildId` differs from `seed.metadata.buildId` | seed; stored copy moved to `…:stale` | banner "The data was regenerated since your last visit…" with **Restore them** / **Dismiss** |
| versions match | stored edits | — |

`persist()` writes `DC.store.saveVersioned(key, seed, data)`. **Restore them** calls `DC.store.restoreStale(key, seed)`: the stale data becomes current and is re-stamped with the current build, so it is not flagged again. **Dismiss** calls `DC.store.dismissStale(key)`. The banner shows whenever a stale copy exists for the active dataset. **Reset dataset** removes the main key only.

Fallback for seeds without `metadata.buildId` (built before schema 3): `buildId = "fallback:" + FNV-1a(generatedAt | counts of entities, edges, datasets, entity types, relationship types, mappings)` and `schemaVersion = 2`. A rebuild that changes neither the timestamp nor any count is not detected.

Migration: the pre-redesign key `ontology-studio-demo-v2:{datasetKey}` is read once (only when the new key is empty), moved into the `…:stale` slot and deleted, so returning users see the restore banner instead of losing their edits.

### 11.4 Module layout and boot order

`demo/js/` (no file over ~600 lines; imports are relative, e.g. `../state.js`):

| File | Holds |
|---|---|
| `main.js` | deep links (`parseDeepLink`, `applyDeepLink`, `scrollSelectedGraphNodeIntoView`) and the boot sequence |
| `state.js` | constants (`ANALYST_TOOLS`, `SCHEMA_TOOLS`, `TOOL_HONESTY`, `DEFAULT_MAP_VIEW`, …), `datasetCatalog`, `ui`, the shared state and setters, `initState()`, `loadState`/`persist`/restore/dismiss (`DC.store`), `switchDataset`, `rebuildRoleView`, `refreshView`, `storedEntityById` |
| `util.js` | `clone`, `slugify`, `escapeHtml`, `truncate`, `normalizeText`, number formatters |
| `governance.js` | `governanceActive`, `currentRole(Id)`, `checkpointDefined`, `lackingMarkings`, `withheldAround`, telecom gate and `expandTelecom`, phone-number search, `logEvent`/`logView`/`logScenarioOpen`/`logRuleOpen`/`logSearch` |
| `derive.js` | `buildDerivedState` and lookups, relationship helpers, `buildSubgraph`, `buildPathSummaries`, `buildTimeline`, `buildPlaces`, `buildTransfers` |
| `analytics.js` | `buildAnalytics`, `createScenario`, `scenarioActions`, `buildInvestigations` |
| `agent.js` | the simulated AIP agent (ex-copilot): matching, `buildCopilotResponse`, `runCopilotQuery` |
| `map.js` | `buildMapData`, places and routes, Leaflet (`initializeLeafletMap`) and the SVG fallback (`renderMapSvg`) |
| `render/index.js` | `render()`, `ensureUiSelection`, focus capture/restore, `renderWorkspace` |
| `render/header.js`, `inspector.js`, `walkthrough.js`, `banners.js`, `common.js` | header and tabs; inspector; guided tour; store/deep-link banner, withheld notes, phone hold; panel header, honesty chip, fields |
| `render/agent.js`, `investigations.js`, `analytics.js`, `map.js`, `object-types.js`, `properties.js`, `link-types.js`, `backing-datasets.js`, `objects.js`, `graph.js` | one file per tab |
| `events.js` | `CLICK_ACTIONS` (keyed by `data-action`), `CHANGE_SCOPES` and `INPUT_SCOPES` (keyed by `data-scope`), `handleKeydown` |
| `mutations.js` | ontology edits, `exportJson`, `persistAndRender` |

Modules import each other in cycles (render ↔ state ↔ derive …). That is safe because no module does work at evaluation time except declaring constants; everything else happens in `main.js`, which is the entry point (nothing imports it), so every other module has finished evaluating before its body runs. Boot order in `main.js`:

1. `DC.session.setSurface("investigate")`
2. `initState()`: `initGovernance` → `seedData` → `fullData = loadState()` → `rebuildRoleView()` → `derived = buildDerivedState()`
3. click / change / input / keydown listeners on `#app`
4. `applyDeepLink(location.hash)` (may switch dataset and select an object), then the first `render()`
5. re-render on `DC.session.onChange`, `DC.markings.onChange` and `hashchange`

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

UI names (F10, contract §7): **Object types**, **Properties**, **Link types**, **Backing datasets**, **Objects**, **Graph Explorer**. Internal ids (`entity-types`, `relationships`, `mappings`, `instances`) and seed field names are unchanged.

These tools read the role view `data` and write `fullData`. In **Objects**, a withheld property is shown as a grey hatched cell "withheld — marking TELECOM" instead of an input, and the type's hidden objects are counted at the top of the list ("5 Device objects withheld from your role", with the "Why can't I see this?" line). Object type counts show "+N withheld".

**Resolution note (F0.2).** When a Person carries `entity.resolution = {method, confidence, mergedFrom, splitRisk, note}`, the Insight inspector (Graph Explorer / Instance Editor selection) and the Instance Editor entity card show a *Resolution* section: "Matched by phone · confidence 0.80" (methods: passport, phone, name + date of birth, alias, location ping only) and the merged-from records. When `splitRisk` is true a warm callout (background `#fff6e0`, 4px `#b26b00` left rule, label "RESOLUTION NOTE" in `#8a5300`) shows `resolution.note`. Nothing is rendered when `resolution` is absent.

**Deep links (F0.5).** `demo/index.html#object=<entityId>` and `#object=<entityId>&dataset=<datasetKey>` are honoured on load and on `hashchange`: the dataset is switched if given and known, the entity is selected, and the Graph Explorer opens in instance mode with the node highlighted and scrolled into view inside the canvas (the node is kept visible even if it falls outside the 84 highest-degree nodes). An unknown ID shows a dismissible notice. Foundry's Lineage tab links here.

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

### 13.4 Agent (simulated AIP)

Formerly "AI Copilot" (renamed in F10; the internal tool id stays `copilot`). Natural-language interface implemented with local prompt interpretation and graph synthesis. It reads only the role view, so withheld objects never reach it; when objects around the answer are withheld it says so ("Your role cannot see N linked objects … This answer uses only what your role can see"). A question containing a phone number goes through the phone-search Checkpoint first. Every asked question is logged (`agent.query`).

No-result state displays:

- **"How this agent works"** card with a `Rule-based stand-in` badge; one fact item carries the `inv.agent` honesty text from the seed ("Rule-based stand-in for an AIP chatbot; it cannot invent objects. Real AIP uses an LLM with tools and stages edits for review."). The earlier claim that real platforms cannot hallucinate is gone.
- **"Without the ontology vs. with it"** static comparison card — a raw CSV row alongside the equivalent linked ontology answer

Result state displays the answer card with a **grounding summary** line showing object and link counts traversed and "built only from objects your role can see".

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
- **grounding summary** — `"{n} objects matched · {n} links traversed · built only from objects your role can see"` derived from `result.graph`
- `withheld` — `{links, objects, markings}` hidden around the focus objects for the current role

### 17.4 Trust model

Because the agent is rule-based and graph-bound, it cannot invent objects, but it is heuristic and only as good as the underlying links — and only as complete as the role's view. A real AIP chatbot uses an LLM with tools and can be wrong; that is why its edits are staged for review (honesty label `inv.agent`, "Simplified").

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
- clinic registrations and residential addresses (Phase 1) from a separate random stream
- `manifest.json` per profile (values from `pipeline/governance.py`)

Two seeds: `--legacy-seed` (default 42) drives the five Phase 0 files; `--seed` (default 20260401) drives only the clinic data. CSVs are written with LF line endings, so a fresh run is byte-identical to the committed files.

### 21.2 `build_ontology_seed.py`

Responsible for:

- ontology metadata
- source ingestion
- identity resolution (via `pipeline/resolution.py`)
- entity and edge generation
- clinic attachment, residential Locations and `RESIDES_AT` (via `pipeline/resolution.py`)
- markings on objects, properties and links, and the governance block (via `pipeline/governance.py`)
- source descriptors with manifest markings and purposes
- seed metadata (via `pipeline/seedmeta.py`)
- writing bundled seed catalog

### 21.3 `demo/js/` (ES modules, §11.4)

Together responsible for:

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

Design: Deep Culture identity (shared with the landing page and Foundry demo via `../brand/deep-culture.css`). A purple `#832161` header band carries the green line logo and the title in a green `#ADFC92` highlight; the workspace is white, with main panel titles in a purple highlight (as slide titles on white); the guided-tour card is black with green accents. Type is Lexend, bundled locally.

## 22. Build and run

### 22.1 Build seed

```bash
python3 scripts/build_ontology_seed.py --output demo/seed.js
```

### 22.2 Serve demo

```bash
python3 -m http.server 8123   # from the repository root; open http://127.0.0.1:8123/demo/
```

Serve the repository root, not `demo/`: the page loads `../core/`, `../brand/` and `../vendor/`.

### 22.3 Generate or regenerate datasets

```bash
python3 scripts/generate_synthetic_sources.py --profile starter --output synthetic_data/starter
python3 scripts/generate_synthetic_sources.py --profile simulator --output synthetic_data/simulator
```

Defaults: `--seed 20260401` (clinic data), `--legacy-seed 42` (Phase 0 files). Rebuild both seeds afterwards.

## 23. Validation approach

`bash scripts/check.sh` builds both seeds to a temp directory, runs `node --check` on `foundry-demo/app.js`, the built seeds and every module in `demo/js/` (as ES modules: `node --input-type=module --check < file`), and runs pytest (`pip install --break-system-packages pytest` if missing):

- `tests/test_resolution_parity.py` — Gotham and Foundry seeds have identical entity IDs, edge sets, Person labels and `resolution` blocks, for both datasets
- `tests/test_person_names.py` — no Person `canonicalName`/`label` starts with `person::`
- `tests/test_seed_contract.py` — `schemaVersion` 3, `buildId` present, stable across builds and CRLF-insensitive, every Person has a valid `resolution`, `governance` present, seeds under 10 MB, and the committed `demo/seed.js` / `foundry-demo/seed.js` match a fresh `buildId` (regenerate them when sources, builders or `pipeline/*.py` change)
- `tests/test_governance_block.py` — markings, roles, purposes, checkpoints (exact prompt texts) and honesty ids match PHASE1_CONTRACT.md; the block is identical in both seeds and every dataset; honesty `docUrl`s come from the research report's sources
- `tests/test_object_markings.py` — the §3 rules hold for every entity and edge in both seeds and are identical between them; residential Locations are reached only via `RESIDES_AT`; clinic data changes no existing identity (seed built with and without the clinic file); unmatched clinic rows create nothing
- `tests/test_markings_propagation.py` — manifest markings; the union rule and provenance on every Build dataset; `HEALTH` on exactly the datasets downstream of `clinic_registrations.csv`; `Transform.run()` unions
- `tests/test_generator_determinism.py` — same `--seed` gives byte-identical output, equal to the committed files; `--seed` changes only clinic data; the five Phase 0 files are unchanged since Phase 0

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
- roles, markings and Checkpoints are evaluated in the browser (§30): a **model** of enforcement for teaching, not security — anyone can switch role in the session strip or edit `localStorage`
- no multi-user separation beyond browser-local state

This is acceptable for the classroom demo but not for production.

## 26. Known limitations

- no backend persistence beyond `localStorage`
- no collaboration or shared sessions
- the audit log (§30.4) lives in `localStorage` with a hash chain: tamper-*evident* against casual edits, trivially rewritable by anyone with devtools; the per-scenario action log in the UI is still ephemeral (actions are also written to the audit log)
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

1. ~~Extract data derivation logic from `app.js` into standalone modules.~~ Done in Phase 1 (`demo/js/`, §11.4).
2. ~~Split rendering by workspace instead of one monolithic controller.~~ Done in Phase 1 (`demo/js/render/`).
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

## 30. Governance in Investigate and Oversight (Phase 1)

Spec: `REDESIGN_SPEC.md` §4.1 (F1), §4.3 (F3), §4.4 (F4), §4.10 (F10), §6.1, §6.3; contract `context/PHASE1_CONTRACT.md` (authoritative). Seeds without a `governance` block still work: `DC.governance.isActive()` is false, every object is visible, no Checkpoint applies, the session strip says so.

### 30.1 Shared core (`core/*.js`, classic scripts on `window.DC`)

| File | API (contract §6) | Additions |
|---|---|---|
| `governance.js` | `init(seedGovernance)`, `get()`, `role(id)` | `isActive()`, `marking(id)`, `purpose(id)`, `honesty(id)`, `checkpoint(idOrTrigger)`, `onInit(cb)`, `DEFAULT_ROLE` |
| `session.js` | `get()`, `setRole(id)`, `setFlag(name, bool)`, `onChange(cb)` | `setPurpose(id)`, `setSurface(name)`, `surface()`, `role()` |
| `audit.js` | `logEvent(partial)`, `readEvents(filter)`, `verifyChain()`, `clear(reason)` | `count()`, `onChange(cb)`, `CAP`, `GENESIS` |
| `markings.js` | `canSee`, `redactEntity`, `edgeVisible`, `removedAtOntology`, `effectiveDatasetMarkings`, `removeMarking` | `missing`, `rolesThatCanSee`, `whyWithheld`, `isWithheld`, `explainDatasetMarkings`, `registerDatasets`, `overrides`, `clearOverrides`, `onChange`, `ONTOLOGY_DATASETS` |
| `checkpoints.js` | `withCheckpoint(idOrTrigger, ctx, fn)` | `isOpen()`, `STRICT_MIN_LENGTH` (40) |
| `ui.js` | `renderSessionStrip(el, {surface})`, `renderAuditStrip(el, {surface})`, `honestyChip(id)` | options `theme`, `oversightHref`, `onRoleChange`; `configure()`, `markingChip()`, `withheldCell()`, `whyLine()`, `escapeHtml()`, `describeEvent()` |
| `core.css` | marking palette `--mk-*`, strips (`.dc-strip-light` / `.dc-strip-dark` on the container), Checkpoint modal, `.dc-honesty-*`, `.dc-marking`, `.dc-withheld` | |

`localStorage` keys: `dc-palantir:session`, `dc-palantir:audit` (+ `dc-palantir:audit:meta` `{dropped, anchorHash, lastSeq}`), `dc-palantir:governance` `{markingOverrides[], ontologyRemoved[]}`. All three fire `onChange` listeners in other tabs through the `storage` event, so a role switched in Oversight or Build shows in an open Investigate tab.

### 30.2 Role view (F1)

Code: `rebuildRoleView()` / `refreshView()` in `demo/js/state.js`; the glue (role checks, `withheldAround`, Checkpoint wiring, audit helpers) in `demo/js/governance.js`.

`rebuildRoleView()` runs first in every `render()`:

1. `removed = DC.markings.removedAtOntology()` — markings a DPO removed at `ontology_entities`/`ontology_edges` (directly, or upstream as computed by Build and stored in `ontologyRemoved`) are ignored.
2. Each entity goes through `DC.markings.redactEntity(entity, role)`: an object whose `markings` the role lacks is withheld (`_withheld: [markings]`, label and values dropped) and counted; a property in `propertyMarkings` the role lacks becomes `{withheld: [markings]}`.
3. A link is kept iff both ends are visible and `DC.markings.edgeVisible(edge, role)`.
4. `buildDerivedState()`, analytics, scenarios, agent, map and graph then read the view only. `entityProperty()` returns `""` for a withheld placeholder and search uses `visiblePropertyValues()`, so a withheld value contributes nothing to a score or a match.

Rendering: the header shows "N objects and M links withheld from your role"; scenarios, the agent answer and the inspector show `withheldAround(ids)` (withheld links touching the objects, and the hidden objects at their far end) with the "Why can't I see this?" line naming the marking and the roles that could see it (`DC.markings.whyWithheld`). A deep link to a withheld object shows a banner instead of "not in dataset". Changing role (`DC.session.onChange`) or a marking override (`DC.markings.onChange`) re-renders everything.

Effect on "Trace the risk-tagged operator" (starter, Jelena Markovic): financial-crime analyst score 22 (4 accounts, $23,460, devices withheld — TELECOM); patrol officer score 14 (0 accounts, $0, no Bank Account nodes — FIN).

### 30.3 Checkpoints (F3)

| Trigger | Where in Investigate |
|---|---|
| `graph.expand.telecom` | **Expand devices & locations** in the inspector for a Person (Objects, Graph Explorer), on the scenario card for its focus person or place, on agent focus cards; **Expand people observed here** for a Location (inspector, map place panel) |
| `search.byPhone` | Graph Explorer and Map search boxes, and agent questions, when the query looks like a phone number (`looksLikePhone`: digits, spaces, `+-().`, ≥ 7 digits, not a date). The query is held — not applied — until the Checkpoint passes; Enter or "Search by phone number…" opens it |
| `export.json` | **Export JSON** (refused for patrol, auditor, contractor) |

Telecom gate: while the gate is active (seed defines `graph.expand.telecom`), TELECOM links (`USES_DEVICE`, `OBSERVED_AT`) are not traversed by `buildSubgraph()` (scenario and agent graphs) or drawn in the Graph Explorer, and a Person's observed places / a Location's observed people are not listed, until that object has been expanded under a Checkpoint record. Analytics still score over everything the role can see. If the role lacks TELECOM, the control shows a withheld cell instead of a button.

Record flow (`core/checkpoints.js`): modal (purple header, green-highlight title, white body, focus trap, Esc = Cancel, initial focus in the justification) → the `checkpoint` event `{payload: {checkpoint, promptText, justification, purpose, outcome}}` is written → only then `fn(record)` runs and logs its own event with `checkpointId = record.recordId` ("cpr-YYYYMMDD-NNNN"). `promptText` is read from the rendered prompt element, so it is the text shown. Refused roles see `refusalText`; the refusal is logged and `fn` never runs. Default validation: justification not empty ("routine" passes). Strict (session strip toggle): purpose required and ≥ 40 characters.

Export writes the role view (withheld placeholders kept, withheld objects counted by type in `exportMetadata`, with the role and the Checkpoint record id).

### 30.4 Audit (F4)

Events: `{id: "ev-000123", seq, ts, sessionId, role, surface, kind, verb, objectIds, datasetId, payload, checkpointId, prevHash, hash, alg}`. `hash` = SHA-256 (`crypto.subtle`) over a canonical string of all other fields; `alg: "fnv1a-64"` when `crypto.subtle` is unavailable (e.g. `file://`). Writes are queued so the chain stays ordered; another tab writing mid-hash causes a retry from the new tail. Cap 5,000: the oldest events are dropped and `audit:meta.anchorHash` keeps the chain verifiable. `clear(reason)` empties the log and writes `audit.clear` as its first event (sequence numbers continue).

Investigate logs: `session.setRole` (kind `role`), `session.setPurpose` / `session.setFlag` (`session`), `object.view` (any object selected in Objects, Graph Explorer, scenario/agent graphs, deep links; repeated selection of the same object is not re-logged), `graph.search` / `map.search` (on change or Enter, not per keystroke), `search.byPhone`, `graph.expand.telecom` (`expand`), `export.json`, `scenario.open`, `rule.open` (`view`), `agent.query` (`agent`), `scenario.action` (`action`), and every Checkpoint outcome. The payload carries `dataset` (starter/simulator).

The audit strip (sticky, black, bottom of the page) shows the last three events, the count and a link to Oversight; it has `aria-live="polite"`. The session strip (white variant) sits under the purple band: role selector with description and the markings it sees, purpose, Strict checkpoints toggle, audit count (all / this session) and the Oversight link.

### 30.5 Oversight (`audit/`)

`audit/index.html` loads `../demo/seed.js` only for the governance block, the core scripts and `audit/oversight.js` / `audit/oversight.css`. Black background, purple band with the green line logo, dark session strip.

- **Role gate**: opens only for roles with `canOpenOversight` (DPO, auditor). Others see "Your role (…) cannot open Oversight. This attempt has been logged." Every open is logged as `oversight.open` with `outcome: granted | refused` (once per role per page load).
- **Chain status**: `DC.audit.verifyChain()` on load and on every change: "Hash chain verified · N events" or "Hash chain broken at ev-…".
- **Filters**: kind, role, surface, verb (substring), object (with a datalist of all object ids in the log). Clicking an object id in any table filters by it.
- **Per-object timeline**: "Everyone who touched `<id>`" — time, role, verb, outcome, surface, justification.
- **Audit table**: #, time, role, surface, kind, verb (+ outcome), objects, justification (an operation shows the justification of the Checkpoint record it ran under). Newest first, at most 500 rows.
- **Checkpoint records**: record id, time, role, checkpoint, prompt as shown, justification, purpose, outcome, objects.
- **Redaction toggle** (Raffinaderij exhibit): the tables turn into a white "released document" and about 99% of cells (a fixed hash of event id + column, `hash % 100 !== 0`) become black bars. Caption: the Dutch police platform built on Palantir since 2012, whose Woo-released documents came back about 99% redacted. Toggling is logged.
- **Export** CSV / JSON of the filtered events (logged as `audit.export.csv|json`).
- **Clear audit (instructor)**: needs a reason; `DC.audit.clear(reason)`.

Action history with before/after arrives with Actions (F5, Phase 2).

