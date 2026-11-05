"""PHASE2_CONTRACT.md §5 / spec §5.4: discussion cards about real cases.

Fix round (FIXROUND_CONTRACT.md §1, summary §C): the NHS, Raffinaderij and
POL-INTEL cards say only what their cited sources support, and a seventh card
names the data-subject rights the tool leaves out.
"""

from __future__ import annotations

from conftest import DATASETS, REPO_ROOT

from pipeline import governance

DISCLAIMER = "Discussion material about real institutions and public reporting. Nothing here simulates a real person."
ATTACHED = {
    "disc-ice-elite": ["build.markings", "inv.leads"],
    "disc-bverfg-2023": ["session.checkpoints", "inv.karlsruhe"],
    "disc-raffinaderij": ["oversight.audit"],
    "disc-nhs-fdp": ["session.roles", "build.markings"],
    "disc-pol-intel": ["build.pipelines", "deployment"],
    "disc-maven": ["inv.agent"],
    "disc-data-subjects": ["oversight.audit", "inv.actions", "session.roles"],
}
KEYWORDS = {
    "disc-ice-elite": ["ImmigrationOS", "ELITE", "Medicaid", "$30m"],
    "disc-bverfg-2023": ["16 February 2023", "Hamburg", "Hesse", "30 September 2023", "VeRA"],
    "disc-raffinaderij": ["Raffinaderij", "2012", "99%", "Buro Jansen & Janssen", "2019", "de Volkskrant reported"],
    "disc-nhs-fdp": ["137", "£330m", "not the data controller", "retain full control as data controllers"],
    "disc-pol-intel": ["POL-INTEL", "Galis", "customised version", "does not mention POL-INTEL"],
    "disc-maven": ["Maven", "$1.3bn", "2029", "20,000", "NATO"],
    "disc-data-subjects": ["GDPR", "Art. 15", "Art. 16", "Art. 17", "Law Enforcement Directive", "Art. 14",
                           "Art. 15", "none of them"],
}
# Claims removed in the fix round because the cited sources do not support them.
UNSUPPORTED = {
    "disc-nhs-fdp": ["BMA", "British Medical Association", "contested", "November 2023"],
    "disc-pol-intel": ["domestic replacements", "Denmark is now looking"],
}


def research_urls():
    text = (REPO_ROOT / "context" / "PALANTIR_RESEARCH_2026-11-04.md").read_text(encoding="utf-8")
    section = text.split("## G. Sources", 1)[1]
    return {line[2:].strip() for line in section.splitlines() if line.startswith("- http")}


def allowed_sources():
    return research_urls() | set(governance.EXTRA_SOURCES)


def test_cards_identical_everywhere(gotham, foundry):
    ref = gotham["starter"]["governance"]["discussions"]
    assert [c["id"] for c in ref] == list(ATTACHED)
    for seed in (gotham, foundry):
        for dataset in DATASETS:
            assert seed[dataset]["governance"]["discussions"] == ref


def test_card_contents(gotham):
    block = gotham["starter"]["governance"]
    surfaces = {h["id"] for h in block["honesty"]}
    urls = allowed_sources()
    for card in block["discussions"]:
        assert set(card) == {"id", "title", "attachedTo", "summary", "questions", "sources", "disclaimer"}
        assert card["attachedTo"] == ATTACHED[card["id"]]
        assert set(card["attachedTo"]) <= surfaces, card["id"]
        assert card["title"] and len(card["summary"]) > 120
        assert len(card["questions"]) == 2 and all(q.endswith("?") for q in card["questions"])
        assert card["sources"] and set(card["sources"]) <= urls, card["id"]
        assert card["disclaimer"] == DISCLAIMER
        for word in KEYWORDS[card["id"]]:
            assert word in card["summary"], (card["id"], word)
    text = " ".join(c["summary"] for c in block["discussions"])
    # Unverified military claims (research §D.7) never go on cards.
    assert "Ukraine" not in text and "Israel" not in text and "TITAN" not in text
    maven = next(c for c in block["discussions"] if c["id"] == "disc-maven")
    assert "human in the loop" in maven["questions"][0]


def test_fix_round_claims(gotham):
    cards = {c["id"]: c for c in gotham["starter"]["governance"]["discussions"]}
    for cid, words in UNSUPPORTED.items():
        for word in words:
            assert word not in cards[cid]["summary"], (cid, word)
    # Raffinaderij: the defence line is kept apart from the police platform
    # and sourced to Euronews, not to NL Times.
    raff = cards["disc-raffinaderij"]["summary"]
    police, defence = raff.split("Separately, on defence", 1)
    assert "Defence" not in police and "defence" not in police
    assert "two years" in defence and "Euronews" in defence
    assert governance.DOC_EURONEWS_EXITS in cards["disc-raffinaderij"]["sources"]
    # POL-INTEL: Denmark's Maven/Foundry deal is presented as separate.
    pol = cards["disc-pol-intel"]["summary"]
    assert pol.index("POL-INTEL") < pol.index("Defence is a separate matter") < pol.index("Maven")
    # Data subjects: attached where people are acted on, cited to EUR-Lex.
    ds = cards["disc-data-subjects"]
    assert ds["sources"] == [governance.DOC_GDPR, governance.DOC_LED]
    assert all(u.startswith("https://eur-lex.europa.eu/") for u in ds["sources"])
    assert "notice" in ds["questions"][0] and "contest" in ds["questions"][1]


def test_quotes_are_short(gotham):
    """Quotations on cards and in the Karlsruhe notes stay under 15 words."""
    import re
    block = gotham["starter"]["governance"]
    texts = [c["summary"] for c in block["discussions"]] + [block["legalBasisNote"]]
    texts += [r.get("note", "") for r in block["purposeRules"]]
    for text in texts:
        for quote in re.findall(r'"([^"]+)"', text):
            assert len(quote.split()) < 15, quote
