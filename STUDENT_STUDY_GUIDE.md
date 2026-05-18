# Student Study Guide: Ontology Studio

**Audience:** Undergraduate or postgraduate students in intelligence studies, data science, or digital policy  
**Time:** Allow 60–90 minutes for the full walkthrough and discussion

Welcome to the Ontology Studio. This guide will help you navigate the system, understand the core concepts behind platforms like Palantir (Gotham/Foundry/AIP), and critically evaluate how intelligence software operates in the real world.

---

## 🎯 Core Learning Objectives

Before you click anything, keep these three questions in mind:

1. **The Data Shift:** How is exploring an "Ontology" different from reading a raw Excel spreadsheet or SQL database?
2. **The AI Shift:** Why is the "AI Copilot" here fundamentally different from a general chatbot like ChatGPT?
3. **The Ethical Tension:** Does linking all this data together make society safer, or does it encode bias and threaten civil liberties?

---

## 🗺️ Step-by-Step Walkthrough

### Step 1: Start with the Guided Tour
* **Action:** Click the **`▶ Guided tour`** button in the top right corner.
* **Focus:** Click through all 9 steps. Pay special attention to the difference between the **Schema** tools (how the model is built) and the **Analyst** tools (how investigators use it). As a quick experiment, open the **`Entity Types`** tab and find the `Person` type — note its fields: **Canonical name**, **Aliases**, **Date of birth**, **Nationality**, **Passport ID**, **Phone number**, **Risk tag**. These are the durable objects that everything else connects to.
* **Key Concept:** The system is *not* a collection of dashboards. It is a modeled reflection of reality.

### Step 2: The "Aha!" Moment — CSV vs. Ontology
* **Action:** Go to the **`AI Copilot`** tab. Do not type anything yet. Look at the card titled *"Without the ontology vs. with it"*.
* **Focus:** Compare the raw `bank_transactions.csv` row to the mapped ontology view on the right.
* **Discussion Question:** Why is the raw CSV row nearly useless to an investigator on its own? What does the ontology add that makes the transaction actionable?
* **Bonus concept — entity resolution:** Notice that two sources might refer to the same person as "Kareem Haddad" and "Karim Haddad". The system must decide these are the same entity *before* any analysis can happen. This *entity resolution* step is one of the hardest problems in real intelligence integration — and it happens before the UI you are looking at even exists.

### Step 3: Surface Patterns with Analytics
* **Action:** Go to the **`Analytics`** tab.
* **Focus:** Look at the four rule groups — **Watchlist operators**, **Address hubs**, **Travel-finance overlap**, and **Shared booking artifacts**. Click each one and examine the top hits.
* **Key Concept:** These are simple, transparent rules — not AI. The system can rank interesting actors and places because the ontology has already done the hard work of joining messy sources. Understanding these rules is essential before you ask the AI copilot anything, because the copilot builds on top of them.
* **Discussion Question:** These rules score people by the number of connections they have. Does having many connections make someone suspicious, or just socially active?

### Step 4: Test the Grounded AI Copilot
* **Action:** Go to the **`AI Copilot`** tab. Before typing, notice the **`⬡ Ontology-grounded`** badge in the *"How this copilot is grounded"* card — this signal is always visible, not generated per-answer. Now click one of the example queries, such as *"Bring together Kareem Haddad across companies, flights, transfers, and devices"*.
* **Focus:** After the answer appears, look at the **grounding summary** line below it: *"N entities matched · N relationships traversed · answer grounded in ontology"*. This makes the grounding claim verifiable — you can count the nodes yourself in the answer graph.
* **Key Concept (AIP Grounding):** Real-world intelligence platforms cannot hallucinate. This AI is not generating text from a language model trained on the internet — it is writing a summary based *only* on the exact nodes and edges that exist in the database. Every entity it names can be verified in the graph.

### Step 5: Execute an Investigation & Action Log
* **Action:** Go to the **`Investigations`** tab. Click the first scenario, *"Trace the risk-tagged operator"*.
* **Focus:** Scroll to the **"Recommended Actions"** card on the left. Click one of the action buttons (e.g., *"Escalate Kareem Haddad to Intelligence Unit"*). Notice the timestamped log that appears below the buttons.
* **Key Concept:** In a real system, every analyst action — every search, every escalation — would be written to an **immutable, audited log** that cannot be deleted or altered. The log in this demo is a mock to illustrate the principle; in production it would be tamper-proof and reviewable by oversight bodies. Why does this matter for civil liberties?

### Step 6: Explore Spatial Intelligence
* **Action:** Go to the **`Map`** tab.
* **Focus:** Notice how a single physical location (like a specific address in Cyprus or an airport) acts as a bridge connecting completely different people and companies who have never directly interacted.
* **Discussion Question:** If two people share the same physical address in the system, does that mean they are complicit in a crime, or could it be coincidence? How should an analyst weigh "guilt by association"?

---

## 🧩 Where This Demo Fits in the Palantir Stack

Palantir is not one product — it is three, and they do different things. This demo is closest to **Gotham**, and it deliberately skips features that define the other two.

| Product | What it is | Modeled here? |
|---|---|---|
| **Gotham** (2008–) | Intelligence and defense ontology with investigation workflows | ✅ This demo is Gotham-flavored |
| **Foundry** (2016–) | Commercial data integration: full lineage, ontology branching, pipeline graphs, write-back to source systems | ❌ Not modeled |
| **AIP** (2023–) | Agentic AI layer: LLM agents that *take actions* (freeze an account, dispatch a unit, send a notification) under permissioned tools — not just answer questions | ⚠️ Partial — copilot retrieves, but real AIP acts |

**Things this demo does not show — but real Palantir deployments do:**

* **Data lineage.** In Foundry, you can click any value in the ontology and trace it back through every pipeline transform to the original source row. That is arguably Foundry's strongest claim and the basis for its "auditability" pitch.
* **Branching the ontology.** Analysts can fork the world model, run a hypothetical, and merge — essentially `git` for an operational ontology.
* **Action-taking agents.** AIP agents call tools under audit (book transport, flag transactions, escalate alerts). The demo's copilot only summarizes evidence; it never *does* anything.
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

Don't take the debate in the abstract — these are named, dated cases. Pick one and read the public reporting before you decide where you stand.

* **ICE — FALCON & LESA (2014–present).** Case-management systems used in U.S. Immigration and Customs Enforcement workplace raids and deportation operations. Contracts have been renewed across the Obama, Trump, and Biden administrations. Catalyst for the most sustained employee-and-activist pressure Palantir has faced.
* **LAPD — Operation LASER (2011–2019).** Predictive-policing program built on Palantir tooling, terminated in 2019 after an internal LAPD Inspector General audit found the inputs and scoring were inconsistent and risked over-policing Black and Latino neighborhoods.
* **NHS England — Federated Data Platform (2023).** £330M, seven-year contract for the platform underlying NHS operational data in England. Awarded amid sustained public-trust controversy over commercial access to patient records and the absence of a competitive open-source bid.
* **U.S. Department of Defense — Project Maven, Army Vantage, TITAN (2018–present).** Battlefield intelligence and targeting; Palantir has become one of the primary software vendors for U.S. military AI, often integrated with Anduril's autonomous hardware.
* **CIA / In-Q-Tel (2005).** Palantir's earliest funding came from the CIA's venture arm, In-Q-Tel. The "Palantir helped find Bin Laden" narrative is foundational company mythology but has never been officially confirmed.
* **Cambridge Analytica adjacency (2014).** A Palantir employee worked with Cambridge Analytica on Facebook data scraping. Palantir disavowed the work as unauthorized, but the episode shaped early public perception of the company's culture and oversight.

**Discussion exercise:** Pick *one* of the above. Find two sources with opposing framings (e.g., a Palantir press release and an ACLU report, or a Pentagon procurement document and an investigative news piece). What does each side leave out? Which framing relies on claims you cannot verify?

