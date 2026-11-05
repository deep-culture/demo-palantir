"""End-to-end checks of the rules the teaching depends on (review F-20).

Each test starts from an empty browser profile. The facts used:
  - "41 Oak Lane" exists only in the clinic file (HEALTH): only the DPO may see it.
  - Kareem Haddad's phone number +971501118890 is TELECOM: the analyst, auditor and contractor may not see it.
  - person::p8842101 embeds Kareem's passport number (PII): the auditor and contractor may not see it.
"""
import json
import re

import pytest

HEALTH_SECRET = "41 Oak Lane"
PHONE = "+971501118890"
NON_DPO = ["patrol", "fin-analyst", "auditor", "contractor"]
NO_TELECOM = ["fin-analyst", "auditor", "contractor"]
INVESTIGATE_TABS = ["copilot", "investigations", "analytics", "map", "leads", "object-sets", "entity-types",
                    "properties", "relationships", "mappings", "instances", "graph"]
BUILD_TABS = ["pipelines", "datasets", "lineage", "markings", "resolution"]
PAGES = ["/index.html", "/glossary.html", "/deployment.html", "/demo/", "/foundry-demo/", "/audit/"]


@pytest.mark.parametrize("path", PAGES)
def test_page_loads_with_home_button_and_logo_link(app, path):
    app.open(path)
    pg = app.page
    assert pg.locator("a.dc-home").count() == 1
    assert pg.evaluate("document.querySelector('.dc-logo').closest('a').href") == "https://deep-culture.org/"
    href = pg.get_attribute("a.dc-home", "href")
    assert href.endswith("index.html#")
    assert not app.errors, app.errors


@pytest.mark.parametrize("role", NON_DPO + ["dpo"])
def test_every_tab_renders_for_every_role(app, role):
    app.open("/demo/")
    app.role(role)
    for name in INVESTIGATE_TABS:
        app.tool(name)
    app.open("/foundry-demo/")
    for name in BUILD_TABS:
        app.build_tab(name)
    app.open("/audit/")
    assert not app.errors, app.errors


@pytest.mark.parametrize("role", NON_DPO)
def test_health_data_never_on_screen_without_health(app, role):
    app.open("/demo/")
    app.role(role)
    for name in INVESTIGATE_TABS:
        app.tool(name)
        assert HEALTH_SECRET not in app.page.content(), f"{role}: {name}"
    app.open("/demo/#object=person%3A%3Ag5510077", wait=1500)
    assert HEALTH_SECRET not in app.page.content()
    app.open("/foundry-demo/")
    for name in BUILD_TABS:
        app.build_tab(name)
        assert HEALTH_SECRET not in app.page.content(), f"{role}: build {name}"


def test_dpo_sees_the_clinic_address(app):
    app.open("/demo/")
    app.role("dpo")
    app.tool("leads")
    assert HEALTH_SECRET in app.page.inner_text("body")


@pytest.mark.parametrize("role", NON_DPO)
def test_export_contains_only_what_the_role_sees(app, role):
    app.open("/demo/")
    app.role(role)
    text = app.page.evaluate("import('/demo/js/mutations.js').then(m => JSON.stringify(m.roleExport(null)))")
    data = json.loads(text)
    visible = set(app.page.evaluate("DC.governance.role(DC.session.get().role).markingsVisible"))
    components = [c for lead in (data.get("leads") or {}).get("items", []) for c in lead["components"]]
    markings = {m for c in components for m in (c.get("markings") or [c.get("marking")])}
    assert HEALTH_SECRET not in text
    assert markings <= visible, markings - visible
    if role in NO_TELECOM:
        assert PHONE not in text
        assert not any(e["type"] in ("USES_DEVICE", "OBSERVED_AT") for e in data["edges"])


def test_phone_search_asks_before_the_number_is_complete(app):
    app.open("/demo/")
    app.role("patrol")
    app.tool("graph")
    app.page.type("#graph-search", "+9", delay=60)
    app.page.wait_for_timeout(1300)
    assert app.page.locator(".dc-modal").count() == 1
    assert "phone number" in app.page.inner_text(".dc-modal-prompt")


def test_approve_all_is_one_checkpoint_for_every_staged_edit(app):
    app.open("/demo/")
    app.ask_agent(1)  # "Who should we add to the watchlist?"
    pg = app.page
    staged = pg.locator('.staged-edit button[data-action="agent-approve"]').count()
    assert staged >= 2
    before = len(app.events())
    pg.click('button[data-action="agent-approve-all"]')
    pg.wait_for_selector(".dc-modal", timeout=5000)
    assert pg.locator('.dc-modal [data-dc="items"] li').count() == staged
    app.checkpoint("Bulk approval in the test: reviewed every edit listed", "financial-crime")
    pg.wait_for_timeout(1200)
    new = app.events()[before:]
    checkpoints = [e for e in new if e["kind"] == "checkpoint"]
    applied = [e for e in new if e["verb"] == "action.apply"]
    assert len(checkpoints) == 1 and checkpoints[0]["payload"]["outcome"] == "continued"
    assert len(applied) == staged
    assert all(e["checkpointId"] == checkpoints[0]["checkpointId"] for e in applied)


def test_marking_removal_needs_the_dpo_and_can_be_restored(app):
    app.open("/foundry-demo/")
    pg = app.page
    app.build_tab("markings")
    pg.click("[data-action=mk-select][data-id='clinic_registrations.csv']")
    pg.wait_for_timeout(200)
    # As analyst: refused and logged.
    pg.click("[data-action=mk-remove][data-id='clinic_registrations.csv'][data-marking=HEALTH]")
    pg.wait_for_timeout(500)
    if pg.locator(".dc-modal").count():
        pg.keyboard.press("Escape")
    assert any(e["verb"] == "marking.remove" and e["payload"].get("outcome") == "refused" for e in app.events())
    assert not (pg.evaluate("DC.store.get('dc-palantir:governance', {})").get("markingOverrides") or [])
    # As DPO: removed, then restored.
    app.role("dpo")
    app.build_tab("markings")
    pg.click("[data-action=mk-select][data-id='clinic_registrations.csv']")
    pg.click("[data-action=mk-remove][data-id='clinic_registrations.csv'][data-marking=HEALTH]")
    app.checkpoint("Legal basis for the test: court order 2026-11 on lawful access", "oversight")
    assert any(o["removed"] == "HEALTH" for o in pg.evaluate("DC.store.get('dc-palantir:governance', {})")["markingOverrides"])
    pg.click("[data-action=mk-restore][data-marking=HEALTH]")
    app.checkpoint("Restoring the marking after the test run", "oversight")
    overrides = pg.evaluate("DC.store.get('dc-palantir:governance', {})").get("markingOverrides") or []
    assert not any(o["removed"] == "HEALTH" for o in overrides)
    assert any(e["verb"] == "marking.restore" and e["payload"].get("outcome") == "restored" for e in app.events())
    assert not app.errors, app.errors


def test_threshold_055_merges_the_namesakes_and_only_some_roles_may_move_it(app):
    app.open("/foundry-demo/")
    pg = app.page
    pg.evaluate("DC.resolution.setThreshold(0.55)")
    pg.wait_for_timeout(500)
    app.build_tab("resolution")
    body = pg.inner_text("body")
    assert re.search(r"Omar Rahman b\. 1979-02-02 now merged into\s+Omar Al-Rahman", body), body[:400]
    app.role("contractor")
    pg.evaluate("Promise.resolve(DC.resolution.setThreshold(0.75))")
    pg.wait_for_timeout(300)
    assert pg.evaluate("DC.resolution.threshold()") == pytest.approx(0.55)
    assert any(e["verb"] == "resolution.setThreshold" and e["payload"].get("outcome") == "refused" for e in app.events())


def test_auditor_sees_no_passport_ids_in_oversight(app):
    app.open("/demo/#object=person%3A%3Ap8842101", wait=1500)
    app.role("auditor")
    app.open("/audit/", wait=1500)
    text = app.page.inner_text("body")
    assert "p8842101" not in text
    app.role("dpo")
    app.page.wait_for_timeout(600)
    assert "p8842101" in app.page.inner_text("body")


def test_r2_blocks_only_rules_that_touch_clinic_data(app):
    app.open("/demo/")
    app.role("dpo")
    app.karlsruhe(True)
    app.purpose("public-order")
    app.tool("analytics")
    cards = app.page.evaluate("[...document.querySelectorAll('[data-action=\"select-rule\"]')].map(b => b.innerText)")
    blocked = [c for c in cards if "rule R2" in c]
    assert len(blocked) == 1 and "Travel-finance overlap" in blocked[0], cards
    # A person without clinic data is not blocked by R2.
    app.open("/demo/#object=person%3A%3Ap8842101", wait=1500)
    assert "Blocked by rule R2" not in app.page.inner_text(".telecom-expand")
    app.open("/demo/#object=person%3A%3Ag5510077", wait=1500)
    assert "Blocked by rule R2" in app.page.inner_text(".telecom-expand")


def test_audit_chain_verifies(app):
    app.open("/demo/")
    app.tool("graph")
    app.role("dpo")
    app.open("/audit/", wait=1500)
    assert "verified" in app.page.inner_text("body").lower()
