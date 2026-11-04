#!/usr/bin/env bash
# scripts/check.sh — build both seeds to a temp dir, syntax-check the apps, run pytest.
# Usage: bash scripts/check.sh [extra pytest args]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
export PYTHONDONTWRITEBYTECODE=1

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "== Building seeds into $TMP"
python3 scripts/build_ontology_seed.py --output "$TMP/gotham-seed.js"
python3 scripts/build_foundry_seed.py --output "$TMP/foundry-seed.js"

echo "== Syntax-checking browser code"
for f in foundry-demo/app.js "$TMP/gotham-seed.js" "$TMP/foundry-seed.js"; do
  node --check "$f"
  echo "ok  $f"
done
# Investigate is split into native ES modules (demo/js/, loaded from demo/js/main.js).
for f in $(find demo/js -name '*.js' | sort); do
  node --input-type=module --check < "$f"
  echo "ok  $f"
done

echo "== pytest"
if ! python3 -c "import pytest" 2>/dev/null; then
  echo "pytest missing: pip install --break-system-packages pytest" >&2
  exit 1
fi
DC_SEED_DIR="$TMP" python3 -m pytest -q -p no:cacheprovider tests "$@"
