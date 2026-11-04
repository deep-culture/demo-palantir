# Phase 3 contract: agent, leads, object sets, retention, deployment

Shared definition for the three Phase 3 builders. Read with `REDESIGN_SPEC.md` §4.7 (F7), §4.8 (F8), §4.11 (F11–F13), §5.1 item 3, §5.3 S3, §5.4, and the Phase 1 and Phase 2 contracts in `context/` (still in force). Where this file and the spec differ, **this file wins**. Out of scope: F14 (the screen builder), the Vertex what-if, and bring-your-own-key LLM mode (spec §9 Q3 is still open; leave a clearly marked hook but no network code).

## 1. Leads (F8), data side

- New transform `pipeline/06_build_leads.py` ("06 Build Leads") produces dataset `leads`. It shows in Build's DAG with lineage to its inputs.
- **One lead per Person** with at least one address source. Address sources, with weights:

| source dataset | marking | weight | address used | date used |
|---|---|---|---|---|
| clinic registrations | HEALTH | 0.5 | `home_address` | `registered_on` |
| mobile location pings (residential or most frequent non-airport location) | TELECOM | 0.4 | location label | latest ping `timestamp` |
| company registry (registered address of a company the person directs or owns) | OPEN | 0.3 | `registered_address` | `incorporation_date` |

- Formula (exact string, stored with each lead): `score = 100 · min(1, Σ weight_i · exp(−ageDays_i / 365))`. `asOf` is a fixed dataset date, the latest timestamp in the data. The best address is the one with the largest contribution.
- **Lead shape** (both seeds: Investigate `catalog[ds].leads = {asOf, formula, weights, items: [...]}`; Build as dataset `leads` with sample rows):

```js
{id: "lead::<personId>", personId, address, lat, lon, score, status: "open",
 components: [{source, marking, weight, ageDays, decay, contribution, address}], formula, asOf}
```

- **Designed outcome (tested):** as DPO, who sees everything, the namesake `person::g5510077` is the **top lead** in starter. Without HEALTH (fin-analyst), his score drops and he is no longer top. The browser recomputes the score from `components` after redaction, so the number visibly changes.
- New Action type `act-close-lead` (objectType `Lead`, roles fin-analyst; parameter `outcome` enum `["no-action","referred","address-wrong"]` plus a `reason` of at least 10 characters; effects: set the lead's `status`, writeback to `case-management`). Leads are **not** ontology objects. They live in `leads.items`, and Investigate's `apply` callback edits `fullData.leads`.
- Discussion cards: `disc-ice-elite` is also attached to `inv.leads`. Add `disc-maven` (Maven Smart System: about $1.3bn ceiling through 2029, 20,000+ users in May 2025, NATO version; questions on the human in the loop at scale), attached to `inv.agent`.
- Honesty entries: `inv.leads` (simplified: "the formula is ours; ELITE's is not public"), `inv.object-sets` (mirrors: object sets), `build.retention` (simplified), `deployment` (extension).

## 2. Agent (F7), browser side: Investigate builder

- Replaces the rule-based stand-in on the **Agent (simulated AIP)** tab. No LLM call. The plan is built deterministically from the query, using the existing match functions in `demo/js/agent.js`.
- **Tools:** `search_objects`, `get_links`, `expand`, `run_rule`, `propose_action`, `get_lineage` (the last reads the Build seed only if it is loaded; otherwise "not available on this surface").
  - Every tool runs through the role view (markings), purpose rules (Karlsruhe), Checkpoints (expansion) and the audit log: **one `agent` event per tool call**.
  - A denied tool step is shown as "denied and logged", and its results never reach the answer.
- **Trace, answer and edits:**
  - Trace shape as in spec §4.7.
  - The answer is a list of sentences, each with ≥ 1 citation chip (an object or link id) that highlights the item in the graph.
  - Staged edits use `DC.actions.applyAction(..., {staged: true})`, each with Approve / Reject, plus **Approve all**. Approve all is one audit event with `payload.count = n` and `approvedBy: "<role> (bulk)"`.
- **Three scripted failure modes**, selectable by the instructor in the session strip (a "Failure mode" select: none / fabricated-link / overreach / approve-all) and also fired by three fixed example prompts:
  - **fabricated-link:** one sentence cites a link id that doesn't exist. The Evals panel flags it only after the student clicks **Check**.
  - **overreach:** the plan includes a tool the role can't use. The step is denied and logged, and the answer doesn't use it.
  - **approve-all:** the plan stages several edits, and the UI nudges towards Approve all.
- **Evals panel:** three checks: every claim cites an existing object or link; no denied tool result was used; no edit was applied without approval.
- **Default example prompts** (spec §5.3 S3): "Summarise Omar Rahman" (it finds *both* Omar Rahmans, and how it handles them depends on the threshold), "Who should we add to the watchlist?" (approve-all), "Show me everyone connected to Kareem Haddad's phones" (overreach as patrol, Checkpoint as analyst), and "What links Omar Rahman to North Quay Logistics?" (fabricated-link).

## 3. Leads tab, object sets: Investigate builder

- **Leads tab:**
  - A table (person, best address, score 0–100, sources with marking chips, age) and a Leads layer on the map (pins sized by score).
  - Clicking a lead shows the formula with the numbers filled in. A withheld component shows hatched, with the recomputed score next to the full one ("score without withheld sources").
  - The Close lead Action is available.
  - With Karlsruhe on and a law-enforcement purpose, R2 removes the HEALTH component, and the card says so.
  - The ELITE discussion card is attached.
- **Object sets (F11):** "Save as object set" from a graph selection, rule hits or a search result. Each set is `{id, name, memberIds, createdBy, versions: [{ts, added, removed, by}]}`, stored in `dc-palantir:governance.objectSets`. A list on a new **Object sets** panel (in the Objects tab or its own tab) shows a diff between versions, and sharing is simulated by role (a "shared with roles" field). Members a role can't see count as "withheld". Usable as the agent's input ("Summarise this set").

## 4. Build builder

- **Leads in Build:** show the `06 Build Leads` transform and the `leads` dataset with markings (HEALTH, TELECOM and OPEN inherited) and lineage. Karlsruhe R2 flags it.
- **Retention clock (F12):** a date slider on the Datasets tab (from `asOf` minus 3 years to `asOf` plus 1 year).
  - Rows past their dataset's `retentionDays` are greyed out, using each raw dataset's own date column.
  - Derived datasets show "n rows still carry data past retention upstream", worked out through lineage.
  - A Discussion line asks: deletion that never reaches copies.
- **Deployment view (F13):** a new root page `deployment.html` in the Deep Culture style. It is a diagram (inline SVG, no external libraries) of where everything lives: seeds and code on GitHub Pages, tiles from OSM, session/audit/governance in each browser's localStorage, nothing on a server. A toggle contrasts this with a real deployment (customer cloud or on-premises, Apollo updates, forward-deployed engineers, classified networks; research §A and §D). It carries the POL-INTEL/European exits discussion card. It is linked from the landing page and the glossary.
- **Landing page:** the Session 3 card is now active (Agent, Leads, Oversight) and links to the right places. **Glossary:** agent, tool call, trace, staged edit, eval, lead, address confidence, object set, retention, deployment / Apollo.

## 5. Core additions (Investigate builder owns `core/`)

```js
DC.agent.logToolCall({runId, n, tool, args, resultIds, denied, reason})   // or reuse DC.audit directly; one event per call
DC.actions.approveAll(ids, {by})       // one audit event {kind:"action", verb:"action.approveAll", payload:{count, ids}}
DC.objectSets.list()/save(set)/update(id, {add, remove})/share(id, roles)/get(id)   // persisted in governance, logged
DC.session flags: failureMode ("none"|"fabricated-link"|"overreach"|"approve-all"), instructor-only control in the strip
DC.ui.leadFormula(lead, visibleComponents) -> HTML   // shared by Investigate and Build
```

## 6. Ownership

| Builder | Owns |
|---|---|
| Data | `scripts/`, `pipeline/` (new `06_build_leads.py`), `synthetic_data/` (only if needed for addresses), `tests/`, both seeds, the seed and pipeline sections of the tech specs |
| Investigate | `core/`, `demo/`, `audit/` (agent events, the approve-all event, object-set events), the Investigate and Oversight sections of `TECHNICAL_SPEC.md` |
| Build | `foundry-demo/`, `deployment.html`, `glossary.html`, `index.html`, the Build sections of `FOUNDRY_TECHNICAL_SPEC.md`. **No guide restructuring**: the runthrough comes after Phase 3. |
