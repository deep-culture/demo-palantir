# Runthrough verification: student4 (one fresh Chromium context, OSM tiles blocked)

Date: 2026-11-05. Server: http://127.0.0.1:8077/ (it was down at the start and I restarted it). All three sessions ran in one context, in order. Screenshots are the numbered PNGs in this folder.

Page errors / console errors over the whole run: **none**.

| Step | Result | What I saw |
|---|---|---|
| Before: session strip | OK | Role, badges ("sees OPEN PII FIN LE-SENSITIVE"), Purpose, Karlsruhe mode, Instructor mode, "N audit events · Oversight →". With Instructor mode on, "Strict checkpoints (instructor)" and "Failure mode (instructor)" appear in Investigate, and "Clear audit (instructor)" appears in Oversight. No restore banner. |
| 1.1.1 | OK | Role set to Patrol officer. The Purpose went back to "— none —". |
| 1.1.2 | OK | Investigations → "Trace the risk-tagged operator". The scenario is about **Jelena Markovic** (the runthrough never names the person). |
| 1.1.3 | OK | Patrol: "score 14", key facts "3 companies, 1 devices, accounts and transfers withheld (marking FIN)", a hatched cell "withheld — marking FIN", "6 linked objects and 6 links around this case withheld from your role", "Why can't I see this? … Roles that could see it: Financial-crime analyst, Data protection officer." Transfer summary: "No transfer edges in this scenario." Minor: "1 devices". |
| 1.1.4 | OK | Analyst: "score 22", "4 accounts, $23,460 linked transfers", "withheld — marking TELECOM". The masked ID appears as "c-silva-•••••" in the Objects list and as "person::c-silva-•••••" in Build/the audit strip, not "person::c-silva-•••". Note: the DOM attribute `data-id` still holds the full number (view-source only). |
| 1.2.1 | OK | Search "Haddad" gives 5 nodes. Kareem Haddad clicked. |
| 1.2.2 | OK | "Matched by passport · confidence 1.00", "Merged from 14 records: watchlist:WL-1001, … · 9 records withheld (marking TELECOM)". Confusing: Summary reads "…and 0 devices" although his devices are only withheld. |
| 1.2.3 | DIFFERS | Clara Silva's amber note reads "Anchored by name+dob; a weaker record for C. Silva was kept as a separate person…". For the analyst, **C. Silva's** amber note reads "Withheld (marking TELECOM): the note describes source records your role cannot see." So the C. Silva explanation can't be read in the analyst seat. |
| 1.3.1 | OK | Patrol, Kareem: "Kareem Haddad → 1 device → 7 observed places. Telecom links are not followed until you state a purpose." Button: "Expand devices & locations". |
| 1.3.2 | OK | "State your purpose / You are about to expand from a person to their devices and every place those devices were observed. State the investigative purpose." "routine" + Continue worked. |
| 1.3.3 | OK | "Expanded under Checkpoint record cpr-…. Telecom links now show in scenario, agent and graph views." The graph now shows DEV-KH-01. |
| 1.3.4 | DIFFERS | Typing "+" alone gave no Checkpoint (waited 1.2 s). It appeared at "+9": "You are searching by phone number. State why you need to identify the holder of this number." Typing on to the full number raised a **second** Checkpoint for "+971501118890". |
| 1.3.5 | DIFFERS | As Patrol officer (the runthrough's role at this point): "Not permitted for your role / Your role cannot export ontology data. … Roles allowed: Financial-crime analyst, Data protection officer." As analyst it works: "State the purpose and the recipient". The file had no 41 Oak Lane, phone numbers or ping IDs. |
| 1.3 instructor box | OK | Strict: "Strict checkpoints are on: choose a purpose and write at least 40 characters." Court card present. |
| 1.4.1 | OK | Analyst → Daniel Wu → Add to watchlist. |
| 1.4.2 | OK | Parameters, Role check, Checkpoint "cp-action-sensitive", Purpose rules, Before/after, Writeback "→ Border watch system as it would be sent", all in that order. |
| 1.4.3 | OK | "Applied · ai-… under Checkpoint record cpr-…". |
| 1.4.4 | OK | Border watch system: "WATCH Daniel Wu passport U2286130 tag procurement-network: …". |
| 1.4.5 | OK | Daniel Wu at score 8. "* 1 object risk-tagged by Actions in this session." |
| 1.4.6 | OK | Tag cleared, he drops off the rule. The inbox keeps WATCH and adds UNWATCH. |
| 1.4.7 | OK | Run action disabled: "…This risk tag comes from the watchlist feed, not from an Action in this session, so it cannot be removed here." |
| 1.5.1 | OK | The strip shows the last 3 events and a count ("36 events"). |
| 1.5.2 | OK | "Your role (Financial-crime analyst) cannot open Oversight. This attempt has been logged." |
| 2.1.1 | OK | DAG and the 02 Resolve Persons code are both shown. |
| 2.1.2 | DIFFERS | clinic: "Purpose: Health care", legal basis and "7,300 days". resolved_persons: "Legal basis: Not recorded: this derived dataset combines inputs collected for other purposes (see inputPurposes)." **The input purposes are not listed anywhere** (I checked as analyst and as DPO). The markings list "HEALTH inherited from clinic_registrations.csv", but healthcare is not named as a purpose. "(see inputPurposes)" is a developer field name. |
| 2.1.3 | OK | The Person Omar Rahman shows per-field provenance (source dataset, row, field) and withheld rows. A student can easily click a Flight first, because flights are listed above people. |
| 2.2.1–2 | OK | Patrol, +6 months: "20 of 20 sample rows are past the retention period of 180 days on 2026-10-12"; "past retention" tags shown. |
| 2.2.3 | OK | "13 rows still carry data past retention upstream…"; leads "18 leads still carry…". |
| 2.2.4 | OK | "No date column; retention cannot be applied." ICE/Medicaid line present. |
| 2.3.1 | OK | HEALTH shown on norm_clinic, resolved_persons, ontology_* and leads. Jargon: "(see markingProvenance)". |
| 2.3.2 | OK | "Your role cannot remove markings. This attempt has been logged." |
| 2.3.3 | DIFFERS (minor) | A short text with no purpose first shows "Choose a purpose to continue." The length rule shows only after a purpose is chosen: "This checkpoint needs at least 20 characters (you wrote 9)." |
| 2.3.4 | OK | "HEALTH removed … removed by Data protection officer". The analyst's Leads #1 shows "Omar Rahman  41 Oak Lane, Birmingham  45.9". |
| 2.3.5 | OK | The button is "Restore marking". The prompt reads "You are restoring a marking…". Log: remove refused, removed, restored. |
| 2.4.1 | OK | Default 0.75, everything "separate". Patrol sees "READ ONLY Only Financial-crime analyst and Data protection officer may change…". |
| 2.4.2 | OK | 0.65 merges nobody. 0.60: "Maya Singh … now merged into M. Singh", "L. Demir … now merged into Lena Demir". |
| 2.4.3 | OK | "Omar Rahman b. 1979-02-02 now merged into Omar Al-Rahman … Omar Rahman inherits riskTag: dual-use-broker". |
| 2.4.4 | DIFFERS | Clicking the pair **row** does nothing ("Select a person (a name in the table or the sidebar)…"). You have to click a name. The explanation then matches: +0.45, +0.15, −0.15, +0.10, = 0.55. |
| 2.4.5 | OK | "Omar Al-Rahman merged at 0.55 — 2 source identities" at score 16. Editor: "…cannot be edited here: unmerge first, or raise the threshold." |
| 2.4.6 | OK | DPO editor: Home address "41 Oak Lane, Birmingham", Clinic code CLN-BHM-02, RESIDES_AT link with source "clinic-ehr". |
| 2.4.7 | OK | The merge is pre-filled ("Filled in from the merge currently applied"). Resolution shows "rejected by override / by Financial-crime analyst: '…'". |
| 2.5.1–2 | OK | The R2 badge is on 02 Resolve Persons and other transforms. Banner: "4 datasets in this pipeline combine purposes that rule R2 forbids". |
| 2.5.3 | OK | 3 of 4 show "blocked · rule R2". The button is "Request a self-certified exception". Granted, and listed in Oversight. |
| 2.5.4 | DIFFERS | With DPO + Public order, **every** person's expansion is "Blocked by rule R2" (I checked all 22), so R3 never shows. With Purpose = Oversight: "Karlsruhe mode, rule R3: …", "Describe the concrete danger…", "needs at least 30 characters (you wrote 6)". |
| 2.5.5 | OK | Untick: "4 hits / 8 / 7 / 1". The rule.open payload still lists purposes with "karlsruhe": false. |
| 3 instructor box | OK | Threshold reset with "0.75 (default)". |
| 3.1.1–4 | OK | The trace shows 6 tool calls. Citation chip highlights the node. "They are separate people at threshold 0.75". |
| 3.1.5 | OK | "I staged 'Add to watchlist' for Omar Rahman…". |
| 3.2.1–3 | OK | 2 edits staged (Zane Ionescu, Elias Orlov), "The agent is confident… Approve all to save time." One Checkpoint for both. The log has 1 checkpoint, 2 apply, 1 approveAll (count 2), all with the same cpr ID. |
| 3.2.4 | OK | Both pass: "…approved, but did anyone read them?" |
| 3.3.1–2 | OK | Sentence 2 fails: "'beneficially_owns::person-g5510077-company-co-102' does not exist in the ontology". |
| 3.3 Notice | DIFFERS | "The fabricated link looks exactly like a real one" is not true. Real chips read "[DIRECTS → North Quay Logistics FZE]"; the fake one reads as a raw ID "[beneficially_owns::person-g5510077-company-co-10…]". |
| 3.3.3 | DIFFERS (minor) | As analyst, **two** steps say "DENIED and logged": the TELECOM expand and a "get_links … RESIDES_AT" with "marking HEALTH". Answer: "2 steps were denied". The patrol re-run behaves as written: a Checkpoint, then 1 denied step (FIN). |
| 3.4.1–2 | OK | DPO #1 "Omar Rahman 41 Oak Lane, Birmingham 85.8". Clinic 45.9 plus pings 39.9. |
| 3.4.3 | OK | Patrol "Oak Lane, Birmingham 39.9", 7th. The clinic row is withheld. |
| 3.4.4 | OK | Analyst: "no visible address 0.0". |
| 3.4.5 | OK | "39.9 (full 85.8) … R2". Confusing for the DPO: "1 component withheld" although it was removed by the rule. |
| 3.4.6 | DIFFERS | Karlsruhe is still ticked from 3.4.5 and the analyst's Purpose is cleared, so Close lead gives "Blocked by rule R1 … needs a stated purpose". It works after setting Financial crime (no Checkpoint). |
| 3.5.1 | OK | "Save hits as object set" works (with Karlsruhe on and Financial crime set, Watchlist operators was blocked by R2 even for the analyst, so I unticked it). v1/v2 diff "− 1 removed Elias Orlov". Patrol sees "View only…". |
| 3.5.2 | DIFFERS (minor) | Chain "verified", exceptions present, unmerge and threshold changes present. Denied agent steps are **not red**: they carry a grey "denied" tag. Odd text: "Restored: HEALTH on clinic_registrations.csv by Data protection officer (restored) · on clinic_registrations.csv by Data protection officer (continued)". |
| 3.5.3 | OK | Passports and risk tags are redacted ("riskTag withheld — marking LE-SENSITIVE"), but see the leak below. |
| 3.5.4 | OK | Every cell blacked out. |
| 3.5.5 | OK | The page names GitHub Pages, localStorage, Apollo, on-premises and forward-deployed engineers. |

## Leaks
- Oversight as **Auditor** (sees OPEN only): the passport values are redacted, but object IDs carry the passports: `person::p8842101` appears 28× (Kareem, passport P8842101) and `person::g5510077` 21×. IDs carrying a date of birth (`clara-silva-1977-11-25`) are also shown. Phone-bearing IDs are masked; passport and date-of-birth IDs are not.
- A role sweep (patrol, analyst, auditor, contractor) over every Investigate tab and the Build datasets and lineage found no "41 Oak Lane" and no phone number shown to a role without HEALTH or TELECOM.
