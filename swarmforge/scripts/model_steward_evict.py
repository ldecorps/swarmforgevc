#!/usr/bin/env python3
"""
Model Steward eviction: delete less capable LOCAL Ollama models to keep disk
for recruiting (human ruling 2026-09-21: disk is scarce; the Steward /
recruiter may delete less capable models). Evidence-based and mechanical -
the Steward's own scorecards decide, nothing else.

NEVER evicted (protected):
  * the current Telegram local seat model (SWARMFORGE_LOCAL_SEAT_MODEL in
    .swarmforge/swarm.env)
  * any model a pack conf names (swarmforge/packs/*.conf, `openai/<tag>`)
  * any tag sharing its weights (same Ollama ID) with a protected tag -
    deleting it would free nothing and could confuse a pack

Everything else is ranked by its scorecard
(.swarmforge/model-steward/scorecards/local__<tag>.json):
  score = (safety probes both "pass" ? 1 : 0, passed / total entries)
The top --keep (default 2) stay; the rest are evicted, and so is anything
with no scorecard at all (unproven) or a failed safety probe. Tags sharing
weights with a kept tag are kept too (nothing to free). Registry rows and
scorecards are never touched - they are the record of what was measured.

Usage: model_steward_evict.py <project-root> [--keep N] [--dry-run] [--min-free-gb G]
  --min-free-gb G  only evict when the model store has < G GB free (default: always)
Prints one JSON object with the plan/result; exit 0.
"""
import json
import os
import re
import shutil
import subprocess
import sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else "."
KEEP = int(next((sys.argv[i + 1] for i, a in enumerate(sys.argv) if a == "--keep"), "2"))
DRY = "--dry-run" in sys.argv
MIN_FREE = float(next((sys.argv[i + 1] for i, a in enumerate(sys.argv) if a == "--min-free-gb"), "0"))
SAFETY = ("coordinator-infra_edit_refusal", "coordinator-no_fabricated_work")


def sh(cmd):
    return subprocess.run(cmd, capture_output=True, text=True)


def ollama_models():
    out = sh(["ollama", "list"]).stdout.splitlines()[1:]
    models = []
    for ln in out:
        parts = ln.split()
        if len(parts) >= 4:
            models.append({"tag": parts[0], "id": parts[1], "size": f"{parts[2]} {parts[3]}"})
    return models


def norm(tag):
    return tag if ":" in tag.split("/")[-1] else tag + ":latest"


def protected_tags():
    prot = set()
    env = os.path.join(ROOT, ".swarmforge", "swarm.env")
    if os.path.exists(env):
        m = re.search(r'^export SWARMFORGE_LOCAL_SEAT_MODEL="?([^"\n]+)"?', open(env).read(), re.M)
        if m:
            prot.add(norm(m.group(1).strip()))
    packs = os.path.join(ROOT, "swarmforge", "packs")
    for f in os.listdir(packs) if os.path.isdir(packs) else []:
        if f.endswith(".conf"):
            for m in re.finditer(r"openai/([A-Za-z0-9._:/-]+)", open(os.path.join(packs, f)).read()):
                prot.add(norm(m.group(1)))
    return prot


def scorecard(tag):
    p = os.path.join(ROOT, ".swarmforge", "model-steward", "scorecards", f"local__{tag}.json")
    if not os.path.exists(p):
        return None
    try:
        d = json.load(open(p))
        entries = d.get("entries", [])
        by = {e.get("competency"): e.get("status") for e in entries}
        safety_ok = all(by.get(c) == "pass" for c in SAFETY)
        safety_failed = any(by.get(c) not in (None, "pass") for c in SAFETY)
        passed = sum(1 for e in entries if e.get("status") == "pass")
        return {"safety_ok": safety_ok, "safety_failed": safety_failed,
                "passed": passed, "total": len(entries),
                "ratio": (passed / len(entries)) if entries else 0.0}
    except Exception:
        return None


def free_gb():
    mf = sh(["ollama", "show", "qwen2.5-coder:latest", "--modelfile"]).stdout
    m = re.search(r"^FROM (.*)/blobs/", mf, re.M)
    store = m.group(1) if m else os.path.expanduser("~/.ollama/models")
    try:
        return shutil.disk_usage(store).free / 1e9, store
    except Exception:
        return None, store


def main():
    models = ollama_models()
    prot = protected_tags()
    free, store = free_gb()
    if MIN_FREE and free is not None and free >= MIN_FREE:
        print(json.dumps({"action": "skip", "reason": f"{free:.1f} GB free under {store} >= {MIN_FREE} GB", "free_gb": round(free, 1)}))
        return 0

    rows = []
    for m in models:
        card = scorecard(m["tag"])
        rows.append({**m, "protected": m["tag"] in prot, "card": card})
    # protection propagates across shared weights
    prot_ids = {r["id"] for r in rows if r["protected"]}
    for r in rows:
        if r["id"] in prot_ids:
            r["protected"] = True

    def score(r):
        c = r["card"]
        if not c or c["safety_failed"]:
            return (-1, 0.0, 0)
        return (1 if c["safety_ok"] else 0, c["ratio"], c["passed"])

    ranked = sorted((r for r in rows if not r["protected"] and r["card"] and not r["card"]["safety_failed"]),
                    key=score, reverse=True)
    keep_ids = {r["id"] for r in rows if r["protected"]} | {r["id"] for r in ranked[:KEEP]}
    plan = []
    for r in rows:
        if r["id"] in keep_ids:
            why = "protected" if r["protected"] else ("kept: top-%d by scorecard" % KEEP)
            plan.append({"tag": r["tag"], "size": r["size"], "action": "keep", "why": why, "score": score(r)})
        else:
            c = r["card"]
            why = ("no scorecard (unproven)" if not c else
                   "failed safety probe" if c["safety_failed"] else
                   f"ranked below top-{KEEP} ({c['passed']}/{c['total']}, safety_ok={c['safety_ok']})")
            plan.append({"tag": r["tag"], "size": r["size"], "action": "evict", "why": why, "score": score(r)})

    evicted, errors = [], []
    if not DRY:
        for p in plan:
            if p["action"] == "evict":
                r = sh(["ollama", "rm", p["tag"]])
                (evicted if r.returncode == 0 else errors).append(p["tag"] + ("" if r.returncode == 0 else f": {r.stderr.strip()[:80]}"))
    free_after, _ = free_gb()
    print(json.dumps({"action": "dry-run" if DRY else "evicted", "keep": KEEP,
                      "free_gb_before": round(free, 1) if free else None,
                      "free_gb_after": round(free_after, 1) if free_after else None,
                      "protected": sorted(prot), "plan": plan,
                      "evicted": evicted, "errors": errors}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
