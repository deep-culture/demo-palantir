"""The Build app is split into classic scripts sharing one global script scope (review F-24).

A name declared twice at top level, or one that shadows a browser global, would break the page at load
(let/const) or silently replace another function (function declarations), so this test checks both, and
that index.html loads every part, with app.js last.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "foundry-demo"
TOP_LEVEL = re.compile(r"^(?:async\s+)?(?:function\s*\*?\s*([A-Za-z_$][\w$]*)|(?:const|let|var|class)\s+([A-Za-z_$][\w$]*))", re.M)
BROWSER_GLOBALS = {
    "name", "status", "open", "close", "find", "print", "event", "history", "location", "top", "parent",
    "length", "origin", "self", "frames", "stop", "focus", "blur", "alert", "confirm", "prompt", "scroll",
    "screen", "navigator", "document", "window", "performance", "crypto", "fetch", "external", "closed",
    "opener", "fonts", "caches", "escape", "unescape", "DC", "BuildLeads", "BuildRetention",
}


def _scripts_in_order():
    html = (BUILD / "index.html").read_text(encoding="utf-8")
    srcs = re.findall(r'<script src="\./([^"]+)"', html)
    return [s for s in srcs if s == "app.js" or s.startswith("js/app-")]


def test_index_loads_every_part_with_app_last():
    loaded = _scripts_in_order()
    parts = sorted(f"js/{p.name}" for p in (BUILD / "js").glob("app-*.js"))
    assert sorted(s for s in loaded if s != "app.js") == parts
    assert loaded[-1] == "app.js"


def test_top_level_names_unique_and_not_browser_globals():
    seen = {}
    for rel in _scripts_in_order():
        for match in TOP_LEVEL.finditer((BUILD / rel).read_text(encoding="utf-8")):
            name = match.group(1) or match.group(2)
            assert name not in BROWSER_GLOBALS, f"{rel}: top-level {name!r} shadows a browser global"
            assert name not in seen, f"{name!r} declared in both {seen[name]} and {rel}"
            seen[name] = rel
    assert len(seen) > 200
