"""End-to-end tests (review F-20): a static server on a free port and a fresh Chromium context per test.

Run:   pip install pytest playwright && python3 -m playwright install chromium
       python3 -m pytest tests/e2e -q
Skipped automatically when Playwright or its browser is not installed (scripts/check.sh runs them only
with --e2e). Map tiles are blocked, so the tests need no internet access.
"""
import functools
import http.server
import socket
import threading
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]

sync_api = pytest.importorskip("playwright.sync_api")


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class _QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


@pytest.fixture(scope="session")
def base_url():
    port = _free_port()
    handler = functools.partial(_QuietHandler, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{port}"
    server.shutdown()


@pytest.fixture(scope="session")
def browser():
    with sync_api.sync_playwright() as p:
        try:
            b = p.chromium.launch()
        except Exception as exc:  # browser binary missing
            pytest.skip(f"Chromium not available: {exc}")
        yield b
        b.close()


class App:
    """A page plus the few helpers every test uses. Console and page errors are collected in .errors."""

    def __init__(self, page, base):
        self.page, self.base, self.errors = page, base, []
        page.on("pageerror", lambda e: self.errors.append(f"pageerror: {e}"))
        page.on("console", self._console)

    def _console(self, msg):
        if msg.type != "error":
            return
        url = (msg.location or {}).get("url", "")
        if "openstreetmap" in url or "openstreetmap" in msg.text or "ERR_FAILED" in msg.text:
            return
        self.errors.append(f"console.error: {msg.text} @ {url}")

    def open(self, path, wait=1200):
        self.page.goto(self.base + path)
        self.page.wait_for_timeout(wait)
        return self

    def role(self, role):
        self.page.select_option('.dc-session-strip select[data-dc="role"]', role)
        self.page.wait_for_timeout(350)

    def purpose(self, purpose):
        self.page.select_option('.dc-session-strip select[data-dc="purpose"]', purpose)
        self.page.wait_for_timeout(300)

    def karlsruhe(self, on=True):
        box = self.page.locator('.dc-session-strip input[data-dc="karlsruhe"]')
        (box.check if on else box.uncheck)()
        self.page.wait_for_timeout(250)

    def tool(self, name):
        """Investigate tab."""
        self.page.click(f'button[data-action="switch-tool"][data-tool="{name}"]')
        self.page.wait_for_timeout(300)

    def build_tab(self, name):
        self.page.click(f'button[data-action="switch-tab"][data-tab="{name}"]')
        self.page.wait_for_timeout(400)

    def events(self):
        return self.page.evaluate("DC.audit.readEvents()")

    def checkpoint(self, text="Checking the case file for this test run", purpose=None):
        """Answer the open Checkpoint and continue."""
        pg = self.page
        pg.wait_for_selector(".dc-modal", timeout=5000)
        if pg.locator(".dc-modal textarea").count():
            pg.fill(".dc-modal textarea", text)
            sel = pg.locator('.dc-modal select[data-dc="purpose"]')
            if sel.count():
                options = sel.evaluate("s => [...s.options].map(o => o.value).filter(Boolean)")
                if purpose or options:
                    sel.select_option(purpose or options[0])
            pg.click('.dc-modal [data-dc="continue"]')
        else:
            pg.click('.dc-modal [data-dc="ok"]')
        pg.wait_for_timeout(500)

    def ask_agent(self, example_index):
        pg = self.page
        self.tool("copilot")
        pg.click(f'button[data-action="copilot-example"] >> nth={example_index}')
        pg.click('button[data-action="run-copilot"]')
        pg.wait_for_function(
            "!document.querySelector('.trace-pending') && !!document.querySelector('.agent-trace')", timeout=15000
        )
        pg.wait_for_timeout(300)


@pytest.fixture
def app(browser, base_url):
    ctx = browser.new_context(viewport={"width": 1440, "height": 950}, accept_downloads=True)
    ctx.route("**/tile.openstreetmap.org/**", lambda route: route.abort())
    page = ctx.new_page()
    a = App(page, base_url)
    yield a
    ctx.close()
