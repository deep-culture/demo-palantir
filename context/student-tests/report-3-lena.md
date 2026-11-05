# Governance by design, tested by a lawyer: a report on the Palantir-style teaching tool

*Lena, LLM European and International Law, University of Amsterdam*

## What I did

I followed the runthrough step by step across all three sessions, in a fresh browser at 1440×900, and took screenshots of most steps. For Session 2.4 and for Session 3 I opened clean profiles, because the marking removal from 2.3 could not be undone. I read every discussion card and the whole glossary, and I checked the cards' sources wherever I could reach them. The sandbox blocked map tiles, so the Map tab showed a grey background.

## Session 1: seeing, asking why, acting

As patrol officer, Jelena Markovic's scenario scored 14, with "$0 linked transfers" and a hatched *withheld — marking FIN* box. As analyst she scored 22, and her telecom data disappeared instead. The "Why can't I see this?" line names the marking and the roles that hold it. There is no neutral view of a person, only views that depend on your role.

Withholding is leakier than it looks, and legally that matters. As analyst I could not see Kareem Haddad's phone, yet his resolution record listed "ping:PG-0002" and other ping records he was merged from. Clara Silva's inspector told the analyst that her home address and clinic code were withheld under HEALTH. In the Leads tab the analyst sees a row labelled "clinic registrations — HEALTH withheld" for the care worker Omar Rahman. Under Article 9 GDPR, the fact that someone is registered at a clinic is itself health data. Hiding the content while announcing that the person has a clinic record is not purpose limitation. It is a hint.

The Checkpoint lesson came through clearly. "routine" opened Haddad's devices and seven places, and the record kept my exact words. Strict mode demanded 40 characters and a purpose. The search Checkpoint was weaker than the runthrough claims. Typing `+357` triggered nothing. A full number triggered a Checkpoint only after I pressed Enter. The partial string `+971` returned three people and their handsets with no Checkpoint at all. Typing less bypasses the safeguard.

The Action drawer is excellent teaching material. Adding Daniel Wu to the watchlist showed the parameters, the role check, the Checkpoint, the purposes, a before/after diff and the exact border-watch message. Analytics then listed him with the honest footnote that the rule "cannot tell an Action's tag from a source tag". Removing him sent an UNWATCH message. That is a nice echo of the duty in Article 19 GDPR and Article 16(6) of the Law Enforcement Directive to tell recipients about a rectification. Yet the border inbox still kept the original WATCH line, so "both changes are reversed" holds only inside the platform. The refusal to remove Kareem's source tag showed something else: "correcting a source is not an Action here". The tool has no route at all for a data subject's right to rectification, access or erasure. Nobody in this system can ask what is held about them.

## Session 2: where the picture comes from

The dataset governance panels are the most legally literate part of the tool. Clinic data cites Article 9(2)(h) GDPR and the 20-year retention period of the Dutch medical-records law (WGBO). Location pings cite Article 6 of the ePrivacy Directive, and bank data cites Article 40 of the Anti-Money Laundering Directive. A derived dataset says its legal basis is "Not recorded". Two of these bases are outdated, though. The flight manifests claim "five-year retention" under the PNR Directive, without the limits the CJEU set in *Ligue des droits humains* (2022). Beneficial owners sit in an OPEN "public company register, open by law", although *WM and Sovim* (2022) struck down general public access to beneficial-ownership registers. The runthrough says `resolved_persons` has no recorded purpose. It actually shows "financial-crime", so health data now carries a law-enforcement label. The retention clock made the copies problem concrete. After six months, 20 pings had expired, but 13 people, 79 links and 18 leads built from them remained.

The marking exercise exposed the most serious design problem. As data protection officer I removed HEALTH from the clinic dataset with a one-line Article 9(2)(g) justification. The only purpose on offer was "Oversight". The clinic dataset carried no other marking, so its rows became visible to every role, including the **Platform contractor**. I could read patient names, dates of birth and home addresses as the vendor's maintenance role. The recorded legal basis stayed "Art. 9(2)(h)". No second person approved, and there is no undo, so the runthrough's "ask students to undo this" is impossible. Giving the DPO this power is also a legal mistake. Under Articles 38 and 39 GDPR the DPO advises and monitors. A DPO who personally lifts protections has exactly the conflict of interest that Article 38(6) forbids. This would make a strong discussion prompt if the tool flagged it.

Entity resolution was the best exercise of the course. At 0.60 the genuine duplicates merged. At 0.55 the watchlisted Omar Al-Rahman merged with a Birmingham care worker, and the explanation laid out the arithmetic: +0.45, +0.15, −0.15, +0.10. The merged person then showed the care worker's address. Three details deserve criticism:

- The merged record still said "Matched by passport · confidence 1.00" while listing two different passport numbers.
- The weights table has no penalty for conflicting passports, which is the strongest evidence that two records are different people.
- The analyst, the person with an interest in more hits, could move the shared threshold without any Checkpoint.

## Karlsruhe mode and the legal framing

The cards held up well against their sources. The German Constitutional Court (BVerfG) card matches the court's press release: Hamburg's provision void, Hesse's in force until 30 September 2023. Verfassungsblog supports the later developments it lists. The ICE card matches NPR: Medicaid data reached Palantir via a Teams chat, and Palantir says it was "purged". The Maven figures match DefenseScoop. Three cards slip, though. Nothing in the NHS card's only source supports the British Medical Association claim or the point that Palantir's "not the controller" position is contested. The Raffinaderij card says de Volkskrant made the Open Government Act (Woo) requests, but its source credits an earlier appeal by Buro Jansen &amp; Janssen. That card and the POL-INTEL card also attach Dutch and Danish *defence* plans to replace Palantir to the police platforms.

Karlsruhe mode is honestly labelled a "teaching extension", an "abstraction of the ruling's logic, not its text", which is fair. But a placeholder, "[to verify against the press release before teaching as the court's criteria]", is visible to students on every rule card. More substantively, the three rules are not the court's tests:

- **R1** (state a purpose) is the thinnest form of purpose limitation.
- **R2** (no health data for law enforcement) comes from Article 9 GDPR and Article 10 LED, not from a judgment about data the police already held. As an absolute ban it is stricter than EU law.
- **R3** ("beyond the first hop" needs a 30-character danger statement) accepts thirty "x" characters.

The court asked the *legislature* for clear limits on data types, methods and thresholds, with an identifiable danger to weighty interests. Its interim order did require a written reason for each use, so the Checkpoint is closer to Karlsruhe than the card implies. But a character count cannot test "sufficiently specific facts". From a clean state, the "Blocked by rule R2" card of step 2.5.3 never appeared in Analytics. It appeared only after earlier actions had tagged a clinic patient, and then it blocked the whole ranking. "Request exception" was granted instantly to the analyst who asked, although it said it was "recorded as an exception for the data protection officer". Students should be told.

## Session 3: who is in the loop

The agent's trace, citations and denied steps made the "human in the loop" question tangible. Asked only to *summarise* Omar Rahman, it staged an Add to watchlist on the care worker because of name and route similarity: guilt by namesake at the default threshold. "Approve all" added two people to the watchlist, one of them a clinic patient whose border message read "passport —". There was **no Checkpoint**, where my manual Action had required one. So the agent route is lighter than the manual route, which contradicts the runthrough's claim that the agent goes through the same Checkpoints as your own clicks. The fabricated link also implicated the innocent Omar Rahman. The runthrough has step 3.3.3 backwards: the patrol officer met the Checkpoint and expanded to ten people at depth 4, while the analyst was simply denied.

Leads delivered the ELITE lesson starkly. Four clinic patients topped the list, with the care worker at 85.8. Oversight's hash-chained, filterable record of my justifications, plus the redaction exhibit, closed the course well. It also showed that the Auditor, who may see only OPEN data in the apps, reads names and justifications in the log.

## Assessment

For law and politics students this is the best hands-on material I have used. It turns markings, purpose limitation, false merges and rubber-stamping into experiences rather than doctrine, and its honesty labels are mostly earned. Its weaknesses are fixable but real:

- withholding still reveals health status;
- removing a marking exposes everything to the vendor role, and the DPO is cast as the decision-maker;
- the bulk-approval path skips Checkpoints;
- several runthrough steps do not reproduce;
- Karlsruhe mode needs a clearer line between what the court held and what EU data protection law requires.

Above all, the tool models controls on the operator. The people who carry the cost of errors (the care worker, Daniel Wu, the clinic patients) have no voice, no notification and no remedy anywhere in it. That absence is itself the lesson, and it should be named.
