# Runthrough: three sessions with the Palantir-style platform

This is the step-by-step route through the teaching tool for three 90-minute sessions. Each step says what to do, what you should see and what to notice. Questions for discussion close each part. Instructor notes are set apart in boxes.

The tool runs on synthetic data. Nobody in it is real. The case-study cards describe real institutions and public reporting, and each card says so.

---

## Before you start

**Open the site.** Use the course URL on GitHub Pages, or run a local server from the repository folder:

```bash
cd demo-palantir
python3 -m http.server 8000
```

Then open `http://127.0.0.1:8000/`. Opening the HTML file directly (by double-clicking) does not work: the apps need a server.

**The four pages.**

| Page | What it is | Background |
|---|---|---|
| Landing page (`/`) | Session cards, guides, glossary | white |
| **Investigate (Gotham-style)** (`/demo/`) | The analyst's workspace: graph, map, rules, Actions, agent, leads | white |
| **Build (Foundry-style)** (`/foundry-demo/`) | The engineer's workspace: pipelines, datasets, lineage, markings, resolution | black |
| **Oversight** (`/audit/`) | The audit trail. It sits outside both workspaces on purpose | black |

**The session strip.** A strip under the purple header appears in every app. It shows:

- **Role.** Patrol officer, Financial-crime analyst (the default), Data protection officer, Auditor, Platform contractor. The badges next to it show which markings the role can see.
- **Purpose.** The purpose you state for this session. Each role holds its own purposes; switching to a role that does not hold the current purpose clears it, so check the Purpose after every role switch.
- **Karlsruhe mode**, and **Instructor mode**. Instructor mode reveals **Strict checkpoints**, the agent's **Failure mode** (Investigate) and Oversight's **Clear audit**. Turning it on or off is logged. It is a classroom convenience, not access control.
- A count of audit events, with a link to **Oversight**.

The role you choose follows you into the other apps.

**Honesty chips.** Every panel title carries a chip:

- **Mirrors Palantir/Gotham/Foundry:** the behaviour follows Palantir's documented concept.
- **Simplified:** the concept is real but the implementation is a stand-in.
- **Teaching extension:** it goes beyond what Palantir documents, to show something.

Click a chip to open its entry in the glossary.

> **Instructor: resetting between groups.** Everything a student does is stored in their own browser (localStorage). Nothing is shared between students, and nothing goes to a server. *Reset dataset* (Investigate header) clears ontology edits and Action effects. Shared settings (threshold, unmerges, marking removals) and the audit log survive it. For a clean start, use a private window, or clear the site's data in the browser settings. A private window also starts with an empty audit log, so a student's trail from an earlier session will not be in it. Oversight's *Clear audit* (Instructor mode, with a reason of at least 10 characters) empties the log and records that it did. A DPO can also undo a marking removal with **Restore** (Build → Markings, or Oversight).

---

## Session 1 — Investigate: what the system lets you see and do

**Goal.** Experience an investigation from the analyst's chair, and notice that what "the system knows" depends on who is asking, that sensitive steps ask *why*, and that every click becomes data.

### 1.1 The same case, two seats (15 min)

1. Open **Investigate**. Set **Role** to **Patrol officer**.
2. Open the **Investigations** tab and pick **Trace the risk-tagged operator**.
3. Read the scenario card and the **Insight** panel on the right: the key facts, the score, the linked companies, accounts and devices.
4. Now switch **Role** to **Financial-crime analyst** and look at the same scenario again.

**What you should see.**

- **As patrol officer:**
  - The bank accounts and the transfer total are missing, and the score is lower.
  - The inspector lists what is **withheld from your role**: grey hatched cells reading *withheld — marking FIN*.
  - A line answers **"Why can't I see this?"**, naming the marking and the roles that could see it.
  - The header counts the objects and links withheld.
- **As analyst:** you see the money. Phone numbers, handsets and pings are now withheld instead (the TELECOM marking). Even object IDs that contain a phone number are masked (`c-silva-•••••`).

**Notice.** Neither view is "the" picture. Markings are mandatory labels that travel with the data; a role sees only what all its markings allow. Withheld things are counted, not silently removed. But naming the marking is itself a signal: "withheld — marking HEALTH" tells you there is health data about this person.

### 1.2 Following a person (15 min)

1. Stay as **Financial-crime analyst**. Open **Graph Explorer** and search for *Haddad*. Click **Kareem Haddad**.
2. In the inspector, read his **markings**, his **resolution** record ("Matched by passport · confidence 1.00") and the records he was **merged from**.
3. Open **Objects**, choose **Person**, and look at **C. Silva** and **Clara Silva**. Both show an amber **Resolution note**. Read Clara Silva's: it explains the split. C. Silva's own note is withheld from the analyst, because it describes phone records (TELECOM).

**Notice.** The system decided that some rows from different files are one person, and that others are not. C. Silva (seen only in phone pings) and Clara Silva (from the company register) stayed two people, because the first record that arrived had too little to match on. The order in which data arrives shaped who exists in the system.

### 1.3 A sensitive step asks why (15 min)

1. Switch **Role** to **Patrol officer** (the analyst cannot see telecom data, so has no expansion button). Open Kareem Haddad's inspector and click **Expand devices & locations**.
2. A **Checkpoint** opens. Read the prompt exactly as shown. Type `routine` and press **Continue**.
3. The graph expands to his devices and every place they were observed.
4. Now try a search by phone number: in **Graph Explorer**, start typing Kareem's number, `+971501118890`. The Checkpoint appears as soon as you type a `+` and a digit, or four digits, before you press Enter; typing more of the number asks again. Searching by phone number counts as telecom access even when you only know part of the number.
5. Try **Export JSON** in the header as well. As patrol officer it is refused: *Your role cannot export ontology data*. Switch to **Financial-crime analyst** and try again: it asks for a purpose and a recipient, and the file contains only what the analyst can see.

**What you should see.** "routine" gets you through the expansion. Nothing stops a vague justification by default; the record is simply kept.

> **Instructor.** Tick **Instructor mode**, then **Strict checkpoints**, in the session strip and repeat step 2: now a purpose and at least 40 characters are required. Compare the two. Is a prompt a safeguard, a deterrent, or a liability shield? Open the **German Constitutional Court** card in the **Discussion** panel on the right for the 2023 ruling on automated data analysis.

### 1.4 Acting on the data (20 min)

1. Switch back to **Financial-crime analyst** (only the analyst may run watchlist Actions). Open **Objects → Person → Daniel Wu** (not on any watchlist). In the inspector, open **Actions** and choose **Add to watchlist**.
2. The **Action drawer** shows, in order:
   - the parameters (a reason of at least 10 characters, a risk tag);
   - a **Role check**;
   - the **Checkpoint** that will be asked;
   - the **Purpose rules**;
   - a **Before / after** diff;
   - the **Writeback**: the message as it would be sent to the *Border watch system*.
3. Fill it in, press **Run action**, and answer the Checkpoint (choose a purpose).
4. Open the **External systems** panel in the inspector: the message has arrived in *Border watch*.
5. Go to **Analytics → Watchlist operators**. Daniel Wu is now on the list, and the footnote counts *objects risk-tagged by Actions in this session*.
6. Run **Remove from watchlist** on him: the risk tag goes, and he drops off the rule. But the message already delivered to *Border watch* stays in its inbox: a writeback cannot be called back.
7. Then open **Remove from watchlist** on **Kareem Haddad**: **Run action** is disabled, and the drawer says why: his tag came from the source watchlist, not from an Action.

**Notice.** The analysis produced the fact it then found. The rule did not discover Daniel Wu; you put him there, and the system now treats that as evidence. Actions are how platforms like this "write back" into the operational world: border systems, bank compliance desks and case management.

### 1.5 The trail (10 min)

1. Look at the **audit strip** at the bottom of the page: every view, search, expansion, Checkpoint and Action is there.
2. Click **Oversight**. As **Financial-crime analyst** you are refused, and the refusal is logged.

### Discussion (15 min)

- Markings: are they a privacy safeguard, or the argument that makes merging everything acceptable? (NHS Federated Data Platform card.)
- Who decides which role sees what, and who checks that decision?
- The audit log records everything you looked at. It is also a record about Kareem Haddad and Daniel Wu. Who may read it?

---

## Session 2 — Build and govern: where the picture comes from

**Goal.** Go underneath the analyst's screen: see how raw files become objects, how security labels travel, how a single number decides who is the same person, and what a legal rule can and cannot do.

### 2.1 The pipeline (15 min)

1. Open **Build**. On **Pipelines**, follow the DAG from the six raw files to **ontology_entities**, **ontology_edges** and **leads**. Click **02 Resolve Persons** and read its code in the inspector.
2. Open **Datasets** and click **clinic_registrations.csv**. Read its **purpose** (healthcare), **legal basis** and **retention**. Then open **resolved_persons**: its purpose is *Financial crime*, but its legal basis reads *Not recorded: this derived dataset combines inputs collected for other purposes*. Its markings show HEALTH, inherited from clinic_registrations.csv.
3. Open **Lineage**, search for *Rahman*, and pick a Person: every field shows which source row and column it came from.

**Notice.** A derived dataset gets a purpose assigned by whoever built it, while its inputs carry a mixture. Who decided that clinic records may feed a financial-crime dataset? Row- and field-level lineage like this is a teaching extension: Palantir's lineage works at the level of datasets.

### 2.2 The retention clock (10 min)

1. Switch **Role** to **Patrol officer** or **Data protection officer** (the analyst cannot see ping rows). On **Datasets**, use the **Retention clock** slider and press **+6 months**.
2. Open **mobile_location_pings.jsonl**: rows past their retention period are hatched and tagged *past retention*.
3. Open **resolved_persons** or **leads**: they report how many rows *still carry data past retention upstream*.
4. Open **watchlist.csv**: it has no date column, so retention cannot be applied at all.

**Notice.** Nothing here deletes anything. When a raw row expires, the people, links and leads built from it remain. Read the discussion line on deletion that never reaches copies (ICE/Medicaid).

### 2.3 Markings travel (15 min)

1. Open **Markings**. The DAG is coloured by marking. Click **clinic_registrations.csv**: it is marked **HEALTH**, and HEALTH flows into every dataset downstream (normalised clinic data, resolved persons, the ontology and leads).
2. As **Financial-crime analyst**, press **Remove marking** on HEALTH. It is refused and logged.
3. Switch **Role** to **Data protection officer** and try again. The Checkpoint asks for a legal basis: under 20 characters is rejected. Choose a purpose first; then a justification under 20 characters is rejected. Write a longer one and continue.
4. HEALTH is tagged *removed* on the clinic dataset and gone from everything downstream. Switch to **Investigate** as **Financial-crime analyst** and open **Leads**: Omar Rahman's clinic address, *41 Oak Lane, Birmingham*, is now visible to a role that could not see it before.
5. Back in **Build → Markings** as **Data protection officer**, press **Restore** on the clinic dataset. A Checkpoint asks why; HEALTH is withheld from the analyst again. Both the removal and the restore are in the log.

> **Instructor.** Make sure HEALTH is restored before 2.4. Read the **ICE ImmigrationOS / ELITE** card together: what would a HEALTH marking have done in that case, and what would it not have done?

### 2.4 One number decides who is the same person (25 min)

1. In **Build**, as **Financial-crime analyst** (only the analyst and the DPO may move the threshold; for the other roles the slider is read-only and says why), open **Resolution**. Read the explanation, the **weights** table and the **candidate pairs**. At the default threshold **0.75** every pair is *separate*.
2. Press **0.65**, then drag to **0.60**. Pairs that really are duplicates merge, for example *M. Singh* and *Maya Singh*. The list *People who changed identity at this threshold* explains each merge.
3. Press **0.55**. Now **Omar Al-Rahman** (watchlisted, *dual-use-broker*) and **Omar Rahman** (a care worker in Birmingham) merge.
4. Click **Omar Rahman** in the pair and read the **merge explanation**: same name +0.45, the Omar/Umar spelling +0.15, conflicting dates of birth −0.15, a shared flight route +0.10, total **0.55**.
5. Open **Investigate → Analytics → Watchlist operators**. The merged person carries a chip, *merged at 0.55 — 2 source identities*, and the care worker's records now carry the watchlist risk tag. A merged person cannot be edited by hand: the editor says *unmerge first*.
6. As **Data protection officer**, open **Objects → Person → Omar Al-Rahman**: the watchlisted man now has a home address in Birmingham. That address can only have come from the false merge.
7. As **Financial-crime analyst**, open his inspector and run **Unmerge person**. The merge to undo is filled in for you; give a reason. Back in **Build → Resolution**, the pair shows **rejected** at every threshold.

**Notice.** The dial does two things at once: it repairs genuine duplicates (0.60) and creates a false one (0.55). The date-of-birth penalty is deliberately small. Is it too small? Who chooses the weights, and who pays for a low threshold?

### 2.5 Law written as code (10 min)

1. Switch **Role** to **Data protection officer**, tick **Karlsruhe mode** in the session strip and set **Purpose** to **Public order**. (Only the DPO sees HEALTH data, so only the DPO can see R2 fire. Other roles see a line saying the HEALTH data is withheld from them anyway.)

   Open **Analytics**: **Travel-finance overlap** now reads *blocked · rule R2*, because one of its people has a clinic record. Click it for the red **Blocked by rule R2** card. The other three rules still run.
2. In **Build → Pipelines**, steps that combine healthcare data with law-enforcement purposes carry a red **R2** badge with the rule text.
3. In **Investigate**, open **Objects → Person → Omar Rahman** (the care worker, who has a clinic registration). Under **Devices & locations** a red **Blocked by rule R2** card replaces the expansion button. Press **Request exception** on the card: the exception is *self-certified* (you grant it to yourself) and lands in Oversight's **Exceptions to review** list.
4. Open **Kareem Haddad** (no health data) and press **Expand devices & locations**: R2 does not apply, but rule **R3** asks for a concrete danger statement (at least 30 characters) before going beyond the first hop.
5. Untick the mode: nothing is blocked, but every expansion, rule and Action still logs the purposes involved.

> **Instructor.** The three rules are our abstraction of the 2023 ruling's logic, not its text (see the note in the glossary). Discuss what the rules get wrong by being rules.

### Discussion (5 min)

- Can a rule engine implement a proportionality test?
- What does "deleted" mean once derived datasets exist?

---

## Session 3 — Agent, leads and oversight: who is in the loop?

**Goal.** Work with a simulated AI agent that plans, calls tools, cites its sources and proposes edits, and see where human review becomes a formality. Then look at an enforcement "lead" built from health data, and at the oversight record of everything you did.

> **Instructor.** Start with the default threshold (0.75) and HEALTH still marked. Keep the same browser window as Session 2 if you want its threshold changes and unmerges in Oversight at the end; reset the threshold to 0.75 on Build → Resolution. A private window starts clean but with an empty log. The **Failure mode** select in the session strip (Instructor mode) forces one of three scripted failures for any question. The four example prompts below fire them anyway.

### 3.1 How the agent works (15 min)

1. Open **Investigate → Agent (simulated AIP)** as **Financial-crime analyst**. Press the example **Summarise Omar Rahman**, then **Ask the agent**.
2. Read the black **Plan and trace** panel: each step is a tool call (`search_objects`, `get_links`, `run_rule`, …) with its arguments and how many objects it returned.
3. Read the **Answer**: every sentence has citation chips. Click one, and the object lights up in the answer graph.
4. Note that the agent finds **two** people called Omar Rahman and says they are separate at threshold 0.75.
5. Look at the edits it staged: alongside the summary, it proposes **Add to watchlist** for the care worker. Nobody asked for that. Leave it for 3.2.

> **Instructor.** If the threshold is at 0.55 (from Session 2), the same question returns *one* Omar Rahman. The agent can only see what the platform has decided.

**Notice.** No language model is involved: the plan is scripted from the question, and each tool runs through the same roles, Checkpoints, purpose rules and audit log as your own clicks. Every tool call is an audit event. The honesty chip says what real AIP does differently.

### 3.2 Staged edits and "Approve all" (15 min)

1. Ask **Who should we add to the watchlist?**
2. The agent stages several **Add to watchlist** edits. Each has **Approve** and **Reject**, and a prominent **Approve all** button invites you to save time.
3. Read each staged edit's reason before you decide. Then try **Approve all**. One Checkpoint opens, listing every edit; you answer it once. Look at the audit strip: one Checkpoint record, one event for the bulk approval with its count, and each applied edit points back to that single record.
4. Open **Evals** and press **Check**: *No edit was applied without approval* and *Every sensitive edit passed a Checkpoint* both pass, which is technically true.

**Notice.** "Human in the loop" can mean one click, and one justification, for many decisions. Read the **Maven Smart System** card: what does the loop mean with 20,000 users?

### 3.3 When the agent gets it wrong (15 min)

1. Ask **What links Omar Rahman to North Quay Logistics?** Read the answer carefully. One sentence cites a link that does not exist.
2. Press **Check** in **Evals**: the check *Every claim cites an existing object or link* fails and names the missing link. It is flagged only because you asked.
3. As **Financial-crime analyst**, ask **Show me everyone connected to Kareem Haddad's phones**. Two steps in the trace are **DENIED and logged**: one needs telecom data, the other the HEALTH-marked home address. The answer does not use their results. Switch to **Patrol officer** and ask again: switching role clears the earlier run, and this time the step stops at a Checkpoint instead, as your own expansion did in 1.3.

**Notice.** The fabricated link sits in the answer like any other citation; only its chip, a raw ID instead of a readable link name, gives it away. Citations only help if someone checks them.

### 3.4 Leads: an address score built from health data (20 min)

1. Open **Leads** as **Data protection officer**. The top lead is **Omar Rahman** (the care worker), at 41 Oak Lane, Birmingham, with the highest score.
2. Click him: the formula is filled in. The clinic registration (HEALTH, weight 0.5, recent) contributes most; phone pings (TELECOM) add the rest.
3. Switch to **Patrol officer**: the clinic component is withheld (hatched), the score is recomputed from the visible sources only, and his best address becomes just *Oak Lane, Birmingham* from the pings. He is no longer top.
4. Switch to **Financial-crime analyst**: he has no visible address sources at all.
5. Switch back to **Data protection officer**, tick **Karlsruhe mode** and set **Purpose** to **Public order**: rule R2 removes the HEALTH component, the score drops, and the card says so.
6. Untick **Karlsruhe mode**, switch to **Financial-crime analyst** and set **Purpose** to **Financial crime** (the role switch cleared it). Try **Close lead** on a lead (outcome and reason).

**Notice.** The care worker becomes the "best" enforcement lead because he registered at a clinic last month. Read the **ICE ImmigrationOS / ELITE** card: health data doing enforcement work. The formula is ours; ELITE's is not public.

### 3.5 Lists and the record (10 min)

1. From an agent answer or a rule, press **Save answer objects as object set** (or **Save hits as object set**). Open **Object sets**: add or remove a member and compare versions; share the set with another role (they can view it but not edit it).
2. Switch to **Data protection officer** and open **Oversight**. Read your own trail: role switches, views, searches, Checkpoints with your exact justifications, Actions with before/after, agent runs grouped by run (denied steps tagged *denied*), the bulk approval, threshold changes and unmerges. The hash chain shows **verified**. Check **Exceptions to review** for the self-certified exception from 2.5.
3. Switch to **Auditor**: the same log, but values the auditor may not see (passport numbers, risk tags) are redacted, and so are object IDs that contain them (they appear as `person::•••` plus a short tag). The note at the top says why: the log is itself personal data about the people it mentions.
4. Tick **Redact (Raffinaderij exhibit)**: almost every cell is blacked out, as in the documents released about the Dutch police's Palantir-based platform.
5. Open **Deployment** from the landing page: compare where this tool keeps its data (your browser, GitHub Pages) with a real deployment (customer cloud or on-premises servers, Apollo pushing updates, forward-deployed engineers).

### Discussion (5 min)

- What does an audit log mean if the public cannot see that it exists? Who is the auditor here?
- Where in today's session did a human decide, and where did the system decide while a human clicked?

---

## Instructor notes

**Timings** are a guide; every session has more than enough material. If time runs short, skip 1.2 (resolution notes reappear in 2.4), 2.2 (retention) and 3.5 step 1 (object sets).

**Two-session version.** Fold 3.1–3.3 into the last 25 minutes of Session 1 (the agent reuses Session 1's people), and the Oversight part of 3.5 into Session 2's close. Drop Leads, or show it as a demonstration.

**Known behaviour worth knowing.**

- Map tiles come from OpenStreetMap and need internet access. Without it the pins and routes still show, on a grey background.
- The first time a returning browser opens Investigate after an update, a banner offers to restore earlier edits. Choose *Dismiss* for a clean class.
- Only the Data protection officer sees HEALTH by default; that is the purpose-limitation lesson, not a bug.
- In the simulator dataset (larger), the same features work with more noise; the namesake lead is fifth rather than first.

**Facts to check before putting them on slides.** The case-study cards summarise the research report (`context/PALANTIR_RESEARCH_2026-11-04.md`). Items marked *[to verify]* there, and the Karlsruhe rules' relation to the actual judgment, should be checked against the sources first. The deployment page cites a Palantir job listing that may change.

**Assessment ideas.** Ask students to export their audit trail from Oversight (CSV) and annotate three moments where a decision was made, by whom and on what basis; or to argue for a threshold and weights for the resolution table and defend who bears the errors.
