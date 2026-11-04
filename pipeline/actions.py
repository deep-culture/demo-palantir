"""
pipeline/actions.py — Action types and simulated external systems (F5,
PHASE2_CONTRACT.md §3).

Both seed builders write ``catalog[ds].ontology.actionTypes`` and
``catalog[ds].ontology.externalSystems`` from this module, so Investigate and
Build show the same kinetic layer.  The browser (``core/actions.js``) validates
parameters, checks roles, runs the Checkpoint, applies the effects to its own
copy of the ontology and records the writebacks; nothing here runs at build
time.

Effect operations
-----------------
``setProperty``         ``{property, from}``; ``from`` is ``"param:<id>"`` or
                        ``"value:<literal>"`` (``"value:"`` clears).  With
                        ``onlyIfSetByAction: true`` the Action refuses, with
                        ``refusal``, when the current value did not come from an
                        Action in this session.
``createObject``        ``{type, properties}``; values are ``"param:<id>"``,
                        ``"session:role"``, ``"now"``, ``"object:<prop>"`` (a
                        property of the focused object) or ``"value:<literal>"``.
``createLink``          ``{linkType, target}``; ``target`` is
                        ``"created:<Type>"`` (the object created above) or
                        ``"object"``.  The link's source is the focused object.
``deleteLinked``        ``{linkType, targetType}``; with
                        ``onlyCreatedByAction: true`` only objects whose
                        ``origin`` is ``"action"`` are deleted (seeded
                        watchlist records never are).
``resolutionOverride``  ``{candidateId, decision}`` (not in the contract's op
                        list; added for Unmerge, §2): writes
                        ``{candidateId, decision: "reject", by, reason, ts}`` to
                        ``dc-palantir:governance.resolutionOverrides``.
``writeback``           ``{system, template}``; ``{name}`` placeholders resolve
                        to a parameter, then a property of the focused object,
                        then ``label``, ``role`` or ``ts``.  The message lands in
                        the system's inbox (a panel, not an API).

``sensitive: true`` Actions run Checkpoint ``cp-action-sensitive`` first.
"""

from __future__ import annotations

import copy
from typing import Any, Dict, List

RISK_TAGS = ["facilitator", "procurement-network", "sanctions-evasion", "dual-use-broker"]

EXTERNAL_SYSTEMS: List[Dict[str, str]] = [
    {"id": "border-watch", "label": "Border watch system",
     "description": "Simulated border-control alert list. Receives watch and unwatch requests for people."},
    {"id": "bank-compliance", "label": "Bank compliance desk",
     "description": "Simulated compliance team at the account-holding bank. Receives account review requests."},
    {"id": "case-management", "label": "Case management",
     "description": "Simulated case file system. Receives identity corrections such as unmerges."},
]


def _reason(min_length: int = 10) -> Dict[str, Any]:
    return {"id": "reason", "label": "Reason", "type": "string", "required": True, "minLength": min_length}


ACTION_TYPES: List[Dict[str, Any]] = [
    {
        "id": "act-add-to-watchlist",
        "label": "Add to watchlist",
        "objectType": "Person",
        "sensitive": True,
        "description": "Tag a person with a risk category, create a watchlist record linked to them and alert the border watch system.",
        "parameters": [
            _reason(),
            {"id": "riskTag", "label": "Risk tag", "type": "enum", "required": True, "options": list(RISK_TAGS)},
        ],
        "allowedRoles": ["fin-analyst"],
        "checkpointId": "cp-action-sensitive",
        "effects": [
            {"op": "setProperty", "property": "riskTag", "from": "param:riskTag"},
            {"op": "createObject", "type": "WatchlistRecord", "properties": {
                "riskTag": "param:riskTag",
                "passportId": "object:passportId",
                "dob": "object:dob",
                "reason": "param:reason",
                "addedBy": "session:role",
                "addedAt": "now",
                "origin": "value:action",
            }},
            {"op": "createLink", "linkType": "LISTED_ON", "target": "created:WatchlistRecord"},
            {"op": "writeback", "system": "border-watch",
             "template": "WATCH {label} passport {passportId} tag {riskTag}: {reason}"},
        ],
        "feedsAnalytics": True,
        "honesty": "inv.actions",
    },
    {
        "id": "act-remove-from-watchlist",
        "label": "Remove from watchlist",
        "objectType": "Person",
        "sensitive": True,
        "description": "Undo an Add to watchlist made in this session: clear the risk tag, delete the watchlist record the Action created and tell the border watch system. Risk tags from the watchlist feed cannot be removed here.",
        "parameters": [_reason()],
        "allowedRoles": ["fin-analyst"],
        "checkpointId": "cp-action-sensitive",
        "effects": [
            {"op": "setProperty", "property": "riskTag", "from": "value:", "onlyIfSetByAction": True,
             "refusal": "This risk tag comes from the watchlist feed, not from an Action in this session, so it cannot be removed here."},
            {"op": "deleteLinked", "linkType": "LISTED_ON", "targetType": "WatchlistRecord", "onlyCreatedByAction": True},
            {"op": "writeback", "system": "border-watch",
             "template": "UNWATCH {label} passport {passportId}: {reason}"},
        ],
        "feedsAnalytics": True,
        "honesty": "inv.actions",
    },
    {
        "id": "act-flag-account",
        "label": "Flag account for review",
        "objectType": "BankAccount",
        "sensitive": False,
        "description": "Mark a bank account for review and send the request to the bank's compliance desk.",
        "parameters": [
            _reason(),
            {"id": "priority", "label": "Priority", "type": "enum", "required": True, "options": ["routine", "urgent"]},
        ],
        "allowedRoles": ["fin-analyst"],
        "effects": [
            {"op": "setProperty", "property": "reviewFlag", "from": "param:priority"},
            {"op": "writeback", "system": "bank-compliance",
             "template": "REVIEW account {accountId} ({priority}) held by {ownerName}: {reason}"},
        ],
        "feedsAnalytics": False,
        "honesty": "inv.actions",
    },
    {
        "id": "act-request-border-watch",
        "label": "Request border watch",
        "objectType": "Person",
        "sensitive": False,
        "description": "Ask the border watch system to alert on this person's passport. Changes nothing in the ontology.",
        "parameters": [
            _reason(),
            {"id": "duration", "label": "Duration", "type": "enum", "required": True, "options": ["24h", "7d", "30d"]},
        ],
        "allowedRoles": ["patrol", "fin-analyst"],
        "effects": [
            {"op": "writeback", "system": "border-watch",
             "template": "ALERT REQUEST {label} passport {passportId} for {duration}: {reason}"},
        ],
        "feedsAnalytics": False,
        "honesty": "inv.actions",
    },
    {
        "id": "act-unmerge-person",
        "label": "Unmerge person",
        "objectType": "Person",
        "sensitive": True,
        "description": "Reject a candidate merge: the two source identities stay separate at every threshold. The correction is sent to case management.",
        "parameters": [
            {"id": "candidateId", "label": "Merge to undo", "type": "string", "required": True},
            _reason(),
        ],
        "allowedRoles": ["fin-analyst", "dpo"],
        "checkpointId": "cp-action-sensitive",
        "effects": [
            {"op": "resolutionOverride", "candidateId": "param:candidateId", "decision": "reject"},
            {"op": "writeback", "system": "case-management",
             "template": "UNMERGE {label}: candidate {candidateId} rejected by {role}: {reason}"},
        ],
        "feedsAnalytics": True,
        "honesty": "inv.actions",
    },
]

ACTION_TYPE_IDS: List[str] = [a["id"] for a in ACTION_TYPES]


def ontology_block() -> Dict[str, Any]:
    """``{actionTypes, externalSystems}`` (fresh deep copies) for ``catalog[ds].ontology``."""
    return {"actionTypes": copy.deepcopy(ACTION_TYPES), "externalSystems": copy.deepcopy(EXTERNAL_SYSTEMS)}
