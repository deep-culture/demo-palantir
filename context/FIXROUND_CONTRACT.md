# Fix round contract (after the simulated student tests)

Source: `context/student-tests/STUDENT_TESTS_SUMMARY.md`, with the detailed lists in `context/student-tests/issues-*.md`. Section letters (A1, B, C, D) refer to the summary. The Phase 1–3 contracts stay in force, and this file wins where they differ.

## 1. Data changes (data builder)

- **Clinic data is PII as well as HEALTH.** The clinic dataset's manifest markings become `["PII","HEALTH"]`. Objects and links derived from clinic rows carry PII as well:
  - residential `Location` objects: `["PII","HEALTH"]`
  - `RESIDES_AT` links: `["PII","HEALTH"]`
  - Person properties `homeAddress` and `clinicCode`: `["PII","HEALTH"]`
  - the lead components from the clinic: `marking: "HEALTH"`, with a new `markings: ["PII","HEALTH"]`

  After the DPO removes HEALTH, roles without PII (auditor, contractor) still cannot see the rows. Propagation, tests and the counts in the spec are updated to match.
- **New checkpoint `cp-marking-restore`** (trigger `marking.restore`, roles: dpo, `requiresPurpose: true`, `minLength: 20`). Prompt: "You are restoring a marking. Everything derived from this dataset will again be withheld from roles without it. State why."
- **The DPO can test rules under an operational purpose.** The DPO's purposes become `["oversight","public-order"]`. The role description adds: "may assume an operational purpose (public order) to test purpose rules; this is a simulation convenience, not a power a real DPO has". This makes the R2 demonstrations on Leads and Analytics reachable as DPO.
- **Discussion cards and facts** (summary §C). Check every changed claim against its cited source with WebFetch, and keep quotes under 15 words.
  - **NHS:** drop the BMA claim and "contested in practice" unless a reachable source supports them. Report the minister's position as stated in the source.
  - **Raffinaderij:** credit Buro Jansen & Janssen's appeal, with de Volkskrant reporting. Remove the Defence sentence, or move it into a clearly separate line on defence (Euronews).
  - **POL-INTEL:** separate Denmark's defence deal from POL-INTEL.
  - **New card `disc-data-subjects`**, attached to `oversight.audit`, `inv.actions` and `session.roles`: the people affected have no notice, access, rectification or erasure in this tool (GDPR Arts 15–17, LED Arts 14–16). Questions: who would notice an error, and how would they contest it? Source: EUR-Lex (GDPR 2016/679, LED 2016/680).
- **Karlsruhe notes** (`legalBasisNote` and each rule's text or a new `note` field).
  - Remove the visible "[to verify …]" placeholder.
  - Say what each rule abstracts: R1 is the thinnest form of purpose limitation; R2 reflects GDPR Art. 9 and LED Art. 10, and an absolute ban is stricter than EU law; R3 is our device, and a length check cannot test "sufficiently specific facts".
  - Say that the court addressed the legislature, and that its interim order required a written reason for each use.
  - Use the BVerfG press release as the source.
- **Illustrative legal bases in the manifest:**
  - `flight_manifests`: name *Ligue des droits humains* (C-817/19, 21 June 2022) and its limits on blanket retention beyond six months.
  - `company_registry`: name *WM and Sovim* (C-37/20, 22 November 2022), which ended general public access to beneficial-ownership data. Mark the `beneficial_owner` and `beneficial_owner_dob` fields PII: as `propertyMarkings` on the Company object if they surface there, and as a field-level note on the dataset.
- **Honesty and glossary source labels:** each `docUrl` gets a `docLabel` ("Palantir documentation", "BVerfG press release", "OCCRP Aleph docs", "News report" …). The UI shows the label, not a blanket "Palantir documentation".
- **Weights table note** (`resolution.signals` gets a `note` on the table, or a `discussion` string): "There is no passport-conflict signal. Should two different passports veto a merge? Who decides?" Don't add the signal; it would break the designed namesake case.

## 2. Core and Investigate (Investigate builder owns `core/`, `demo/`, `audit/`)

- **A1: approving staged edits runs the same Checkpoint.**
  - Approve and Approve all go through `cp-action-sensitive` for sensitive Action types.
  - Approve all asks **once**, and its prompt lists every item. It logs one checkpoint record and one `action.approveAll` event with the count.
  - Evals gains a fourth check: "every sensitive edit passed a Checkpoint".
- **A2: export through the role view.**
  - Export JSON serialises only what the role can see: entities, edges, leads (with withheld components removed and recomputed), object sets, resolution candidates (candidates involving withheld objects are dropped), and action logs.
  - Add a test: as fin-analyst the export contains no "41 Oak Lane" and no telecom addresses.
- **A3: governed properties in the Objects editor.**
  - `riskTag`, `reviewFlag` and lead `status` are read-only in the editor, with a link "use the Action".
  - Deleting an object with `origin` from a source file (not created by an Action) is refused, with an explanation.
  - Every editor create, update and delete of an object, link, type or property is logged (`kind: "edit"`), and *Reset dataset* is logged.
- **A4: withheld means withheld.**
  - `resolution.mergedFrom` references are filtered by the marking of their source. Withheld ones show as "n records withheld".
  - Component labels and lineage references for withheld sources show "1 source withheld (marking X)" without naming the dataset when that would reveal the category. The marking chip can stay; note on screen that showing a marking is itself a signal.
  - Display IDs that embed a phone number (`person::c-silva-30131994523`) are shown truncated with the digits masked, for roles without TELECOM. The real IDs stay internal.
- **A5:** `DC.markings.restoreMarking({datasetId, marking, checkpointRecordId})` removes the override, is logged (`marking.restore`), and runs through `cp-marking-restore`. It is also exposed in Oversight for the DPO.
- **A6: audit chain and instructor controls.**
  - `verifyChain` checks `meta.lastSeq` and `meta.count` against the log's length and the last sequence number, so truncation fails ("n events missing since seq …").
  - It claims a cap drop only when the cap was actually reached and recorded in meta. A head anchor is kept, and removing events from the head is detected unless they were legitimately dropped.
  - A new **Instructor mode** checkbox in the session strip (off by default, logged when toggled) reveals Strict checkpoints, Failure mode and Clear audit. Clear audit needs instructor mode and a reason of at least 10 characters.
  - The honesty label stays: this models tamper evidence; it is not tamper-proof.
- **A7: phone search.**
  - The Checkpoint fires for any query of 4 or more digits, or starting with `+`, on input after a debounce, not only on Enter.
  - Search audit events are debounced into one event per settled query.
- **A8: Request exception.** Keep it self-granted, but label it: "Self-certified exception: takes effect now, recorded for review by the data protection officer". Oversight gets an "Exceptions to review" list for the DPO, with a "Reviewed" mark (logged).
- **D: resolution.**
  - A merged person's resolution record says "merged at 0.55 from n source identities (scores …)" instead of "Matched by passport · confidence 1.00".
  - Investigate and Build use the same name for the representative: the watchlisted member's label.
- **D: threshold.** Only fin-analyst and dpo may change it. Other roles see the slider disabled with the reason, and an attempt is logged.
- **D: trace header** shows the failure mode only in instructor mode.
- **D: object sets** shared with a role are view-only for that role. The owner and the DPO can edit.
- **D: accessibility.**
  - Graph nodes are keyboard reachable (`tabindex="0"`, `role="button"`, `aria-label`, Enter/Space to select).
  - The audit strip no longer covers content (pad the body).
  - Every select and search input has a label.
  - Citation chips show readable labels (object label or link type, plus target), with the ID in `title`.
  - The tab bar wraps or scrolls visibly at 1440 px.
  - Low-contrast states are checked against WCAG AA.
- **D: small bugs** (from the issue lists):
  - the "No transfer edges" vs "$… linked transfers" contradiction;
  - the stale "Athens International Airport" fallback;
  - the Leads detail panel must follow the clicked row;
  - an example prompt must not run twice (clicking fills the box; Ask runs it);
  - Run action disabled when the plan has a refusal;
  - Purpose kept across a role switch when the new role holds it;
  - patrol's shared-address-hub scenario rated HIGH with 1 node;
  - withheld totals shown as "withheld" rather than "0 accounts, $0".
- **B 2.5.3: R2 in Analytics is reachable.** With Karlsruhe on and a law-enforcement purpose, any rule whose hits carry HEALTH-derived data shows the R2 card for roles that can see HEALTH (the DPO with public-order). For roles that can't see HEALTH, add the line "HEALTH data is withheld from your role anyway; R2 would also exclude it under this purpose". Keep the current behaviour for actions.

## 3. Build (Build builder owns `foundry-demo/`, `glossary.html`, `index.html`, `deployment.html`)

- **Restore marking** on the Markings tab (calls `DC.markings.restoreMarking` through `cp-marking-restore`).
- **A4 in Build:** lineage row references, `mergedFrom`, and lead and component sources for withheld markings are shown as withheld (count and marking) without the dataset row ids. Phone-embedded IDs are masked for roles without TELECOM.
- **Polish:**
  - the raw `null (carried by this dataset)` becomes "(this dataset)";
  - the legend label "ID" is fixed;
  - struck-through grey or red on black is replaced with AA-contrast styles plus a text tag;
  - the header counts are role-filtered ("visible / total");
  - the DAG shows a scroll cue when it overflows;
  - underlined links don't hide underscores (use `text-underline-offset`, or no underline on code-like names);
  - the Resolution threshold control is disabled for roles that can't change it (core rule).
- **Glossary and landing:**
  - use `docLabel` instead of a blanket "Palantir documentation";
  - remove the visible placeholder;
  - the Session 1 card text: "Oversight opens for the data protection officer or auditor; as analyst you'll be refused, and that refusal is logged";
  - add glossary entries for Instructor mode, self-certified exception and data-subject rights.

## 4. Coordinator

The runthrough corrections (summary §B) are done after the merge, against the final behaviour.
