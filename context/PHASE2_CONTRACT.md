# Phase 2 contract: Actions, entity resolution, Karlsruhe mode

Shared definition for the three Phase 2 builders. Read with `REDESIGN_SPEC.md` §4.5 (F5), §4.6 (F6), §4.9 (F9), §5.1, §5.2, §5.4, and `context/PHASE1_CONTRACT.md` (still in force). Where this file and the spec differ, **this file wins**.

## 1. Storyline changes (data)

- **Namesake** (spec §5.1 item 1): `PER-007` Omar Rahman, born 1979-02-02, British, passport `G5510077`, phone `+447911223344`, home *41 Oak Lane, Birmingham*. A care worker. Flies LHR–IST twice (a route shared with the watchlisted Omar Rahman `N5538219`). One manifest spells him **Umar Rahman**. Pays rent by bank transfer. Has a clinic registration. No watchlist entry. He must be a **separate Person** at the default threshold.
- **Clinic data follows the spec**, which amends Phase 1: clinic rows cover the namesake, some non-watchlisted core people and about 60% of noise people, but **none of the four watchlisted people**. Health data on a watchlisted person can then only come from a false merge, which is a second thing for students to notice. Phase 1's markings and propagation rules are unchanged.
- **Simulator:** two more namesake pairs among the noise people (same name, different date of birth), so the resolution table isn't a one-row demo.
- Existing raw rows stay byte-identical. New rows are appended, or written as new files, with a fixed RNG. Existing Person IDs and properties stay unchanged; the namesake is new.

## 2. Entity resolution (F6)

The seed's Persons stay as the pipeline resolved them, and that is what the **default threshold 0.75** means. The pipeline also writes **cross-person candidate pairs** with transparent scores. The browser merges pairs whose score is at or above the threshold (union-find). Above 0.75 nothing splits, and the UI says so: "merges made by the pipeline's deterministic rules are fixed in this build — see each person's resolution record".

```js
catalog[ds].resolution = {
  defaultThreshold: 0.75,
  minThreshold: 0.30,
  signals: [{id, weight, label, note}],            // the scorer's weights, shown to students
  candidates: [{id, left, right, score, signals: [signalId], block, explanation}],
  // left/right are Person IDs; score = clamp(sum of weights, 0, 1); explanation is plain English
}
```

- The builder chooses the weights and documents them; it is a transparent weighted sum. Suggested signals: `name-exact`, `name-translit` (Omar/Umar), `surname+initial`, `dob-exact`, `dob-conflict` (negative), `phone-exact`, `shared-route`, `shared-address`, `same-nationality`.
- **Constraints (tested):**
  - No candidate scores ≥ 0.75. Otherwise the pipeline would already have merged the pair.
  - The namesake pair `person::n5538219` ↔ the namesake scores in **[0.50, 0.60)**, *with* the `dob-conflict` penalty applied and shown. The lesson is that the penalty is too small.
  - At 0.55, merging puts the namesake into the "Watchlist operators" rule.
  - Each simulator namesake pair scores between 0.40 and 0.70.
  - Blocking: same normalised surname, or a shared phone or address. Keep starter to at most 40 candidates and simulator to at most 400.
- When persons are merged, the merged person takes the union of their properties, with **the watchlisted member's `riskTag` winning**. Edges are remapped to the cluster representative, the lowest-sorting watchlisted ID or else the lowest ID.
- **Unmerge** is an Action (`act-unmerge-person`) that writes `resolutionOverrides: [{candidateId, decision: "reject", by, reason, ts}]` to `dc-palantir:governance`. It is honoured at every threshold. Threshold changes are logged.
- The threshold lives in `dc-palantir:governance.threshold`, so it is shared by both apps.

## 3. Actions (F5)

```js
catalog[ds].ontology.actionTypes = [{
  id, label, objectType, sensitive, description,
  parameters: [{id, label, type: "string"|"enum"|"boolean", required, minLength?, options?}],
  allowedRoles, checkpointId,            // checkpointId optional; sensitive Actions use "cp-action-sensitive"
  effects: [ {op: "setProperty", property, from: "param:x"|"value:..."},
             {op: "createObject", type, properties},     // values may be "param:x", "session:role", "now", "object:prop"
             {op: "createLink", linkType, target: "created:<Type>"|"object"},
             {op: "deleteLinked", linkType, targetType},  // used by "Remove from watchlist"
             {op: "writeback", system, template} ],       // template placeholders {label} {passportId} {param} etc.
  feedsAnalytics: bool, honesty: "inv.actions"
}]
```

| id | label | objectType | roles | effects |
|---|---|---|---|---|
| `act-add-to-watchlist` | Add to watchlist | Person | fin-analyst | set `riskTag`; create a WatchlistRecord and a `LISTED_ON` link; writeback to `border-watch` |
| `act-remove-from-watchlist` | Remove from watchlist | Person | fin-analyst | clear `riskTag` (only if set by an Action; otherwise refuse, saying so); delete the Action-created WatchlistRecord and link; writeback |
| `act-flag-account` | Flag account for review | BankAccount | fin-analyst | set `reviewFlag`; writeback to `bank-compliance` |
| `act-request-border-watch` | Request border watch | Person | patrol, fin-analyst | writeback to `border-watch` only (no ontology change) |
| `act-unmerge-person` | Unmerge person | Person | fin-analyst, dpo | write a resolution override (§2); writeback to `case-management` |

External systems (`ontology.externalSystems`): `border-watch` "Border watch system", `bank-compliance` "Bank compliance desk", `case-management` "Case management".

Action instance:

```js
{id, actionTypeId, objectId, ts, role, params, before, after, writebacks: [{system, message, ts}], stagedBy: "user"|"agent", approvedBy}
```

Instances are stored in `dc-palantir:governance.actionLog`. Effects are applied to Investigate's persisted ontology (`fullData`), so **Reset dataset clears them**, and analytics see them through the normal role view. The "Watchlist operators" rule shows a footnote: "*n* objects risk-tagged by Actions in this session".

## 4. Purposes and Karlsruhe mode (F9)

Seed additions in `governance`:

```js
purposeRules: [
  {id: "R1", text: "Automated cross-dataset analysis needs a stated purpose on the session.", operations: ["expand","rule","action"], requires: "sessionPurpose", effect: "block"},
  {id: "R2", text: "Data collected for healthcare may not be combined with law-enforcement purposes.", operations: ["expand","rule","action","view"], incompatible: {data: ["healthcare"], session: ["public-order","financial-crime"]}, effect: "block"},
  {id: "R3", text: "Expansion beyond the first hop requires a concrete, logged danger statement.", operations: ["expand"], depthOver: 1, effect: "checkpoint", checkpointId: "cp-danger-statement"}
],
legalBasisNote: "Our abstraction of the BVerfG 2023 ruling's logic, not its text [to verify against the press release before teaching as the court's criteria]."
```

- New checkpoints: `cp-action-sensitive` (trigger `action.execute`; roles fin-analyst, dpo), `cp-danger-statement` (trigger `expand.danger`; roles patrol, fin-analyst, dpo; `minLength: 30`; prompt "Describe the concrete danger that justifies widening this analysis beyond the first hop."), `cp-exception` (trigger `purpose.exception`; roles fin-analyst, dpo; `requiresPurpose: true`; records are tagged `exception`).
- Which purpose a piece of data has comes from the dataset manifest. Objects, properties and links carry it through their markings (HEALTH ⇒ `healthcare`) and `sourceMarkings`.
- **Mode off (default):** nothing is blocked, but each expansion, rule run and Action logs the purposes involved (`payload.purposes`).
- **Mode on:** a blocked operation shows a red "Blocked by rule R2" card with the rule text and a "Request exception" button (`cp-exception`). For rules, the rule panel shows "blocked" instead of a ranking. Toggling the mode is logged.

## 5. Discussion cards (spec §5.4)

`governance.discussions = [{id, title, attachedTo: [surface ids], summary, questions: [q1, q2], sources: [url], disclaimer}]` for ICE ImmigrationOS/ELITE (attached to `build.markings`), BVerfG 2023 (`session.checkpoints`, `inv.karlsruhe`), Raffinaderij (`oversight.audit`), NHS FDP (`session.roles`, `build.markings`) and POL-INTEL (`build.pipelines`). Use the research report's wording, paraphrased, with its source URLs. Each card's disclaimer: "Discussion material about real institutions and public reporting. Nothing here simulates a real person." Maven and Leads come in Phase 3.

## 6. Core API additions (`core/*.js`, owned by the Investigate builder)

```js
DC.resolution.init(seedResolution)
DC.resolution.threshold() / setThreshold(t)           // persisted in governance, logged ("resolution" kind)
DC.resolution.resolveAt(t?)                            // -> {clusters: Map(rep -> [ids]), repOf: Map(id -> rep), merges: [{candidate, rep}]}
DC.resolution.overrides() / reject(candidateId, reason)
DC.resolution.explain(personId)                        // -> [{candidate, signals, score}] chain for this cluster

DC.actions.init(actionTypes, externalSystems)
DC.actions.applicable(objectType, roleId)              // action types
DC.actions.applyAction(typeId, objectId, params, {staged, apply})
  // validates params, checks the role, runs the Checkpoint (cp-action-sensitive when sensitive), runs purposes.check,
  // calls opts.apply(effects, ctx) to mutate the app's data (the app owns its data), records the instance and writebacks,
  // logs an "action" event with before/after. staged:true -> pending only (Phase 3 agent).
DC.actions.pending() / approveAction(id) / rejectAction(id)
DC.actions.log(filter?) / inbox(systemId)

DC.purposes.init(rules)
DC.purposes.enabled() / setEnabled(bool)               // "Karlsruhe mode", logged
DC.purposes.check(operation, {dataPurposes, depth, sessionPurpose}) -> {allowed, rule, effect}

DC.ui.discussionCard(id) / discussionCardsFor(surfaceId)   // -> HTML
DC.ui.karlsruheToggle  // part of renderSessionStrip
```

## 7. Ownership

| Builder | Owns |
|---|---|
| Data | `scripts/`, `pipeline/`, `synthetic_data/`, `tests/`, both seeds, the seed and pipeline sections of the tech specs |
| Investigate | `core/` (new `actions.js`, `resolution.js`, `purposes.js`; additions to `ui.js`, `session.js`, `core.css`), `demo/`, `audit/`, the Investigate and Oversight sections of `TECHNICAL_SPEC.md` |
| Build | `foundry-demo/` (new **Resolution** tab, purpose and Karlsruhe display, discussion cards), `glossary.html` (new terms: Action type, writeback, candidate, threshold, purpose rule), `index.html`, the Build sections of `FOUNDRY_TECHNICAL_SPEC.md`. Guides: only factual and renamed-term fixes. The full runthrough is written after Phase 3. |
