# Student Study Guide: Foundry Studio

**Audience:** Same as the Gotham Study Guide — undergraduate or postgraduate students in intelligence studies, data science, or digital policy
**Time:** Allow 30–45 minutes
**Prerequisite:** You should have completed the Gotham Study Guide first. This session is shorter because it builds on familiar entities.

Welcome to Foundry Studio. If the Gotham demo asked "given a finished ontology, what can an investigator do with it?", this demo asks the harder and more political question: **how was that ontology built, and why should anyone trust it?**

---

## 🎯 Core Learning Objectives

Three questions to keep in mind before you click anything:

1. **The Origin Question:** When the Gotham app told you "Kareem Haddad's risk tag is `sanctions-evasion`", *where did that fact come from*? Could you defend it to a court, a journalist, or to Kareem himself?
2. **The Trust Question:** Lineage lets you trace a fact to its source row. Is that enough to make the system trustworthy, or does it just push the problem one level down?
3. **The Accountability Question:** A system that *can* be audited is not the same as a system that *is* audited. Who would need to look at this lineage for it to actually protect anyone?

---

## 🗺️ Step-by-Step Walkthrough

### Step 1: The Pipeline Tab — Ontologies Are Built by Code

* **Action:** Open the **`Pipelines`** tab. You will see a left-to-right data flow diagram: five raw source files on the left, five transform steps in the middle, and final outputs on the right.
* **Focus:** Click the **`resolve_persons`** box. The bottom inspector pane loads the actual Python source code of that transform. Read the first 30 lines.
* **Key Concept:** The Gotham demo's elegant ontology — the one you investigated yesterday — is not a fact about the world. It is the **output of code**, written by engineers, executed in a known order, on specific input files. Every entity you saw was *manufactured* by this pipeline.
* **Discussion Question:** The `resolve_persons` transform decides that two records refer to the same person using the priority `passport → phone → name+dob → alias`. Who decided that order? What kinds of people are most likely to be mismatched if that priority is wrong?

### Step 2: The Datasets Tab — Schemas Are Contracts

* **Action:** Open the **`Datasets`** tab. The sidebar groups everything into **Raw Sources**, intermediate (normalized + resolved) datasets, and **Final** (ontology entities and edges).
* **Focus:** Open `watchlist.csv` and note the raw column names and sample rows. Now open `norm_watchlist` (the normalized version) and compare: same data, but every field has a declared type and an explicit `_source_row` index. Now open `resolved_persons` and find Kareem Haddad — he exists here only after merging across multiple sources.
* **Key Concept:** A schema is a **contract**. Once you declare `dob: date`, every downstream piece of code can rely on that type. Most data disasters happen because schemas are implicit and inconsistent.
* **Bonus concept — intermediate datasets:** Notice that `resolved_persons` is itself a dataset, not a final product. It has its own schema, its own row count, and its own backlinks. Foundry's model is that **every step is inspectable** — there are no hidden internal states.

### Step 3: The Lineage Tab — The Aha Moment

* **Action:** Open the **`Lineage`** tab. Type "Kareem" into the search box and select **Kareem Haddad**.
* **Focus:** You now see three panels for one entity:
  * **Entity properties** — the seven fields the Gotham demo showed you, but here you are looking *behind* them
  * **Upstream source rows** — every single raw row across every dataset that contributed to this entity (14 rows in total for the starter dataset)
  * **Per-field provenance** — for each property, the exact source row and column it came from
* **Try this:** Click any row in the per-field provenance table. The app jumps to the Datasets tab and **highlights the exact source row** you clicked. This is the click-through that makes the audit story real — not a promise that lineage exists, but a working trace you can follow yourself.
* **Key Concept:** A real Foundry deployment lets you do this for *any* value in *any* downstream system — a chart, an alert, an export to a partner agency. If a fact ever appears anywhere in the system, you can ask "where did this come from?" and get a verifiable answer.

### Step 4: The Cross-Link — One Ontology, Two Tools

* **Action:** Scroll to the bottom of the Kareem Haddad lineage view. Click **"View Kareem Haddad in Gotham demo →"**.
* **Focus:** The link opens the Gotham demo in a new tab. The Person ID is identical (`person::p8842101`). Yesterday you investigated this entity. Today you traced where it came from.
* **Key Concept:** Gotham and Foundry are two views of **one operational model**. The Gotham analyst sees a Person; the Foundry engineer sees the pipeline that produced that Person; both see the same `person::p8842101`. This is what "an ontology" means in practice — a shared identity across tools, audiences, and workflows.

---

## 🧩 What This Demo Doesn't Show

Real Foundry deployments do several things this classroom demo deliberately skips. Knowing what is missing is part of understanding the platform honestly:

* **Branching the ontology.** A real analyst can fork the world model, run a hypothetical ("what if we re-classify shell companies?"), diff, and merge. Think `git` for an operational ontology.
* **Write-back and actions.** Foundry can push decisions back into source systems — freezing an account, dispatching a unit, sending a partner notification. This is where lineage becomes ethically loaded, because the system is no longer just *describing* the world, it is *changing* it.
* **Permissioned access by purpose.** A real deployment can restrict who sees what *and for what stated purpose*. An analyst might see a Person's name for case A but not for case B. None of that is modeled here.
* **Real-time pipelines.** This demo runs the pipeline once, at build time. Production Foundry ingests live feeds and rebuilds continuously.
* **Schema evolution.** What happens when a raw source adds a new column or changes a type? Real Foundry has tooling for this; the demo does not.

---

## 🧠 Critical Perspectives & Debate Prompts

> **Lineage as Accountability — and Its Limits**
> The Foundry demo demonstrates that every fact in the ontology can be traced to a raw source row. This is genuinely impressive engineering. But trace-to-source tells you *which* row produced a fact, not whether the row was *correct*, whether the transform code was *fair*, or whether the schema captures what *matters*. A perfectly audited pipeline can still produce systematically biased outputs. What additional structures (human, legal, technical) would need to exist for lineage to actually protect anyone?

> **The Engineer-Analyst Gap**
> In this two-app demo, you played both roles: yesterday the analyst, today the engineer. In real intelligence agencies and corporations, these are different people, often in different buildings, sometimes with conflicting incentives. The engineer wants the pipeline to run; the analyst wants the answer to be usable; neither necessarily wants to ask "is this person being treated fairly?". Who in this hierarchy is responsible when the system produces a harmful but technically lineage-clean result?

> **The Public-Facing Argument**
> Palantir's strongest public defense of its work is roughly: *"structured, lineage-tracked systems are better for human rights than the alternative, which is unstructured analyst access to raw databases with no audit trail."* Now that you have seen what lineage actually looks like, evaluate this argument on its merits. Under what conditions is it convincing? Under what conditions is it a sophisticated way of changing the subject?

### 📚 A Concrete Exercise

Pick **one** of the field-level provenance entries you saw on the Kareem Haddad lineage view. Write three short paragraphs:

1. **What the system claims.** State the field, the value, and the source row in plain language.
2. **What lineage proves.** What can you say with certainty because of the trace? What remains unproven?
3. **What you would still want to know** before treating this fact as the basis for an enforcement action (a sanction, an arrest, a deportation, a refused transaction).

This exercise is the bridge between the engineering you saw today and the ethics you debated yesterday.
