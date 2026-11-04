"""
pipeline/governance.py — the one definition of markings, roles, purposes,
checkpoints, honesty labels and object/link marking rules (PHASE1_CONTRACT.md
§1–§4).

Both seed builders (``scripts/build_ontology_seed.py`` for Investigate and
``scripts/build_foundry_seed.py`` for Build) and the generator
(``scripts/generate_synthetic_sources.py``, for ``manifest.json``) import this
module, so the two apps cannot drift apart.

What lives here
---------------
``governance_block()``
    The ``catalog[ds].governance`` object written into both seeds:
    ``{markings, roles, defaultRole, purposes, checkpoints, honesty,
    purposeRules, legalBasisNote, discussions}`` (the last three are Phase 2,
    PHASE2_CONTRACT.md §4–§5).

``SOURCE_DATASETS``
    Per raw dataset: file, markings, purpose, legal basis, retention.  The
    generator writes these into ``synthetic_data/<profile>/manifest.json``;
    the builders read the manifest (``load_manifest``), not this table, so a
    manifest edited by hand is what the seeds show.

``annotate_objects(entities, edges, file_markings)``
    Adds ``markings``, ``propertyMarkings`` and ``sourceMarkings`` to every
    entity and ``markings`` to every edge (contract §3).  Computed only from
    entity types, edge types, ``resolution.mergedFrom`` and the edge set, which
    the two builders already agree on, so the result is identical in both
    seeds.

``union_markings`` / ``merge_provenance`` / ``derived_governance``
    The dataset-level union rule used by ``lib.Transform.run()`` and by the
    pipeline steps (contract §4).

Marking order everywhere is the order of ``MARKINGS`` (OPEN, PII, FIN,
TELECOM, HEALTH, LE-SENSITIVE), so lists compare equal as lists.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence

# ---------------------------------------------------------------------------
# Markings and roles (contract §1)
# ---------------------------------------------------------------------------

MARKINGS: List[Dict[str, str]] = [
    {"id": "OPEN", "label": "Open", "description": "No restriction.", "colour": "--mk-open"},
    {"id": "PII", "label": "Personal data", "description": "Identifies a living person.", "colour": "--mk-pii"},
    {"id": "FIN", "label": "Financial", "description": "Bank and payment data.", "colour": "--mk-fin"},
    {"id": "TELECOM", "label": "Telecom", "description": "Phone numbers, handsets and location pings.", "colour": "--mk-telecom"},
    {"id": "HEALTH", "label": "Health", "description": "Collected for care; purpose-limited.", "colour": "--mk-health"},
    {"id": "LE-SENSITIVE", "label": "Law-enforcement sensitive", "description": "Watchlist and intelligence.", "colour": "--mk-le"},
]
MARKING_IDS: List[str] = [m["id"] for m in MARKINGS]
_MARKING_RANK = {mid: i for i, mid in enumerate(MARKING_IDS)}

ROLES: List[Dict[str, Any]] = [
    {
        "id": "patrol",
        "label": "Patrol officer",
        "description": "Front-line officer. Sees people, phones, places and the watchlist, but no bank or health data.",
        "markingsVisible": ["OPEN", "PII", "TELECOM", "LE-SENSITIVE"],
        "purposes": ["public-order"],
        "canApprove": False,
        "canRemoveMarkings": False,
        "canOpenOversight": False,
    },
    {
        "id": "fin-analyst",
        "label": "Financial-crime analyst",
        "description": "Investigates money flows. Sees people, bank data and the watchlist; phone numbers, handsets and pings are withheld.",
        "markingsVisible": ["OPEN", "PII", "FIN", "LE-SENSITIVE"],
        "purposes": ["financial-crime"],
        "canApprove": True,
        "canRemoveMarkings": False,
        "canOpenOversight": False,
    },
    {
        "id": "dpo",
        "label": "Data protection officer",
        "description": "Oversees lawful use. Sees every marking, read-only, and is the only role that may remove a marking (with a stated legal basis).",
        "markingsVisible": list(MARKING_IDS),
        "purposes": ["oversight"],
        "canApprove": False,
        "canRemoveMarkings": True,
        "canOpenOversight": True,
    },
    {
        "id": "auditor",
        "label": "Auditor",
        "description": "Reviews the audit log. Sees only open data in the apps, but can read who looked at what, when and why.",
        "markingsVisible": ["OPEN"],
        "purposes": ["oversight"],
        "canApprove": False,
        "canRemoveMarkings": False,
        "canOpenOversight": True,
    },
    {
        "id": "contractor",
        "label": "Platform contractor",
        "description": "Maintains the platform. Sees the schema and open data only.",
        "markingsVisible": ["OPEN"],
        "purposes": ["maintenance"],
        "canApprove": False,
        "canRemoveMarkings": False,
        "canOpenOversight": False,
    },
]
DEFAULT_ROLE = "fin-analyst"

PURPOSES: List[Dict[str, str]] = [
    {"id": "public-order", "label": "Public order"},
    {"id": "financial-crime", "label": "Financial crime"},
    {"id": "oversight", "label": "Oversight"},
    {"id": "maintenance", "label": "Platform maintenance"},
    {"id": "healthcare", "label": "Health care"},
    {"id": "sanctions-screening", "label": "Sanctions screening"},
    {"id": "border-security", "label": "Border security"},
    {"id": "telecom-billing", "label": "Telecom billing"},
    {"id": "public-record", "label": "Public record"},
]

# ---------------------------------------------------------------------------
# Checkpoints (contract §2)
# ---------------------------------------------------------------------------

CHECKPOINTS: List[Dict[str, Any]] = [
    {
        "id": "cp-expand-telecom",
        "trigger": "graph.expand.telecom",
        "prompt": "You are about to expand from a person to their devices and every place those devices were observed. State the investigative purpose.",
        "requiresPurpose": False,
        "allowedRoles": ["patrol", "fin-analyst", "dpo"],
        "refusalText": "Your role cannot expand to devices and locations. This attempt has been logged.",
    },
    {
        "id": "cp-search-phone",
        "trigger": "search.byPhone",
        "prompt": "You are searching by phone number. State why you need to identify the holder of this number.",
        "requiresPurpose": False,
        "allowedRoles": ["patrol", "fin-analyst", "dpo"],
        "refusalText": "Your role cannot search by phone number. This attempt has been logged.",
    },
    {
        "id": "cp-export",
        "trigger": "export.json",
        "prompt": "You are about to export ontology data outside the platform. State the purpose and the recipient.",
        "requiresPurpose": True,
        "allowedRoles": ["fin-analyst", "dpo"],
        "refusalText": "Your role cannot export ontology data. This attempt has been logged.",
    },
    {
        "id": "cp-marking-remove",
        "trigger": "marking.remove",
        "prompt": "You are about to remove a marking. Everything derived from this dataset will become visible to more roles. State the legal basis.",
        "requiresPurpose": True,
        "allowedRoles": ["dpo"],
        "minLength": 20,
        "refusalText": "Your role cannot remove markings. This attempt has been logged.",
    },
    # Phase 2 (PHASE2_CONTRACT.md §4)
    {
        "id": "cp-action-sensitive",
        "trigger": "action.execute",
        "prompt": "You are about to run an Action that changes data and sends a message to an external system. State why it is needed and for what purpose.",
        "requiresPurpose": True,
        "allowedRoles": ["fin-analyst", "dpo"],
        "refusalText": "Your role cannot run sensitive Actions. This attempt has been logged.",
    },
    {
        "id": "cp-danger-statement",
        "trigger": "expand.danger",
        "prompt": "Describe the concrete danger that justifies widening this analysis beyond the first hop.",
        "requiresPurpose": False,
        "allowedRoles": ["patrol", "fin-analyst", "dpo"],
        "minLength": 30,
        "refusalText": "Your role cannot widen an analysis beyond the first hop. This attempt has been logged.",
    },
    {
        "id": "cp-exception",
        "trigger": "purpose.exception",
        "prompt": "You are asking for an exception to a purpose rule. State the legal basis and why the rule should not apply in this case. The request is recorded as an exception for the data protection officer.",
        "requiresPurpose": True,
        "allowedRoles": ["fin-analyst", "dpo"],
        "minLength": 20,
        "tag": "exception",
        "refusalText": "Your role cannot request exceptions to purpose rules. This attempt has been logged.",
    },
]

# ---------------------------------------------------------------------------
# Purpose rules ("Karlsruhe mode", PHASE2_CONTRACT.md §4)
# ---------------------------------------------------------------------------

PURPOSE_RULES: List[Dict[str, Any]] = [
    {"id": "R1", "text": "Automated cross-dataset analysis needs a stated purpose on the session.",
     "operations": ["expand", "rule", "action"], "requires": "sessionPurpose", "effect": "block"},
    {"id": "R2", "text": "Data collected for healthcare may not be combined with law-enforcement purposes.",
     "operations": ["expand", "rule", "action", "view"],
     "incompatible": {"data": ["healthcare"], "session": ["public-order", "financial-crime"]}, "effect": "block"},
    {"id": "R3", "text": "Expansion beyond the first hop requires a concrete, logged danger statement.",
     "operations": ["expand"], "depthOver": 1, "effect": "checkpoint", "checkpointId": "cp-danger-statement"},
]
LEGAL_BASIS_NOTE = ("Our abstraction of the BVerfG 2023 ruling's logic, not its text "
                    "[to verify against the press release before teaching as the court's criteria].")

# Marking -> purpose of the data it marks (contract §4: HEALTH => healthcare).
MARKING_PURPOSE: Dict[str, str] = {"HEALTH": "healthcare"}

# ---------------------------------------------------------------------------
# Honesty labels (contract §2; spec §2.1; research report §B and §G)
# ---------------------------------------------------------------------------

DOC_CORE_CONCEPTS = "https://www.palantir.com/docs/foundry/ontology/core-concepts"
DOC_PLATFORM_SUMMARY = "https://www.palantir.com/docs/foundry/getting-started/foundry-platform-summary-llm/"
DOC_ONTOLOGY_BLOG = "https://blog.palantir.com/connecting-ai-to-decisions-with-the-palantir-ontology-c73f7b0a1a72"
DOC_MARKINGS = "https://palantir.com/docs/foundry/security/markings/"
DOC_CHECKPOINTS = "https://palantir.com/docs/foundry/checkpoints/overview/"
DOC_CHECKPOINTS_CONCEPTS = "https://palantir.com/docs/foundry/checkpoints/core-concepts/"
DOC_AGENT_STUDIO = "https://www.palantir.com/docs/foundry/agent-studio/overview"
DOC_PEPR = "https://fpf.org/wp-content/uploads/2021/06/Session-8-2-Lightweight-Purpose-by-Jagasia-Wee.pdf"
DOC_BVERFG = "https://bundesverfassungsgericht.de/SharedDocs/Pressemitteilungen/EN/2023/bvg23-018.html"
DOC_ALEPH = "https://docs.aleph.occrp.org/developers/mappings"
DOC_ELITE = "https://gigazine.net/gsc_news/en/20260116-us-ice-palantir-elite"
DOC_APOLLO = "https://blog.palantir.com/palantir-apollo-powering-saas-where-no-saas-has-gone-before-7be3e565c379"
DOC_MAVEN = "https://defensescoop.com/2025/05/23/dod-palantir-maven-smart-system-contract-increase/"

HONESTY_LABELS = {
    "mirrors": "Mirrors Foundry",
    "simplified": "Simplified",
    "extension": "Teaching extension",
}

HONESTY: List[Dict[str, Any]] = [
    {
        "id": "inv.agent", "kind": "simplified", "title": "Agent (simulated AIP)",
        "text": ("Scripted stand-in for an AIP agent, with no language model: it plans tool calls from your question by fixed rules, "
                 "runs each call through your role, the purpose rules, Checkpoints and the audit log, cites the objects behind "
                 "its claims and stages edits for review. Real AIP agents use an LLM with tools; here the failures are scripted for teaching."),
        "docUrl": DOC_AGENT_STUDIO,
    },
    {
        "id": "inv.investigations", "kind": "simplified", "title": "Investigations",
        "text": "Scripted scenarios with fixed scores stand in for an analyst's own investigation. In Gotham an investigation is assembled by the analyst from searches, graphs and maps; nothing is pre-scored.",
        "docUrl": None,
    },
    {
        "id": "inv.analytics", "kind": "simplified", "title": "Analytics",
        "text": "Plausible, hand-written rules stand in for Search Around-style network expansion. Expansion like this is how people with no police contact enter what Brayne calls a 'secondary surveillance network'.",
        "docUrl": None,
    },
    {
        "id": "inv.map", "kind": "simplified", "title": "Map",
        "text": "Synthetic points on a basic map. Gotham supports analysis on maps alongside graphs and timelines; layers, imagery, tracks and geofences are not modelled here.",
        "docUrl": None,
    },
    {
        "id": "inv.object-types", "kind": "mirrors", "title": "Object types",
        "text": "Object types are the nouns of the Ontology's semantic layer, as in Foundry and Gotham. Palantir's own terms are object type, object, property and link type; this demo used to say entity and relationship types.",
        "docUrl": DOC_CORE_CONCEPTS,
    },
    {
        "id": "inv.properties", "kind": "mirrors", "title": "Properties",
        "text": "Properties are the typed attributes of an object type; the columns of the backing dataset become properties.",
        "docUrl": DOC_CORE_CONCEPTS,
    },
    {
        "id": "inv.link-types", "kind": "mirrors", "title": "Link types",
        "text": "Link types connect two object types; in Foundry a join between backing datasets becomes a link.",
        "docUrl": DOC_CORE_CONCEPTS,
    },
    {
        "id": "inv.backing-datasets", "kind": "mirrors", "title": "Backing datasets",
        "text": "In Foundry an object type is backed by a dataset: rows become objects, columns become properties and joins become links. This view was called 'Source mappings' before.",
        "docUrl": DOC_CORE_CONCEPTS,
    },
    {
        "id": "inv.objects", "kind": "simplified", "title": "Objects",
        "text": "Objects are edited directly here. In Palantir, edits go through Action types (the kinetic layer) with parameters, validation, permissions, side effects and logs, and write back to operational systems.",
        "docUrl": DOC_ONTOLOGY_BLOG,
    },
    {
        "id": "inv.graph", "kind": "simplified", "title": "Graph",
        "text": "Objects and links drawn as a graph, as in Gotham's graph view. Layout, expansion and styling are simplified, and the graph is redrawn from a static seed.",
        "docUrl": None,
    },
    {
        "id": "build.pipelines", "kind": "simplified", "title": "Pipelines",
        "text": "Transforms produce new datasets from existing ones, as in Foundry. Builds, branches, schedules and dataset versions are not modelled; the pipeline runs once, offline, when the seed is built.",
        "docUrl": DOC_PLATFORM_SUMMARY,
    },
    {
        "id": "build.datasets", "kind": "simplified", "title": "Datasets",
        "text": "Each dataset is a snapshot with sample rows. Foundry datasets are versioned through transactions, and every build produces a new version.",
        "docUrl": DOC_PLATFORM_SUMMARY,
    },
    {
        "id": "build.lineage", "kind": "extension", "title": "Lineage",
        "text": "Row- and field-level provenance goes beyond Foundry's dataset-level lineage.",
        "docUrl": DOC_PLATFORM_SUMMARY,
    },
    {
        "id": "build.markings", "kind": "mirrors", "title": "Markings",
        "text": "Markings carry down lineage: a dataset made from a marked dataset inherits the marking, and only a privileged user can remove it. Here the union is computed when the seed is built and overrides are kept in your browser.",
        "docUrl": DOC_MARKINGS,
    },
    {
        "id": "oversight.audit", "kind": "simplified", "title": "Audit log",
        "text": "Searches, views, exports, checkpoints and role changes are logged in a hash-chained log kept in this browser. A real platform keeps its audit log on the server; anyone with this browser can clear this one, and the clear is logged.",
        "docUrl": None,
    },
    {
        "id": "session.roles", "kind": "simplified", "title": "Roles",
        "text": "Five roles stand in for the groups, projects and organisations that grant access in a real deployment, combined with mandatory markings. The role switch is a client-side convenience, not security: anyone can pick any role.",
        "docUrl": DOC_MARKINGS,
    },
    {
        "id": "session.checkpoints", "kind": "mirrors", "title": "Checkpoints",
        "text": "A purpose-justification prompt before sensitive searches, exports or network expansion. The record keeps the user, the time, the prompt exactly as shown, the justification and the items involved, as in Foundry Checkpoints (Jagasia & Wee, PEPR '21). Nothing stops you typing 'routine'.",
        "docUrl": DOC_CHECKPOINTS,
    },
    # Phase 2
    {
        "id": "inv.actions", "kind": "mirrors", "title": "Actions",
        "text": "Action types with parameters, validation, permissions, side effects, logs and writeback to operational systems: the Ontology's kinetic layer, as in Foundry. Simplified: the receiving systems are panels in this page, not real APIs.",
        "docUrl": DOC_CORE_CONCEPTS,
    },
    {
        "id": "inv.karlsruhe", "kind": "extension", "title": "Karlsruhe mode",
        "text": "Purpose rules that block combining data collected for incompatible purposes. Not a Palantir feature: our abstraction of the logic of the German Constitutional Court's 2023 ruling on automated data analysis, not its text.",
        "docUrl": DOC_BVERFG,
    },
    {
        "id": "build.resolution", "kind": "simplified", "title": "Entity resolution",
        "text": "Real entity resolution scores candidate matches and merges above a threshold; false merges are a known risk. Simplified: our scorer is a transparent weighted sum of a few signals, and the pipeline's own deterministic merges are fixed.",
        "docUrl": DOC_ALEPH,
    },
    # Phase 3 (PHASE3_CONTRACT.md §1)
    {
        "id": "inv.leads", "kind": "simplified", "title": "Leads",
        "text": ("A 0\u2013100 address confidence score from source type and age, in the style of ICE's ELITE app. "
                 "Simplified: the formula is ours; ELITE's is not public. Here every weight, age and source is shown."),
        "docUrl": DOC_ELITE,
    },
    {
        "id": "inv.object-sets", "kind": "mirrors", "title": "Object sets",
        "text": ("Saved, shareable lists of objects whose membership changes over time, as with Foundry object sets. "
                 "Here versions and sharing are kept in your browser, and sharing is simulated by role."),
        "docUrl": DOC_CORE_CONCEPTS,
    },
    {
        "id": "build.retention", "kind": "simplified", "title": "Retention",
        "text": ("Each dataset carries a retention period; the slider greys out rows past it and counts derived rows that still "
                 "carry them. Simplified: nothing is ever deleted here, and in a real platform deletion has to reach every "
                 "derived dataset, export and copy."),
        "docUrl": None,
    },
    {
        "id": "deployment", "kind": "extension", "title": "Deployment",
        "text": ("Where this classroom tool lives: static files on GitHub Pages, map tiles from OpenStreetMap, and the session, "
                 "audit log and governance in your own browser's localStorage, with nothing on a server. Not a Palantir view: "
                 "real deployments run in the customer's cloud or on premises, updated by Apollo."),
        "docUrl": DOC_APOLLO,
    },
]
for _entry in HONESTY:
    _entry["label"] = HONESTY_LABELS[_entry["kind"]]

HONESTY_IDS: List[str] = [h["id"] for h in HONESTY]

# ---------------------------------------------------------------------------
# Discussion cards (PHASE2_CONTRACT.md §5; spec §5.4; research report §D, §G)
# ---------------------------------------------------------------------------

DISCUSSION_DISCLAIMER = "Discussion material about real institutions and public reporting. Nothing here simulates a real person."

DISCUSSIONS: List[Dict[str, Any]] = [
    {
        "id": "disc-ice-elite",
        "title": "ICE: ImmigrationOS and ELITE (2025\u201326)",
        "attachedTo": ["build.markings", "inv.leads"],
        "summary": ("In April 2025 US Immigration and Customs Enforcement gave Palantir a $30m contract, without competition, "
                    "for an \"ImmigrationOS\" targeting and removal platform. ELITE, reported in January 2026, is a map-based app "
                    "for finding people that draws on Medicaid, USCIS and Thomson Reuters CLEAR data and shows a 0\u2013100 "
                    "\"address confidence score\". Court filings in July 2026 describe Medicaid data, shared beyond what a court "
                    "order allowed, reaching Palantir through a Teams chat; Palantir says the data was deleted."),
        "questions": [
            "What would a HEALTH marking have prevented here, and what would it not have prevented?",
            "What does \"deleted\" mean once derived datasets have been built from the data?",
        ],
        "sources": [
            "https://immpolicytracking.org/policies/reported-palantir-awarded-30-million-to-build-immigrationos-surveillance-platform-for-ice",
            "https://gigazine.net/gsc_news/en/20260116-us-ice-palantir-elite",
            "https://www.hppr.org/npr-news/2026-07-17/ice-shared-medicaid-data-it-wasnt-supposed-to-have-with-palantir",
        ],
    },
    {
        "id": "disc-bverfg-2023",
        "title": "German Constitutional Court, 16 February 2023 (1 BvR 1547/19, 1 BvR 2634/20)",
        "attachedTo": ["session.checkpoints", "inv.karlsruhe"],
        "summary": ("On 16 February 2023 the court ruled on police powers for automated data analysis in Hamburg and Hesse. Hamburg's provision was "
                    "void outright; Hesse's was unconstitutional but stayed in force until 30 September 2023. Bavaria's system "
                    "(VeRA, built on Palantir) went live in September 2024 and a constitutional complaint followed in July 2025. "
                    "By 2026 many states had passed new laws; the complaint against North Rhine-Westphalia was not accepted "
                    "(February 2026), those against Bavaria and Hesse are pending, and the federal government is reviewing "
                    "nationwide use."),
        "questions": [
            "Is a free-text Checkpoint the kind of threshold the court had in mind?",
            "Can a rule engine implement a proportionality test, or only imitate one?",
        ],
        "sources": [
            "https://bundesverfassungsgericht.de/SharedDocs/Pressemitteilungen/EN/2023/bvg23-018.html",
            "https://verfassungsblog.de/?p=106048",
            "https://posteo.de/en/news/germany-legal-challenge-alleges-unconstitutional-data-analysis-by-bavarian-police",
            "https://www.yahoo.com/news/articles/germany-weighs-nationwide-palantirs-controversial-161014140.html",
        ],
    },
    {
        "id": "disc-raffinaderij",
        "title": "Dutch police: the \"Raffinaderij\" platform",
        "attachedTo": ["oversight.audit"],
        "summary": ("Dutch police have used Palantir software since 2012 inside a platform called the \"Raffinaderij\" "
                    "(refinery). Its use became public through Open Government Act (Woo) requests by de Volkskrant; about 99% "
                    "of the released documents were redacted (Buro Jansen & Janssen). The Ministry of Defence plans an "
                    "alternative within two years."),
        "questions": [
            "What does an audit log mean if the public cannot see that the system exists?",
            "Who is the auditor here, and who audits them?",
        ],
        "sources": [
            "https://nltimes.nl/2025/08/22/dutch-police-also-use-controversial-ai-intelligence-software-american-palantir",
        ],
    },
    {
        "id": "disc-nhs-fdp",
        "title": "NHS England: the Federated Data Platform",
        "attachedTo": ["session.roles", "build.markings"],
        "summary": ("NHS England awarded the Federated Data Platform contract to Palantir in November 2023, worth up "
                    "to \u00a3330m over seven years; 137 NHS trusts were using it by April 2026. Palantir says it is not the "
                    "data controller, a claim that is contested in practice, and in February 2026 the British Medical "
                    "Association urged doctors to limit their use of the platform."),
        "questions": [
            "Does \"not the controller\" survive once the vendor's software decides what each role can see?",
            "Who should define the roles and markings on a health platform: the hospital, the ministry or the vendor?",
        ],
        "sources": [
            "https://parallelparliament.co.uk/mp/zubir-ahmed/debate/2026-04-16/commons/westminster-hall/nhs-federated-data-platform",
        ],
    },
    {
        "id": "disc-pol-intel",
        "title": "Denmark: POL-INTEL and European exits",
        "attachedTo": ["build.pipelines", "deployment"],
        "summary": ("Danish police use POL-INTEL, a customised version of Gotham. Galis and Karlsson (2025) study it under "
                    "the title \"Scientification through privatization\". Denmark is now looking for domestic replacements, "
                    "and other European governments are re-evaluating their agreements with US defence-technology suppliers."),
        "questions": [
            "What is sovereignty when the platform, and its updates, are delivered by the vendor?",
            "Which decisions in a pipeline are technical, and which are policy made by whoever writes the transforms?",
        ],
        "sources": [
            "https://researcher.itu.dk/p/en/research-outputs/scientification-through-privatization-pol-intel-in-denmark",
            "https://euronews.com/next/2026/06/05/why-are-european-governments-reevaluating-their-agreements-with-us-defence-tech-contractor",
        ],
    },
    # Phase 3 (PHASE3_CONTRACT.md §1; spec §5.4; research §A, §C.7)
    {
        "id": "disc-maven",
        "title": "Maven Smart System",
        "attachedTo": ["inv.agent"],
        "summary": ("Maven Smart System is the Pentagon's AI and data-fusion system for command and targeting, built on "
                    "Palantir software: it detects, tags and tracks. In May 2025 the contract ceiling rose to about $1.3bn "
                    "through 2029, with more than 20,000 users. There is a NATO version, and Denmark has a deal combining "
                    "Maven with Foundry. Like an AIP agent, it puts machine suggestions in front of people who decide "
                    "what to act on; at that scale, how closely each suggestion is checked is an open question."),
        "questions": [
            "What does \"human in the loop\" mean when more than 20,000 users each review machine suggestions?",
            "Which of this agent's scripted failures would be hardest to catch at that scale, and who would notice?",
        ],
        "sources": [DOC_MAVEN],
    },
]
for _card in DISCUSSIONS:
    _card["disclaimer"] = DISCUSSION_DISCLAIMER


def governance_block() -> Dict[str, Any]:
    """The ``governance`` object for one dataset key (a fresh deep copy)."""
    honesty = [
        {"id": h["id"], "kind": h["kind"], "label": h["label"], "title": h["title"],
         "text": h["text"], "docUrl": h["docUrl"]}
        for h in HONESTY
    ]
    return copy.deepcopy({
        "markings": MARKINGS,
        "roles": ROLES,
        "defaultRole": DEFAULT_ROLE,
        "purposes": PURPOSES,
        "checkpoints": CHECKPOINTS,
        "honesty": honesty,
        "purposeRules": PURPOSE_RULES,
        "legalBasisNote": LEGAL_BASIS_NOTE,
        "discussions": DISCUSSIONS,
    })


# ---------------------------------------------------------------------------
# Raw datasets and the manifest (contract §4)
# ---------------------------------------------------------------------------

# Legal bases are illustrative for teaching, not legal advice.
SOURCE_DATASETS: Dict[str, Dict[str, Any]] = {
    "watchlist": {
        "file": "watchlist.csv",
        "markings": ["LE-SENSITIVE"],
        "purpose": "sanctions-screening",
        "legalBasis": "EU restrictive measures (e.g. Council Regulation (EU) No 269/2014); illustrative",
        "retentionDays": 1825,
    },
    "company_registry": {
        "file": "company_registry.csv",
        "markings": ["OPEN"],
        "purpose": "public-record",
        "legalBasis": "Public company register, open by law; illustrative",
        "retentionDays": 3650,
    },
    "flight_manifests": {
        "file": "flight_manifests.csv",
        "markings": ["PII"],
        "purpose": "border-security",
        "legalBasis": "PNR Directive (EU) 2016/681, five-year retention; illustrative",
        "retentionDays": 1825,
    },
    "bank_transactions": {
        "file": "bank_transactions.csv",
        "markings": ["FIN"],
        "purpose": "financial-crime",
        "legalBasis": "Anti-money-laundering record keeping, Directive (EU) 2015/849 Art. 40; illustrative",
        "retentionDays": 1825,
    },
    "mobile_location_pings": {
        "file": "mobile_location_pings.jsonl",
        "markings": ["TELECOM"],
        "purpose": "telecom-billing",
        "legalBasis": "Traffic data kept for billing, ePrivacy Directive 2002/58/EC Art. 6; illustrative",
        "retentionDays": 180,
    },
    "clinic_registrations": {
        "file": "clinic_registrations.csv",
        "markings": ["HEALTH"],
        "purpose": "healthcare",
        "legalBasis": "GDPR Art. 9(2)(h), provision of health care; medical-record retention as under the Dutch WGBO (20 years); illustrative",
        "retentionDays": 7300,
    },
}
SOURCE_ORDER: List[str] = list(SOURCE_DATASETS)
FILE_TO_SOURCE: Dict[str, str] = {v["file"]: k for k, v in SOURCE_DATASETS.items()}

# resolution.mergedFrom ref prefix -> raw file
REF_SOURCE_FILE: Dict[str, str] = {
    "watchlist": "watchlist.csv",
    "company": "company_registry.csv",
    "flight": "flight_manifests.csv",
    "ping": "mobile_location_pings.jsonl",
    "clinic": "clinic_registrations.csv",
}

# Derived datasets are built for the investigating unit; their legal basis is
# not recorded anywhere — that gap is the teaching point of F9.
DERIVED_PURPOSE = "financial-crime"
DERIVED_LEGAL_BASIS = "Not recorded: this derived dataset combines inputs collected for other purposes (see inputPurposes)."


def manifest_for(as_of: Mapping[str, str]) -> Dict[str, Dict[str, Any]]:
    """Manifest content for one profile; ``as_of`` maps dataset key -> date."""
    out: Dict[str, Dict[str, Any]] = {}
    for key in SOURCE_ORDER:
        spec = SOURCE_DATASETS[key]
        out[key] = {
            "file": spec["file"],
            "markings": list(spec["markings"]),
            "purpose": spec["purpose"],
            "legalBasis": spec["legalBasis"],
            "retentionDays": spec["retentionDays"],
            "asOf": as_of[key],
        }
    return out


def load_manifest(dataset_dir: Path) -> Dict[str, Dict[str, Any]]:
    """Read ``manifest.json``; fall back to ``SOURCE_DATASETS`` if it is missing."""
    path = Path(dataset_dir) / "manifest.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {k: {**copy.deepcopy(v), "asOf": ""} for k, v in SOURCE_DATASETS.items()}


def file_markings(manifest: Mapping[str, Mapping[str, Any]]) -> Dict[str, List[str]]:
    """``{raw file name: markings}`` from a manifest."""
    return {entry["file"]: sort_markings(entry.get("markings", [])) for entry in manifest.values()}


def manifest_entry_for_file(manifest: Mapping[str, Mapping[str, Any]], file_name: str) -> Dict[str, Any]:
    for entry in manifest.values():
        if entry.get("file") == file_name:
            return dict(entry)
    return {}


# ---------------------------------------------------------------------------
# Dataset-level union rule
# ---------------------------------------------------------------------------

def sort_markings(markings: Iterable[str]) -> List[str]:
    unique = set(markings)
    return sorted(unique, key=lambda m: (_MARKING_RANK.get(m, len(_MARKING_RANK)), m))


def union_markings(lists: Iterable[Iterable[str]]) -> List[str]:
    out: set = set()
    for markings in lists:
        out.update(markings)
    return sort_markings(out)


def merge_provenance(provenances: Iterable[Mapping[str, Sequence[str]]]) -> Dict[str, List[str]]:
    """Union of ``{marking: [raw dataset ids]}`` maps, keys in marking order."""
    merged: Dict[str, set] = {}
    for prov in provenances:
        for marking, sources in prov.items():
            merged.setdefault(marking, set()).update(sources)
    return {m: sorted(merged[m]) for m in sort_markings(merged)}


def raw_governance(raw_id: str, entry: Mapping[str, Any]) -> Dict[str, Any]:
    """Governance fields of a raw (or normalised) dataset from its manifest entry."""
    markings = sort_markings(entry.get("markings", []))
    return {
        "markings": markings,
        "markingProvenance": {m: [raw_id] for m in markings},
        "purpose": entry.get("purpose", ""),
        "legalBasis": entry.get("legalBasis", ""),
        "retentionDays": entry.get("retentionDays"),
        "inputPurposes": [entry.get("purpose", "")] if entry.get("purpose") else [],
    }


def derived_governance(inputs: Sequence[Mapping[str, Any]]) -> Dict[str, Any]:
    """Governance fields of a dataset derived from ``inputs`` (union rule).

    ``markings`` is the union of the inputs' markings, ``markingProvenance``
    the union of their provenance (always pointing at raw datasets), and
    ``retentionDays`` the shortest input retention (a derived copy should not
    outlive its sources).
    """
    retention = [i["retentionDays"] for i in inputs if i.get("retentionDays") is not None]
    purposes: set = set()
    for i in inputs:
        purposes.update(i.get("inputPurposes", []))
    return {
        "markings": union_markings(i.get("markings", []) for i in inputs),
        "markingProvenance": merge_provenance(i.get("markingProvenance", {}) for i in inputs),
        "purpose": DERIVED_PURPOSE,
        "legalBasis": DERIVED_LEGAL_BASIS,
        "retentionDays": min(retention) if retention else None,
        "inputPurposes": sorted(purposes),
    }


# ---------------------------------------------------------------------------
# Object, property and link markings (contract §3)
# ---------------------------------------------------------------------------

OBJECT_MARKINGS: Dict[str, List[str]] = {
    "Person": ["PII"],
    "Company": [],
    "BankAccount": ["FIN"],
    "Device": ["TELECOM"],
    "Flight": ["PII"],
    "Airport": [],
    "Location": [],
    "WatchlistRecord": ["LE-SENSITIVE"],
}
RESIDENTIAL_LOCATION_MARKINGS: List[str] = ["HEALTH"]

PROPERTY_MARKINGS: Dict[str, Dict[str, List[str]]] = {
    "Person": {
        "phoneNumber": ["TELECOM"],
        "riskTag": ["LE-SENSITIVE"],
        "passportId": ["PII"],
        "homeAddress": ["HEALTH"],
        "clinicCode": ["HEALTH"],
    },
    "Flight": {"paymentCardLast4": ["FIN"]},
}

LINK_MARKINGS: Dict[str, List[str]] = {
    "OWNS_ACCOUNT": ["FIN"],
    "HAS_CORP_ACCOUNT": ["FIN"],
    "TRANSFERRED_TO": ["FIN"],
    "USES_DEVICE": ["TELECOM"],
    "OBSERVED_AT": ["TELECOM"],
    "LISTED_ON": ["LE-SENSITIVE"],
    "BOOKED_ON": ["PII"],
    "RESIDES_AT": ["HEALTH"],
}

# Raw dataset each object type is made from (Person and Location are computed).
TYPE_SOURCE_FILES: Dict[str, List[str]] = {
    "Company": ["company_registry.csv"],
    "BankAccount": ["bank_transactions.csv"],
    "Device": ["mobile_location_pings.jsonl"],
    "Flight": ["flight_manifests.csv"],
    "Airport": ["flight_manifests.csv"],
    "WatchlistRecord": ["watchlist.csv"],
}
# Edges that make a Location (target) or enrich a Person (source).
LOCATION_EDGE_SOURCE_FILES: Dict[str, str] = {
    "REGISTERED_AT": "company_registry.csv",
    "OBSERVED_AT": "mobile_location_pings.jsonl",
    "RESIDES_AT": "clinic_registrations.csv",
}
PERSON_EDGE_SOURCE_FILES: Dict[str, str] = {
    "RESIDES_AT": "clinic_registrations.csv",
}


def object_markings(entity_type: str, residential: bool = False) -> List[str]:
    if entity_type == "Location" and residential:
        return list(RESIDENTIAL_LOCATION_MARKINGS)
    return list(OBJECT_MARKINGS.get(entity_type, []))


def link_markings(edge_type: str) -> List[str]:
    return list(LINK_MARKINGS.get(edge_type, []))


def _contributing_files(entity: Mapping[str, Any], edge_files: Mapping[str, set]) -> set:
    etype = entity["type"]
    files: set = set(TYPE_SOURCE_FILES.get(etype, []))
    if etype == "Person":
        for ref in (entity.get("resolution") or {}).get("mergedFrom", []):
            prefix = ref.split(":", 1)[0]
            if prefix in REF_SOURCE_FILE:
                files.add(REF_SOURCE_FILE[prefix])
    files.update(edge_files.get(entity["id"], set()))
    return files


def annotate_objects(
    entities: List[Dict[str, Any]],
    edges: List[Dict[str, Any]],
    file_markings_map: Mapping[str, Sequence[str]],
) -> None:
    """Add contract §3 markings in place to every entity and edge.

    * ``markings`` — what a role must be cleared for to see that the object exists.
    * ``propertyMarkings`` — per property (fixed per object type, whether or
      not the object has a value, so absence of a value is not itself a signal).
    * ``sourceMarkings`` — union of the markings of every raw dataset that
      contributed: for a Person the datasets of its ``resolution.mergedFrom``
      records plus the clinic dataset if it has a ``RESIDES_AT`` link; for a
      Location the datasets behind its ``REGISTERED_AT`` / ``OBSERVED_AT`` /
      ``RESIDES_AT`` links; otherwise the dataset the type is made from.
    """
    edge_files: Dict[str, set] = {}
    residential: set = set()
    for edge in edges:
        edge["markings"] = link_markings(edge["type"])
        loc_file = LOCATION_EDGE_SOURCE_FILES.get(edge["type"])
        if loc_file:
            edge_files.setdefault(edge["target"], set()).add(loc_file)
        person_file = PERSON_EDGE_SOURCE_FILES.get(edge["type"])
        if person_file:
            edge_files.setdefault(edge["source"], set()).add(person_file)
        if edge["type"] == "RESIDES_AT":
            residential.add(edge["target"])
    for entity in entities:
        etype = entity["type"]
        entity["markings"] = object_markings(etype, residential=entity["id"] in residential)
        entity["propertyMarkings"] = copy.deepcopy(PROPERTY_MARKINGS.get(etype, {}))
        files = _contributing_files(entity, edge_files)
        entity["sourceMarkings"] = union_markings(file_markings_map.get(f, []) for f in files)


def marking_counts(entities: Iterable[Mapping[str, Any]], edges: Iterable[Mapping[str, Any]]) -> Dict[str, Dict[str, int]]:
    """``{"objects": {marking: n}, "edges": {...}, "properties": {...}}`` for reports and tests."""
    objects: Dict[str, int] = {m: 0 for m in MARKING_IDS}
    props: Dict[str, int] = {m: 0 for m in MARKING_IDS}
    links: Dict[str, int] = {m: 0 for m in MARKING_IDS}
    unmarked_objects = 0
    unmarked_edges = 0
    for e in entities:
        if not e.get("markings"):
            unmarked_objects += 1
        for m in e.get("markings", []):
            objects[m] += 1
        for prop, ms in e.get("propertyMarkings", {}).items():
            if prop in e.get("properties", {}):
                for m in ms:
                    props[m] += 1
    for e in edges:
        if not e.get("markings"):
            unmarked_edges += 1
        for m in e.get("markings", []):
            links[m] += 1
    objects["(none)"] = unmarked_objects
    links["(none)"] = unmarked_edges
    return {"objects": objects, "edges": links, "propertyValues": props}
