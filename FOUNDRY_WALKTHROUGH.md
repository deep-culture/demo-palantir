# Foundry Walkthrough

This document is a speaker guide for the Foundry-style sibling demo in this repository. It is designed as the **second session** in a two-part Palantir teaching sequence: the Gotham demo (`demo/`) shows what investigators do with a finished ontology; this Foundry demo shows how the ontology was built and why anyone should trust it.

## 1. Start the demo

From the repository root:

```bash
python3 scripts/build_foundry_seed.py --output foundry-demo/seed.js
python3 -m http.server 8124 --directory foundry-demo
```

Open:

```text
http://127.0.0.1:8124
```

The Foundry demo runs on a different port (8124) so it can be served alongside the Gotham demo (8123). Switching between browser tabs is the easiest way to compare the two.

## 2. Recommended storyline

Use this sequence:

1. **Pipelines first** — show that the ontology is produced by code, not handed down. There is a transform graph.
2. **Datasets second** — show that every intermediate stage is itself a dataset that can be inspected, schema'd, and counted.
3. **Lineage third** — show that any single value in the final ontology can be traced back to the exact raw row that produced it.
4. **Cross-link to Gotham** — pick a familiar entity (Kareem Haddad) and jump to the Gotham demo to see what an investigator does with the audited ontology.
5. **Scale to simulator** — switch from `starter` to `simulator` to show the same pipeline running over a larger dataset without changing.

## 3. Live walkthrough

## 3.1 Opening: what students are looking at

Start on the **starter** dataset.

Point out:

- the dataset switcher (`starter` / `simulator`)
- the entity, edge, and dataset counts in the header
- the three tabs: **Pipelines**, **Datasets**, **Lineage**
- the deliberately different aesthetic — dark, monospace, IDE-like — versus the Gotham demo's analyst-card layout

Talking point:

> Yesterday we used a finished ontology to investigate a case. Today we look underneath it. The question this app answers is: where did every fact in the ontology actually come from, and could you defend that origin to a court or an auditor?

## 3.2 Pipeline tour

Go to **Pipelines**.

Show:

- the DAG: five raw sources → `normalize_sources` → five normalized datasets → three resolution transforms → `build_ontology` → final entities and edges
- click `normalize_sources` to open its actual Python source in the bottom inspector pane
- click `resolve_persons` to show the entity-resolution priority order: passport ID → phone → name + dob → alias

Good thing to say:

> Every box in this graph is either a dataset or a transform. The transforms are real Python files in `pipeline/` — what you see in the inspector pane is the actual code, not a stylized summary. This is the closest the demo gets to what a Foundry engineer sees on a normal day.

Optional interaction:

- click each of the five transforms in order; show the row counts changing (157 normalized rows feed into resolution, 23 persons come out)
- note that `resolve_companies` and `resolve_accounts` are deliberately simple — most of the interesting logic lives in `resolve_persons`

## 3.3 Dataset inspection

Go to **Datasets**.

Walk the three groups in order:

1. **Raw Sources** — five files exactly as they exist on disk
2. **Normalized + Resolved** — six intermediate datasets the pipeline produces
3. **Final** — `ontology_entities` and `ontology_edges`, the inputs to the Gotham demo

For each, point out:

- the schema table (field name + declared type)
- row count and "produced by / consumed by" backlinks
- the paginated sample rows

Suggested narration:

> A schema is a contract. Once a raw column is declared as `dob: date`, every downstream transform can rely on it. This is the most boring slide in the deck and probably the most important one — most data disasters happen because schemas are implicit.

Demonstration:

- open `watchlist.csv` and show one row of raw input
- open `norm_watchlist` and show the same row with cleaned types and `_source_row` index
- open `resolved_persons` and find the same person, now merged with rows from other sources

## 3.4 Lineage deep-dive

Go to **Lineage**.

This is the central moment of the demo.

Search for **Kareem Haddad** and select the result.

Walk through the three panels in the main pane:

1. **Entity properties** — the seven fields stored on the Person object
2. **Upstream source rows** — every raw row across every dataset that contributed to this entity (14 rows in the starter dataset)
3. **Per-field provenance** — for each field, the exact row and column it came from, with notes when entity resolution merged across aliases

Good thing to say:

> The `aliases` field on Kareem Haddad contains "Karim Haddad" because a flight manifest had that spelling. The lineage tells you exactly which manifest row, and the note records that the merge happened because the passport numbers matched. If a journalist or an auditor asks "where did this alias come from?", the answer is one click away.

Important demonstration:

- click any source row in the provenance table — the app jumps to the Datasets tab and highlights that exact row
- this is the click-through that makes the audit story credible: not a claim about lineage, a working trace

## 3.5 Cross-link to Gotham

Still on the Lineage tab, scroll to the bottom of the Kareem Haddad view.

Click **"View Kareem Haddad in Gotham demo →"**.

The link opens the Gotham demo in a new tab, where students see the same entity in its investigation context.

Talking point:

> This is the bridge between the two apps. In Foundry you saw how the entity was built. In Gotham you see what an investigator does with it. The Person ID — `person::p8842101` — is identical in both, which is the whole point: the ontology is one thing, accessed through different tools.

## 3.6 Scale up

Switch from **starter** to **simulator**.

Say:

> The transforms are unchanged. The pipeline DAG is unchanged. The schemas are unchanged. The only thing that changed is the volume of raw input.

Then show:

- raw source row counts jump (hundreds of rows instead of dozens)
- the Person count goes from 23 to several hundred
- a lineage trace for the same person still works — same fields, more contributing rows

## 3.7 Critical perspectives — lineage and accountability

End the session by reframing what students just saw.

Talking points:

> Lineage is not a neutral engineering feature. It is the technical precondition for accountability. Without lineage, an analyst cannot honestly answer "why does the system say this person is risky?" — and neither can a regulator, a judge, or the person being flagged.

> But lineage also has limits. It tells you which raw row produced a fact. It does not tell you whether that raw row was correct, whether the transform code is fair, or whether the schema captures what matters. A perfectly audited pipeline can still produce systematically biased outputs.

> Palantir's strongest commercial argument is: structured, lineage-tracked systems are better for human rights than unstructured analyst access to raw databases. That argument is true *if* the lineage is actually inspected by people with power to act on it. It is false if lineage exists only on the engineering side and never reaches oversight.

## 4. Suggested 30-45 minute classroom flow

1. **2 min** — opening: what changes between Gotham and Foundry
2. **8-10 min** — Pipelines tab: the DAG, the inspector, read one transform aloud
3. **8-10 min** — Datasets tab: schema, raw → normalized → resolved progression
4. **10-12 min** — Lineage tab: full Kareem Haddad trace, click-through to source row, cross-link to Gotham
5. **3 min** — switch to simulator and note what does and doesn't change
6. **5 min** — critical perspectives discussion: lineage as accountability and its limits

## 5. Key teaching messages

- A Palantir-style ontology is **produced by code**, not assembled by hand
- Every intermediate stage is itself a **versionable, schema'd dataset**
- **Lineage** lets any final fact be traced to the raw row that produced it
- Lineage is the **technical precondition for audit**, but not by itself an audit
- The same ontology used by an investigator should be **defensible all the way back to the source**
- The Foundry demo and the Gotham demo show **two views of one model** — the engineering view and the analyst view

## 6. Good student questions to invite

- What happens to a downstream entity if a raw row is corrected? What if it is deleted?
- The pipeline embeds the resolution priority `passport > phone > name+dob > alias`. Who decided that order, and what fails when they are wrong?
- If a transform's code is updated, does old lineage still apply, or does the entire pipeline need to be re-run?
- The lineage tracks **which** row produced a value. Does it also tell you whether that row was correct?
- Could two pipelines produce the same ontology but with different lineage? Why does that matter?
- Foundry-style lineage is sometimes called "audit-ready." Audit-ready by whom — engineers, regulators, the people in the data?

## 7. Reset and recovery

If the seed needs to be regenerated (e.g., synthetic data changes):

```bash
python3 scripts/build_foundry_seed.py --output foundry-demo/seed.js
```

Browser UI state (active tab, selected entity, etc.) is held in `localStorage` under `foundry-studio-demo-v1:{datasetKey}`. To clear it, use the browser's site data tools or run `localStorage.clear()` in the dev console.

## 8. Optional extension ideas

- ask students to read one transform and propose an additional resolution rule (e.g., normalize phone numbers before matching)
- ask students to find an entity whose lineage looks suspicious (few sources, weak identifiers) and discuss what an analyst should do with it
- compare a person's lineage in `starter` vs `simulator` — what survives scale, what doesn't
- ask students to design a "lineage view for the data subject" — what would Kareem Haddad himself be entitled to see?
- debate: under GDPR or similar regimes, who is legally responsible when a transform produces a wrong fact about a real person?
