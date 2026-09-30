#!/usr/bin/env bash
# BL-1821 bounce fix: recruiter_hf_discover.py's --batch flag must emit
# the {"candidates": [...]} shape whenever --batch was given AT ALL,
# including --batch 1 - the exact boundary the architect's review found
# silently regressed to the singular {"candidate": ...} shape (gated on
# `BATCH > 1` instead of "was --batch given"). Drives the REAL script
# against a fake `requests` module on PYTHONPATH (no real network,
# never a real Hugging Face call) - a shim, not a reimplementation of
# the script's own filtering logic.
set -uo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DISCOVER="$SCRIPT_DIR/../recruiter_hf_discover.py"
fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

ROOT="$(mktemp -d)"; register_tmp_dir "$ROOT"
mkdir -p "$ROOT/swarmforge/model-steward"
echo "trusted-org" > "$ROOT/swarmforge/model-steward/recruiter-trusted-orgs.txt"

FAKE_PY="$(mktemp -d)"; register_tmp_dir "$FAKE_PY"
cat > "$FAKE_PY/requests.py" <<'EOF'
# A fake `requests` module: /api/models -> two qualifying candidates,
# any /api/models/<id> "has a Q4_K_M file" probe -> one hit.
import json

class _Resp:
    def __init__(self, payload):
        self._payload = payload
        self.status_code = 200
    def json(self):
        return self._payload
    def raise_for_status(self):
        pass

def get(url, params=None, timeout=None):
    if url.endswith("/api/models"):
        return _Resp([
            {"id": "trusted-org/model-one-8b", "downloads": 100, "likes": 1},
            {"id": "trusted-org/model-two-8b", "downloads": 90, "likes": 1},
        ])
    return _Resp({"siblings": [{"rfilename": "model-Q4_K_M.gguf"}]})
EOF

run_discover() {
  PYTHONPATH="$FAKE_PY" python3 "$DISCOVER" "$ROOT" "$@" 2>&1
}

# 01: --batch 1 emits the plural "candidates" shape with exactly one entry
#     (the boundary the architect found regressed to zero).
OUT1="$(run_discover --batch 1)"
HAS_CANDIDATES="$(printf '%s' "$OUT1" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("candidates" in d)')"
COUNT1="$(printf '%s' "$OUT1" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(d.get("candidates", [])))')"
check "01: --batch 1 emits the plural candidates key" '[[ "$HAS_CANDIDATES" == "True" ]]'
check "01: --batch 1 returns exactly one candidate, never zero" '[[ "$COUNT1" -eq 1 ]]'

# 02: --batch 2 (over the boundary) still emits the plural shape, two entries.
OUT2="$(run_discover --batch 2)"
COUNT2="$(printf '%s' "$OUT2" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(d.get("candidates", [])))')"
check "02: --batch 2 returns two candidates" '[[ "$COUNT2" -eq 2 ]]'

# 03: no --batch at all keeps the singular shape, unchanged.
OUT3="$(run_discover)"
HAS_CANDIDATE_SINGULAR="$(printf '%s' "$OUT3" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("candidate" in d and "candidates" not in d)')"
check "03: no --batch keeps the singular candidate shape" '[[ "$HAS_CANDIDATE_SINGULAR" == "True" ]]'

# 04 (BL-1821 QA bounce D1, second pass): two DIFFERENT orgs publishing a
#     repo whose name normalizes to the SAME alias - the later one is
#     skipped (never silently overwriting the first's ollama alias), and
#     the scan keeps going to fill the batch from a third, distinct repo.
ROOT4="$(mktemp -d)"; register_tmp_dir "$ROOT4"
mkdir -p "$ROOT4/swarmforge/model-steward"
printf 'org-a\norg-b\ntrusted-org\n' > "$ROOT4/swarmforge/model-steward/recruiter-trusted-orgs.txt"

FAKE_PY4="$(mktemp -d)"; register_tmp_dir "$FAKE_PY4"
cat > "$FAKE_PY4/requests.py" <<'EOF'
import json

class _Resp:
    def __init__(self, payload):
        self._payload = payload
        self.status_code = 200
    def json(self):
        return self._payload
    def raise_for_status(self):
        pass

def get(url, params=None, timeout=None):
    if url.endswith("/api/models"):
        return _Resp([
            {"id": "org-a/Llama-3.2-3B-Instruct-GGUF", "downloads": 100, "likes": 1},
            {"id": "org-b/Llama-3.2-3B-Instruct-GGUF", "downloads": 90, "likes": 1},
            {"id": "trusted-org/model-two-8b", "downloads": 80, "likes": 1},
        ])
    return _Resp({"siblings": [{"rfilename": "model-Q4_K_M.gguf"}]})
EOF

OUT4="$(PYTHONPATH="$FAKE_PY4" python3 "$DISCOVER" "$ROOT4" --batch 2 2>&1)"
COUNT4="$(printf '%s' "$OUT4" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(len(d.get("candidates", [])))')"
ALIASES4="$(printf '%s' "$OUT4" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(sorted(c["alias"] for c in d["candidates"]))')"
DUP4="$(printf '%s' "$OUT4" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("rejected", {}).get("duplicate-alias", 0))')"
check "04: a batch of 2 still returns 2 candidates, never collapsed by the alias collision" '[[ "$COUNT4" -eq 2 ]]'
check "04: the colliding second repo never rides along under the first's alias" \
  '[[ "$ALIASES4" == "['"'"'llama-3.2-3b-instruct:latest'"'"', '"'"'model-two-8b:latest'"'"']" ]]'
check "04: the skipped duplicate is counted under rejected.duplicate-alias" '[[ "$DUP4" -eq 1 ]]'

# 05 (BL-1821 spec ruling, note 003572): RECRUITER_SEEN_FILE points
#     novelty at a caller's OWN seen list, apart from the default
#     seen.jsonl the weekly coder path uses - a candidate marked only in
#     the named file is skipped; one marked only in seen.jsonl is not.
ROOT5="$(mktemp -d)"; register_tmp_dir "$ROOT5"
mkdir -p "$ROOT5/swarmforge/model-steward" "$ROOT5/.swarmforge/recruiter"
echo "trusted-org" > "$ROOT5/swarmforge/model-steward/recruiter-trusted-orgs.txt"
echo '{"hf_id": "trusted-org/model-one-8b"}' > "$ROOT5/.swarmforge/recruiter/seen.jsonl"
echo '{"hf_id": "trusted-org/model-two-8b"}' > "$ROOT5/.swarmforge/recruiter/seen-specifier.jsonl"
OUT5="$(RECRUITER_SEEN_FILE=seen-specifier.jsonl PYTHONPATH="$FAKE_PY" python3 "$DISCOVER" "$ROOT5" --batch 2 2>&1)"
IDS5="$(printf '%s' "$OUT5" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(sorted(c["hf_id"] for c in d["candidates"]))')"
check "05: RECRUITER_SEEN_FILE scopes novelty to its own file - the default seen.jsonl entry is ignored" \
  '[[ "$IDS5" == "['"'"'trusted-org/model-one-8b'"'"']" ]]'

echo "ALL PASS"
[[ "$fail" -eq 0 ]] || exit 1
