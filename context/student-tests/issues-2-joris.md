# Issues found — Joris (student 2)

Environment: Playwright/Chromium, 1440×900, fresh profile with localStorage cleared at the start, server at `http://127.0.0.1:8077/`. Screenshots are in `shots/`. Map tiles are blocked in this sandbox, so the Map tab has a grey background (`100_map_grey.png`). That is a limitation of the environment, not a bug.

Severity labels: **bug**, **guide mismatch**, **design question**, **security-honesty** (the simulation's own access rules or audit claims don't hold, judged by the tool's own logic, not by real-world security).

---

## A. Most important

1. **The Objects (schema) editor gets around Actions, Checkpoints and the audit log** — security-honesty
   - Steps: as Financial-crime analyst, go to Objects → Person → Ben Grant and type `sanctions-evasion` into the *Risk tag* field. Then pick Watchlist Record → WL-1001 → *Delete object*.
   - Expected: the same governance as *Add to watchlist* (role check, Checkpoint, writeback, audit event), or a read-only field. Remove from watchlist refuses to touch Kareem's source tag, so deleting his source record should be refused too.
   - Actual: Ben Grant appears straight away in Analytics → Watchlist operators (score 4). The footnote reads "0 objects risk-tagged by Actions". WL-1001 is deleted with no confirmation, and Kareem's score drops from 14 to 13. The audit log has only `object.view` events for both objects: no edit, no delete. *Reset dataset* is not logged either.
   - Shots: `23_direct_edit_risktag.png`, `24_analytics_after_direct_edit.png`.

2. **Export JSON leaks HEALTH and TELECOM data through the `leads` block** — security-honesty
   - Steps: as analyst, *Export JSON*, pass the Checkpoint, open the file (`fetched_export.json`).
   - Expected: the export is filtered like the screen. The Checkpoint itself says "117 objects and 149 links visible to Financial-crime analyst".
   - Actual: `entities` are redacted correctly (`homeAddress: {withheld:["HEALTH"]}`), but `leads.items[].components` holds all 10 clinic home addresses (e.g. "41 Oak Lane, Birmingham", purpose healthcare, with lat/lon) and 18 TELECOM ping addresses. Exporting is the easiest way to see what your role is told it cannot see.
   - Shot: `14_export_checkpoint.png` (the file is the evidence).

3. **Approving an agent's staged edit skips the Checkpoint that a manual Action requires** — design question / security-honesty
   - Steps: run *Add to watchlist* by hand on Daniel Wu: the `cp-action-sensitive` Checkpoint appears. Then ask the agent "Who should we add to the watchlist?" and press *Approve all*, or *Approve* on a single edit after "Summarise Omar Rahman".
   - Expected: each approval asks for a purpose, as the manual path does. The drawer says the Checkpoint "will be asked".
   - Actual: no Checkpoint. Two (and then one) watchlist writebacks go to Border watch. The single-approve case put the namesake care worker Omar Rahman on the watchlist with one click. Evals reports "No edit was applied without approval: PASS". If this is meant as a point about the agent being the weaker path, nothing on screen says so.
   - Shots: `73_staged_edits.png`, `74_approve_all_checkpoint.png`, `75_evals_after_approve_all.png`.

4. **The phone-search Checkpoint can be avoided with a partial number** — security-honesty / guide mismatch
   - Steps (guide 1.3.4): type `+357` in Graph Explorer search. Then, as Patrol officer, type `118890`.
   - Expected: a Checkpoint for searching by phone.
   - Actual: `+357` opens no Checkpoint; the check only fires at 7 or more digits. `118890` (6 digits, the end of Kareem's number) returns Kareem Haddad and DEV-KH-01 without any Checkpoint (it is logged only as `graph.search`). The full number does open the Checkpoint.
   - Shots: `12_phone_search_checkpoint.png`, `15b_partial_phone_Pat.png`.

5. **"Hash chain verified" survives truncation, a forged "dropped" note and a hidden clear** — security-honesty
   - Steps (devtools, in Oversight): (a) edit one justification; (b) delete the last 120 events; (c) delete the first 80 events and set `audit:meta.anchorHash` to event 80's hash; (d) as **Auditor**, *Clear audit* with the reason `x`, then write the old log back.
   - Expected: (a) to (c) detected; clearing limited to an instructor.
   - Actual: (a) is detected ("broken at ev-000019"). (b) shows "verified · 219 events", even though `meta.lastSeq` still records the higher number. (c) shows "verified · 259 events · 80 older events dropped (cap 5000)", a false explanation because the cap was nowhere near reached. (d) any Oversight role can clear the log with a one-letter reason, and writing the backup back erases the `audit.clear` event and verifies cleanly. The glossary admits that the log can be cleared, but the green "verified" badge promises more than it delivers.
   - Shots: `91_tamper_edit_detected.png`, `92_tamper_tail_truncation.png`, `93_tamper_head_drop.png`, `99_clear_audit.png`.

## B. Other security-honesty and design points

6. **Object IDs contain phone numbers** — security-honesty. `person::c-silva-30131994523`, `person::tomas-orlov-971106977991` and `person::e-orlov-33919795579` are shown to the analyst (no TELECOM) in the Objects list and the instance editor, and to the Auditor in Oversight. C. Silva's withheld phone number is +30131994523, which is exactly the ID suffix. Shots: `08_CSilva.png`, `09_patrol_csilva.png`.
7. **The Checkpoint shows what it guards before you answer it** — design question. The expansion Checkpoint lists `location::14-seabright-ave-limassol`, `location::88-marina-free-zone-dubai` and others under "Items involved", before any justification is given. The inspector also shows the IDs of withheld ping records in "Merged from" (`ping:PG-0002`…). Shot: `10_checkpoint_expand.png`.
8. **Removing HEALTH exposes patient rows to every role, including the Platform contractor** — design question. `clinic_registrations.csv` carries only HEALTH, not PII, so after the DPO removes it the contractor ("open data only") sees names, dates of birth and home addresses. Shot: `45_contractor_clinic_rows.png`.
9. **A removed marking cannot be put back in the app** — bug / guide mismatch. Guide 2.3 says "ask students to undo this before 2.4", but there is no restore control, and *Reset dataset* leaves `markingOverrides` in place. I had to edit `dc-palantir:governance` by hand, which was not logged either.
10. **Any role, including the Platform contractor, can move the global merge threshold** — design question. As contractor I set 0.30 (5 merges). The change is logged but needs no Checkpoint. The contractor also reads the analyst's free-text unmerge reason ("care worker is not the broker"), so free text gets past the markings. Shot: `59_contractor_threshold_030.png`.
11. **Instructor controls are open to every role** — design question. Strict checkpoints, Failure mode and *Clear audit (instructor)* need no instructor identity (see 5d).
12. **Justifications are only checked for length** — design question (probably intended). Strict mode accepts 40 × `a`; the marking removal accepts `zzzzzzzzzzzzzzzzzzzz`; R3 accepts a filler sentence. Ten spaces are rejected.
13. **An object set shared with Patrol carries FIN-derived selection, and Patrol can edit it** — design question. The set says "0 withheld", although membership came from a rule over bank transfers. Shot: `86_object_set_patrol.png`.

## C. Guide mismatches

14. **1.1:** the Patrol view lists only FIN as withheld, not "(and HEALTH)". Shot: `02_patrol_scenario.png`.
15. **1.3.1:** as analyst (TELECOM withheld) there is no *Expand devices & locations* button, only "withheld — marking TELECOM". I had to switch to Patrol. Shot: `06_haddad_inspector.png`.
16. **2.1.2:** `resolved_persons` shows *Purpose: Financial crime*; only the legal basis is "Not recorded". Shot: `33_resolved_persons.png`.
17. **2.5.3:** with Karlsruhe on and Purpose Financial crime, no Analytics rule shows a "Blocked by rule R2" card, for any role or purpose (HEALTH marked, threshold 0.75). Shot: `61_karlsruhe_analytics.png`.
18. **3.4.5:** the R2 effect on Leads can't be seen. Only the analyst can choose *Financial crime*, and the analyst already can't see HEALTH. The DPO's only purpose is *Oversight*. No R2 note appears. Shot: `83_analyst_lead_karlsruhe.png`.
19. **3.3.3:** reversed. Patrol gets a **Checkpoint** for the depth-4 expansion and then one DENIED step (FIN). The analyst gets two DENIED steps and **no** Checkpoint. Shots: `77b_patrol_agent_cp.png`, `77_patrol_denied_step.png`, `78_analyst_phone_checkpoint.png`.
20. **3.1:** "Summarise Omar Rahman" also stages *Add to watchlist* for the care worker. The guide doesn't mention this, and it is a trap students will walk into (see 3).

## D. Bugs and polish

21. **The resolution record contradicts the merge** — bug. The person merged at 0.55 still shows "Matched by passport · confidence 1.00". Build says "Omar Al-Rahman … now merged into Omar Rahman b. 1979-02-02", while Investigate keeps `person::n5538219` (Al-Rahman) as the representative. Shots: `52_resolution_055.png`, `55_dpo_omar_merged.png`.
22. Markings table shows a raw `null (carried by this dataset)` in INHERITEDFROM. Shot: `41_markings_clinic.png`.
23. The Insight panel and the "Add selected:" object-set button fall back to a stale "Athens International Airport". Shots: `05_search_haddad.png`, `85_object_sets.png`.
24. As Patrol, the scenario "Investigate the shared address hub" becomes "Geneva Business District", rated **HIGH** with 1 node and 0 edges. Shot: `02_patrol_scenario.png`.
25. Withheld totals appear as zeros in the key facts ("0 accounts, $0 linked transfers") for Patrol, which reads as a fact rather than an absence. Shot: `02_patrol_scenario.png`.
26. Every keystroke in search is a separate audit event (`+9`, `+97`, `+971`), which floods Oversight.
27. Lineage shows empty `aliases` values (marked "ping alias") for Omar Rahman, while Investigate shows "Umar Rahman". Flights show "No source rows recorded". Shot: `35_lineage_omar_person.png`.
28. Agent sentence lists 5 places but cites 6 (Larnaca Marina is cited, not named). Shot: `77_patrol_denied_step.png`.
29. Build header shows 144 objects / 257 links for every role (not role-filtered).

## E. Things that held up (for balance)

- The role is checked again when you commit: with a DPO marking-removal Checkpoint open in tab 1, I switched to Platform contractor in tab 2 and pressed Continue in tab 1. The removal was refused and logged as contractor. Shot: `97_two_tab_marking.png`.
- Editing one audit event is detected. Shot: `91_tamper_edit_detected.png`.
- The glossary and deployment page state plainly that roles "model access control … do not enforce it" and that devtools show every seed row. This is accurate: `demo/seed.js` contains Kareem's phone number and the Oak Lane address several times.
