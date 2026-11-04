# Palantir platforms: research for the demo-palantir teaching tool

Compiled 4 November 2026 by a research agent, using about 50 web searches and fetches. Claude spot-checked three key claims against their original sources: the BVerfG 2023 ruling, the Dutch police "Raffinaderij" platform and the contents of Foundry Checkpoint records. All three held up. Items marked **[unverified]** could not be confirmed and should be checked before they go into teaching materials.

---

## A. Product map (2026)

| Product | What it does | Main users | Key terms |
|---|---|---|---|
| **Gotham** | Investigation and intelligence platform. It brings data together as objects, links and properties, and supports analysis on graphs, maps and timelines, as well as targeting work. | Police, intelligence agencies and militaries. Customised versions include Denmark's POL-INTEL, Bavaria's VeRA, Hessen's "Hessendata" and NRW's system. | Objects, links, search, graph, map |
| **Foundry** | Data integration and "operational" platform. Datasets are versioned through transactions. Transforms (written in Code Repositories, or built without code in Pipeline Builder) produce new datasets from existing ones, and Data Lineage shows how each dataset was made. The Ontology sits on top of the datasets. Its apps include Workshop (low-code apps), Object Explorer, Quiver (objects and time series), Contour (large tables) and Vertex (digital twin with what-if simulation). | Companies, NHS England (the Federated Data Platform), US federal agencies, ICE | Dataset, transform, build, branch, Ontology, Workshop |
| **AIP** (2023–) | Connects large language models (LLMs) to the Ontology. AIP Logic builds LLM-powered functions without code. AIP Chatbot Studio, formerly Agent Studio, builds chatbots that use Ontology data and tools and can edit data. AIP Evals tests how well these perform, and Automate runs logic on a schedule or trigger. There is also Palantir MCP, for outside AI agents. AI edits are *staged* for a person to review by default. | Companies, defence | Logic function, tools, staged edits, evals |
| **Apollo** | Continuous delivery system. It deploys and updates Gotham, Foundry and AIP across public cloud, on-premises servers, classified networks and edge devices. | Palantir, defence customers | Environments, fleet |
| **Maven Smart System** | Pentagon AI and data-fusion system for command and targeting. The contract ceiling rose to about $1.3bn through 2029, with 20,000+ users (May 2025). There is a NATO version, and Denmark has a deal combining Maven with Foundry. | US DoD, NATO, Denmark | Detect, tag, track |
| **TITAN** | US Army intelligence ground station that fuses sensor data. $178.4m for 10 prototypes (March 2024). | US Army | Deep sensing |
| **MetaConstellation / Skykit** | Satellite tasking with AI support; a rugged kit for working offline in the field. | Military, Ukraine | Edge |
| **Army Enterprise Agreement** | 10 years, capped at $10bn, consolidating the Army's Palantir contracts (August 2025). | US Army | — |
| **ImmigrationOS / ELITE** | ICE targeting and removal platform ($30m, April 2025). ELITE is a map-based app for finding people, with a 0–100 "address confidence score". | ICE | — |

## B. Accuracy check against the current demo

1. **Terminology.** Palantir says *object type, object, property, link type, link, Action type, function, object set, interface*, where the demo says entity and relationship types. Add a glossary.
2. **"Source mappings".** In Foundry, an object type is *backed by a dataset*: rows become objects, columns become properties and joins become links. Rename the mappings view to match.
3. **Missing kinetic layer.** Palantir splits the Ontology into a *semantic* layer (nouns: objects and links) and a *kinetic* layer (verbs: Actions that write data back to operational systems). The demo only edits data directly, while real edits go through Action types with parameters, validation, permissions, side effects and logs. This is the biggest conceptual gap.
4. **Pipelines.** The demo's model is broadly right. Foundry adds builds, branches, schedules and dataset versions. Real entity resolution uses confidence scores and thresholds, and false merges are a known risk (see Aleph's warnings about overly broad matching keys).
5. **Lineage.** Foundry's lineage tracks datasets, not individual rows. The demo's row- and field-level provenance goes further, so label it as a teaching extension. Missing: **markings (security labels) carry down lineage**, so a dataset made from a marked dataset inherits the marking, and only a privileged user can remove it.
6. **Copilot.** Label it a "rule-based stand-in for an AIP chatbot". Real AIP chatbots use tools and stage edits for human review.
7. **Analytics rules.** These are plausible stand-ins for Search Around-style network expansion. Brayne describes people with no police contact entering a "secondary surveillance network" this way.
8. **Gotham vs Foundry.** The two products share the Ontology, AIP and Apollo. Note that splitting them into two demos is a teaching simplification.
9. **Student guide updates.** NHS FDP: 137 trusts (April 2026), up to £330m over 7 years. Palantir is *not the data controller*, a claim that is contested in practice.

## C. Features to add, in priority order

1. **Role and markings switcher.** The same data looks different depending on the role logged in (patrol officer, financial analyst with access to personal data, data protection officer, contractor). This mirrors mandatory markings plus roles and projects. *Discussion:* privacy safeguard, or a way to justify merging everything?
2. **Markings carried through lineage.** Mark a raw dataset HEALTH and every dataset made from it turns red; removing the marking needs a justification. *Discussion:* the ICE/Medicaid data case.
3. **Checkpoints (purpose-justification prompts).** A prompt before sensitive searches, exports or multi-step network expansion. Records store the user, the time, the prompt exactly as shown, the justification and the items involved. This is a real Foundry feature, from the Palantir privacy team's PEPR 2021 paper. *Discussion:* students can type "routine" and nothing stops them. Compare the BVerfG's requirement of a written explanation for each case.
4. **Audit log with an auditor view.** Every search, view, export, action and AI call is logged, and an auditor can filter the log. *Discussion:* who audits the auditors, and the log itself becomes data about the people searched.
5. **Action types with writeback.** Actions such as "flag for screening", "add to watchlist" and "deny booking" change properties, which feeds back into the analytics. A simulated outside system receives the writebacks. *Discussion:* feedback loops, and how analysis produces the reality it claims to describe.
6. **Entity resolution with confidence scores.** A threshold slider for merging records: set it too low and an innocent person gets merged with a watchlisted one. Add an "unmerge" Action. *Discussion:* error is never neutral; transliteration of names; discrimination; the BVerfG's concern with margins of error.
7. **Simulated AIP agent.** A chatbot that calls tools, shows a trace of its steps, cites the objects behind its claims and stages Actions for approval. Scripted failures: a made-up link, a request beyond the user's access (denied and logged) and an "approve all" button. *Discussion:* the human in the loop, Maven, evals as governance.
8. **ELITE-style leads map.** Synthetic leads with a 0–100 address confidence score calculated from source type and age, with the formula shown. *Discussion:* data repurposed from health to enforcement.
9. **Purpose and legal-basis tags ("Karlsruhe mode").** The BVerfG 2023 criteria applied as rules that block certain joins. *Discussion:* law written as code vs law applied with judgement.
10. **Workshop-style app builder.** Students build a border officer's screen; removing the source and date fields changes decisions. *Discussion:* interface design as governance.
11. **Object sets / saved lists.** Shared lists whose membership changes over time, shown as differences between versions. *Discussion:* lists as instruments of power.
12. **Retention clock.** A time slider shows data that should have been deleted still present in derived datasets or other copies.
13. **Deployment / sovereignty view.** Where the data and software sit, and who has access. *Discussion:* European exits.
14. **Vertex-style what-if simulation (optional).** Thresholds vs who gets flagged.

## D. Case studies

1. **ICE: ImmigrationOS and ELITE (2025–26).** A $30m contract awarded without competition (April 2025). ELITE, reported January 2026, draws on Medicaid, USCIS and Thomson Reuters CLEAR data. Court filings in July 2026 show that Medicaid data shared beyond a court order reached Palantir through a Teams chat; Palantir says it was deleted.
2. **US federal data consolidation (2025).** The executive order on information silos; the IRS database reported by the NYT; letters from Democratic lawmakers; Palantir's reply that it is "not building a master database".
3. **Germany.** BVerfG, 16 February 2023 (1 BvR 1547/19, 1 BvR 2634/20): Hamburg's provision was void outright; Hesse's was unconstitutional but stayed in force until 30 September 2023. Bavaria's VeRA went live in September 2024, and a constitutional complaint followed in July 2025 (GFF). By 2026 many states had passed new laws. The complaint against NRW was not accepted (February 2026); Bavaria and Hesse are pending. The federal government is reviewing nationwide use.
4. **Netherlands.** Police have used Palantir since 2012 in the "Raffinaderij" platform, revealed by de Volkskrant through Open Government Act (Woo) requests, with about 99% of the documents redacted (Buro Jansen & Janssen). The Ministry of Defence plans an alternative within two years.
5. **Denmark: POL-INTEL.** Galis & Karlsson (2025). Denmark is now looking for domestic replacements.
6. **NHS Federated Data Platform.** Awarded November 2023; 137 trusts by April 2026; the BMA urged doctors to limit use (February 2026).
7. **Military.** Karp's 2023 claim about targeting in Ukraine; Maven; TITAN; the Israel MoD agreement (January 2024; details unclear, use claims **[unverified]**).
8. **LAPD (historical).** Brayne 2017/2020.

## E. Reading list

- Brayne, S. (2017). Big Data Surveillance: The Case of Policing. *American Sociological Review* 82(5): 977–1008. doi:10.1177/0003122417725865
- Brayne, S. (2020). *Predict and Surveil*. Oxford University Press.
- Iliadis, A. & Acker, A. (2022). The seer and the seen: Surveying Palantir's surveillance platform. *The Information Society*. doi:10.1080/01972243.2022.2100851 **[check volume/issue]**
- Galis, V. & Karlsson, B. (2025). Scientification through privatization: POL-INTEL in Denmark. *Theoretical Criminology*. doi:10.1177/13624806251345461
- Jagasia, A. & Wee, Y. W. (2021). Lightweight Purpose Justification Service for Embedded Accountability. USENIX PEPR '21.
- BVerfG, 1 BvR 1547/19, 1 BvR 2634/20 (16 February 2023).
- Bäuerle, M. (2026). Verfassungsblog, on legislation after the ruling.

## F. Open analogues

- Palantir Developer Tier (free) and learn.palantir.com courses. Check the terms before using them in class.
- FollowTheMoney / Aleph / OpenSanctions: an open ontology with CSV mappings and false-merge warnings. A good model, and a contrast from investigative journalism.

## G. Sources

- https://www.palantir.com/docs/foundry/ontology/core-concepts
- https://www.palantir.com/docs/foundry/getting-started/foundry-platform-summary-llm/
- https://blog.palantir.com/connecting-ai-to-decisions-with-the-palantir-ontology-c73f7b0a1a72
- https://palantir.com/docs/foundry/checkpoints/core-concepts/
- https://palantir.com/docs/foundry/checkpoints/overview/
- https://palantir.com/docs/foundry/security/markings/
- https://palantir.com/docs/foundry/aip/aip-features/
- https://www.palantir.com/docs/foundry/agent-studio/overview
- https://palantir.com/docs/foundry/vertex/example-use-cases/
- https://blog.palantir.com/privacy-civil-liberties-engineering-palantir-explained-5-4f027b207923
- https://fpf.org/wp-content/uploads/2021/06/Session-8-2-Lightweight-Purpose-by-Jagasia-Wee.pdf
- https://blog.palantir.com/palantir-apollo-powering-saas-where-no-saas-has-gone-before-7be3e565c379
- https://immpolicytracking.org/policies/reported-palantir-awarded-30-million-to-build-immigrationos-surveillance-platform-for-ice
- https://gigazine.net/gsc_news/en/20260116-us-ice-palantir-elite
- https://www.hppr.org/npr-news/2026-07-17/ice-shared-medicaid-data-it-wasnt-supposed-to-have-with-palantir
- https://nextgov.com/modernization/2025/06/democrats-press-palantir-about-reported-creation-irs-mega-database/406144
- https://bundesverfassungsgericht.de/SharedDocs/Pressemitteilungen/EN/2023/bvg23-018.html
- https://verfassungsblog.de/?p=106048
- https://posteo.de/en/news/germany-legal-challenge-alleges-unconstitutional-data-analysis-by-bavarian-police
- https://www.yahoo.com/news/articles/germany-weighs-nationwide-palantirs-controversial-161014140.html
- https://nltimes.nl/2025/08/22/dutch-police-also-use-controversial-ai-intelligence-software-american-palantir
- https://euronews.com/next/2026/06/05/why-are-european-governments-reevaluating-their-agreements-with-us-defence-tech-contractor
- https://parallelparliament.co.uk/mp/zubir-ahmed/debate/2026-04-16/commons/westminster-hall/nhs-federated-data-platform
- https://www.theregister.com/2025/08/01/palantir_us_army_contract/
- https://defensescoop.com/2025/05/23/dod-palantir-maven-smart-system-contract-increase/
- https://defensescoop.com/2024/03/06/palantir-army-titan-ground-station-award-178-million/
- https://www.euronews.com/next/2023/02/02/ukraine-crisis-palantir
- https://en.globes.co.il/en/article-What-is-Palantir-doing-in-Israel-1001468876
- https://researcher.itu.dk/p/en/research-outputs/scientification-through-privatization-pol-intel-in-denmark
- https://docs.aleph.occrp.org/developers/mappings
- https://www.opensanctions.org/docs/entities/
