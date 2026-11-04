# Phase 1 contract: governance core

Shared definition for the three Phase 1 builders (data, Investigate + core + Oversight, Build + glossary). Read with `REDESIGN_SPEC.md` §2.1–2.2, §4.1–4.4, §4.10, §5.2, §6.1–6.3. Where this file and the spec differ, **this file wins** (it resolves inconsistencies found while planning).

## 1. Markings and roles (amends spec §4.1)

The spec's role table contradicts its own user stories (patrol should see the case *without bank data*; the analyst should see it *with phone numbers withheld*). Resolved by adding a `TELECOM` marking for phone and location data.

| Marking | Label | Description | Source datasets |
|---|---|---|---|
| `OPEN` | Open | No restriction. | `company_registry` (public register) |
| `PII` | Personal data | Identifies a living person. | `flight_manifests` |
| `FIN` | Financial | Bank and payment data. | `bank_transactions` |
| `TELECOM` | Telecom | Phone numbers, handsets and location pings. | `mobile_location_pings` |
| `HEALTH` | Health | Collected for care; purpose-limited. | `clinic_registrations` (new) |
| `LE-SENSITIVE` | Law-enforcement sensitive | Watchlist and intelligence. | `watchlist` |

| Role id | Label | `markingsVisible` | `purposes` | `canApprove` | `canRemoveMarkings` | `canOpenOversight` |
|---|---|---|---|---|---|---|
| `patrol` | Patrol officer | OPEN, PII, TELECOM, LE-SENSITIVE | public-order | false | false | false |
| `fin-analyst` | Financial-crime analyst | OPEN, PII, FIN, LE-SENSITIVE | financial-crime | true | false | false |
| `dpo` | Data protection officer | all six (read-only) | oversight | false | true | true |
| `auditor` | Auditor | OPEN | oversight | false | false | true |
| `contractor` | Platform contractor | OPEN | maintenance | false | false | false |

Default role on first visit: `fin-analyst`. Nobody but the DPO sees `HEALTH`: that is the purpose-limitation lesson.

## 2. Seed additions (both seeds, per dataset key)

```js
catalog[ds].governance = {
  markings:  [{id, label, description, colour}],      // colour = CSS var name, e.g. "--mk-health"
  roles:     [{id, label, description, markingsVisible, purposes, canApprove, canRemoveMarkings, canOpenOversight}],
  purposes:  [{id, label}],                           // public-order, financial-crime, oversight, maintenance, healthcare, sanctions-screening, border-security, telecom-billing, public-record
  checkpoints: [{id, trigger, prompt, requiresPurpose, allowedRoles, refusalText}],
  honesty:   [{id, kind: "mirrors"|"simplified"|"extension", label, text, docUrl}]
}
```

**Checkpoints to seed** (`trigger` is the string the app passes):

| id | trigger | allowedRoles | prompt (exact text shown) |
|---|---|---|---|
| `cp-expand-telecom` | `graph.expand.telecom` | patrol, fin-analyst, dpo | You are about to expand from a person to their devices and every place those devices were observed. State the investigative purpose. |
| `cp-search-phone` | `search.byPhone` | patrol, fin-analyst, dpo | You are searching by phone number. State why you need to identify the holder of this number. |
| `cp-export` | `export.json` | fin-analyst, dpo | You are about to export ontology data outside the platform. State the purpose and the recipient. |
| `cp-marking-remove` | `marking.remove` | dpo | You are about to remove a marking. Everything derived from this dataset will become visible to more roles. State the legal basis. |

Only `cp-export` and `cp-marking-remove` set `requiresPurpose: true`; the two investigative checkpoints accept any non-empty justification by default (spec §4.3: "routine" must get through unless Strict is on). `cp-marking-remove` also sets `minLength: 20` (spec §4.2), enforced by the core.

`refusalText` for roles not in `allowedRoles`, e.g. "Your role cannot remove markings. This attempt has been logged."

**Honesty ids** (one per surface; the browser builders render a chip from these): `inv.agent`, `inv.investigations`, `inv.analytics`, `inv.map`, `inv.object-types`, `inv.properties`, `inv.link-types`, `inv.backing-datasets`, `inv.objects`, `inv.graph`, `build.pipelines`, `build.datasets`, `build.lineage`, `build.markings`, `oversight.audit`, `session.roles`, `session.checkpoints`. Text from research §B and spec §2.1 (e.g. `inv.agent` = simplified: "Rule-based stand-in for an AIP chatbot; it cannot invent objects. Real AIP uses an LLM with tools and stages edits for review."; `build.lineage` = extension: "Row- and field-level provenance goes beyond Foundry's dataset-level lineage."). `docUrl` from the research sources where one exists.

## 3. Object, property and link markings (Investigate seed and Build entities)

Markings say what a role needs to see **that the object exists** (`markings`) and **each property** (`propertyMarkings`). Rule by type:

| Object type | `markings` | `propertyMarkings` |
|---|---|---|
| Person | `["PII"]` | `phoneNumber: ["TELECOM"]`, `riskTag: ["LE-SENSITIVE"]`, `passportId: ["PII"]`, `homeAddress: ["HEALTH"]`, `clinicCode: ["HEALTH"]` |
| Company | `[]` | — |
| BankAccount | `["FIN"]` | — |
| Device | `["TELECOM"]` | — |
| Flight | `["PII"]` | `paymentCardLast4: ["FIN"]` |
| Airport | `[]` | — |
| Location | `[]`; residential (clinic-derived) `["HEALTH"]` | — |
| WatchlistRecord | `["LE-SENSITIVE"]` | — |

Links: `OWNS_ACCOUNT`, `HAS_CORP_ACCOUNT`, `TRANSFERRED_TO` → `["FIN"]`; `USES_DEVICE`, `OBSERVED_AT` → `["TELECOM"]`; `LISTED_ON` → `["LE-SENSITIVE"]`; `BOOKED_ON` → `["PII"]`; `RESIDES_AT` (new) → `["HEALTH"]`; others `[]`.

Each entity also gets `sourceMarkings`: the union of the markings of every dataset that contributed to it (for Build's lineage view and the "Why can't I see this?" line).

## 4. New dataset: clinic registrations (spec §5.2, Phase 1 subset)

- `synthetic_data/{starter,simulator}/clinic_registrations.csv`: `registration_id, patient_name, dob, home_address, home_city, home_country, lat, lon, clinic_code, registered_on, source` (`source = "clinic-ehr"`). Starter: about 8 rows covering 5 core people (including Kareem Haddad and Omar Rahman) plus 3 noise people; simulator: about 60.
- **Existing CSV/JSONL files must stay byte-identical.** Use a separate, fixed RNG for the clinic rows; add `--seed` (default 20260401) to the generator.
- `synthetic_data/{profile}/manifest.json`: `{ "<dataset>": {file, markings, purpose, legalBasis, retentionDays, asOf} }` for all six datasets.
- Pipeline: `01_normalize_sources.py` gains `normalize_clinic()` and copies manifest markings and purpose to `Dataset.markings` / `Dataset.purpose`; `Transform.run()` sets `output.markings = union(inputs)` and `markingProvenance = {marking: [raw dataset ids]}`; persons absorb clinic rows (name + dob only, via the shared resolver; never create a Person from a clinic row alone). Residential addresses become `Location` objects (`locationType: "residential"`) with `RESIDES_AT` links (`properties: {asOf, source}`). The Person gains `homeAddress` and `clinicCode`.
- Build seed datasets gain `markings`, `markingProvenance`, `purpose`, `legalBasis`, `retentionDays`. Acceptance (spec §4.2): `HEALTH` reaches 7 datasets downstream of the raw clinic dataset (adjust the number in the spec if the DAG differs, and say so).
- Seed size: the Build seed must stay under 10 MB.

## 5. Shared state (localStorage, spec §6.1)

```
dc-palantir:session      {sessionId, role, purpose, flags: {strictCheckpoints: false}}
dc-palantir:audit        [event…]                    (cap 5,000)
dc-palantir:governance   {markingOverrides: [{datasetId, removed, by, checkpointRecordId, ts, buildId}]}
dc-palantir:gotham:{ds}  (exists, Phase 0)
dc-palantir:foundry:{ds} (exists, Phase 0)
```

## 6. Core API (`core/*.js`, classic scripts on `window.DC`, loaded after `core/store.js`)

Owned by the Investigate builder. The Build builder codes against these signatures (and may shim them in tests, never in committed code).

```js
DC.governance.init(seedGovernance)            // call once per app after the seed loads
DC.governance.get()                           // {markings, roles, purposes, checkpoints, honesty}
DC.governance.role(id)                        // role object

DC.session.get()                              // {sessionId, role, purpose, flags}
DC.session.setRole(id)                        // persists, logs a "role" event, notifies listeners
DC.session.setFlag(name, bool)                // e.g. strictCheckpoints; logged
DC.session.onChange(cb)                       // also fires on the "storage" event from another tab

DC.audit.logEvent({surface, kind, verb, objectIds?, datasetId?, payload?, checkpointId?})  // -> Promise<event>
DC.audit.readEvents(filter?)                  // {kind?, role?, surface?, objectId?} -> event[]
DC.audit.verifyChain()                        // -> Promise<{ok, brokenAt}>
DC.audit.clear(reason)                        // instructor; the clear is the first event of the new log

DC.markings.canSee(roleId, markings)          // every marking in role.markingsVisible
DC.markings.redactEntity(entity, roleId)      // copy; hidden props -> {withheld: [..]}; whole object hidden -> {..., _withheld: [..]}
DC.markings.edgeVisible(edge, roleId)
DC.markings.removedAtOntology()               // Set of markings removed (by override) from "ontology_entities" or upstream
DC.markings.effectiveDatasetMarkings(dataset, datasetsById)   // applies overrides through markingProvenance
DC.markings.removeMarking({datasetId, marking, checkpointRecordId})   // writes governance override + "marking" event

DC.checkpoints.withCheckpoint(checkpointId, {surface, objectIds, datasetId, summary}, fn)
  // shows the modal (purple header, prompt, justification, purpose dropdown, Continue/Cancel);
  // writes a "checkpoint" event {promptText, justification, purpose, outcome: continued|cancelled|refused}
  // BEFORE running fn; refused roles see refusalText and fn never runs. Strict flag: purpose + >= 40 chars.

DC.ui.renderSessionStrip(el, {surface})       // role selector + description, purpose, strict toggle, audit count, Oversight link
DC.ui.renderAuditStrip(el, {surface})         // last three events + count + link
DC.ui.honestyChip(honestyId)                  // -> HTML string; links to glossary.html#<id>
```

`surface` values: `investigate`, `build`, `oversight`.

## 7. Names and pages

- UI names: **Investigate (Gotham-style)** for `demo/`, **Build (Foundry-style)** for `foundry-demo/`, **Oversight** for `audit/`. Directories stay.
- Renames (F10): *AI Copilot* → **Agent (simulated AIP)**; *Source Mappings* → **Backing datasets**; *Entity Types* → **Object types**; *Relationships* → **Link types**; *Instance Editor* → **Objects**. Internal field names stay.
- `glossary.html` at the root: Palantir term ↔ generic term (spec §2.2) and every honesty entry with an anchor per id.

## 8. Ownership

| Builder | Owns |
|---|---|
| Data | `scripts/`, `pipeline/`, `synthetic_data/`, `tests/`, both `seed.js`, `TECHNICAL_SPEC.md`/`FOUNDRY_TECHNICAL_SPEC.md` seed and pipeline sections |
| Investigate | `core/` (except `store.js` changes kept minimal), `demo/`, `audit/`, Investigate/Oversight sections of the tech specs |
| Build | `foundry-demo/`, `glossary.html`, `index.html`, all study and speaker guides (`*_GUIDE.md`, `*_WALKTHROUGH.md`), Build sections of `FOUNDRY_TECHNICAL_SPEC.md` |
