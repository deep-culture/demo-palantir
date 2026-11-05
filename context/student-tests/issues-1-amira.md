# Issues found while following RUNTHROUGH.md

Amira (student tester). Laptop viewport 1440×900, fresh browser profile, Chromium (Playwright). All screenshots are in `shots/`. Severity: **High** = blocks or contradicts a runthrough step; **Med** = confusing or misleading; **Low** = polish.

Environment note (not a tool bug): map tiles are blocked in this sandbox, so the Map tab shows a grey background (`89_map_grey.png`).

## Guide and screen disagree

| # | Step | Guide says | What actually happened | Screenshot | Sev |
|---|---|---|---|---|---|
| 1 | 1.3 step 1 | Stay as Financial-crime analyst; on Kareem Haddad's inspector click **Expand devices & locations**. | As analyst there is no such button: DEVICES & LOCATIONS reads "withheld — marking TELECOM". It appears only for Patrol officer (or DPO). The guide does not say to switch role. | `06_haddad_inspector.png`, `09_patrol_expand_button.png` | High |
| 2 | 1.3 step 4 | Type a number "such as `+357`" into the search box; a Checkpoint appears. | `+357`, `+3579` and `357` give 0 nodes and no Checkpoint, in both roles. No phone number in the sample data starts with +357. Only a full number (`+971501118890`, as patrol) shows an inline line, "looks like a phone number…", with a **Search by phone number…** button that opens the Checkpoint. As analyst, numbers never trigger anything. | `12_phone_search_checkpoint.png`, `15_phone_full_number.png`, `16_phone_checkpoint.png`, `46_pings_rows_greyed_dpo.png` | High |
| 3 | 1.3 step 5 | Export JSON asks for a purpose and a recipient. | As patrol officer: refused ("Not permitted for your role"). As analyst: a Checkpoint asks to "State the purpose and the recipient", but there is only one Justification box and no recipient field. | `13_export_checkpoint.png`, `100_export_analyst.png` | Med |
| 4 | 1.1 | Patrol view shows hatched cells "withheld — marking FIN (and HEALTH)". | The scenario Insight shows only FIN; no HEALTH cell appears in this scenario. | `02b_patrol_trace_scroll.png` | Low |
| 5 | 1.4 step 6 | Remove from watchlist on Kareem Haddad "is refused". | The drawer explains this beforehand, but **Run action** stays enabled. Pressing it changes nothing on screen and shows no refusal; only the audit strip says `not-applicable`. The writeback preview still shows "UNWATCH Kareem Haddad …". | `25_remove_haddad.png`, `26_remove_result_haddad.png`, `27_audit_strip_bottom.png` | Med |
| 6 | Landing page vs 1.5 | Session 1 card: "then open Oversight and read your own trail". | As analyst (the role Session 1 uses), Oversight is refused. The runthrough says so; the landing page does not. | `00_landing.png`, `28_oversight_refused.png` | Low |
| 7 | 2.1 step 2 | `resolved_persons`: "its purpose and legal basis say *Not recorded*…". | Purpose is "Financial crime" / `financial-crime`; only the legal basis says "Not recorded … (see inputPurposes)". There is no inputPurposes field on screen to look at. | `33_ds_resolved.png` | Med |
| 8 | 2.2 step 2 | Open `mobile_location_pings.jsonl`: rows past retention are greyed out. | As analyst (the default role) the rows are withheld under TELECOM ("schema only"), so nothing greyed is visible. I had to switch to DPO to see them. | `39_pings_rows_greyed.png`, `46_pings_rows_greyed_dpo.png` | Med |
| 9 | 2.3 instructor box | "Ask students to undo this before 2.4." | There is no restore or undo control for a removed marking (the Markings panel shows only "HEALTH (removed) … removed by Data protection officer"). The guide says Reset dataset does not restore it. The only route is a new browser profile, which also wipes the audit trail that 3.5 asks you to read. | `45_marking_removed.png` (no restore button anywhere on the panel) | High |
| 10 | 2.5 step 3 | In Investigate → Analytics, rules whose hits include clinic data show a red **Blocked by rule R2** card. | After following 2.4 step 7 (unmerge) and the 2.3 note (HEALTH restored), no rule is blocked by R2 for the analyst with purpose Financial crime. R2 appears only while the false 0.55 merge is active (checked in a second profile). | `60_karlsruhe_analytics.png` vs `62_R2_Watchlist.png` | High |
| 11 | 2.5 / 3.4 | Purpose stays set while switching roles (implied). | Switching role silently resets Purpose to "— none —", because each role offers different purposes (analyst: Financial crime; patrol: Public order; DPO: Oversight). With Karlsruhe on, every rule then shows **Blocked by rule R1**, which the guide never mentions. | `61_blocked_Data_Watchlist.png`, `61_blocked_Patrol_Watchlist.png` | Med |
| 12 | 3.1 step 1 | Press the example **Summarise Omar Rahman**, then **Ask the agent**. | Clicking an example prompt runs the agent at once (Ask is disabled while it runs). Pressing Ask afterwards runs it a second time; Oversight lists runs in pairs (`…-01`, `…-02`), and staged edits can be duplicated. | `102_trace_header_failure_mode.png` (run `-01` with no Ask click), `93_oversight_dpo.png` | Med |
| 13 | 3.3 step 3 | Patrol officer: one step is DENIED. Analyst: the same question "stops at a Checkpoint instead". | Reversed. Patrol: a Checkpoint for the depth-4 expansion (`routine` accepted), then `get_links` DENIED (FIN). Analyst: two DENIED steps (TELECOM and HEALTH) and no Checkpoint. | `82_patrol_phones_checkpoint.png`, `83_patrol_phones_trace.png`, `83_analyst_phones_trace.png` | High |
| 14 | 3.4 step 5 | With Karlsruhe on and Purpose Financial crime, R2 removes the HEALTH component and the card says so. | Not reproducible. The only role that sees HEALTH (DPO) can choose only "Oversight"; analyst and patrol never see the HEALTH component, so the card shows "withheld", not R2. | `85_leads_dpo_karlsruhe.png`, `87_leads_analyst_karlsruhe_fincrime.png` | High |
| 15 | 3 instructor box vs 3.5 | Start Session 3 in a private window, then in 3.5 read a trail including "threshold changes and unmerges". | A private window has an empty log, so the Session 2 threshold changes and unmerge would not be there. (I kept my 2.4 profile, which is why mine showed them.) | `93_oversight_dpo.png` | Med |
| 16 | 3.5 step 2 | Agent runs grouped by run, "denied steps in red". | Grouping is a filter dropdown of run IDs. "denied" is a small dark tag, not visibly red. | `94_oversight_agent_run.png` | Low |
| 17 | 2.4 step 7 | Pair shows **rejected**. | Shows "rejected by override" with the reason. Fine, but the wording differs. | `58_resolution_rejected.png` | Low |

## Bugs and inconsistent behaviour

| # | Step | What happened | Screenshot | Sev |
|---|---|---|---|---|
| 18 | 3.2 | **Approve all** applied two *sensitive* Add to watchlist Actions and sent them to Border watch **with no Checkpoint**. A single Add to watchlist asks for a purpose. Oversight's Action history shows Checkpoint "—" for both. Possibly intended, but the guide does not say so. | `77_after_approve_all.png`, `95_oversight_checkpoints.png` | High |
| 19 | 2.5 | **Request exception** says "The request is recorded as an exception for the data protection officer", yet the analyst's own request is granted instantly ("Exception granted under Checkpoint record …") and the rule then ranks hits. | `63_request_exception.png`, `64_after_exception.png` | Med |
| 20 | 2.4 | The merged person is described in contradictory ways. Build says "Omar Al-Rahman … now merged into Omar Rahman b. 1979-02-02". Investigate shows the merged person as Omar Al-Rahman, born 1984-08-19, with links pointing to `person::n5538219`, plus a "Conflicting values (the representative's is shown)" list. The Resolution section still says "Matched by passport · confidence 1.00" for a 0.55 merge. The care worker disappears from the Person list without comment. | `52_threshold_055.png`, `55_dpo_omar_alrahman_merged.png` | Med |
| 21 | 3.4 step 6 | Clicking the Omar Rahman row in Leads (as analyst) did not change the detail panel, which stayed on Clara Silva. The next **Close lead** therefore closed Clara Silva's lead, without any Checkpoint. | `86_leads_analyst_omar.png`, `88_lead_closed.png` | Med |
| 22 | 3.3 | Clicking the fabricated citation chip selects Omar Al-Rahman like any real chip, with no "link not found" signal. | `79_fabricated_answer.png` | Low (arguably the point) |
| 23 | 3.2 / 3.3 | The trace header prints the scripted failure ("failure mode approve all (example prompt)", "failure mode fabricated link (example prompt)"), giving the exercise away before students read the answer. | `102_trace_header_failure_mode.png` | Med |
| 24 | 3.1 | After the human unmerge in 2.4, "Summarise Omar Rahman" still stages Add to watchlist for the care worker with riskTag "dual-use-broker". The answer explains the pair only by score ("below the threshold") and never mentions the human rejection. | `72_plan_trace.png`, `73_answer.png` | Med (good discussion point, but unexplained) |
| 25 | 3.1 | `get_lineage` returns "not available on this surface (… open Build → Lineage)", although the guide and the agent panel list it as one of its tools. | `72_plan_trace.png` | Low |
| 26 | 1.1 | Analyst Insight says "$23,460 linked transfers", but the Transfer summary panel says "No transfer edges in this scenario". | `101_transfer_summary_empty.png` | Low |
| 27 | 1.3 | Every keystroke in the Graph Explorer search is a separate `graph.search` audit event ("+97", "+971", …), which inflates the trail. | `15_phone_full_number.png` (audit strip) | Low |
| 28 | 3.5 | A set shared with Patrol officer can be edited (× remove) and deleted by Patrol officer, not only viewed. | `92_object_set_patrol.png` | Low |
| 29 | 1.4 | The Watchlist operators footnote says "1 object risk-tagged by Actions in this session", but the table does not mark which row (Daniel Wu) it is. | `24_watchlist_operators_table.png` | Low |

## Unclear wording

| # | Step | Problem | Screenshot | Sev |
|---|---|---|---|---|
| 30 | 2.4 | Pairs with visibly different names are scored **name-exact "Same name"** (M. Singh / Maya Singh; Omar Al-Rahman / Omar Rahman). This only makes sense once you read the explanation sentence, which compares an alias. The weights table says surname+initial applies to "C. Silva ~ Clara Silva", but that pair is scored name-exact. | `50_resolution_default.png`, `53_merge_explanation.png` | Med |
| 31 | 2.5 | The R2 card shows an editorial note to the course team: "[to verify against the press release before teaching as the court's criteria]". | `62_R2_Watchlist.png` | Med |
| 32 | 2.5 | R3 asks for a "concrete danger" (≥30 characters) but accepts "routine routine routine routine routine". Probably the intended lesson, but nothing on screen or in the guide invites students to try it. | `66_karlsruhe_after_routine.png` | Low |
| 33 | 2.3 | The Checkpoint asks students to "State the legal basis", but the field is labelled "Justification" and the only purpose offered is "Oversight". | `43_remove_marking_dpo_cp.png` | Low |
| 34 | 2.3 | The Markings table shows a raw `null (carried by this dataset)` in the INHERITEDFROM column; the legend entry for inherited markings is labelled "ID". | `41_markings_clinic.png` | Low |
| 35 | 1.4 | The Add to watchlist drawer for Daniel Wu lists purposes "Health care" and "Telecom billing" that the analyst cannot see. It is not explained why these are involved. | `19_action_drawer.png` | Low |
| 36 | Landing | There is a study guide for Sessions 1 and 2 but none for Session 3. | `00_landing.png` | Low |

## Accessibility and layout

| # | Where | Problem | Screenshot | Sev |
|---|---|---|---|---|
| 37 | Investigate graphs (Graph Explorer, scenario, answer graph) | SVG nodes (`<g data-action="select-graph-node">`) have no tabindex or role, so they cannot be reached by keyboard or announced by a screen reader. Labels in the scenario graph are tiny and unreadable at 1440px. | `05_search_haddad.png`, `02b_patrol_trace_scroll.png` | High |
| 38 | All apps | The fixed bottom audit strip covers content. In Graph Explorer the bottom row of nodes sat under it, and mouse clicks landed on the strip until I scrolled. | `05_search_haddad.png` | Med |
| 39 | Investigate | The Dataset select, Graph mode select and Type filter select have no programmatic label (visible text is not associated). The search input relies on its placeholder. | (DOM check; visible in `04_graph_explorer.png`) | Med |
| 40 | Build Datasets | Past-retention rows are grey **and** struck through on black. Low contrast and hard to read. | `46_pings_rows_greyed_dpo.png` | Med |
| 41 | Build Markings | "HEALTH (removed)" is dark red, struck through, on black. Very low contrast. | `45_marking_removed.png` | Med |
| 42 | Investigate tab bar | At 1440px the last tab is cut off ("Graph" instead of "Graph Explorer"), with no visible scroll cue. | `01_investigate_initial.png` | Low |
| 43 | Build Pipelines | The DAG is wider than the viewport; `ontology_entities`, `ontology_edges` and `leads` (named in 2.1) are off-screen. Underlined links hide underscores (`norm_watchlist` reads "norm watchlist"). | `30_build_pipelines.png`, `31_resolve_persons_inspector.png` | Med |
| 44 | Investigate Objects | The middle columns are cramped: link targets are cut ("Keys Trad Ltd"), selects are truncated ("LISTED_("). | `08_ClaraSilva.png` | Low |
| 45 | Agent | Citation chips are raw IDs (`owns_account::person-g5510077-bankaccount-acct-p007`). They are hard to read, and a screen reader would read them out literally. | `73_answer.png` | Med |
| 46 | Session strip | The strip reflows differently per role (two rows for patrol and DPO, one for analyst), so controls jump position when you switch role. | `11b_after_expand_top.png` vs `04_graph_explorer.png` | Low |

Positive accessibility notes: Checkpoint and refusal modals use `role="dialog"`/`role="alertdialog"` with `aria-modal` and move focus to the primary button. Remove buttons in object sets have `aria-label`s ("Remove Jelena Markovic"). Build DAG nodes are focusable buttons. The threshold slider is labelled "Merge threshold".
