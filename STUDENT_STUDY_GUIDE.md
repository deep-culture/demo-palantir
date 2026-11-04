# Session 1 study guide: Investigate (Gotham-style)

**Audience:** Undergraduate or postgraduate students in intelligence studies, data science, or digital policy  
**Time:** Allow 60–90 minutes for the full walkthrough and discussion

Welcome to **Investigate (Gotham-style)**, the analyst's surface of this teaching platform (it lives in `demo/`). This guide will help you navigate the system, understand the core concepts behind platforms like Palantir's (Gotham, Foundry, AIP), and critically evaluate how intelligence software operates in the real world.

> **Two vocabularies.** The interface uses Palantir's terms: *object type*, *object*, *link type*, *backing dataset*. Older parts of the demo, and its code, still say *entity type*, *entity*, *relationship* and *source mapping*. They mean the same thing; the [glossary](glossary.html) maps one onto the other. Each panel also carries a small label (*Mirrors Foundry/Gotham*, *Simplified* or *Teaching extension*) that says how closely it follows the real product.

---

## 🎯 Core Learning Objectives

Before you click anything, keep these three questions in mind:

1. **The Data Shift:** How is exploring an "Ontology" different from reading a raw Excel spreadsheet or SQL database?
2. **The AI Shift:** How does the **Agent (simulated AIP)** here differ from a general chatbot like ChatGPT, and how does a real AIP chatbot differ from both?
3. **The Ethical Tension:** Does linking all this data together make society safer, or does it encode bias and threaten civil liberties?

---

## 🗺️ Step-by-Step Walkthrough

### Before you start: who are you?
* **Action:** Find the **session strip** under the purple header. It shows your current **role** (by default *Financial-crime analyst*), your purpose and the number of audit events so far. Switch to *Patrol officer* and back as you go.
* **Key Concept:** The same data looks different to different roles. Data carries **markings** (for example `FIN` for bank data, `TELECOM` for phone numbers and location pings), and a role sees only what its markings allow; withheld values are shown hatched, not silently removed. The roles are enforced in your browser, so this is a model of access control, not access control.

### Step 1: Start with the Guided Tour
* **Action:** Click the **`▶ Guided tour`** button in the top right corner.
* **Focus:** Click through all 9 steps. Pay special attention to the difference between the **Schema** tools (how the model is built) and the **Analyst** tools (how investigators use it). As a quick experiment, open the **`Object types`** tab (formerly *Entity Types*) and find the `Person` type — note its fields: **Canonical name**, **Aliases**, **Date of birth**, **Nationality**, **Passport ID**, **Phone number**, **Risk tag**. These are the durable objects that everything else connects to.
* **Key Concept:** The system is *not* a collection of dashboards. It is a modelled version of reality, built by someone, for a purpose.

### Step 2: The "Aha!" Moment — CSV vs. Ontology
* **Action:** Go to the **`Agent (simulated AIP)`** tab (formerly *AI Copilot*). Do not type anything yet. Look at the card titled *"Without the ontology vs. with it"*.
* **Focus:** Compare the raw `bank_transactions.csv` row to the mapped ontology view on the right.
* **Discussion Question:** Why is the raw CSV row nearly useless to an investigator on its own? What does the ontology add that makes the transaction actionable?
* **Bonus concept — entity resolution:** Notice that two sources might refer to the same person as "Kareem Haddad" and "Karim Haddad". The system must decide these are the same entity *before* any analysis can happen. This *entity resolution* step is one of the hardest problems in real intelligence integration — and it happens before the UI you are looking at even exists.

### Step 3: Surface Patterns with Analytics
* **Action:** Go to the **`Analytics`** tab.
* **Focus:** Look at the four rule groups — **Watchlist operators**, **Address hubs**, **Travel-finance overlap**, and **Shared booking artifacts**. Click each one and examine the top hits.
* **Key Concept:** These are simple, transparent rules — not AI. The system can rank interesting actors and places because the ontology has already done the hard work of joining messy sources. Understanding these rules is essential before you ask the agent anything, because the agent builds on top of them.
* **Discussion Question:** These rules score people by the number of connections they have. Does having many connections make someone suspicious, or just socially active?

### Step 4: Test the Agent (simulated AIP)
* **Action:** Go to the **`Agent (simulated AIP)`** tab. Before typing, read the card that explains how the agent is grounded. Now click one of the example queries, such as *"Bring together Kareem Haddad across companies, flights, transfers, and devices"*.
* **Focus:** After the answer appears, look at the **grounding summary** line below it: *"N entities matched · N relationships traversed"*. This makes the grounding claim checkable: you can count the objects yourself in the answer graph.
* **Key Concept (what this agent is, and what it is not):** This is a rule-based stand-in for an AIP chatbot; it cannot invent objects, because it only assembles a summary from the objects and links that exist in the demo's data. Real AIP uses a large language model with tools and stages edits for review. A language model *can* produce claims that no object supports, which is why Palantir stages AI edits for a person to approve, and why a summary is only as good as the entity resolution and the links underneath it. Grounding narrows the problem; it does not remove it.
* **Discussion Question:** If the agent's answer is built from a false merge (two different people resolved into one Person), is the answer "grounded"?

### Step 5: Execute an Investigation & Action Log
* **Action:** Go to the **`Investigations`** tab. Click the first scenario, *"Trace the risk-tagged operator"*.
* **Focus:** Scroll to the **"Recommended Actions"** card on the left. Click one of the action buttons (e.g., *"Escalate Kareem Haddad to Intelligence Unit"*). Notice the timestamped log that appears below the buttons.
* **Key Concept:** In a real system, every analyst action — every search, every escalation — would be written to an **immutable, audited log** that cannot be deleted or altered. In this demo, your actions are written to a shared audit log kept in your browser: the strip at the bottom of the app shows the latest entries, and the **Oversight** page (`audit/`) lets the data protection officer or the auditor read them. It is a classroom model, not a tamper-proof system: anyone with access to the browser can clear it. Why does it matter for civil liberties who can read such a log, and who can delete it?

### Step 6: Explore Spatial Intelligence
* **Action:** Go to the **`Map`** tab.
* **Focus:** Notice how a single physical location (like a specific address in Cyprus or an airport) acts as a bridge connecting completely different people and companies who have never directly interacted.
* **Discussion Question:** If two people share the same physical address in the system, does that mean they are complicit in a crime, or could it be coincidence? How should an analyst weigh "guilt by association"?

---

## 🧩 Where This Demo Fits in the Palantir Stack

Palantir is not one product — it is three, and they do different things. This session uses the **Gotham**-style surface; Session 2 goes underneath it in the **Foundry**-style Build app. In the real products, Gotham and Foundry share the Ontology, AIP and Apollo; splitting them into two apps is a teaching simplification.

| Product | What it is | Modeled here? |
|---|---|---|
| **Gotham** (2008–) | Intelligence and defence platform with investigation workflows | ✅ Investigate (Gotham-style) |
| **Foundry** (2016–) | Data integration: pipelines, dataset lineage, markings, branching, write-back to source systems | ⚠️ Partly: Build (Foundry-style) shows pipelines, datasets, lineage and markings; branching and write-back are not modelled |
| **AIP** (2023–) | Connects LLMs to the Ontology: chatbots that use tools and can *stage* edits (freeze an account, add to a watchlist) for a person to review | ⚠️ Simplified: the Agent (simulated AIP) retrieves and summarises; it does not act |

**Things this demo does not show — but real Palantir deployments do:**

* **Data lineage (see Session 2).** Foundry records how every dataset was produced from other datasets, and markings travel down that lineage. The Build app shows this, and goes further than Foundry by tracing individual rows and fields (a teaching extension: Foundry's lineage is dataset-level).
* **Branching the ontology.** Analysts can fork the world model, run a hypothetical, and merge — essentially `git` for an operational ontology.
* **Action-taking agents.** AIP chatbots call tools under audit and can stage edits (flag transactions, escalate alerts) for a person to approve. The demo's agent only summarises evidence; it never *does* anything.
* **Real-time streaming and write-back.** Production systems ingest live feeds and push decisions back into operational systems (border control, dispatch, payments).

**Why this matters:** when you read about "Palantir at the NHS" or "Palantir at ICE," it is usually Foundry or Gotham + AIP doing things this demo intentionally simplifies away. Keep that in mind when you weigh the ethical arguments below.

---

## 🧠 Critical Perspectives & Debate Prompts

Palantir systems are powerful — and highly contested. Use these prompts for group discussion after completing the demo:

> **The Dual-Use Dilemma**
> The exact same architectural capability used to track illicit money laundering and human trafficking has also been utilised by agencies like ICE for mass immigration enforcement. Does the creator of an ontology bear responsibility for how the operational model is used?

> **Predictive Policing & Bias**
> Civil liberties groups argue that if you feed historical police data into an ontology, the "Analytics" algorithms will inherently over-police marginalised communities. How do we prevent an ontology from simply automating historical prejudice? What would a bias audit of this system look like?

> **The Counter-Argument**
> Palantir argues that structured, permissioned ontologies are actually *better* for human rights than the status quo. Without an ontology, analysts pass around raw CSVs and query massive databases with zero oversight. What conditions would need to hold for this argument to be convincing? What evidence would you want to see?

### 📚 Real-World Deployments Worth Researching

Don't take the debate in the abstract: these are named, dated cases. Pick one and read the public reporting before you decide where you stand. Items marked **[to verify]** predate the research report behind this course (`context/PALANTIR_RESEARCH_2026-11-04.md`) and have not been re-checked; treat them as leads, not facts.

* **NHS England — Federated Data Platform (awarded November 2023).** Worth up to £330m over seven years; 137 NHS trusts were on the platform by April 2026. Palantir says it is not the data controller, which critics contest in practice; in February 2026 the BMA urged doctors to limit their use of it. Awarded amid sustained controversy over commercial access to patient records.
* **ICE — ImmigrationOS and ELITE (2025–26).** A $30m contract awarded without competition (April 2025). ELITE, reported in January 2026, is a map-based app for finding people with a 0–100 "address confidence score", drawing on Medicaid, USCIS and Thomson Reuters CLEAR data. Court filings in July 2026 describe Medicaid data shared beyond a court order reaching Palantir through a Teams chat; Palantir says it was deleted.
* **Germany — BVerfG, 16 February 2023 (1 BvR 1547/19, 1 BvR 2634/20).** The Federal Constitutional Court declared Hamburg's legal basis for automated data analysis void and Hesse's unconstitutional (in force until 30 September 2023). Bavaria's VeRA went live in September 2024 and a constitutional complaint followed in July 2025; the complaint against North Rhine-Westphalia was not accepted (February 2026).
* **Netherlands — the police "Raffinaderij".** Dutch police have used Palantir since 2012; the platform came to light through Open Government Act (Woo) requests, with about 99% of the released documents redacted.
* **Denmark — POL-INTEL.** The Danish police's Palantir-based system, studied by Galis & Karlsson (2025); Denmark is now looking for domestic replacements.
* **U.S. Department of Defense — Maven Smart System and TITAN.** Maven's contract ceiling rose to about $1.3bn through 2029, with more than 20,000 users (May 2025); the Army's TITAN ground station: $178.4m for 10 prototypes (March 2024). An Army Enterprise Agreement of up to $10bn over 10 years followed in August 2025.
* **[to verify] ICE — FALCON & LESA (2014–present).** Case-management systems reported in use in U.S. Immigration and Customs Enforcement workplace raids and deportation operations, with contracts renewed across several administrations.
* **[to verify] LAPD — Operation LASER (2011–2019).** Predictive-policing programme reported to use Palantir tooling, ended in 2019 after an LAPD Inspector General review of its inputs and scoring. Brayne (2017, 2020) is the scholarly account of Palantir at the LAPD.
* **[to verify] CIA / In-Q-Tel (2005).** Palantir's early funding included the CIA's venture arm, In-Q-Tel. The "Palantir helped find Bin Laden" story has never been officially confirmed.
* **[to verify] Cambridge Analytica adjacency (2014).** A Palantir employee was reported to have worked with Cambridge Analytica on Facebook data; Palantir called the work unauthorised.

**Discussion exercise:** Pick *one* of the above. Find two sources with opposing framings (e.g., a Palantir press release and an ACLU report, or a Pentagon procurement document and an investigative news piece). What does each side leave out? Which framing relies on claims you cannot verify?

