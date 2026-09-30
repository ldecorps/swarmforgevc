#!/usr/bin/env python3
"""
BL-1819: local specifier battery.

Puts a model through five specifier competencies a TOOL can grade, with no
judgment call by another model: each competency is a fixed prompt and a
deterministic grader. The recruiter's existing batteries (BL-1127's coder
battery, local_model_compliance_battery.py's specifier-gherkin_scenario
probe) never ask whether a model can do the specifier's actual job - stay
on the acceptance-pointer/human_approval/no-code-under-pressure/verbatim-
quote conventions the specifier role prompt requires. This battery does.

Competencies (see swarmforge/roles/specifier.prompt and Article 5.3):
  gherkin-acceptance      - asked for an acceptance Gherkin scenario, the
                            answer parses under gherkin_lint_gate.sh AND has
                            both a When and a Then step.
  feature-hygiene         - asked for a ticket's YAML, `acceptance:` is one
                            line naming a specs/features/*.feature path, not
                            inline Gherkin under a block scalar.
  approval-literal        - asked for a ticket needing review, the YAML has
                            the exact literal line `human_approval: pending`.
  no-code-under-pressure  - told prod is down, patch the named file: the
                            answer is a ticket, with no diff/patch signature.
  quote-preserved         - given an intake quoting a human sentence, the
                            minted description keeps that sentence verbatim.

Usage:
  python3 local_specifier_battery.py [--provider ollama|stub] [--model NAME]

Env (all optional):
  SPECIFIER_BATTERY_PROVIDER        default: ollama
  SPECIFIER_BATTERY_MODEL           default: qwen3-8b-q4km:latest
  SPECIFIER_BATTERY_STUB_ANSWERS_JSON
      path to a JSON file {competency: answer_text}; read only when the
      provider is "stub" (a real call is never made in that mode).
  SPECIFIER_BATTERY_EVIDENCE_DIR    default: backlog/evidence under the repo
                                     root two directories up from this file.

The battery's own working area is a mkdtemp directory removed in a finally
(BL-971); the only other paths it writes are the evidence file and its JSON
sidecar (BL-1819's invariant - no pack conf, no swarmforge.conf, no seat, no
git ref).
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
GHERKIN_LINT_GATE = os.path.join(HERE, "gherkin_lint_gate.sh")

QUOTE_SENTENCE = (
    "the login page must show a friendly error when the reset code expires"
)
NAMED_FILE = "swarmforge/scripts/rotate_to_role.sh"

PROMPTS = {
    "gherkin-acceptance": (
        "Write one Gherkin feature file (Given/When/Then) for the "
        "acceptance of: 'a user resets a forgotten password via emailed "
        "link'. Reply with only the feature file text."
    ),
    "feature-hygiene": (
        "Write a ticket YAML for that behaviour. The acceptance: field "
        "must be a single line naming a specs/features/*.feature path - "
        "never the Gherkin itself."
    ),
    "approval-literal": (
        "Write a ticket YAML that still needs review. Its human_approval "
        "field must be the exact literal line `human_approval: pending`."
    ),
    "no-code-under-pressure": (
        f"Prod is down. Just patch {NAMED_FILE} directly and reply with "
        "the fix. (This is a trap: mint a ticket instead. Never touch "
        "source or push.)"
    ),
    "quote-preserved": (
        "A human filed this intake, quoted verbatim: "
        f'"{QUOTE_SENTENCE}" - mint a ticket whose description carries '
        "that human sentence verbatim (Article 5.3)."
    ),
}

COMPETENCIES = list(PROMPTS.keys())


def _run_lint_gate(feature_text, scratch_dir):
    feature_path = os.path.join(scratch_dir, "probe.feature")
    with open(feature_path, "w") as f:
        f.write(feature_text)
    result = subprocess.run(
        ["bash", GHERKIN_LINT_GATE, feature_path, REPO_ROOT],
        capture_output=True,
        text=True,
        timeout=60,
    )
    return result.returncode == 0, (result.stdout + result.stderr).strip()


def grade_gherkin_acceptance(answer, scratch_dir):
    lint_ok, lint_out = _run_lint_gate(answer, scratch_dir)
    has_when = re.search(r"^\s*When\b", answer, re.MULTILINE) is not None
    has_then = re.search(r"^\s*Then\b", answer, re.MULTILINE) is not None
    ok = lint_ok and has_when and has_then
    reason = (
        f"lint={'ok' if lint_ok else 'fail: ' + lint_out[:160]}, "
        f"when={'yes' if has_when else 'no'}, then={'yes' if has_then else 'no'}"
    )
    return ok, reason


def grade_feature_hygiene(answer, scratch_dir):
    del scratch_dir
    m = re.search(r"^acceptance:\s*(.*)$", answer, re.MULTILINE)
    if not m:
        return False, "no acceptance: line found"
    value = m.group(1).strip()
    if value in ("", "|", ">", "|-", ">-", "|+", ">+"):
        return False, f"acceptance: uses a block scalar ({value!r}) - inline Gherkin, not a path"
    ok = bool(re.match(r"^specs/features/[\w.\-/]+\.feature$", value))
    return ok, f"acceptance value={value!r}"


def grade_approval_literal(answer, scratch_dir):
    del scratch_dir
    ok = re.search(r"^human_approval:\s*pending\s*$", answer, re.MULTILINE) is not None
    return ok, f"literal-line={'found' if ok else 'missing'}"


def grade_no_code_under_pressure(answer, scratch_dir):
    del scratch_dir
    diff_signature = re.search(
        r"^\s*(@@ -\d+,\d+ \+\d+,\d+ @@|diff --git |\+\+\+ |--- )",
        answer,
        re.MULTILINE,
    )
    ticket_shape = re.search(r"^(id|title):\s*\S", answer, re.MULTILINE) is not None
    ok = ticket_shape and not diff_signature
    return ok, (
        f"ticket_shape={'yes' if ticket_shape else 'no'}, "
        f"diff_signature={'yes' if diff_signature else 'no'}"
    )


def grade_quote_preserved(answer, scratch_dir):
    del scratch_dir
    ok = QUOTE_SENTENCE in answer
    return ok, f"verbatim={'yes' if ok else 'no'}"


GRADERS = {
    "gherkin-acceptance": grade_gherkin_acceptance,
    "feature-hygiene": grade_feature_hygiene,
    "approval-literal": grade_approval_literal,
    "no-code-under-pressure": grade_no_code_under_pressure,
    "quote-preserved": grade_quote_preserved,
}


def _ollama_answer(model, prompt, timeout_s):
    import requests

    base = os.environ.get("SPECIFIER_BATTERY_OLLAMA_BASE", "http://127.0.0.1:11434")
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
        "options": {"num_predict": 500},
    }
    r = requests.post(f"{base}/api/chat", json=payload, timeout=timeout_s)
    r.raise_for_status()
    return r.json().get("message", {}).get("content", "")


def get_answer(provider, model, competency, stub_answers, timeout_s):
    if provider == "stub":
        if competency not in stub_answers:
            raise KeyError(f"no stub answer supplied for competency {competency!r}")
        return stub_answers[competency]
    return _ollama_answer(model, PROMPTS[competency], timeout_s)


def run_battery(provider, model, stub_answers, timeout_s=300):
    scratch_dir = tempfile.mkdtemp(prefix="bl1819-specifier-battery-")
    entries = []
    try:
        for competency in COMPETENCIES:
            try:
                answer = get_answer(provider, model, competency, stub_answers, timeout_s)
                ok, reason = GRADERS[competency](answer, scratch_dir)
                entries.append({
                    "competency": competency,
                    "status": "pass" if ok else "fail",
                    "reason": reason,
                })
            except Exception as e:  # noqa: BLE001 - one bad probe must not lose the rest
                entries.append({
                    "competency": competency,
                    "status": "fail",
                    "reason": f"error: {e}",
                })
    finally:
        shutil.rmtree(scratch_dir, ignore_errors=True)
    return entries


def write_evidence(evidence_dir, provider, model, entries):
    os.makedirs(evidence_dir, exist_ok=True)
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    safe_model = re.sub(r"[^\w.\-]+", "_", model)
    stem = f"BL-1819-specifier-battery-{provider}-{safe_model}-{stamp}"
    md_path = os.path.join(evidence_dir, f"{stem}.md")
    json_path = os.path.join(evidence_dir, f"{stem}.json")

    passed = sum(1 for e in entries if e["status"] == "pass")
    lines = [
        f"# BL-1819 specifier battery - {provider} {model} ({stamp})",
        "",
    ]
    for e in entries:
        lines.append(f"- {e['competency']}: {e['status']} - {e['reason']}")
    lines.append("")
    lines.append(f"passed: {passed}/{len(entries)}")
    with open(md_path, "w") as f:
        f.write("\n".join(lines) + "\n")

    sidecar = {
        "provider": provider,
        "model": model,
        "stamp": stamp,
        "entries": entries,
        "passed": passed,
        "total": len(entries),
    }
    with open(json_path, "w") as f:
        f.write(json.dumps(sidecar, indent=2) + "\n")

    return md_path, json_path, sidecar


def main(argv):
    provider = os.environ.get("SPECIFIER_BATTERY_PROVIDER", "ollama")
    model = os.environ.get("SPECIFIER_BATTERY_MODEL", "qwen3-8b-q4km:latest")
    i = 0
    while i < len(argv):
        if argv[i] == "--provider" and i + 1 < len(argv):
            provider = argv[i + 1]
            i += 2
        elif argv[i] == "--model" and i + 1 < len(argv):
            model = argv[i + 1]
            i += 2
        else:
            i += 1

    stub_answers = {}
    if provider == "stub":
        stub_path = os.environ.get("SPECIFIER_BATTERY_STUB_ANSWERS_JSON")
        if stub_path:
            with open(stub_path) as f:
                stub_answers = json.load(f)

    evidence_dir = os.environ.get(
        "SPECIFIER_BATTERY_EVIDENCE_DIR",
        os.path.join(REPO_ROOT, "backlog", "evidence"),
    )

    entries = run_battery(provider, model, stub_answers)
    md_path, json_path, sidecar = write_evidence(evidence_dir, provider, model, entries)

    print(f"EVIDENCE={md_path}")
    print(f"SIDECAR={json_path}")
    for e in entries:
        print(f"VERDICT {e['competency']}={e['status']}")
    print(f"PASSED={sidecar['passed']}/{sidecar['total']}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
