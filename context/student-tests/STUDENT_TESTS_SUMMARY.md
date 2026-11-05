# Simulated student tests: summary and fix list

Three simulated students each followed `RUNTHROUGH.md` through the live site (Investigate, Build, Oversight, glossary, deployment page) in their own fresh browser, on 4 November 2026. Each wrote a reflective report of about 1,500 words and a list of the problems they hit, with screenshots.

| Student | Background | Angle | Report | Issues |
|---|---|---|---|---|
| Amira | MA Digital Humanities | follows the guide closely; clarity and accessibility | `student1/report.md` | `student1/issues.md` (46) |
| Joris | BSc Computer Science | probes edges, devtools, two tabs, tampering | `student2/report.md` | `student2/issues.md` (29) |
| Lena | LLM European law | legal framing; checks the case-study sources | `student3/report.md` | `student3/issues.md` (33) |

**Overall verdict.** All three found the tool valuable:

- Lena called it "the best hands-on material I have used" for law and politics students.
- Entity resolution (the 0.55 namesake merge, with its arithmetic) was the strongest exercise for all three.
- The Action drawer and the leads/health-data moment were close behind.

The weaknesses are of two kinds. Several runthrough steps don't reproduce as written. And in a few places the tool breaks its own governance rules, which matters because those rules are the lesson.

---

## A. The tool breaks its own rules (fix first)

1. **Approving the agent's staged edits skips the Checkpoint** (all three). A manual *Add to watchlist* asks for a purpose; *Approve* or *Approve all* on the agent's edits does not, yet still sends the writeback to Border watch. Evals then reports "No edit was applied without approval: PASS". *Fix:* make Approve and Approve all run the same Checkpoint, so that bulk approval asks once and logs the count, or deliberately make the bypass visible as a teaching point. Either way, the runthrough's claim of "same Checkpoints" must match.
2. **Export JSON leaks HEALTH and TELECOM data through the `leads` block** (Joris). Entities are redacted, but `leads.items[].components` contains all clinic home addresses (including "41 Oak Lane") and the ping addresses. *Fix:* redact leads (and every other block) through the role view before export. Add the export to the leak sweep.
3. **The Objects (schema) editor gets around Actions, Checkpoints and the audit log** (Joris). Typing a risk tag puts a person on the Watchlist operators list. Deleting a source WatchlistRecord isn't refused. Neither is logged, and *Reset dataset* isn't logged either. *Fix:* make governed properties (riskTag, reviewFlag, lead status) read-only in the editor with a pointer to the Action. Log object and link edits and resets. Refuse to delete source records.
4. **"Withheld" still reveals that a record exists** (Lena, Joris).
   - Resolution records list ping IDs to a role without TELECOM.
   - Leads shows "clinic registrations — HEALTH withheld" to roles without HEALTH.
   - Lineage lists `norm_clinic_registrations row 9`.
   - Some Person IDs contain phone numbers (`person::c-silva-30131994523`).

   Being in clinic data is itself health data. *Fix:* redact `mergedFrom`, lineage row references and component labels by marking ("1 source withheld"), and hash or neutralise phone-derived IDs in the display. This could also be a discussion point ("absence as signal"), but only if the tool says so.
5. **Marking removal over-exposes the data and cannot be undone** (all three).
   - Removing HEALTH leaves the clinic dataset with no marking at all, so even the Platform contractor reads patient names, dates of birth and addresses.
   - There is no restore control, although the runthrough tells instructors to undo the removal.
   - The legal basis doesn't change, and the only purpose offered is "Oversight".

   *Fix:*
   - Give clinic rows PII as well as HEALTH, so a removal drops only HEALTH.
   - Add a **Restore marking** action (logged).
   - Consider a second approver.
   - Add a discussion note: a DPO who lifts protections has the conflict of interest GDPR Article 38(6) forbids. Or rename the role "Privacy officer (acting controller)".
6. **The audit chain misses truncation, and anyone can clear it** (Joris).
   - Deleting the last 120 events still shows "verified".
   - Deleting the first 80 is explained as "dropped (cap 5000)", which is untrue.
   - The Auditor can *Clear audit* with the reason "x", and writing a backup back erases the record of the clear.

   *Fix:* check `meta.lastSeq` against the chain's length, keep a head anchor, and only claim a cap drop when the cap was actually reached. Make the instructor controls (Strict, Failure mode, Clear audit) need an explicit instructor toggle. Keep the honest label that this is a model, not tamper-proof storage.
7. **The phone-search Checkpoint can be avoided** (all three). It fires only at 7 or more digits and only on Enter; `+971` or a 6-digit tail finds people with no prompt. Every keystroke is also a separate audit event. *Fix:* trigger at 4 or more digits or any `+` prefix, debounce the search logging, and correct the runthrough example (no number starts with +357).
8. **"Request exception" grants itself** (Amira, Lena). It says the exception is recorded "for the data protection officer", but the analyst's own request takes effect immediately. *Fix:* either queue the exception for DPO approval, or say plainly that it is self-certified and logged, which is itself a teaching point.

## B. Runthrough steps that don't reproduce (fix in the guide, sometimes in the tool)

| Step | Problem | Fix |
|---|---|---|
| 1.3.1 | The analyst has no *Expand devices & locations* button (TELECOM is withheld) | Do 1.3 as **Patrol officer** |
| 1.3.4 | `+357` matches nothing | Use a real full number (e.g. Kareem's), and explain the partial-number gap or fix it (A7) |
| 1.1 | Patrol sees only FIN withheld, not "(and HEALTH)" | Drop "(and HEALTH)" |
| 1.4.6 | "Both changes are reversed": the WATCH message stays in the inbox; Run action stays enabled on the refused source tag | Rephrase; disable Run when refused |
| 2.1.2 | `resolved_persons` shows Purpose "Financial crime"; only the legal basis is "Not recorded" | Fix the text (and question the default purpose) |
| 2.2.2 | As analyst the ping rows are withheld; greyed rows only show for Patrol or DPO | Switch to Patrol or DPO for 2.2 |
| 2.3 | Removal cannot be undone | Add Restore (A5), or have 2.4 start in a fresh window |
| 2.5.3 | No "Blocked by rule R2" card in Analytics from a clean state | Show R2 on a rule whose hits touch clinic data (e.g. at 0.55), or reword the step to use the Action drawer, where R2 does fire |
| 3.1 | "Summarise Omar Rahman" also stages *Add to watchlist* for the care worker | Mention it; it's a good trap |
| 3.3.3 | Roles reversed: Patrol gets the Checkpoint, the analyst is denied | Swap the roles in the text |
| 3.4.5 | The R2 effect on leads can't be seen: only the DPO sees HEALTH, and the DPO can only pick "Oversight" | Give the DPO a law-enforcement purpose for testing, or demonstrate it after a marking removal |
| 3 box / 3.5 | A private window has an empty log, so Session 2's threshold changes aren't in Oversight | Say so, or keep the same window and reset only the threshold |
| Landing | The Session 1 card says "open Oversight and read your trail", but the analyst is refused | Fix the card text |
| Switching roles | Switching roles silently resets the Purpose | Note it in the guide, or keep the purpose when the new role has it |

## C. Facts and legal framing (Lena)

- **NHS card:** the BMA claim and "contested in practice" aren't in the cited source (that source has the minister saying NHS bodies remain the controllers). Add a source or drop the claims.
- **Raffinaderij card:** the source credits the original appeal to Buro Jansen & Janssen, with de Volkskrant reporting. The "Defence plans an alternative" line belongs to a Euronews defence story, not the police platform.
- **POL-INTEL card:** Denmark's search for replacements concerns its defence deal, not POL-INTEL.
- **Visible "[to verify …]" placeholder** on the glossary and every rule card: remove it, or rewrite it for students.
- **Glossary source labels:** the BVerfG, Gigazine and OCCRP Aleph sources are mislabelled "Palantir documentation".
- **Karlsruhe mode:**
  - R2 reflects GDPR Article 9 and LED Article 10 more than the 2023 judgment, and as an absolute ban it is stricter than EU law.
  - R3's length check accepts filler text.
  - The ruling addressed the legislature.

  Rewrite the rule notes to say what each rule abstracts and what it doesn't.
- **Illustrative legal bases are outdated:**
  - The PNR "five-year retention" ignores *Ligue des droits humains* (CJEU 2022).
  - Beneficial owners marked OPEN ignores *WM and Sovim* (CJEU 2022).
- **Data-subject rights are absent** (access, rectification, erasure, notification). Name this on a discussion card rather than silently leaving it out.

## D. Design and polish

- **Merged person contradictions** (all three): the merged record still says "Matched by passport · confidence 1.00" while listing two passports, and Build and Investigate name the merged person differently. Add a **passport-conflict** penalty signal (or make it a discussion point), and show "merged at 0.55" in the resolution record.
- **Any role can move the shared threshold, even the contractor.** Restrict it to the analyst and DPO, or put a Checkpoint on it.
- **The trace header gives the failure mode away** ("failure mode fabricated link (example prompt)"). Show it only to the instructor.
- **Shared object sets** can be edited and deleted by the role they're shared with, and carry a selection derived from FIN data.
- **Accessibility:**
  - Graph nodes have no tabindex or role.
  - The fixed audit strip covers content.
  - Several selects have no labels.
  - Struck-through grey or red on black is low contrast.
  - Citation chips are raw IDs; use readable labels with the ID in a tooltip.
  - The tab bar is cut off at 1440 px.
- **Smaller bugs:**
  - A raw `null (carried by this dataset)` in the Markings table.
  - "No transfer edges" shown next to "$23,460 linked transfers".
  - A stale "Athens International Airport" fallback in the Insight panel.
  - The Leads detail panel doesn't follow the clicked row, so Close lead closed the wrong lead.
  - The Build header counts aren't role-filtered.
  - The example prompts run on click, so pressing Ask runs them twice.

## E. What held up

- The role is checked again on commit: Joris switched role in a second tab mid-Checkpoint and the removal was refused.
- Editing an audit event is detected.
- The modals are accessible (dialog roles, focus moved to the primary button).
- The glossary and deployment page are honest that roles model access control rather than enforce it.
- My leak sweep and the students' screen checks agree: on screen, no non-DPO role sees "41 Oak Lane". The leaks they found are in the export file and in metadata (A2, A4).
