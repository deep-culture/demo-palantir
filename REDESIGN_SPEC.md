# Redesign specification: demo-palantir

**For:** Tobias Blanke (owner) and the developer implementing the next version
**Branch:** `deep-culture-design`
**Date:** 4 November 2026
**Status:** proposal for decision; see §9 for the questions only Tobias can answer

This document specifies the next version of the classroom tool that simulates Palantir-style platforms on synthetic data. It builds on the verified research report (`context/PALANTIR_RESEARCH_2026-11-04.md`, referred to below as *the research*), the two technical specs, the four teaching guides and a code review of both apps, the pipeline and the builders. Where a claim about Palantir comes from the research it is cited by section (e.g. *research §B.3*). Anything not in the research is marked **[to verify]**.

---

## 1. Purpose and teaching goals

### 1.1 What the tool is for

The tool exists so that students can understand how an operational intelligence platform works from the inside — and then question it. It is not a product demo. Its job is to make three things visible that real deployments keep out of sight: **governance** (who may see and do what, and how that is enforced), **power** (how a platform turns data into decisions about people) and **error** (how a merged record, a stale address or a low threshold becomes a wrong decision).

The pedagogical stance, stated once here and applied throughout:

- The tool must never read as an advert for Palantir. Every polished capability sits next to the thing that can go wrong with it and a prompt to argue about it.
- The tool must also be honest in the other direction. Where Palantir has built a real safeguard (markings, Checkpoints, staged AI edits) the tool shows it working, so that students can judge whether it is enough rather than argue against a straw man.
- Everything is synthetic. No real person, address or document is simulated. Real case studies are *discussion material* attached to features, clearly marked as such.

### 1.2 Learning outcomes by session

After the redesign the course runs as three sessions (see §3.4 for the alternative two-session cut).

| Session | Students can **see** | Students can **do** | Students can **critique** |
|---|---|---|---|
| 1 — Investigate | An ontology of object types and link types; the same case looking different under different roles; a Checkpoint prompt; the audit trail their own clicks produce | Follow a case across people, companies, flights, money and devices; execute an Action and watch the analytics change; justify a sensitive search | Whether a free-text justification is a safeguard; whether connection count equals suspicion; who the audit log is really about |
| 2 — Build and govern | The pipeline that manufactured the ontology; a marking travelling from a raw dataset to every derived dataset; entity resolution as scored candidates, not facts | Move the resolution threshold and merge an innocent namesake into a watchlisted person; unmerge; try to remove a HEALTH marking | Error as a design choice; purpose limitation as code versus as law; what lineage proves and what it does not |
| 3 — Agent, leads and oversight | A simulated AIP agent calling tools, citing objects and staging edits; a leads map with an address-confidence formula; the auditor's view of everything done in Sessions 1–2 | Approve or reject staged Actions; catch the agent inventing a link; filter the audit log as an oversight body would | The human in the loop; health data repurposed for enforcement; who audits the auditors |

---

## 2. Design principles

### 2.1 Honesty labels

Every surface carries one of three labels, rendered as a small chip next to the panel title and listed in a glossary page:

| Label | Meaning | Example |
|---|---|---|
| **Mirrors Foundry/Gotham** | The behaviour follows Palantir's documented concept; the doc is linked | Markings inherited down lineage (*research §B.5*) |
| **Simplified** | The concept is real; the implementation is a stand-in | Rule-based analytics standing in for Search Around-style expansion (*research §B.7*) |
| **Teaching extension** | Goes beyond what Palantir documents, because it helps students see something | Row- and field-level provenance; Foundry's lineage is dataset-level (*research §B.5*) |

The label text is stored with the feature definition in the seed (`metadata.honesty[]`) so the UI and the docs cannot drift apart.

### 2.2 Terminology

The apps adopt Palantir's vocabulary (*research §B.1–B.2*), with the generic term kept in a glossary and in tooltips for the first two sessions.

| Palantir term (use in UI) | Current demo term | Generic meaning |
|---|---|---|
| Object type | Entity type | A class of thing: Person, Company |
| Object | Entity / instance | One Person |
| Property | Property | A typed attribute |
| Link type / link | Relationship type / edge | A typed connection between two objects |
| Object set | (none) | A saved, shareable set of objects |
| Backing dataset | Source mapping | The dataset whose rows become objects of a type |
| Action type / Action | Scenario action string | A permitted, parameterised, logged change to objects |
| Marking | (none) | A mandatory security label that travels with data |
| Checkpoint | (none) | A purpose-justification prompt before a sensitive operation |
| Interface | (none) | A shared shape several object types satisfy — mention only, not modelled |
| Semantic layer / kinetic layer | (none) | Nouns (objects, links) / verbs (Actions) — *research §B.3* |

Renames in code are limited to labels and the `TOOL_LABELS` / `SCHEMA_TOOLS` maps in `demo/app.js`; internal field names (`entityTypes`, `relationshipTypes`, `edges`) stay to avoid a disruptive seed change. The study guides explain the two-vocabulary situation once.

### 2.3 Offline and static constraints

- No backend, no accounts, no telemetry. Everything runs from GitHub Pages or `python3 -m http.server`.
- Everything except map tiles works offline. New vendor code (none is required for Phases 0–2) must be bundled in `vendor/` under a compatible licence.
- No build step for the JavaScript. The 3,700-line `app.js` is split into several classic `<script>` files loaded in order (§6.4), which keeps `file://` opening working. ES modules are an alternative if Tobias is happy to require a local server (§9).
- No real LLM by default. A bring-your-own-key mode is an open question (§9), off by default and never required for teaching.
- Shared state between the apps lives in `localStorage` under one namespace (§6.1).

### 2.4 Accessibility

- Colour never carries meaning alone: markings use colour plus a text chip; the ER slider shows the numeric threshold; severity shows a word.
- All controls are real `<button>`/`<select>`/`<input>` elements with labels (the current apps already do this); add `aria-live="polite"` to the audit strip and the agent trace so screen readers hear new entries.
- Keyboard: the walkthrough card and every tab must be reachable with Tab/Enter; the graph SVG nodes get `tabindex="0"` and `role="button"`.
- Contrast: Deep Culture green `#ADFC92` on black and purple on white pass; green text on white does not and must not be used (use `--dc-green-dark`). The body type remains Lexend at ≥ 14 px.

### 2.5 Deep Culture design system

`brand/deep-culture.css` is the single source of colour and type. The three backgrounds carry meaning across the redesign:

- **Purple (`--dc-purple`)** — headers, claims and argument: the page band, the honesty labels, discussion prompts, the Checkpoint dialog header.
- **White (`--dc-paper`)** — evidence: the Investigate workspace, tables, graphs, map.
- **Black (`--dc-black`)** — code and breaks: the Build workspace, transform source, the agent's tool-call trace, the audit log.

Titles use the highlight box: purple-on-white titles in the white app (`.dc-highlight`), green-on-dark in the black app and the purple band (`.dc-on-dark .dc-highlight`). Markings get their own small palette, defined once as CSS variables (`--mk-pii`, `--mk-health`, `--mk-le-sensitive`, `--mk-open`) with a hatched border for "inherited" so that inheritance is visible even in greyscale print.

---

## 3. Information architecture

### 3.1 The two options

**Option A — keep two demos plus the landing page.** Gotham-style `demo/` and Foundry-style `foundry-demo/` stay separate pages with separate seeds, as now, each gaining governance features.

**Option B — one "platform" with modes.** A single app with Investigate / Build / Govern / Agent modes over one state, one role switcher and one audit log.

| Criterion | A: two demos | B: one platform |
|---|---|---|
| Teaching fidelity | Good: analysts and engineers really are different people in different buildings (the Foundry study guide already teaches this). Research §B.8 notes the split is a simplification but the shared Ontology can still be shown by identical object IDs | Better in one respect: Gotham and Foundry genuinely share Ontology, AIP and Apollo |
| Governance features | Role, markings and audit must be *shared* or the lesson breaks (a marking removed in Build must be visible in Investigate) | Shared for free |
| Code | `demo/app.js` 3,700 lines and `foundry-demo/app.js` 750 lines; already two renderers, two state models | A merge would create a 5,000-line app unless modularised first; both seeds (2.9 MB + 7.6 MB) load on one page |
| Design | Maps onto the Deep Culture white/black backgrounds with a reason | One background, or mode-switching backgrounds that confuse |
| Course structure | One app per session | Modes per session; weaker sense of "going underneath" |
| Effort | Shared core only | Shared core plus a full rewrite of both UIs |

### 3.2 Recommendation: two surfaces, one platform (A, with a shared core)

Keep the two apps and the landing page, but make them behave as one platform:

1. A shared **core** (`core/*.js`) provides session, roles, markings, Checkpoints, the audit log and Actions to both apps (§6).
2. A shared **session strip** sits under the purple band in both apps: current role, dataset, purpose tag, number of audit events this session, and a link to Oversight. Changing the role in one app changes it in the other on reload.
3. A third, deliberately small page **`audit/` (Oversight)** reads the shared log. It sits *outside* both working surfaces because that is the teaching point: oversight is not a tab for the analyst.
4. The apps are renamed in the UI to say what they are: **Investigate (Gotham-style)** and **Build (Foundry-style)**. The directories stay `demo/` and `foundry-demo/` so existing links keep working.

Justification for teaching: students experience the engineer/analyst gap as a change of room, which the guides already exploit; identical object IDs and the shared audit log show that it is one ontology underneath; the auditor page makes the "who watches" question physical. Option B is the better model of the product and the worse model of the organisation that uses it. If Tobias prefers B, the shared core in §6 is the first step either way, so no work is wasted.

### 3.3 Site map

```
/                      Landing: course overview, three session cards, glossary, docs (existing index.html)
/demo/                 Investigate (Gotham-style), white workspace
  Analyst tools:       Investigations · Analytics · Agent (simulated AIP) · Map · Leads (P2)
  Ontology tools:      Object types · Properties · Link types · Backing datasets · Objects · Graph
  Everywhere:          session strip (role, dataset, purpose, audit count) · Checkpoint dialog · Action drawer
/foundry-demo/         Build (Foundry-style), black workspace
  Tabs:                Pipelines · Datasets · Lineage · Resolution (P1/2) · Markings (P1) · Purpose rules (P2)
/audit/                Oversight: audit log, Checkpoint records, Action history, filters, redaction toggle, export
/glossary.html         Terminology table (§2.2) and honesty labels (§2.1); linked from every honesty chip
```

### 3.4 Student journey

| | Session 1 — Investigate (90 min) | Session 2 — Build and govern (90 min) | Session 3 — Agent, leads, oversight (90 min) |
|---|---|---|---|
| App | `/demo/` | `/foundry-demo/` then `/demo/` | `/demo/` Agent + Leads, then `/audit/` |
| Opening | Log in as *Patrol officer*; notice what is missing; switch to *Financial analyst* | Open the pipeline; find where the ontology was made | Ask the agent the Session 1 question; read the trace |
| Core task | Trace the risk-tagged operator; hit a Checkpoint on the device-ping expansion; execute two Actions | Trace a marking; move the ER threshold until Omar Rahman (namesake) merges with Omar Rahman (watchlisted); unmerge | Approve or reject staged edits; catch the invented link; review the leads formula |
| Close | Open Oversight and read your own trail | Try to remove the HEALTH marking as analyst, then as DPO | Debate with the four case studies (§5.4) |
| Case study hook | BVerfG 2023 (Checkpoints vs written justification) | ICE/Medicaid (markings) · Raffinaderij (lineage you cannot see) | ELITE (leads) · NHS FDP (controller question) · Maven (human in the loop) |

Two-session cut: fold the agent into Session 1's last 20 minutes (it reuses the same questions) and the auditor view into Session 2's close; drop Leads.

---

## 4. Feature specifications

Priority: **P0** = Phase 0 fixes, **P1** = Phase 1 governance core, **P2** = Phase 2 Actions and resolution, **P3** = Phase 3 agent and scenarios. Effort: S ≤ 1 day, M 2–4 days, L ≥ 1 week, for one developer who knows the codebase.

### 4.0 Phase 0 fixes (P0)

Each item was verified against the code on 4 November 2026 by building both seeds to `/tmp` and diffing them.

**F0.1 Company edges attach to different people in the two demos (M).**
`pipeline/05_build_ontology.py` resolves directors and owners with `builder.find_person(name=...)` only, and `OntologyBuilder.__init__` fills `person_by_alias` last-writer-wins over canonical names *and* aliases. `scripts/build_ontology_seed.py` uses `ensure_person(name, dob)` with a `person_by_name_dob` index. Entity ID sets are identical in both seeds, but the edges differ: starter — 5 `DIRECTS`/`BENEFICIALLY_OWNS` edges (and 4–5 `OWNS_ACCOUNT`) point at a different person; simulator — 83 `DIRECTS`/`BENEFICIALLY_OWNS`, 18 `OWNS_ACCOUNT`, 1 `USES_DEVICE`. Example: Gotham has `DIRECTS person::maya-singh-1992-09-21 → company::co-104`; Foundry has `DIRECTS person::i6117009 → company::co-104`.
*Fix:* extract one resolver into `pipeline/resolution.py` (a `PersonResolver` with `passport → phone → name+dob → alias` and `find(name, dob, passport, phone)`), import it from both `02_resolve_persons.py` and `scripts/build_ontology_seed.py`, and pass `director_dob`/`beneficial_owner_dob` in step 05. Acceptance: a test asserts the two seeds' `(type, source, target)` edge sets are identical for both datasets.

**F0.2 Order-dependent splits — keep, but make visible (S now, becomes F6 later).**
Greedy resolution splits people when a weak record arrives first. Starter: Clara Silva / "C. Silva" (`person::c-silva-30131994523`, created from a ping with a phone), Elias Orlov / "E. Orlov", Lena Demir / "L. Demir" (`person::x2622631`), Maya Singh / "M. Singh" (`person::i6117009`, the one holding the passport), Clara Adler / "C. Adler". A second exhibit: `merge_value()` prefers the longer string, so the watchlist's canonical name loses to an alias — Sofia Petrov is labelled "Sofia Petrova", Elena Markovic "Jelena Markovic", Omar Rahman "Omar Al-Rahman".
*Fix now:* do not "repair" these; add a `resolution` block to each Person (§4.6 shape) recording `method` and `splitRisk: true` when a person was created from a single weak key, and surface it in the Gotham inspector as an amber "resolution note". The full treatment is F6.

**F0.3 Foundry persons named after their ID (S).**
`_PersonAccum.absorb_ping()` adds `observed_name` to `aliases` only; `to_row()` falls back to `entity_id`. Result: 4/23 starter persons (`person::c-silva-…`, `e-orlov-…`, `n-costa-…`, `tomas-orlov-…`) and 1/186 simulator persons have `canonicalName == id`. *Fix:* when `canonical_name` is empty, use the most frequent observed name; record `fieldProvenance.canonicalName` with note `"from ping observed_name (weak)"`. Acceptance: no Person has `canonicalName` starting `person::`.

**F0.4 Stale localStorage hides regenerated seeds (S).**
`loadState()` in `demo/app.js` returns whatever is under `ontology-studio-demo-v2:{dataset}` with no version check. *Fix:* §6.2 (seed contract versioning). Acceptance: rebuilding the seed with changed data is visible on next load without pressing Reset, with a banner offering to restore the previous edits.

**F0.5 Hygiene (S).**
`git rm --cached` the nine tracked `.pyc` files under `pipeline/__pycache__/` and `scripts/__pycache__/` and `.claude/settings.local.json` (add `.claude/settings.local.json` to `.gitignore`; `__pycache__/` is already listed but the files were committed before). Also: `01_normalize_sources.py` hard-codes `source_file="synthetic_data/starter/…"` for the simulator too (pass the directory); the Foundry → Gotham cross-link (`foundry-demo/app.js` line ~543) opens `../demo/index.html` without the entity — add `#object=person::p8842101` and make `demo/app.js` honour it on load.

### 4.1 F1 — Role and markings switcher (P1, M)

**User stories.** *Student:* "I log in as a patrol officer and see the same case with the bank data missing; as the financial analyst I see it with the phone numbers blurred; I understand that the platform never has one view." *Instructor:* "I switch roles live to show that the question 'what does the system know?' has no single answer."

**Mirrors.** Mandatory markings combined with roles and projects (*research §C.1*; https://palantir.com/docs/foundry/security/markings/). Label: **Mirrors Foundry** for marking semantics; **Simplified** for roles (a real deployment has groups, projects and organisations — we model four roles).

**UI.** A role selector in the session strip of both apps, with a short description under it. Objects and properties the role may not see are rendered as a grey hatched cell reading *withheld — marking HEALTH*, not removed silently: the point is that the student sees the shape of what is hidden. The inspector gains a "Why can't I see this?" line naming the marking and the role that could.

**Roles (seeded in `governance.roles`).**

| Role id | Label | Sees markings | Purposes | May approve Actions |
|---|---|---|---|---|
| `patrol` | Patrol officer | `OPEN` | `public-order` | no |
| `fin-analyst` | Financial-crime analyst | `OPEN`, `PII`, `FIN` | `financial-crime` | yes (own unit) |
| `dpo` | Data protection officer | all, read-only | `oversight` | may remove markings with justification |
| `contractor` | Platform contractor | `OPEN`, schema only | `maintenance` | no |

**Data model.** Every entity, edge and (in Build) dataset carries `markings: string[]`. Backing datasets declare their markings in the generator manifest and the builders propagate them (F2). Seed addition:

```json
"governance": {
  "markings": [
    {"id": "OPEN", "label": "Open", "colour": "--mk-open", "description": "No restriction."},
    {"id": "PII", "label": "Personal data", "colour": "--mk-pii", "description": "Identifies a living person."},
    {"id": "FIN", "label": "Financial", "colour": "--mk-fin", "description": "Bank and payment data."},
    {"id": "HEALTH", "label": "Health", "colour": "--mk-health", "description": "Collected for care; purpose-limited."},
    {"id": "LE-SENSITIVE", "label": "Law-enforcement sensitive", "colour": "--mk-le", "description": "Watchlist and intelligence."}
  ],
  "roles": [
    {"id": "patrol", "label": "Patrol officer", "markingsVisible": ["OPEN"], "purposes": ["public-order"],
     "canApprove": false, "canRemoveMarkings": false}
  ]
}
```

Entity: `{"id": "person::p8842101", "type": "Person", "markings": ["PII", "LE-SENSITIVE"], "propertyMarkings": {"phoneNumber": ["PII"], "riskTag": ["LE-SENSITIVE"]}, …}`.

**Behaviour rules.** `core/markings.js` exposes `canSee(role, markings) → boolean` (true iff every marking is in `role.markingsVisible`) and `redact(entity, role)` which returns a copy with withheld properties replaced by `{withheld: ["HEALTH"]}`. Derived state (`buildDerivedState()`), analytics, scenarios, the agent and the map all read through `redact`; a withheld property contributes nothing to a score. Role changes are logged (F4). The role is a client-side convenience, not security — the honesty label says so.

**Discussion prompt.** Privacy safeguard, or the argument that makes merging everything acceptable? (*research §C.1*.)

**Acceptance.** Switching to `patrol` removes all `FIN` evidence from the "Trace the risk-tagged operator" scenario and the score changes visibly; the inspector names the marking; the change appears in the audit log; the choice survives reload and is honoured by the other app.

### 4.2 F2 — Markings carried through lineage (P1, M)

**User stories.** *Student:* "I mark the clinic dataset HEALTH and watch every dataset downstream turn red, including `ontology_entities`; when I try to remove it as an analyst I am refused, as DPO I must write why." *Instructor:* "This is the ICE/Medicaid case in one click."

**Mirrors.** Markings inherited down lineage; removal requires privilege (*research §B.5, §C.2*). Label: **Mirrors Foundry**.

**UI (Build app).** New **Markings** tab: the pipeline DAG coloured by marking, a legend, and per dataset a list `markings: [{id, inheritedFrom: datasetId | null}]`. A "Remove marking" button opens a Checkpoint (F3) whose prompt differs for `dpo` (allowed, justification required) and other roles (refused, logged). Marking changes made in Build are persisted in the shared state so the Investigate app renders the new redactions.

**Data model.** Builder-side: `generate_synthetic_sources.py` writes `manifest.json` per dataset with `markings` and `purpose` (F9); `01_normalize_sources.py` copies them to `Dataset.markings`; `lib.Transform.run()` sets `output.markings = union(inputs.markings)` and records `markingProvenance: {HEALTH: ["raw_clinic_registrations"]}`. Seed dataset shape gains:

```json
{"id": "resolved_persons", "markings": ["PII", "HEALTH", "LE-SENSITIVE"],
 "markingProvenance": {"HEALTH": ["raw_clinic_registrations"], "LE-SENSITIVE": ["raw_watchlist"]}}
```

Client-side overrides: `dc-palantir:governance` holds `{"markingOverrides": [{"datasetId": "resolved_persons", "removed": "HEALTH", "by": "dpo", "checkpointId": "cp-…", "ts": "…"}]}`.

**Behaviour rules.** Union on every transform; an override removes a marking from a dataset *and* from everything downstream that inherited it only from there (recompute via `markingProvenance`); removal re-applies on rebuild (overrides are keyed by `buildId`, §6.2).

**Discussion prompt.** Medicaid data reaching an enforcement contractor via a chat message (*research §D.1*): what would a marking have done, and what would it not have done?

**Acceptance.** Marking the clinic dataset colours 4 downstream datasets (`norm_clinic_registrations`, `resolved_persons`, `ontology_entities`, `ontology_edges`; the DAG is shorter than first assumed); the analyst's removal attempt produces a refusal event; the DPO's removal needs ≥ 20 characters of justification and shows in Oversight.

### 4.3 F3 — Checkpoints (purpose justification) (P1, M)

**User stories.** *Student:* "Before the system lets me expand from a person to everyone observed at the same tower, it asks me why; I type 'routine' and it lets me through." *Instructor:* "Compare this with what the Constitutional Court asked for."

**Mirrors.** Foundry Checkpoints: a prompt before sensitive operations; the record stores user, time, the prompt text exactly as shown, the justification and the items involved (*research §C.3*; https://palantir.com/docs/foundry/checkpoints/core-concepts/; Jagasia & Wee 2021). Label: **Mirrors Foundry**.

**UI.** A modal with a purple header, the prompt text, a justification textarea, a dropdown of purposes the role holds (F9), and *Continue* / *Cancel*. No validation beyond "not empty" by default — that is the lesson. An instructor toggle in the session strip (**Strict checkpoints**) requires a purpose and ≥ 40 characters, for the comparison.

**Triggers (seeded in `governance.checkpoints`).**

```json
{"id": "cp-expand-pings", "trigger": "graph.expand", "when": {"linkType": "OBSERVED_AT", "depth": ">=2"},
 "prompt": "You are about to expand from a device to every person observed at the same locations. State the investigative purpose.",
 "requiresPurpose": false, "applicableRoles": ["fin-analyst", "patrol"]}
```

Other seeded triggers: `export.json`, `search.byPhone`, `action.execute` for Actions marked `sensitive`, `marking.remove`, `agent.run` when the agent's plan includes a sensitive tool.

**Record shape.**

```json
{"id": "cpr-20261104-0007", "ts": "2026-11-04T10:12:31Z", "sessionId": "s-…", "role": "fin-analyst",
 "checkpointId": "cp-expand-pings", "promptText": "You are about to expand…", "justification": "routine",
 "purpose": null, "objectIds": ["device::dev-kh-01"], "outcome": "continued"}
```

**Behaviour rules.** `core/checkpoints.js` exposes `withCheckpoint(triggerId, context, fn)`; the record is written before `fn` runs; cancel writes `outcome: "cancelled"`. Records are audit events of kind `checkpoint` (F4).

**Discussion prompt.** Students will type "routine" and nothing stops them (*research §C.3*). The BVerfG asked for case-by-case thresholds and justification (*research §D.3*; the exact criteria are **[to verify]** against the press release before putting them on a slide). Is a prompt a safeguard, a deterrent, or a liability shield?

**Acceptance.** The ping expansion cannot happen without a record; the record's `promptText` matches what was displayed; Strict mode rejects "routine".

### 4.4 F4 — Audit log and auditor view (P1, M)

**User stories.** *Student:* "Everything I did is here, including the role switches and the agent's tool calls; I can filter by object and see who looked at Omar Rahman." *Instructor:* "Now ask: this log is also a record about Omar Rahman. Who may read it?"

**Mirrors.** Every search, view, export, action and AI call logged (*research §C.4*). Label: **Simplified** — real audit systems are tamper-evident and separate; ours is `localStorage` with a hash chain for the idea.

**UI.** In both apps a thin **audit strip** at the bottom (last three events, count, link). The **Oversight** page (`audit/index.html`, black background) shows a filterable table (time, role, surface, kind, verb, objects, justification), a per-object timeline ("everyone who touched `person::n5538219`"), Checkpoint records, Action history with before/after, a **redaction toggle** that blacks out 99% of the table (the Raffinaderij exhibit, *research §D.4*), and CSV/JSON export. Oversight has its own role gate: it opens only as `dpo` or `auditor`; other roles see the refusal and the refusal is logged.

**Event shape (one for the whole platform).**

```json
{"id": "ev-000123", "ts": "2026-11-04T10:12:31Z", "sessionId": "s-7f2a", "prevHash": "9c1e…", "hash": "4b77…",
 "role": "fin-analyst", "surface": "investigate", "kind": "view|search|expand|export|action|checkpoint|agent|role|marking|resolution",
 "verb": "graph.expand", "objectIds": ["device::dev-kh-01"], "datasetId": null,
 "payload": {"depth": 2, "resultCount": 14}, "checkpointId": "cpr-20261104-0007"}
```

**Behaviour rules.** `core/audit.js` exposes `logEvent(partial)`; it fills `id`, `ts`, `sessionId`, `role`, `prevHash`, `hash` (SHA-256 via `crypto.subtle`, falling back to a simple FNV hash when unavailable). Storage: `dc-palantir:audit` as a JSON array, capped at 5,000 events (oldest dropped with a `truncated` marker). Reset dataset does not clear the log; a separate **Clear audit (instructor)** does, and that clearing is itself logged as the first event of the new log.

**Discussion prompt.** Who audits the auditors; the log as a second dataset about the people searched (*research §C.4*).

**Acceptance.** A scripted sequence of 12 actions across both apps yields 12 events plus role switches in order; the hash chain verifies; filtering by object returns the right subset; the `patrol` role cannot open Oversight.

### 4.5 F5 — Action types with writeback and feedback (P2, L)

**User stories.** *Student:* "I run *Add to watchlist* on Omar Rahman; the system asks for a reason, changes his `riskTag`, sends a message to the simulated border system, and when I return to Analytics he has climbed the ranking because he is now 'risk-tagged'." *Instructor:* "The analysis produced the fact it then found."

**Mirrors.** The kinetic layer: Action types with parameters, validation, permissions, side effects and logs; writeback to operational systems (*research §B.3, §C.5*; https://www.palantir.com/docs/foundry/ontology/core-concepts). Label: **Mirrors Foundry** for the Action model; **Simplified** for the receiving system (a panel, not an API).

**UI.** The investigation scenario's "Recommended actions" card becomes an **Action drawer** listing Action types applicable to the focused object type. Each opens a form (parameters, validation messages), shows the role check, the Checkpoint if any, then a before/after diff and the writeback message as it would be sent. A new **External systems** panel (black, monospace) in the inspector shows the simulated recipients' inboxes: *Border watch system*, *Bank compliance desk*, *Case management*.

**Action type shape (seeded in `ontology.actionTypes`).**

```json
{"id": "act-add-to-watchlist", "label": "Add to watchlist", "objectType": "Person", "sensitive": true,
 "parameters": [
   {"id": "reason", "label": "Reason", "type": "string", "required": true, "minLength": 10},
   {"id": "riskTag", "label": "Risk tag", "type": "enum", "options": ["facilitator", "procurement-network", "sanctions-evasion", "dual-use-broker"]}
 ],
 "allowedRoles": ["fin-analyst"], "checkpointId": "cp-action-sensitive",
 "effects": [
   {"op": "setProperty", "property": "riskTag", "from": "param:riskTag"},
   {"op": "createObject", "type": "WatchlistRecord", "properties": {"riskTag": "param:riskTag", "addedBy": "session:role", "addedAt": "now"}},
   {"op": "createLink", "linkType": "LISTED_ON", "target": "created:WatchlistRecord"},
   {"op": "writeback", "system": "border-watch", "template": "WATCH {label} passport {passportId}: {reason}"}
 ],
 "feedsAnalytics": true}
```

Seeded set: *Add to watchlist*, *Remove from watchlist*, *Flag account for review* (BankAccount), *Request border watch* (Person), *Close lead* (Lead, P3), *Unmerge person* (F6), *Remove marking* (F2, DPO only). Action instance: `{"id": "ai-…", "actionTypeId": "act-add-to-watchlist", "ts", "role", "params", "before": {...}, "after": {...}, "writebacks": [{"system": "border-watch", "message": "…", "deliveredTs": "…"}], "stagedBy": "agent|user", "approvedBy": null}`.

**Behaviour rules.** `core/actions.js` exposes `applyAction(actionTypeId, objectId, params, {staged})` which validates parameters, checks role, runs the Checkpoint, applies effects to the shared `data` object, persists, logs an event of kind `action` and re-renders. `staged: true` (used by the agent, F7) writes the instance to `pendingActions` and applies nothing until `approveAction(id)`. Analytics must read `riskTag` from `data` so the feedback loop is real; the "Watchlist operators" rule shows a footnote *n objects risk-tagged by Actions in this session*.

**Discussion prompt.** Feedback loops; how analysis produces the reality it describes (*research §C.5*; Brayne 2017 on secondary surveillance networks, *research §B.7*).

**Acceptance.** Executing *Add to watchlist* on an untagged person moves them into the Watchlist operators rule on the next render; the writeback appears in the Border watch inbox; *Remove from watchlist* reverses both; all four steps are in the audit log with before/after.

### 4.6 F6 — Entity resolution with confidence scores, threshold slider, false merges and unmerge (P2, L)

**User stories.** *Student:* "At threshold 0.75 there are two Omar Rahmans; at 0.55 the system merges them and the Birmingham one inherits `dual-use-broker`; I can see which signal did it and undo it." *Instructor:* "Error is never neutral; look who pays for a low threshold."

**Mirrors.** Real resolution uses confidence scores and thresholds; false merges are a known risk (*research §B.4*; Aleph's warnings, https://docs.aleph.occrp.org/developers/mappings). Label: **Simplified** (our scorer is a transparent weighted sum).

**UI (Build app, new Resolution tab).** A slider (0.30–0.95, default 0.75) and a table of *candidate pairs* with score, signals and decision at the current threshold; a diff of the Person count; a list "People who changed identity at this threshold". A **Merge explanation** panel for any Person shows the chain of merges with the signal that caused each. In Investigate, merged persons show a chip *merged at 0.55 — 2 source identities* and an **Unmerge** Action (F5).

**Data model.** `02_resolve_persons.py` becomes two passes: blocking (same normalised surname, or shared passport/phone) produces candidate pairs; scoring produces `score ∈ [0,1]` from signals; a *threshold-independent* output is written — all candidates with scores — and the merge decision is taken **client-side** so the slider needs no rebuild.

```json
"resolution": {
  "defaultThreshold": 0.75,
  "signals": [
    {"id": "passport-exact", "weight": 1.0}, {"id": "phone-exact", "weight": 0.8},
    {"id": "name-exact+dob-exact", "weight": 0.9}, {"id": "name-exact", "weight": 0.45},
    {"id": "name-translit", "weight": 0.35, "note": "Omar/Umar, Petrov/Petrova"},
    {"id": "dob-conflict", "weight": -0.5}, {"id": "shared-route", "weight": 0.1}, {"id": "shared-address", "weight": 0.2}
  ],
  "candidates": [
    {"id": "cand-0012", "left": "person::n5538219", "right": "person::omar-rahman-1979-02-02",
     "score": 0.55, "signals": ["name-exact", "shared-route"], "block": "rahman"}
  ],
  "clusters": {"person::n5538219": {"members": ["person::n5538219"], "method": "passport", "confidence": 1.0}}
}
```

Person gains `resolution: {"method": "passport|phone|name+dob|alias|ping-only", "confidence": 0.0–1.0, "mergedFrom": ["…"], "splitRisk": false}`. The F0.2 exhibits are expressed in this block rather than hidden.

**Behaviour rules.** `core/resolution.js` exposes `resolveAt(threshold) → {clusters, persons, edgesRemapped}` using union-find over candidates with `score ≥ threshold`; merged persons take the union of properties with the watchlisted member's `riskTag` winning (that is the point); edges are remapped to the cluster representative; the lineage view shows both source identities. `Unmerge` (an Action, F5) writes `resolutionOverrides: [{"candidateId": "cand-0012", "decision": "reject", "by": "fin-analyst", "reason": "DOB conflict"}]` to shared state and is honoured at every threshold. Threshold changes and unmerges are logged.

**Discussion prompt.** Transliteration, discrimination, the court's concern with margins of error (*research §C.6*); who decides the threshold and who bears the false merges.

**Acceptance.** Default threshold produces exactly the current Person count for the starter data (23 after F0 fixes) plus the namesake; at 0.55 the two Omar Rahmans merge and the merged person appears in the Watchlist operators rule; Unmerge restores both and survives reload; the candidate table explains every merge.

### 4.7 F7 — Simulated AIP agent (P3, L)

**User stories.** *Student:* "I ask the agent to summarise Omar Rahman; it shows each tool it called, cites the objects behind every sentence, proposes *Add to watchlist* as a staged edit, and in one scripted run it asserts a link that does not exist — I have to notice." *Instructor:* "This is what 'human in the loop' costs."

**Mirrors.** AIP: LLM connected to the Ontology through tools; edits staged for review by default; Evals as governance (*research §A AIP row, §C.7*; https://palantir.com/docs/foundry/aip/aip-features/; https://www.palantir.com/docs/foundry/agent-studio/overview). Label: **Simplified — rule-based stand-in for an AIP chatbot** (*research §B.6*). No LLM is called by default.

**UI.** The *AI Copilot* tab is renamed **Agent (simulated AIP)**. Layout: question box with examples; **Plan and trace** panel (black, monospace) listing steps `tool(args) → result (n objects)`; **Answer** with inline citation chips `[person::n5538219]` that highlight in the graph; **Staged edits** card with per-edit *Approve* / *Reject* and an **Approve all** button; **Evals** panel showing pass/fail against three seeded checks (every claim cites an existing object; no denied tool result was used; no edit applied without approval).

**Tools (the existing copilot functions, wrapped).**

| Tool | Backed by | Marking-aware |
|---|---|---|
| `search_objects(query)` | `collectEntityMatches()` | yes, via `redact` |
| `get_links(objectId, linkType?)` | `edgesForEntity()` | yes |
| `expand(objectIds, depth)` | `buildSubgraph()` — triggers `cp-expand-pings` | yes |
| `run_rule(ruleId)` | `buildAnalytics()` | yes |
| `propose_action(actionTypeId, objectId, params)` | `applyAction(…, {staged: true})` | role of the *user* |
| `get_lineage(objectId)` | Foundry seed lineage (if loaded) | yes |

**Trace shape.**

```json
{"id": "run-…", "query": "Summarise Omar Rahman", "role": "fin-analyst", "mode": "scripted|rules",
 "steps": [
   {"n": 1, "tool": "search_objects", "args": {"query": "Omar Rahman"}, "resultIds": ["person::n5538219", "person::omar-rahman-1979-02-02"], "ms": 3},
   {"n": 2, "tool": "get_links", "args": {"objectId": "person::n5538219"}, "resultIds": ["…"], "denied": false},
   {"n": 3, "tool": "expand", "args": {"depth": 2}, "denied": true, "reason": "marking FIN not visible to role patrol"}
 ],
 "answer": [{"text": "Omar Rahman directs North Quay Logistics FZE.", "cites": ["directs::…"]}],
 "stagedActions": ["ai-…"], "failureMode": null | "fabricated-link" | "overreach" | "approve-all",
 "evals": [{"id": "all-claims-cited", "pass": true}]}
```

**Behaviour rules.** `demo/js/agent.js` builds the plan deterministically from the query (reuse `collectEntityMatches`, `collectRuleMatches`, `collectScenarioMatches`), executes tools through the core so markings, Checkpoints and audit apply, and renders the answer from tool results only. Three **scripted failure modes**, selectable by the instructor in the session strip and otherwise fired on fixed example prompts: (a) *fabricated link* — the answer includes one sentence citing a non-existent edge id; the Evals panel flags it only after the student clicks *Check*; (b) *overreach* — the plan includes a tool denied for the role; the step shows *denied and logged* and the answer must not use it; (c) *approve all* — a button that applies every staged edit at once, logged as a single approval with `approvedBy: "fin-analyst (bulk)"`. Every run logs one `agent` event per tool call.

**Optional BYO-key mode (P3, decision in §9).** If enabled, the plan is produced by a hosted LLM through the same tool interface, with the key kept in `sessionStorage` and a red banner; the scripted failure modes remain available because real ones are not reliable in class.

**Discussion prompt.** The human in the loop; Maven's 20,000+ users (*research §A*); evals as governance (*research §C.7*).

**Acceptance.** Every sentence in a non-failure answer has ≥ 1 citation that resolves to an object or link; the denied tool result does not appear in the answer; *Approve all* produces one audit event with `count: n`; the Evals panel catches the fabricated link.

### 4.8 F8 — Leads map with address confidence (P3, M)

**User stories.** *Student:* "The leads list ranks people by an address score I can read: clinic registration 0.5 × age decay, company registry 0.3, last ping 0.4; the clinic record is the one that makes the score high." *Instructor:* "That is health data doing enforcement work."

**Mirrors.** ELITE's 0–100 address confidence score (*research §A ImmigrationOS row, §C.8*). Label: **Simplified** — the formula is ours; the real one is not public.

**UI.** New **Leads** tab in Investigate: a table (person, best address, score 0–100, sources, age) and a map layer of lead pins sized by score. Clicking a lead shows the formula with the numbers filled in and the marking of each contributing source. If the role cannot see `HEALTH`, the clinic component shows as withheld and the score is recomputed without it — the number changes in front of the student.

**Data model.** Builder-side `pipeline/06_build_leads.py` (Build app shows it as a transform) produces dataset `leads`:

```json
{"id": "lead::person::omar-rahman-1979-02-02", "personId": "person::omar-rahman-1979-02-02",
 "address": "41 Oak Lane, Birmingham", "score": 78,
 "components": [
   {"source": "raw_clinic_registrations", "marking": "HEALTH", "weight": 0.5, "ageDays": 40, "decay": 0.89, "contribution": 44.5},
   {"source": "norm_mobile_pings", "marking": "PII", "weight": 0.4, "ageDays": 3, "decay": 0.99, "contribution": 39.6}
 ],
 "formula": "score = 100 · min(1, Σ weight_i · exp(−ageDays_i / 365))", "asOf": "2026-04-12"}
```

**Behaviour rules.** Score is recomputed client-side from `components` after `redact`, so markings and purpose rules (F9) change it. *Close lead* is an Action (F5).

**Discussion prompt.** Data repurposed from health to enforcement (*research §C.8, §D.1*).

**Acceptance.** As `dpo` the lead shows all components; as `fin-analyst` the HEALTH component is withheld and the score drops; the formula text equals the code path (a unit test evaluates the formula string against the function).

### 4.9 F9 — Purpose and legal-basis tags, "Karlsruhe mode" (P2, M)

**User stories.** *Student:* "With Karlsruhe mode on, joining the clinic dataset to the watchlist is refused with the rule shown; with it off the join runs and only the log remembers." *Instructor:* "Law as code against law as judgement."

**Mirrors.** None directly — this is a **Teaching extension** built on markings. Discussion anchor: BVerfG 16 February 2023 (*research §D.3*; https://bundesverfassungsgericht.de/SharedDocs/Pressemitteilungen/EN/2023/bvg23-018.html). The specific rules below are our abstraction of the ruling's logic, not its text; **[to verify]** each against the press release and Bäuerle (2026) before teaching them as the court's criteria.

**UI.** A toggle in the session strip (**Karlsruhe mode**). Each dataset and each role carries `purpose` and `legalBasis` chips. When a join, expansion, Action or agent tool would combine datasets whose purposes are incompatible under the active rules, the UI shows a red *blocked by rule R2* card with the rule text and a *Request exception* button (a Checkpoint whose record is tagged `exception`).

**Data model.**

```json
"purposes": {
  "tags": [{"id": "healthcare", "legalBasis": "care-provision"}, {"id": "financial-crime", "legalBasis": "aml-statute"},
           {"id": "public-order", "legalBasis": "police-act"}, {"id": "oversight", "legalBasis": "supervisory"}],
  "rules": [
    {"id": "R1", "text": "Automated cross-dataset analysis needs a stated purpose on the session.", "when": {"operation": "expand|rule|agent", "sessionPurpose": null}, "effect": "block"},
    {"id": "R2", "text": "Data collected for healthcare may not be joined to law-enforcement datasets.", "when": {"joins": ["healthcare", "public-order|financial-crime"]}, "effect": "block"},
    {"id": "R3", "text": "Expansion beyond depth 1 requires a concrete, logged danger statement.", "when": {"operation": "expand", "depth": ">1"}, "effect": "checkpoint:cp-danger-statement"}
  ]
}
```

Datasets: `"purpose": "healthcare"`. Session: `dc-palantir:session.purpose`.

**Behaviour rules.** `core/purposes.js` exposes `check(operation, context) → {allowed, rule}`; it is called from `buildSubgraph`, `buildAnalytics` (per rule, so the rule panel shows "blocked" instead of a ranking), `applyAction` and the agent's tool runner. Off by default; the toggle is logged.

**Discussion prompt.** Law written as code vs law applied with judgement (*research §C.9*); what the rules get wrong by being rules.

**Acceptance.** With the mode on and session purpose `financial-crime`, the Leads score excludes the clinic component and the Agent's `expand` is refused by R3 until a Checkpoint is passed; with the mode off nothing is blocked but every join is logged with the purposes involved.

### 4.10 F10 — Rename the copilot and add honesty labels and glossary (P1, S)

Rename *AI Copilot* to **Agent (simulated AIP)** now, before F7 lands, and change the grounding card's text: the current claim that *real-world intelligence platforms cannot hallucinate* (in `STUDENT_STUDY_GUIDE.md` Step 4) is wrong and must go; replace with: the stand-in is rule-based and cannot invent entities, whereas a real AIP chatbot uses an LLM with tools and stages edits for review (*research §B.6*). Add the honesty chip to every panel header (`renderPanelHeader(title, honestyId)`), rename *Source Mappings* to **Backing datasets** (*research §B.2*), and ship `glossary.html` (§2.2). Acceptance: no UI string says "copilot"; every tab has a chip; the glossary lists all terms in §2.2.

### 4.11 Later-phase items (P3, lighter)

- **F11 Object sets / saved lists (M).** Save any selection as an object set `{id, name, memberIds, createdBy, versions: [{ts, added, removed, by}]}`; the Investigate app shows diffs between versions; sharing is simulated by role. Prompt: lists as instruments of power (*research §C.11*).
- **F12 Retention clock (M).** Each dataset carries `retentionDays`; a date slider in Build greys out rows past retention and highlights derived rows that still carry them (via lineage). Prompt: deletion that never reaches copies (*research §C.12*).
- **F13 Deployment and sovereignty view (S).** A static diagram page: where seeds, tiles and the audit log live (browser, GitHub Pages, OSM), who can read them; the honest answer that this classroom tool is more sovereign than any real deployment. Discussion: Apollo and European exits (*research §A Apollo row, §D.4–5*).
- **F14 Workshop-style screen builder (L, optional).** Drag properties onto a "border officer" card; hide `source` and `asOf` and ask students to decide; show how many decisions change (*research §C.10*).
- **Vertex-style what-if (optional).** Threshold vs number flagged, as a chart on the Resolution tab (*research §C.14*).

---

## 5. Scenarios and case studies

### 5.1 The storyline after the rework

The Kareem Haddad network (Cyprus–Dubai–Geneva, sanctions evasion) stays as the spine. Three additions give the governance features something to bite on:

1. **A namesake.** `PER-007` **Omar Rahman**, born 1979-02-02, British, passport `G5510077`, phone `+447911223344`, home address *41 Oak Lane, Birmingham*. He is a care worker who flies LHR–IST twice (shared route with the watchlisted Omar Rahman, `N5538219`), pays rent by bank transfer, and appears in the clinic registrations. One flight manifest spells him *Umar Rahman* (transliteration signal). No watchlist entry. At threshold 0.55 he merges with `N5538219`.
2. **A health-sourced dataset.** `clinic_registrations.csv` — synthetic community-clinic registrations: `registration_id, patient_name, dob, home_address, city, country, registered_on, clinic_code`. Marking `HEALTH`, purpose `healthcare`, legal basis `care-provision`. Covers 60% of noise people and Omar Rahman (namesake); none of the watchlisted people, so that any HEALTH contribution to a watchlisted person's lead is itself a false merge artefact — a second thing to notice.
3. **A leads scenario.** Derived `leads` dataset (F8) for every Person with ≥ 1 address source; the top lead at default settings is the namesake Omar Rahman because the clinic record is recent — the designed "oh no" moment.

The existing exhibits stay: the split "C. Silva"/Clara Silva (F0.2), the label flip Petrov → Petrova, the shared address hub at 14 Seabright Ave.

### 5.2 Generator changes (`scripts/generate_synthetic_sources.py`)

- Add `PER-007` to `CORE_PEOPLE` with fields `home_address`, `clinic_code`, `namesakeOf: "PER-003"`.
- Add `build_clinic_rows(profile, rng, people)` writing `clinic_registrations.csv`; give every noise person a `home_address` drawn from a new `RESIDENTIAL_ADDRESSES` list (6 starter / 40 simulator) so leads vary.
- Add a transliteration variant to one of the namesake's manifest rows (`passenger_name = "Umar Rahman"`), and a second shared-route flight.
- Write `manifest.json` per profile: `{dataset: {file, markings, purpose, legalBasis, retentionDays, asOf}}`. The builders read it; the Build app shows it on the Datasets tab.
- Add `--seed` (default 20260401) so regeneration is deterministic; the current `rng` seeding should be checked **[to verify]** — if it already fixes the seed, document it.
- Add `source` provenance fields already present on pings to clinic rows (`source: "clinic-ehr"`) for the formula.
- Simulator: 2 further namesake pairs among noise people (same name, different DOB) so the ER table is not a one-row demo.

Builders: `01_normalize_sources.py` gains `normalize_clinic()`; `02_resolve_persons.py` becomes candidate-scoring (F6) and *also* consumes clinic rows (name + dob + address signals); `05_build_ontology.py` adds object type `Address` (`Location` with `locationType: "residential"` is enough — do not add a type) and link `RESIDES_AT` with `asOf` and `source`; `06_build_leads.py` is new. `scripts/build_ontology_seed.py` imports the shared resolver (F0.1) and the manifest.

### 5.3 Walkthrough beats per session (for the speaker guides)

- **S1:** patrol view → analyst view → Trace the risk-tagged operator → Checkpoint on ping expansion (type "routine") → *Request border watch* Action → audit strip → Oversight refused as analyst.
- **S2:** Pipelines → Datasets with manifest → Markings tab (HEALTH flows) → Resolution tab slider to 0.55 → Investigate shows merged Omar Rahman in Watchlist operators → Unmerge → remove HEALTH as analyst (refused), as DPO (justified) → Karlsruhe mode on, Leads changes.
- **S3:** Agent on "Summarise Omar Rahman" → trace → staged *Add to watchlist* → Approve all → Evals → fabricated-link run → Leads formula → Oversight as `dpo`, redaction toggle → case-study debate.

### 5.4 Case studies (discussion material, not simulation)

Each appears as a purple **Discussion** card beside the feature, with a one-paragraph summary from the research and two questions. They describe real institutions and public reporting; no real person is modelled, and the cards say so.

| Case | Attached to | Summary (from *research §D*) | Questions |
|---|---|---|---|
| ICE ImmigrationOS / ELITE (2025–26) | F2 Markings, F8 Leads | $30m contract without competition; ELITE draws on Medicaid, USCIS and CLEAR data; court filings (July 2026) describe Medicaid data shared beyond a court order reaching Palantir through a Teams chat, later said to be deleted | What would a HEALTH marking have prevented here? What does "deleted" mean once derived datasets exist? |
| BVerfG, 16 Feb 2023 (1 BvR 1547/19, 1 BvR 2634/20) | F3 Checkpoints, F9 Karlsruhe mode | Hamburg's provision void; Hesse's unconstitutional but in force until 30 Sept 2023; Bavaria's VeRA live Sept 2024, complaint July 2025; NRW complaint not accepted Feb 2026; federal review of nationwide use | Is a free-text Checkpoint the kind of threshold the court meant? Can a rule engine implement a proportionality test? |
| Dutch police "Raffinaderij" | F4 Oversight (redaction toggle) | In use since 2012; revealed via Woo requests with about 99% of documents redacted; Defence plans an alternative within two years | What does an audit log mean if the public cannot see that it exists? Who is the auditor here? |
| NHS Federated Data Platform | F1 Roles, F2 Markings | Awarded Nov 2023; 137 trusts by April 2026; up to £330m over seven years; Palantir says it is not the data controller, which is contested; BMA urged doctors to limit use (Feb 2026) | Does "not the controller" survive once the vendor's software decides what a role can see? |
| Denmark POL-INTEL; European exits | F13 Deployment view | Galis & Karlsson (2025); Denmark looking for domestic replacements | What is sovereignty in a platform delivered by Apollo? |
| Maven Smart System | F7 Agent | Contract ceiling about $1.3bn through 2029, 20,000+ users (May 2025); NATO version | What does "human in the loop" mean at that scale? |

Military targeting claims beyond the above (Ukraine 2023, Israel MoD) remain **[unverified]** per the research and are not put on cards.

---

## 6. Architecture changes

### 6.1 Shared core and state model

New directory `core/`, classic scripts, attached to `window.DC`:

| File | Exposes | Used by |
|---|---|---|
| `core/session.js` | `getSession()`, `setRole(id)`, `setPurpose(id)`, `sessionId` | both apps, Oversight |
| `core/audit.js` | `logEvent(partial)`, `readEvents(filter)`, `verifyChain()`, `clearAudit(reason)` | everything |
| `core/markings.js` | `canSee(role, markings)`, `redact(obj, role)`, `effectiveMarkings(datasetId)` | derived state, analytics, agent, map, Build |
| `core/checkpoints.js` | `withCheckpoint(triggerId, ctx, fn)`, `renderDialog()` | expand, export, actions, marking removal |
| `core/actions.js` | `applyAction(typeId, objectId, params, opts)`, `approveAction(id)`, `rejectAction(id)`, `pendingActions()` | Investigate, agent |
| `core/resolution.js` | `resolveAt(threshold)`, `overrides` | Build (slider), Investigate (merged view) |
| `core/purposes.js` | `check(op, ctx)` | expand, rules, actions, agent |
| `core/store.js` | namespaced `localStorage` access with versioning (§6.2) | all of the above |

`localStorage` namespace (replacing `ontology-studio-demo-v2:*` and `foundry-studio-demo-v1:*`):

```
dc-palantir:session                       {sessionId, role, purpose, flags: {strictCheckpoints, karlsruhe}}
dc-palantir:audit                         [event…]
dc-palantir:governance                    {markingOverrides[], resolutionOverrides[], threshold, pendingActions[], objectSets[]}
dc-palantir:gotham:{dataset}              {buildId, schemaVersion, data}        (editable ontology, as now)
dc-palantir:foundry:{dataset}             {buildId, ui}                           (UI state only, as now)
```

The two apps keep separate `data` objects (Gotham edits its ontology; Foundry treats the pipeline as authoritative). Cross-app effects go through `governance` (markings, resolution, pending actions) and are *applied* on load by each app: Investigate applies `resolveAt(threshold)` and `markingOverrides` before `buildDerivedState()`; Build reads `pendingActions` to show them on the Lineage tab as "edits awaiting approval".

### 6.2 Seed contract versioning (fixes F0.4)

Both builders write:

```json
"metadata": {"schemaVersion": 3, "buildId": "sha256:ab12…", "generatedAt": "…", "sources": {"watchlist.csv": "sha256:…"}, "builder": "build_ontology_seed.py@<git short sha or 'dirty'>"}
```

`buildId` is a hash over the sorted raw files, the manifest and the builder's own source. `core/store.js` `loadVersioned(key, seed)`:

1. If nothing stored → use seed.
2. If `stored.schemaVersion !== seed.metadata.schemaVersion` → discard, banner *schema changed; saved edits discarded*.
3. If `stored.buildId !== seed.metadata.buildId` → use seed, keep the stale copy under `…:stale`, banner *data was regenerated; your earlier edits are available to restore*.
4. Else → use stored.

`schemaVersion` bumps when a field's meaning changes (this redesign is 3). Foundry's payload gains the same `metadata` block (it currently has only `pipeline.generatedAt`).

### 6.3 How markings and roles are evaluated client-side

Everything is evaluated in the browser, honestly labelled as a model of enforcement, not enforcement. The evaluation order on every render in Investigate: `resolveAt` → apply `markingOverrides` → `redact` per object for the current role → `buildDerivedState` → analytics/scenarios/agent/map. Redaction returns `{withheld: [marking]}` placeholders so renderers can draw the hatched cell. Build evaluates markings per dataset from `markings` ∪ `markingProvenance` minus overrides. Oversight evaluates only its own role gate.

Performance: the simulator has 1,534 entities and ~6,000 edges; `resolveAt` is union-find over ≤ 300 candidates and `redact` is a shallow copy per entity — both well under the existing full re-render cost. Memoise `resolveAt` by `(threshold, overrides hash)`.

### 6.4 Module split of `demo/app.js`

No build step; `demo/index.html` loads, in order: `../core/*.js`, then `js/state.js` (constants, `ui`, `data`, persistence, `switchDataset`), `js/derive.js` (lookups, `buildDerivedState`, `buildSubgraph`, paths, timeline), `js/analytics.js` (`buildAnalytics`, `buildInvestigations`, `scenarioActions` → Action drawer), `js/agent.js` (F7; replaces the copilot functions), `js/map.js` (Leaflet + SVG fallback), `js/render/*.js` (one file per tab plus header, inspector, walkthrough), `js/events.js` (`handleClick/Change/Input` as a dispatch table keyed by `data-action`), `js/main.js` (boot). Each file is an IIFE that attaches to `window.DCInvestigate`. Target: no file over 600 lines; the dispatch table replaces the 300-line `if (action === …)` chain. `foundry-demo/app.js` (750 lines) gains `js/resolution.js`, `js/markings.js`, `js/purposes.js` and can otherwise stay one file.

Why not ES modules: they fail on `file://` in Chromium, and the README promises double-click opening. If Tobias drops that promise (§9), convert the IIFEs to modules in a day.

*Status (Phase 1):* done as native ES modules after Q6 was decided (§9): `demo/js/main.js` is loaded as `<script type="module">`, modules import each other instead of attaching to `window.DCInvestigate`, and `core/` stays classic. Layout and boot order: TECHNICAL_SPEC §11.4.

### 6.5 Testing

**Python (`tests/`, pytest, run by `scripts/check.sh`):**

- `test_resolution_parity.py` — both builders produce identical entity IDs *and* identical `(type, source, target)` edge sets for both datasets (F0.1).
- `test_person_names.py` — no `canonicalName` starts with `person::` (F0.3).
- `test_markings_propagation.py` — every dataset downstream of `raw_clinic_registrations` carries `HEALTH` with correct `markingProvenance` (F2).
- `test_candidates.py` — the namesake pair scores in [0.5, 0.6); passport matches score 1.0; `dob-conflict` is negative (F6).
- `test_leads_formula.py` — evaluate the `formula` string with the component values and compare to `score` (F8).
- `test_generator_determinism.py` — two runs with the same `--seed` are byte-identical.
- `test_seed_contract.py` — `schemaVersion`, `buildId`, `governance`, `resolution` present; JSON-serialisable; sizes under 10 MB each.

**Browser (Playwright for Python, dev dependency only, `tests/e2e/`):** headless Chromium against `python3 -m http.server`:

- Load both apps and Oversight with no console errors.
- Role switch in Investigate → reload Build → session strip shows the role.
- Checkpoint flow: expand pings → dialog → "routine" → record present in `dc-palantir:audit`.
- Action flow (F5) and threshold flow (F6) as in their acceptance criteria.
- Stale-seed banner appears when `buildId` is changed in storage (F0.4).

CI: a GitHub Actions workflow that runs `scripts/check.sh` (syntax checks, pytest, seed build to a temp dir, Playwright smoke) on pull requests; Pages deployment stays "deploy from branch" with committed seeds, so the workflow also fails if the committed seeds' `buildId` does not match a fresh build.

---

## 7. Documentation and teaching materials

| Document | Change |
|---|---|
| `README.md` | Three sessions, three surfaces; run and test commands; honesty-label legend |
| `STUDENT_STUDY_GUIDE.md` → `SESSION_1_INVESTIGATE.md` | Rewrite steps around roles, Checkpoint, Action, audit strip. Remove the "cannot hallucinate" claim and the "Real-world… platforms" sentence (Step 4). Replace entity/relationship vocabulary with object/link plus glossary pointer. The "Real-World Deployments" list predates the research: keep NHS FDP (update to 137 trusts by April 2026, up to £330m over seven years, controller claim contested — *research §B.9*) and Maven/TITAN (figures from *research §A*); mark FALCON/LESA, LASER, In-Q-Tel and Cambridge Analytica **[to verify]** or drop them; add ImmigrationOS/ELITE, BVerfG 2023, Raffinaderij, POL-INTEL from *research §D* |
| `FOUNDRY_STUDY_GUIDE.md` → `SESSION_2_BUILD.md` | Add Markings, Resolution and Karlsruhe steps; state that Foundry's lineage is dataset-level and the row/field view is a teaching extension (*research §B.5*); mention builds, branches, schedules as not modelled (*research §B.4*) |
| new `SESSION_3_AGENT_OVERSIGHT.md` | Agent, Leads, Oversight; case-study debate format |
| `DEMO_WALKTHROUGH.md`, `FOUNDRY_WALKTHROUGH.md` → `INSTRUCTOR_NOTES.md` | One file with per-feature sections: *what to click, what students will say, what to say back, the honesty label, the source*. Each F-feature in §4 gets one section; include the "type 'routine'" moment and the "Approve all" moment as planned provocations |
| `TECHNICAL_SPEC.md`, `FOUNDRY_TECHNICAL_SPEC.md` | Update §7/§8 seed contracts to v3 (governance, resolution, purposes, leads, metadata); document `core/` and the storage namespace; replace §13.2's ephemeral action log with F4; add the testing section |
| `glossary.html` (new) | §2.2 table plus honesty labels, generated from `metadata.honesty[]` at build time so it cannot drift |
| `DEPLOY.md` | Add `scripts/check.sh`, CI, and the note that the audit log is per browser |
| `context/` | Keep the research report in the repo (`context/PALANTIR_RESEARCH_2026-11-04.md`) so citations in the guides resolve; it is currently only in the session output folder |

Facts to carry into the guides from the research (with dates): NHS FDP 137 trusts (April 2026), up to £330m over seven years, BMA guidance (February 2026); Maven ceiling about $1.3bn through 2029, 20,000+ users (May 2025); TITAN $178.4m for 10 prototypes (March 2024); Army Enterprise Agreement 10 years capped at $10bn (August 2025); ImmigrationOS $30m (April 2025); BVerfG dates as in §5.4. Reading list: Brayne 2017/2020, Iliadis & Acker 2022 (**[check volume/issue]** per research), Galis & Karlsson 2025, Jagasia & Wee 2021, Bäuerle 2026.

---

## 8. Phased roadmap

| Phase | Scope | Depends on | Demo-able afterwards | Effort |
|---|---|---|---|---|
| **0 — Fixes** | F0.1 shared resolver and edge parity; F0.2 resolution notes; F0.3 ping names; F0.4 seed versioning; F0.5 hygiene, `source_file`, deep link; `tests/` skeleton with parity test; CI | — | Same two demos, now consistent with each other; regenerated seeds appear without Reset; Foundry → Gotham link lands on the object | 1 week |
| **1 — Governance core** | `core/` (session, audit, markings, checkpoints, store); F1 roles; F2 markings through lineage (requires clinic dataset from §5.2, so the generator change lands here); F3 Checkpoints; F4 audit + Oversight page; F10 renames, honesty chips, glossary; split `demo/app.js` (§6.4) | Phase 0 | Session 1 and most of Session 2 in their new form: role switch, Checkpoint, audit, markings flowing, DPO removal; copilot honestly labelled | 3 weeks |
| **2 — Actions and resolution** | F5 Action types, writeback panel, analytics feedback; F6 candidate scoring, slider, unmerge; F9 Karlsruhe mode; namesake storyline (§5.1 item 1); session guides 1–2 | Phase 1 (actions need checkpoints/audit; unmerge is an Action) | Full Sessions 1 and 2; the false-merge moment; feedback loop | 3–4 weeks |
| **3 — Agent and scenarios** | F7 agent with trace, citations, staged edits, failure modes, evals; F8 Leads and `06_build_leads.py`; F11 object sets; F12 retention clock; F13 deployment view; Session 3 guide; instructor notes complete; optional BYO-key mode and F14 if decided | Phase 2 (agent stages Actions; leads use markings and purposes) | Full three-session course | 4 weeks |

Order within Phase 1: store/versioning → session/audit → markings (data) → roles (UI) → Checkpoints → Oversight → renames/glossary → app.js split last (so features are not written twice). Phase 2 can start the generator work in parallel with Phase 1's UI.

---

## 9. Open questions for Tobias

**Decided on 4 November 2026:**

- **Q1 — Two surfaces + Oversight with a shared core** (§3.2, Option A).
- **Q2 — Three 90-minute sessions** (§3.4); Leads and Oversight stay in scope.
- **Q6 — A local server or GitHub Pages is acceptable**; `file://` double-click is no longer promised. Phase 1 may convert the shared core and the `demo/app.js` split (§6.4) to ES modules instead of IIFEs. Phase 0 keeps classic scripts.
- **Phase 0** approved as specified in §4.0.

The remaining questions are open:


1. **Two surfaces or one platform?** §3.2 recommends two apps plus Oversight with a shared core. Confirm, or choose Option B (one app with modes) before Phase 1's UI work starts; the core is the same either way.
2. **Course length.** Three 90-minute sessions as in §3.4, or the two-session cut? This decides whether Leads and Oversight are P3 or folded in.
3. **Bring-your-own-API-key LLM mode.** Should the agent offer an optional real-LLM mode (key held in `sessionStorage`, never stored, off by default)? It adds realism and unpredictability; it also adds a dependency and a data-protection question for a university course. Default proposal: no in Phases 0–2; decide for Phase 3.
4. **Public hosting of Deep Culture logos and fonts.** `brand/` (ERC/UvA identity, Lexend under OFL) is served from GitHub Pages at `goto4711.github.io/demo-palantir`. Is that acceptable to the project and the funder, and should the ERC acknowledgement text appear on the landing page?
5. **The word "Palantir" in titles.** The repo and the landing page say "Palantir-style". Keep "-style" everywhere, and add a one-line disclaimer that this is an independent teaching simulation with no affiliation? (The honesty labels cover the content; this is about the name.)
6. **`file://` support.** Keep double-click opening (classic scripts, no ES modules) or require a local server / Pages (ES modules, cleaner code)?
7. **Student persistence.** Should students be able to export their session (audit log, overrides, edits) as a file and hand it in, or import it into another browser? Cheap (S) and useful for assessment; raises the question of what the instructor learns about the student.
8. **Who plays the auditor?** Should Oversight be gated to `dpo`/`auditor` (students must switch role, learning that oversight is a different seat) or open to all (less friction)?
9. **Editable transforms in the browser.** The Foundry spec defers a JS port of the pipeline. Is that wanted for Session 2 (students change the resolution weights and rebuild live), or is the client-side threshold slider enough?
10. **Case-study cards.** Are you comfortable naming institutions (ICE, NHS England, Dutch police, Bavarian police) on cards inside the tool, with sources, or should those stay in the guides only?
11. **Language.** English only, or Dutch UI strings for UvA students? Strings are already centralised enough to add a second locale in Phase 1 if decided now.
12. **Palantir Developer Tier.** The research (§F) notes it is free; should the course point students to it for comparison, subject to its terms **[to verify]**?

---

## 10. References

All from `context/PALANTIR_RESEARCH_2026-11-04.md` (§G and §E); only those relied on above are listed.

Palantir documentation and writing
- Ontology core concepts — https://www.palantir.com/docs/foundry/ontology/core-concepts
- Foundry platform summary — https://www.palantir.com/docs/foundry/getting-started/foundry-platform-summary-llm/
- Connecting AI to decisions with the Ontology — https://blog.palantir.com/connecting-ai-to-decisions-with-the-palantir-ontology-c73f7b0a1a72
- Checkpoints: core concepts and overview — https://palantir.com/docs/foundry/checkpoints/core-concepts/ · https://palantir.com/docs/foundry/checkpoints/overview/
- Markings — https://palantir.com/docs/foundry/security/markings/
- AIP features — https://palantir.com/docs/foundry/aip/aip-features/
- Agent Studio overview — https://www.palantir.com/docs/foundry/agent-studio/overview
- Vertex example use cases — https://palantir.com/docs/foundry/vertex/example-use-cases/
- Privacy and civil liberties engineering — https://blog.palantir.com/privacy-civil-liberties-engineering-palantir-explained-5-4f027b207923
- Apollo — https://blog.palantir.com/palantir-apollo-powering-saas-where-no-saas-has-gone-before-7be3e565c379
- Jagasia, A. & Wee, Y. W. (2021). Lightweight Purpose Justification Service for Embedded Accountability. USENIX PEPR '21 — https://fpf.org/wp-content/uploads/2021/06/Session-8-2-Lightweight-Purpose-by-Jagasia-Wee.pdf

Cases and reporting
- ImmigrationOS award — https://immpolicytracking.org/policies/reported-palantir-awarded-30-million-to-build-immigrationos-surveillance-platform-for-ice
- ELITE — https://gigazine.net/gsc_news/en/20260116-us-ice-palantir-elite
- Medicaid data and Palantir — https://www.hppr.org/npr-news/2026-07-17/ice-shared-medicaid-data-it-wasnt-supposed-to-have-with-palantir
- IRS database letters — https://nextgov.com/modernization/2025/06/democrats-press-palantir-about-reported-creation-irs-mega-database/406144
- BVerfG press release, 16 February 2023 — https://bundesverfassungsgericht.de/SharedDocs/Pressemitteilungen/EN/2023/bvg23-018.html
- Bäuerle, M. (2026), Verfassungsblog — https://verfassungsblog.de/?p=106048
- Bavarian complaint — https://posteo.de/en/news/germany-legal-challenge-alleges-unconstitutional-data-analysis-by-bavarian-police
- Federal review of nationwide use — https://www.yahoo.com/news/articles/germany-weighs-nationwide-palantirs-controversial-161014140.html
- Dutch police — https://nltimes.nl/2025/08/22/dutch-police-also-use-controversial-ai-intelligence-software-american-palantir
- European reassessments — https://euronews.com/next/2026/06/05/why-are-european-governments-reevaluating-their-agreements-with-us-defence-tech-contractor
- NHS FDP, Westminster Hall debate, 16 April 2026 — https://parallelparliament.co.uk/mp/zubir-ahmed/debate/2026-04-16/commons/westminster-hall/nhs-federated-data-platform
- Army Enterprise Agreement — https://www.theregister.com/2025/08/01/palantir_us_army_contract/
- Maven contract increase — https://defensescoop.com/2025/05/23/dod-palantir-maven-smart-system-contract-increase/
- TITAN award — https://defensescoop.com/2024/03/06/palantir-army-titan-ground-station-award-178-million/
- Galis, V. & Karlsson, B. (2025). Scientification through privatization: POL-INTEL in Denmark. *Theoretical Criminology* — https://researcher.itu.dk/p/en/research-outputs/scientification-through-privatization-pol-intel-in-denmark

Scholarship
- Brayne, S. (2017). Big Data Surveillance: The Case of Policing. *American Sociological Review* 82(5). doi:10.1177/0003122417725865
- Brayne, S. (2020). *Predict and Surveil*. Oxford University Press.
- Iliadis, A. & Acker, A. (2022). The seer and the seen. *The Information Society*. doi:10.1080/01972243.2022.2100851 **[check volume/issue]**

Open analogues
- Aleph mappings and false-merge warnings — https://docs.aleph.occrp.org/developers/mappings
- OpenSanctions entity model — https://www.opensanctions.org/docs/entities/
