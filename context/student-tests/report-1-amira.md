# Reflective report: three sessions with the Palantir-style teaching platform

*Amira, MA Digital Humanities, University of Amsterdam*

## Starting position

I come from history and media studies, with spreadsheets and one Python course behind me, and had never used an investigation platform. I followed the runthrough step by step in a fresh laptop browser, noting every point where guide and screen disagreed. Map tiles did not load in my environment, so the Map tab was a grey background with pins; I mention it here once and leave it aside.

## Session 1: the analyst's chair

The first exercise was the one that made the whole unit click for me. As a patrol officer, the scenario "Trace the risk-tagged operator" (Jelena Markovic) showed score 14, "0 accounts" and "$0 linked transfers", with a hatched box reading *withheld — marking FIN* and a "Why can't I see this?" line naming the roles that could. Switching to financial-crime analyst gave score 22, four accounts and $23,460, but now the devices were hatched out under TELECOM. The point was very clear: there is no neutral view, only views assembled for a role. Reading Bowker and Star, I had thought of classification as something that happens to records. Here it also happens to the person looking at them.

Following Kareem Haddad led me to C. Silva, whose amber resolution note ("Created from a location ping only · confidence 0.35", "may be the same person as Clara Silva") is a small, concrete example of infrastructure deciding who exists.

The Checkpoint step is where I first got stuck. The runthrough says to stay as analyst and click **Expand devices & locations**, but as analyst that button does not exist: the whole section is withheld under TELECOM. I only found it by guessing and switching to patrol officer. There, `routine` got me through. With **Strict checkpoints** on, `routine` was refused ("choose a purpose and write at least 40 characters"). The phone-number search did not behave as described either: `+357` did nothing, and none of the phone numbers I later saw in the data began with +357. Only a full number (+971501118890) produced the line "looks like a phone number" and a button that opened the Checkpoint. I also noticed that every keystroke of a search was logged as a separate event ("+97", "+971"), which made "every click becomes data" very literal.

The Action drawer for adding Daniel Wu to the watchlist was the most instructive screen in the tool. It shows the role check, Checkpoint, purposes, a before/after table and the exact message for the "Border watch system". After I ran it, the message sat in the External systems panel and the Watchlist operators rule listed Daniel Wu at score 8, with a footnote: "The rule cannot tell an Action's tag from a source tag: the analysis feeds on what it produced." I put him there, and the rule then "found" him. That sentence is the one I will remember from this course. Removing him reversed both changes. Trying to remove Kareem Haddad, though, gave me no visible refusal: the button stayed active, nothing on screen changed, and only the audit strip said "not-applicable".

Oversight refused me as analyst and said the attempt was logged. This contradicts the landing page, which tells Session 1 students to "open Oversight and read your own trail".

## Session 2: underneath the screen

Build was harder to read: small monospace text on black, and a pipeline graph wider than my screen. In the transform inspector the underlined dataset names lose their underscores, so `norm_watchlist` looked like "norm watchlist". The content, however, was strong. `resolved_persons` has legal basis "Not recorded: this derived dataset combines inputs collected for other purposes", although, unlike the guide, its purpose is not "not recorded" but "Financial crime". I found that more disturbing than the guide's version: the derived table has acquired a new purpose that none of its sources had.

The retention clock worked as promised (+6 months, 20 of 20 ping sample rows past retention, and "Still present downstream: … leads (18 leads)"). But as analyst I could not see the greyed rows, because the rows themselves are withheld. Again the guide forgot to say which role to use.

Removing the HEALTH marking was refused for the analyst and allowed for the data protection officer once I had written at least 20 characters. Afterwards the clinic rows were listed as visible to "Patrol officer, Financial-crime analyst, Data protection officer, Auditor, Platform contractor". One officer's paragraph opened health addresses to a contractor. Back in Investigate the analyst could now see "41 Oak Lane, Birmingham". The instructor box says to undo this before 2.4, but I could find no restore control. I had to start a fresh browser profile, which also emptied my audit trail.

The resolution exercise was the strongest of the unit. At 0.60 the Singh and Demir duplicates merged; at 0.55 the watchlisted Omar Al-Rahman and the Birmingham care worker became one person, and as data protection officer I saw the watchlisted man with a Birmingham home address and clinic code. The merge explanation added up exactly as described. But some labels confused me. Pairs with visibly different names were scored "name-exact · Same name"; I only understood this later from the explanation sentence, which compares an alias. Build said Al-Rahman was "merged into Omar Rahman b. 1979-02-02", while Investigate showed the merged person as Omar Al-Rahman, born 1984. The same inspector also still said "Matched by passport · confidence 1.00". The care worker simply vanished from the Person list. Unmerging as analyst worked, and the pair then showed "rejected by override".

Karlsruhe mode put red R2 badges on three transforms. But after I had unmerged (as 2.4 tells you to) and restored HEALTH (as the instructor note tells you to), no rule in Analytics was blocked by R2 at all. I only saw the R2 card when I went back to my first profile with the false merge still active. "Request exception" then granted the exception to me, the analyst, at once, although the prompt said it was "recorded as an exception for the data protection officer". R3 refused `routine` but accepted "routine routine routine routine routine" as a "concrete danger". As a lesson about rules that count characters rather than read reasons, this was very effective.

## Session 3: the agent, leads and oversight

The agent's "Plan and trace" panel is clear: every tool call with its arguments and result count, and citation chips on each sentence. The chips are raw identifiers such as `owns_account::person-g5510077-bankaccount-acct-p007`, which are hard to read and probably worse with a screen reader. Clicking an example prompt already runs the agent, so pressing "Ask the agent" as instructed ran it twice. Oversight lists the runs in pairs (-01, -02).

What unsettled me most was that "Summarise Omar Rahman" staged an *Add to watchlist* for the care worker with the tag "dual-use-broker", "the name and a travel route match". This happened after a human had rejected that very merge, and the answer does not mention the rejection.

"Approve all" applied two watchlist additions with one click, sent both to Border watch, and asked for no Checkpoint at all. In Oversight's Action history their Checkpoint column reads "—". The fabricated-link question failed its eval correctly, but clicking the invented citation simply highlighted Omar Al-Rahman, with no hint that the link did not exist. The trace header also printed "failure mode fabricated link (example prompt)", which gave the exercise away. For the phones question the guide has the roles the wrong way round: as patrol officer I got a Checkpoint and then a DENIED step; as analyst I got two DENIED steps and no Checkpoint.

Leads matched the guide closely. As data protection officer the care worker was first at 85.8, with the clinic registration contributing 45.9 points. As patrol officer he fell to seventh at 39.9 with "Oak Lane, Birmingham", and as analyst he had "no visible address". Step 5 could not be done, though: the data protection officer's only purpose is "Oversight", and the other roles cannot see HEALTH anyway. When I clicked his row as analyst, the detail panel stayed on Clara Silva, so the Close lead I ran next closed *her* lead, with no Checkpoint.

Oversight as data protection officer showed my trail with "routine" in the justification column, the bulk approval and the threshold changes, and said "Hash chain verified". With Redact ticked, every cell turned black. The Deployment page is the most honest page in the tool: "the roles model access control; they do not enforce it."

## Assessment

The tool taught me three things a lecture could not: a role's view is constructed and partial; an Action turns an analyst's guess into evidence the system will cite back; and one number in a resolution table can give a care worker a broker's risk tag. The honesty chips, "Why can't I see this?" lines and discussion cards make the politics visible without preaching.

The guide, however, often assumes a role it does not name (1.3, 2.2, 3.4), and in a few places it describes behaviour that the instructed order makes impossible (R2 after the unmerge, the swapped roles in 3.3). For a careful reader these mismatches cost more time than the concepts. Accessibility needs work: graph nodes cannot be reached by keyboard, the fixed audit strip covers the bottom row of the graph, several selects have no label, and the struck-through grey rows and dark-red "HEALTH (removed)" on black are hard to read. I would recommend the tool strongly, after a careful pass on the runthrough.
