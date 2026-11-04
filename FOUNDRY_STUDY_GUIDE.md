# Session 2 study guide: Build (Foundry-style)

**Audience:** Same as the Session 1 study guide — undergraduate or postgraduate students in intelligence studies, data science, or digital policy
**Time:** Allow 45–60 minutes (30–45 without the markings section)
**Prerequisite:** You should have completed the Session 1 study guide (Investigate) first. This session builds on objects you already know.

Welcome to **Build (Foundry-style)**, the engineering surface of this teaching platform (it lives in `foundry-demo/`). If the Investigate app asked "given a finished ontology, what can an investigator do with it?", this demo asks the harder and more political question: **how was that ontology built, and why should anyone trust it?**

---

## 🎯 Core Learning Objectives

Three questions to keep in mind before you click anything:

1. **The Origin Question:** When the Investigate app told you "Kareem Haddad's risk tag is `sanctions-evasion`", *where did that fact come from*? Could you defend it to a court, a journalist, or to Kareem himself?
2. **The Trust Question:** Lineage lets you trace a fact to its source row. Is that enough to make the system trustworthy, or does it just push the problem one level down?
3. **The Accountability Question:** A system that *can* be audited is not the same as a system that *is* audited. Who would need to look at this lineage for it to actually protect anyone?

---

## 🗺️ Step-by-Step Walkthrough

### Step 1: The Pipeline Tab — Ontologies Are Built by Code

* **Action:** Open the **`Pipelines`** tab. You will see a left-to-right data flow diagram: five raw source files on the left, five transform steps in the middle, and final outputs on the right.
* **Focus:** Click the **`resolve_persons`** box. The bottom inspector pane loads the actual Python source code of that transform. Read the first 30 lines.
* **Key Concept:** The ontology you investigated in Session 1 is not a fact about the world. It is the **output of code**, written by engineers, executed in a known order, on specific input files. Every entity you saw was *manufactured* by this pipeline.
* **Discussion Question:** The `resolve_persons` transform decides that two records refer to the same person using the priority `passport → phone → name+dob → alias`. Who decided that order? What kinds of people are most likely to be mismatched if that priority is wrong?

### Step 2: The Datasets Tab — Schemas Are Contracts

* **Action:** Open the **`Datasets`** tab. The sidebar groups everything into **Raw Sources**, intermediate (normalized + resolved) datasets, and **Final** (ontology entities and edges).
* **Focus:** Each dataset now shows a **Governance** block: its *purpose*, its *legal basis*, how long it may be kept (*retentionDays*) and its **markings**, each with where it came from. Then open `watchlist.csv` and note the raw column names and sample rows. Now open `norm_watchlist` (the normalized version) and compare: same data, but every field has a declared type and an explicit `_source_row` index. Now open `resolved_persons` and find Kareem Haddad — he exists here only after merging across multiple sources.
* **Key Concept:** A schema is a **contract**. Once you declare `dob: date`, every downstream piece of code can rely on that type. Most data disasters happen because schemas are implicit and inconsistent.
* **Note — rows you cannot see:** If your role cannot see one of a dataset's markings, the schema stays visible but the sample rows are withheld. Switch role in the session strip and watch which datasets open up.
* **Bonus concept — intermediate datasets:** Notice that `resolved_persons` is itself a dataset, not a final product. It has its own schema, its own row count, and its own backlinks. Foundry's model is that **every step is inspectable** — there are no hidden internal states.

### Step 3: The Lineage Tab — The Aha Moment

* **Action:** Open the **`Lineage`** tab. Type "Kareem" into the search box and select **Kareem Haddad**.
* **Focus:** You now see three panels for one entity:
  * **Object properties** — the fields the Investigate app showed you, but here you are looking *behind* them (values your role may not see are shown hatched, with the marking that withholds them)
  * **Markings** — the markings needed to see the object, the markings of every dataset that contributed to it (`sourceMarkings`), and per-property markings
  * **Upstream source rows** — every single raw row across every dataset that contributed to this entity (14 rows in total for the starter dataset)
  * **Per-field provenance** — for each property, the exact source row and column it came from
* **Try this:** Click any row in the per-field provenance table. The app jumps to the Datasets tab and **highlights the exact source row** you clicked. This is the click-through that makes the audit story real — not a promise that lineage exists, but a working trace you can follow yourself.
* **Key Concept:** Foundry's own lineage is **dataset-level**: it shows which datasets and transforms produced a dataset, not which raw row produced a single value. The row- and field-level trace here is a *teaching extension* (see the label on the tab) that makes the idea of provenance visible. Even at dataset level, lineage lets an organisation ask "where did this come from?" of a chart, an alert or an export, and get a checkable answer.

### Step 4: The Cross-Link — One Ontology, Two Tools

* **Action:** Scroll to the bottom of the Kareem Haddad lineage view. Click **"View Kareem Haddad in Investigate (Gotham-style) →"**.
* **Focus:** The link opens the Investigate app in a new tab. The Person ID is identical (`person::p8842101`). Yesterday you investigated this entity. Today you traced where it came from.
* **Key Concept:** Gotham and Foundry are two views of **one operational model**. The analyst sees a Person; the engineer sees the pipeline that produced that Person; both see the same `person::p8842101`. This is what "an ontology" means in practice — a shared identity across tools, audiences, and workflows.

### Step 5: Session 2: markings

Markings are mandatory security labels that travel with data. In Foundry, a dataset built from a marked dataset inherits the marking, and only a privileged user can remove it. The **Markings** tab shows this (label: *Mirrors Foundry*).

* **Action — follow HEALTH downstream:** Open the **`Markings`** tab. The pipeline is drawn left to right, each dataset with its markings as coloured stripes and as text badges (a dashed badge means *inherited*). Click **HEALTH** in the *Highlight* row. The raw `clinic_registrations` dataset carries HEALTH because it was collected for care. Count the datasets downstream that inherit it, and notice that the ontology itself (`ontology_entities`, `ontology_edges`) is among them.
* **Focus:** Click `resolved_persons`. The inspector lists each marking as `{id, inheritedFrom}`: HEALTH is inherited from the clinic data. Then look at *Rows visible to*: with HEALTH on it, only the data protection officer may read the rows. Nobody but the DPO sees HEALTH. That is purpose limitation: data collected for care is not available for policing by default.
* **Action — try to remove it as the analyst:** With the role *Financial-crime analyst*, select the clinic dataset and click **Remove marking** next to HEALTH. The Checkpoint refuses: your role cannot remove markings, and the attempt is logged.
* **Action — remove it as the DPO:** Switch the role to *Data protection officer* and try again. This time the Checkpoint asks for the legal basis in writing before it lets you continue. Write a real justification, continue, and watch HEALTH disappear from every dataset that had inherited it only from the clinic data. The removal is stored in your browser and the Investigate app honours it on reload.
* **Action — read the trail:** Open **Oversight** (link in the session strip) as the DPO or the auditor and find the refused attempt, the Checkpoint record with your justification, and the marking removal.
* **Key Concept:** A marking is a rule about who may see data, attached to the data itself, so it survives every join. But it only governs access *inside* the platform. It says nothing about what happens after an export, a screenshot or a chat message, and a single privileged removal opens everything downstream at once.
* **Discussion prompt — ICE and Medicaid (research §D.1):** In 2025–26, ICE's ELITE tool reportedly drew on Medicaid data; court filings in July 2026 describe Medicaid data shared beyond a court order reaching Palantir through a Teams chat, after which Palantir said it was deleted. What would a HEALTH marking have prevented here, and what would it not have prevented? What does "deleted" mean once derived datasets exist?

---

## 🧩 What This Demo Doesn't Show

Real Foundry deployments do several things this classroom demo deliberately skips. Knowing what is missing is part of understanding the platform honestly:

* **Branching the ontology.** A real analyst can fork the world model, run a hypothetical ("what if we re-classify shell companies?"), diff, and merge. Think `git` for an operational ontology.
* **Write-back and actions.** Foundry can push decisions back into source systems — freezing an account, dispatching a unit, sending a partner notification. This is where lineage becomes ethically loaded, because the system is no longer just *describing* the world, it is *changing* it.
* **Purpose-based access in full.** A real deployment combines markings with groups, projects and organisations, and can restrict who sees what *for which stated purpose*. The demo models five roles and six markings (a simplification); purpose rules that block particular joins are planned for a later phase.
* **Builds, branches, schedules and dataset versions.** Foundry versions datasets through transactions and rebuilds them on schedules and branches. The demo runs the pipeline once, at build time.
* **Real-time pipelines.** This demo runs the pipeline once, at build time. Production Foundry ingests live feeds and rebuilds continuously.
* **Schema evolution.** What happens when a raw source adds a new column or changes a type? Real Foundry has tooling for this; the demo does not.

---

## 🧠 Critical Perspectives & Debate Prompts

> **Lineage as Accountability — and Its Limits**
> The Foundry demo demonstrates that every fact in the ontology can be traced to a raw source row. This is genuinely impressive engineering. But trace-to-source tells you *which* row produced a fact, not whether the row was *correct*, whether the transform code was *fair*, or whether the schema captures what *matters*. A perfectly audited pipeline can still produce systematically biased outputs. What additional structures (human, legal, technical) would need to exist for lineage to actually protect anyone?

> **The Engineer-Analyst Gap**
> In this two-app demo, you played both roles: in Session 1 the analyst, now the engineer. In real intelligence agencies and corporations, these are different people, often in different buildings, sometimes with conflicting incentives. The engineer wants the pipeline to run; the analyst wants the answer to be usable; neither necessarily wants to ask "is this person being treated fairly?". Who in this hierarchy is responsible when the system produces a harmful but technically lineage-clean result?

> **The Public-Facing Argument**
> Palantir's strongest public defense of its work is roughly: *"structured, lineage-tracked systems are better for human rights than the alternative, which is unstructured analyst access to raw databases with no audit trail."* Now that you have seen what lineage actually looks like, evaluate this argument on its merits. Under what conditions is it convincing? Under what conditions is it a sophisticated way of changing the subject?

### 📚 A Concrete Exercise

Pick **one** of the field-level provenance entries you saw on the Kareem Haddad lineage view. Write three short paragraphs:

1. **What the system claims.** State the field, the value, and the source row in plain language.
2. **What lineage proves.** What can you say with certainty because of the trace? What remains unproven?
3. **What you would still want to know** before treating this fact as the basis for an enforcement action (a sanction, an arrest, a deportation, a refused transaction).

This exercise is the bridge between the engineering you saw today and the ethics you debated in Session 1.
