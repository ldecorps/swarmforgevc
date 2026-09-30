#!/usr/bin/env python3
"""
Weekly recruiter, discovery step: pick ONE open-weight GGUF model from
Hugging Face that fits this host and has not been seen or registered, and
print it as JSON for recruiter_weekly.sh to hand to the Model Steward.

This is the "smarter crawler-backed DiscoverySource" discoverySource.ts
leaves room for, kept as a plain script on purpose: after the 2026-09-21
runaway-coordinator incident, discovery has NO language model in the loop -
nothing here can freelance. Judgement is a reviewable rule set:

  * org allowlist   swarmforge/model-steward/recruiter-trusted-orgs.txt
  * name blocklist  uncensored / abliterated / heretic / crack / ternary /
                    1bit / nsfw / roleplay ... (the raw trending feed is
                    mostly these)
  * size rule       <= MAX_PARAMS_B billion total params (dense or MoE
                    total - CPU-only host, ~13 GB resident ceiling)
  * quant rule      the repo must ship a Q4_K_M .gguf (what `ollama pull
                    hf.co/<org>/<repo>:Q4_K_M` needs)
  * novelty         not in .swarmforge/recruiter/seen.jsonl (or
                    RECRUITER_SEEN_FILE's own file, for a caller with its
                    own seen list - BL-1821's specifier scout), not
                    already a local/<alias> row in the Model Steward
                    registry
  * ranking         downloads desc, then likes (more stable than trending)

Usage: recruiter_hf_discover.py <project-root> [--batch N]
Prints one JSON object on stdout, or {"candidate": null, "reason": ...}.
Exit 0 either way; exit 2 only on a hard error (network, malformed files).

BL-1821: --batch N (N >= 1) returns up to N qualifying candidates instead
of one, as {"candidates": [...], "scanned": ..., "rejected": ...} - for
the specifier scout, which batteries a batch rather than acquiring a
single pick. The single-candidate shape above is UNCHANGED when --batch
is absent (recruiter_weekly.sh's own coder path keeps reading it exactly
as before).
"""
import json
import os
import re
import sys
import time
import requests

BATCH = 1
BATCH_GIVEN = False
_raw = sys.argv[1:]
if "--batch" in _raw:
    _i = _raw.index("--batch")
    BATCH = int(_raw[_i + 1])
    BATCH_GIVEN = True
    _raw = _raw[:_i] + _raw[_i + 2:]
ROOT = _raw[0] if _raw else "."
HF = "https://huggingface.co"
MAX_PARAMS_B = float(os.environ.get("RECRUITER_MAX_PARAMS_B", "14"))
SCAN_LIMIT = int(os.environ.get("RECRUITER_SCAN_LIMIT", "200"))
QUANT = os.environ.get("RECRUITER_QUANT", "Q4_K_M")
# BL-1821 spec ruling (note 003572): novelty is per role - a caller with
# its own seen list (the specifier scout's seen-specifier.jsonl) points
# this at its own filename instead of the weekly coder path's default,
# never sharing one role's seen state with another's.
SEEN_FILENAME = os.environ.get("RECRUITER_SEEN_FILE", "seen.jsonl")

BLOCK = re.compile(
    r"uncensor|abliterat|heretic|crack|ternary|1[-_]?bit|nsfw|roleplay|\brp\b|erp|"
    r"lewd|toxic|jailbreak|obliterat|distill(?!ed-)?.*(?:35b|70b)|merge",
    re.IGNORECASE,
)
PARAMS = re.compile(r"(\d+(?:\.\d+)?)\s*[bB](?![a-zA-Z])")


def trusted_orgs():
    p = os.path.join(ROOT, "swarmforge", "model-steward", "recruiter-trusted-orgs.txt")
    orgs = set()
    with open(p) as f:
        for line in f:
            line = line.split("#", 1)[0].strip()
            if line:
                orgs.add(line.lower())
    return orgs


def seen_ids():
    p = os.path.join(ROOT, ".swarmforge", "recruiter", SEEN_FILENAME)
    ids = set()
    if os.path.exists(p):
        with open(p) as f:
            for line in f:
                try:
                    ids.add(json.loads(line)["hf_id"])
                except Exception:
                    pass
    return ids


def registered_aliases():
    p = os.path.join(ROOT, ".swarmforge", "model-steward", "registry.json")
    try:
        d = json.load(open(p))
        return {k.split("/", 1)[1].split(":")[0].lower() for k in d.get("models", {}) if k.startswith("local/")}
    except Exception:
        return set()


def total_params_b(name):
    """Largest N in 'NB' tokens of the repo name (a MoE '30B-A3B' counts as 30:
    what has to fit in RAM is the total, not the active set)."""
    nums = [float(m.group(1)) for m in PARAMS.finditer(name)]
    return max(nums) if nums else None


def alias_for(hf_id):
    repo = hf_id.split("/", 1)[1]
    a = re.sub(r"-?gguf$", "", repo, flags=re.IGNORECASE)
    a = re.sub(r"[^A-Za-z0-9.]+", "-", a).strip("-").lower()
    return a


def has_quant_file(hf_id):
    r = requests.get(f"{HF}/api/models/{hf_id}", timeout=30)
    if r.status_code != 200:
        return None
    files = [s.get("rfilename", "") for s in r.json().get("siblings", [])]
    want = QUANT.lower()
    hits = [f for f in files if f.lower().endswith(".gguf") and want in f.lower()]
    # a single-file quant only; sharded (-00001-of-0000N) needs a Modelfile, skip
    hits = [f for f in hits if not re.search(r"-\d{5}-of-\d{5}\.gguf$", f, re.IGNORECASE)]
    return hits[0] if hits else None


def main():
    orgs = trusted_orgs()
    seen = seen_ids()
    registered = registered_aliases()
    r = requests.get(
        f"{HF}/api/models",
        params={"filter": "gguf", "pipeline_tag": "text-generation",
                "sort": "downloads", "direction": -1, "limit": SCAN_LIMIT},
        timeout=60,
    )
    r.raise_for_status()
    rejected = {}
    found = []
    # BL-1821 QA bounce D1 (second pass): two different repos can normalize
    # to the SAME alias_for() (e.g. two orgs both publishing a
    # "Llama-3.2-3B-Instruct" repo) - `registered` only catches a collision
    # with an ALREADY-registered local/<alias>, never one against a
    # candidate this same batch run already picked. Unchecked, a real run
    # pulls both under one alias and `ollama cp` silently overwrites it,
    # collapsing two distinct models into one score-table row. Track this
    # run's own picks and skip a later duplicate, counted separately from
    # "registered" so the two causes stay distinguishable in `rejected`.
    batch_aliases = set()
    for m in r.json():
        hf_id = m.get("id", "")
        org = hf_id.split("/", 1)[0].lower()
        name = hf_id.split("/", 1)[-1]
        if org not in orgs:
            rejected.setdefault("untrusted-org", 0); rejected["untrusted-org"] += 1
            continue
        if BLOCK.search(name):
            rejected.setdefault("blocklisted-name", 0); rejected["blocklisted-name"] += 1
            continue
        pb = total_params_b(name)
        if pb is None or pb > MAX_PARAMS_B:
            rejected.setdefault("size", 0); rejected["size"] += 1
            continue
        if hf_id in seen:
            rejected.setdefault("seen", 0); rejected["seen"] += 1
            continue
        alias = alias_for(hf_id)
        if alias in registered:
            rejected.setdefault("registered", 0); rejected["registered"] += 1
            continue
        if alias in batch_aliases:
            rejected.setdefault("duplicate-alias", 0); rejected["duplicate-alias"] += 1
            continue
        qf = has_quant_file(hf_id)
        time.sleep(0.2)
        if not qf:
            rejected.setdefault(f"no-{QUANT}-file", 0); rejected[f"no-{QUANT}-file"] += 1
            continue
        batch_aliases.add(alias)
        found.append({
            "hf_id": hf_id,
            "org": org,
            "params_b": pb,
            "downloads": m.get("downloads"),
            "likes": m.get("likes"),
            "quant": QUANT,
            "quant_file": qf,
            "ollama_pull": f"hf.co/{hf_id}:{QUANT}",
            "alias": f"{alias}:latest",
            "page": f"{HF}/{hf_id}",
        })
        if len(found) >= BATCH:
            break
    if BATCH_GIVEN:
        print(json.dumps({"candidates": found, "scanned": SCAN_LIMIT, "rejected": rejected}, indent=2))
        return 0
    if found:
        print(json.dumps({"candidate": found[0], "scanned": SCAN_LIMIT, "rejected": rejected}, indent=2))
        return 0
    print(json.dumps({"candidate": None,
                      "reason": f"no trusted, in-size, unseen GGUF repo with a {QUANT} file in the top {SCAN_LIMIT} by downloads",
                      "rejected": rejected}, indent=2))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        print(json.dumps({"candidate": None, "error": str(e)}))
        sys.exit(2)
