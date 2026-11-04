"""
pipeline/resolution.py — the one Person resolver shared by both seed builders.

Both ``pipeline/02_resolve_persons.py`` (Foundry) and
``scripts/build_ontology_seed.py`` (Gotham) resolve people with this module,
so the two demos agree on who is who and on every Person edge.

How it works
------------
Resolution is *greedy* and runs in one fixed order over the source records
(see :func:`person_observations`): watchlist rows, company-registry directors
and beneficial owners, flight passengers, then mobile pings.  Each record is
matched to an existing Person by the first key that hits, in this priority:

  1. passport number
  2. phone number
  3. normalised name + date of birth
  4. normalised name or alias (last writer wins)

If nothing matches, a new Person is created.

Watchlisted identities are curated (Phase 2).  Two guards keep a name alone
from reaching them:

  * a record that carries a passport is never matched *by name* to a
    watchlisted Person who holds a different passport (a different passport
    is a different person);
  * a later record never re-points a name already held by a watchlisted
    Person to somebody else, so name-only lookups (bank account owners) keep
    finding the watchlisted Person.

On the Phase 0/1 data both guards change nothing (tests compare every Person
with the pre-Phase-2 seed); they are what keeps the namesake Omar Rahman
(``person::g5510077``) a separate Person.  Whether he *should* be merged is
then a scoring question: see ``pipeline/candidates.py``.

Because matching is greedy and
order-dependent, a weak record that arrives first (a ping observed as
"C. Silva") can create a Person that a later, stronger record (a registry
entry for "Clara Silva", b. 1977-11-25) never joins.  These splits are kept
on purpose as a teaching exhibit; they are made visible through the
``resolution`` block rather than repaired.

Edges are linked only after every record has been resolved.  An edge that
comes from a person-bearing record (watchlist, registry, flight, ping) goes
to the person that record was resolved into (:meth:`PersonResolver.person_for`).
An edge from a record that is not part of person resolution — a bank
account's owner name — is linked with :meth:`PersonResolver.find` against the
final state, so it never depends on which file a builder happened to read
first.

The ``resolution`` block
------------------------
Every Person gets ``{"method", "confidence", "mergedFrom", "splitRisk",
"note"}`` (REDESIGN_SPEC.md §4.0 F0.2 and §4.6):

``method`` — the strongest key that created or anchored the person:

  ``passport``   some record carried a passport number
  ``phone``      a non-ping record (e.g. a flight) carried a phone number
  ``name+dob``   a non-ping record carried a name and a date of birth
  ``alias``      only names without a date of birth (no stronger key)
  ``ping-only``  known only from mobile pings (observed name and/or phone)

``confidence`` — a fixed value per method (not a computed score; the real
scorer arrives with F6):

  passport 1.0 · name+dob 0.9 · phone 0.8 · alias 0.45 · ping-only 0.35

``mergedFrom`` — source record references, in the order they were absorbed:
``watchlist:WL-1001``, ``company:CO-104:director``, ``company:CO-104:owner``,
``flight:NMF-0008``, ``ping:NPG-00018``.

``splitRisk`` — true when another Person shares a normalised name, an alias,
or a surname-plus-first-initial ("C. Silva" ~ "Clara Silva") with this one
*and* either side is weak (``alias`` or ``ping-only``) or both share a birth
date. Both halves of a likely split are flagged, so the exhibit is visible
from either person.

``note`` — a plain-English sentence explaining the split risk, or noting a
same-name, same-birth-date Person that was kept separate; ``""`` otherwise.

Clinic registrations (Phase 1)
------------------------------
Clinic rows are *attached* after the greedy pass, by :func:`attach_clinic_rows`
(:meth:`PersonResolver.attach`): a row joins the Person whose normalised name
plus date of birth matches exactly, and nothing else — no passport, phone or
alias fallback, and a row that matches nobody never creates a Person.
Attaching registers no lookup keys and changes no name, method or
``mergedFrom``, so every Phase 0 identity, edge and resolution block is
unchanged.  The clinic link is held in ``PersonResolver.clinic_refs`` and shows
up only as HEALTH-marked properties (``homeAddress``, ``clinicCode``) and
``RESIDES_AT`` links; putting ``clinic:REG-…`` into ``mergedFrom`` would leak
the health record to every role that can see the resolution block.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, Iterator, List, Mapping, Optional, Sequence, Set, Tuple

from pipeline.lib import slug


METHOD_CONFIDENCE: Dict[str, float] = {
    "passport": 1.0,
    "phone": 0.8,
    "name+dob": 0.9,
    "alias": 0.45,
    "ping-only": 0.35,
}
WEAK_METHODS = frozenset({"alias", "ping-only"})


def normalize_name(value: str) -> str:
    """Lowercase, collapse non-alphanumeric runs to single spaces, trim."""
    cleaned = re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()
    return re.sub(r"\s+", " ", cleaned)


def _initial_surname(norm: str) -> str:
    tokens = norm.split()
    if len(tokens) < 2:
        return ""
    return f"{tokens[0][0]} {tokens[-1]}"


# ---------------------------------------------------------------------------
# Observations: one per person-bearing source record, in canonical order
# ---------------------------------------------------------------------------

@dataclass
class Observation:
    kind: str            # watchlist | director | owner | flight | ping
    source: str          # watchlist | company | flight | ping
    record_id: str
    row_index: int
    row: Mapping[str, Any]
    name: str = ""
    dob: str = ""
    passport: str = ""
    phone: str = ""
    aliases: Tuple[str, ...] = ()

    @property
    def ref(self) -> str:
        if self.source == "company":
            return f"company:{self.record_id}:{self.kind}"
        return f"{self.source}:{self.record_id}"


def _s(row: Mapping[str, Any], key: str) -> str:
    value = row.get(key, "")
    return "" if value is None else str(value).strip()


def _aliases(row: Mapping[str, Any]) -> Tuple[str, ...]:
    raw = row.get("aliases")
    if isinstance(raw, (list, tuple)):
        return tuple(str(a).strip() for a in raw if str(a).strip())
    return tuple(a.strip() for a in _s(row, "alias").split("|") if a.strip())


def _idx(row: Mapping[str, Any], fallback: int) -> int:
    value = row.get("_source_row")
    return int(value) if value not in (None, "") else fallback


def person_observations(
    watchlist_rows: Sequence[Mapping[str, Any]],
    company_rows: Sequence[Mapping[str, Any]],
    flight_rows: Sequence[Mapping[str, Any]],
    ping_rows: Sequence[Mapping[str, Any]],
) -> Iterator[Observation]:
    """Yield person observations in the order resolution must see them.

    Accepts raw rows (``alias`` as a pipe-joined string) or rows normalised
    by step 01 (``aliases`` as a list, ``_source_row`` set).
    """
    for i, row in enumerate(watchlist_rows):
        yield Observation("watchlist", "watchlist", _s(row, "watchlist_id"), _idx(row, i), row,
                          name=_s(row, "canonical_name"), dob=_s(row, "dob"),
                          passport=_s(row, "passport_id"), aliases=_aliases(row))
    for i, row in enumerate(company_rows):
        cid = _s(row, "company_id")
        if _s(row, "director_name"):
            yield Observation("director", "company", cid, _idx(row, i), row,
                              name=_s(row, "director_name"), dob=_s(row, "director_dob"))
        if _s(row, "beneficial_owner"):
            yield Observation("owner", "company", cid, _idx(row, i), row,
                              name=_s(row, "beneficial_owner"), dob=_s(row, "beneficial_owner_dob"))
    for i, row in enumerate(flight_rows):
        yield Observation("flight", "flight", _s(row, "manifest_id"), _idx(row, i), row,
                          name=_s(row, "passenger_name"), dob=_s(row, "dob"),
                          passport=_s(row, "passport_id"), phone=_s(row, "phone_number"))
    for i, row in enumerate(ping_rows):
        yield Observation("ping", "ping", _s(row, "ping_id"), _idx(row, i), row,
                          name=_s(row, "observed_name"), phone=_s(row, "phone_number"))


# ---------------------------------------------------------------------------
# Person record and resolver
# ---------------------------------------------------------------------------

@dataclass
class PersonRecord:
    id: str
    merged_from: List[str] = field(default_factory=list)
    record_names: List[str] = field(default_factory=list)     # names from non-ping records, in order
    alias_names: List[str] = field(default_factory=list)      # watchlist aliases, in order
    ping_names: Counter = field(default_factory=Counter)      # observed_name -> count
    ping_name_order: List[str] = field(default_factory=list)
    dobs: List[str] = field(default_factory=list)
    has_passport: bool = False
    has_record_phone: bool = False
    has_record_name_dob: bool = False
    has_record: bool = False
    created_by: str = ""
    passports: List[str] = field(default_factory=list)
    watchlisted: bool = False

    @property
    def method(self) -> str:
        if self.has_passport:
            return "passport"
        if self.has_record_phone:
            return "phone"
        if self.has_record_name_dob:
            return "name+dob"
        if self.has_record:
            return "alias"
        return "ping-only"

    @property
    def display_name(self) -> str:
        """Longest name from a non-ping record (first wins on ties); else the
        most frequent ping observed name (first seen wins on ties)."""
        best = ""
        for name in self.record_names:
            if len(name) > len(best):
                best = name
        if best:
            return best
        return self.most_frequent_ping_name

    @property
    def most_frequent_ping_name(self) -> str:
        best, best_count = "", 0
        for name in self.ping_name_order:
            if self.ping_names[name] > best_count:
                best, best_count = name, self.ping_names[name]
        return best

    @property
    def name_is_weak(self) -> bool:
        return not any(self.record_names)

    @property
    def dob(self) -> str:
        best = ""
        for value in self.dobs:
            if len(value) > len(best):
                best = value
        return best

    def all_names(self) -> List[str]:
        seen: List[str] = []
        for name in self.record_names + self.alias_names + self.ping_name_order:
            if name and name not in seen:
                seen.append(name)
        return seen


class PersonResolver:
    """Greedy person resolver: passport → phone → name+dob → alias."""

    def __init__(self) -> None:
        self.by_passport: Dict[str, str] = {}
        self.by_phone: Dict[str, str] = {}
        self.by_name_dob: Dict[str, str] = {}
        self.by_alias: Dict[str, str] = {}
        self.records: Dict[str, PersonRecord] = {}
        self.by_ref: Dict[str, str] = {}
        # Phase 1: clinic rows attached by name + dob (see attach()).
        self.clinic_by_ref: Dict[str, str] = {}
        self.clinic_refs: Dict[str, List[str]] = {}

    # -- lookup --------------------------------------------------------------
    def find(self, name: str = "", dob: str = "", passport: str = "", phone: str = "") -> Optional[str]:
        """Return the person ID matched by the first key that hits, else None."""
        if passport and passport in self.by_passport:
            return self.by_passport[passport]
        if phone and phone in self.by_phone:
            return self.by_phone[phone]
        norm = normalize_name(name)
        if norm and dob and f"{norm}|{dob}" in self.by_name_dob:
            return self.by_name_dob[f"{norm}|{dob}"]
        if norm and norm in self.by_alias:
            pid = self.by_alias[norm]
            if passport and self._curated_conflict(pid, passport):
                return None  # same name, different passport, watchlisted: not by name alone
            return pid
        return None

    def _curated_conflict(self, pid: str, passport: str) -> bool:
        record = self.records.get(pid)
        return bool(record and record.watchlisted and record.passports and passport not in record.passports)

    def person_for(self, ref: str, name: str = "", dob: str = "", passport: str = "", phone: str = "") -> Optional[str]:
        """Person that source record ``ref`` was resolved into during the pass.

        Edges derived from a person-bearing record (LISTED_ON, DIRECTS,
        BENEFICIALLY_OWNS, BOOKED_ON, USES_DEVICE) use this, so an edge always
        lands on the person whose ``mergedFrom`` lists that record — even if a
        later record re-pointed the name+dob or alias key elsewhere.  Falls
        back to :meth:`find` for records the pass never saw.
        """
        return self.by_ref.get(ref) or self.find(name, dob, passport, phone)

    @staticmethod
    def make_id(name: str, dob: str = "", passport: str = "", phone: str = "") -> str:
        if passport:
            return f"person::{slug(passport)}"
        key = f"{normalize_name(name)}-{dob or phone or 'person'}"
        return f"person::{slug(key)}"

    # -- creation ------------------------------------------------------------
    def get_or_create(
        self,
        name: str,
        dob: str = "",
        passport: str = "",
        phone: str = "",
        aliases: Iterable[str] = (),
    ) -> Tuple[PersonRecord, bool]:
        """Match or create a person and register every key this call carries."""
        pid = self.find(name, dob, passport, phone)
        created = False
        if pid is None:
            pid = self.make_id(name, dob, passport, phone)
            created = pid not in self.records
            self.records.setdefault(pid, PersonRecord(pid))
        record = self.records[pid]
        if passport:
            self.by_passport[passport] = pid
        if phone:
            self.by_phone[phone] = pid
        norm = normalize_name(name)
        if norm and dob:
            self.by_name_dob[f"{norm}|{dob}"] = pid
        for alias in (name, *aliases):
            alias_norm = normalize_name(alias)
            if alias_norm:
                owner = self.by_alias.get(alias_norm)
                if owner and owner != pid and self.records[owner].watchlisted:
                    continue  # a watchlisted Person keeps their names
                self.by_alias[alias_norm] = pid
        return record, created

    def observe(self, obs: Observation) -> Optional[PersonRecord]:
        """Resolve one observation and record its evidence on the person."""
        if obs.kind == "ping":
            # A ping never creates a nameless person.
            if not obs.name and not self.find(phone=obs.phone):
                return None
        elif not (obs.name or obs.passport or obs.phone):
            return None
        record, created = self.get_or_create(obs.name, obs.dob, obs.passport, obs.phone, obs.aliases)
        if created:
            record.created_by = obs.ref
        if obs.ref not in record.merged_from:
            record.merged_from.append(obs.ref)
        self.by_ref[obs.ref] = record.id
        if obs.kind == "ping":
            if obs.name:
                if obs.name not in record.ping_names:
                    record.ping_name_order.append(obs.name)
                record.ping_names[obs.name] += 1
        else:
            record.has_record = True
            if obs.name:
                record.record_names.append(obs.name)
            record.alias_names.extend(obs.aliases)
            if obs.dob:
                record.dobs.append(obs.dob)
            if obs.passport:
                record.has_passport = True
                if obs.passport not in record.passports:
                    record.passports.append(obs.passport)
            if obs.kind == "watchlist":
                record.watchlisted = True
            if obs.phone:
                record.has_record_phone = True
            if obs.name and obs.dob:
                record.has_record_name_dob = True
        return record

    def attach(self, obs: Observation) -> Optional[str]:
        """Attach a clinic observation to an existing Person by name + dob only.

        Returns the person ID, or None if no Person has exactly this
        normalised name and date of birth.  Never creates a Person and never
        registers keys, so resolution of every other record is unaffected.
        """
        norm = normalize_name(obs.name)
        if not norm or not obs.dob:
            return None
        pid = self.by_name_dob.get(f"{norm}|{obs.dob}")
        if pid is None:
            return None
        self.clinic_by_ref[obs.ref] = pid
        refs = self.clinic_refs.setdefault(pid, [])
        if obs.ref not in refs:
            refs.append(obs.ref)
        return pid

    def resolve(self, observations: Iterable[Observation]) -> "PersonResolver":
        for obs in observations:
            self.observe(obs)
        return self

    # -- resolution block ------------------------------------------------------
    def _name_keys(self, record: PersonRecord) -> Set[str]:
        keys: Set[str] = set()
        for name in record.all_names():
            norm = normalize_name(name)
            if norm:
                keys.add(norm)
                init = _initial_surname(norm)
                if init:
                    keys.add(init)
        return keys

    @staticmethod
    def _describe(record: PersonRecord) -> str:
        dob = record.dob
        return f"{record.display_name} (b. {dob})" if dob else record.display_name

    def resolutions(self) -> Dict[str, Dict[str, Any]]:
        """Return ``{person_id: resolution_block}`` for every person."""
        keys = {pid: self._name_keys(rec) for pid, rec in self.records.items()}
        key_index: Dict[str, List[str]] = {}
        for pid, ks in keys.items():
            for k in ks:
                key_index.setdefault(k, []).append(pid)

        out: Dict[str, Dict[str, Any]] = {}
        for pid, rec in self.records.items():
            method = rec.method
            others: List[str] = []
            for k in sorted(keys[pid]):
                for other in key_index.get(k, []):
                    if other != pid and other not in others:
                        others.append(other)
            # Strongest, then alphabetical, so notes are deterministic.
            others.sort(key=lambda o: (-METHOD_CONFIDENCE[self.records[o].method], self.records[o].display_name, o))
            weak_others = [o for o in others if self.records[o].method in WEAK_METHODS]
            twins = [o for o in others if rec.dob and self.records[o].dob == rec.dob]
            # Flag both halves of a likely split: a weak person with any namesake, a strong person
            # with a weak namesake, or a strong person with a same-birth-date namesake.
            split_risk = bool(others) and (method in WEAK_METHODS or bool(weak_others) or bool(twins))
            note = ""
            if method == "ping-only":
                seen_as = ", ".join(f"'{n}'" for n in rec.ping_name_order) or "an unnamed handset"
                if split_risk:
                    note = (f"Created from phone pings observed as {seen_as}; may be the same person as "
                            + " or ".join(self._describe(self.records[o]) for o in others[:2]) + ".")
                else:
                    note = f"Known only from phone pings observed as {seen_as}; no passport, flight or registry record."
            elif method == "alias":
                if split_risk:
                    note = (f"Created from a record naming '{rec.display_name}' without a date of birth; may be the same person as "
                            + " or ".join(self._describe(self.records[o]) for o in others[:2]) + ".")
                else:
                    note = f"Matched on name only ('{rec.display_name}'); no date of birth, passport or phone."
            else:
                # Strong person: point out a namesake with the same birth date, or a weak namesake,
                # that was kept separate.
                if twins:
                    names = " and ".join(self._describe(self.records[o]) for o in twins[:2])
                    verb = "has" if len(twins[:2]) == 1 else "have"
                    note = (f"Anchored by {method}; {names} {verb} a matching name and the same birth date "
                            "but stayed a separate person.")
                elif weak_others:
                    names = " and ".join(self._describe(self.records[o]) for o in weak_others[:2])
                    note = (f"Anchored by {method}; a weaker record for {names} was kept as a separate person "
                            "and may be the same individual.")
            out[pid] = {
                "method": method,
                "confidence": METHOD_CONFIDENCE[method],
                "mergedFrom": list(rec.merged_from),
                "splitRisk": split_risk,
                "note": note,
            }
        return out


def clinic_observations(clinic_rows: Sequence[Mapping[str, Any]]) -> Iterator[Observation]:
    """One observation per clinic registration (``clinic:REG-0001``)."""
    for i, row in enumerate(clinic_rows):
        yield Observation("clinic", "clinic", _s(row, "registration_id"), _idx(row, i), row,
                          name=_s(row, "patient_name"), dob=_s(row, "dob"))


def attach_clinic_rows(
    resolver: "PersonResolver", clinic_rows: Sequence[Mapping[str, Any]],
) -> List[Tuple[Observation, Optional[str]]]:
    """Attach every clinic row (after the greedy pass); ``[(obs, person_id or None)]``."""
    return [(obs, resolver.attach(obs)) for obs in clinic_observations(clinic_rows)]


def latest_clinic_rows(
    attached: Sequence[Tuple[Observation, Optional[str]]],
) -> Dict[str, Observation]:
    """Per person, the clinic observation with the latest ``registered_on``
    (file order breaks ties).  Supplies ``homeAddress`` and ``clinicCode``."""
    latest: Dict[str, Observation] = {}
    for obs, pid in attached:
        if pid is None:
            continue
        current = latest.get(pid)
        if current is None or _s(obs.row, "registered_on") >= _s(current.row, "registered_on"):
            latest[pid] = obs
    return latest


def resolve_people(
    watchlist_rows: Sequence[Mapping[str, Any]],
    company_rows: Sequence[Mapping[str, Any]],
    flight_rows: Sequence[Mapping[str, Any]],
    ping_rows: Sequence[Mapping[str, Any]],
) -> PersonResolver:
    """Run the full greedy resolution pass and return the resolver."""
    return PersonResolver().resolve(person_observations(watchlist_rows, company_rows, flight_rows, ping_rows))
