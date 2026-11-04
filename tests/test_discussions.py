"""PHASE2_CONTRACT.md §5 / spec §5.4: discussion cards about real cases."""

from __future__ import annotations

from conftest import DATASETS, REPO_ROOT

DISCLAIMER = "Discussion material about real institutions and public reporting. Nothing here simulates a real person."
ATTACHED = {
    "disc-ice-elite": ["build.markings"],
    "disc-bverfg-2023": ["session.checkpoints", "inv.karlsruhe"],
    "disc-raffinaderij": ["oversight.audit"],
    "disc-nhs-fdp": ["session.roles", "build.markings"],
    "disc-pol-intel": ["build.pipelines"],
}
KEYWORDS = {
    "disc-ice-elite": ["ImmigrationOS", "ELITE", "Medicaid", "$30m"],
    "disc-bverfg-2023": ["16 February 2023", "Hamburg", "Hesse", "30 September 2023", "VeRA"],
    "disc-raffinaderij": ["Raffinaderij", "2012", "99%"],
    "disc-nhs-fdp": ["November 2023", "137", "£330m", "not the data controller"],
    "disc-pol-intel": ["POL-INTEL", "Galis", "domestic replacements"],
}


def research_urls():
    text = (REPO_ROOT / "context" / "PALANTIR_RESEARCH_2026-11-04.md").read_text(encoding="utf-8")
    section = text.split("## G. Sources", 1)[1]
    return {line[2:].strip() for line in section.splitlines() if line.startswith("- http")}


def test_five_cards_identical_everywhere(gotham, foundry):
    ref = gotham["starter"]["governance"]["discussions"]
    assert [c["id"] for c in ref] == list(ATTACHED)
    for seed in (gotham, foundry):
        for dataset in DATASETS:
            assert seed[dataset]["governance"]["discussions"] == ref


def test_card_contents(gotham):
    block = gotham["starter"]["governance"]
    surfaces = {h["id"] for h in block["honesty"]}
    urls = research_urls()
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
    # Maven and Leads come in Phase 3; unverified military claims never go on cards.
    assert "Maven" not in text and "Ukraine" not in text and "Israel" not in text
