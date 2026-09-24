# second-round variants, loaded by lab.py at the end (before __main__)
CONT_ASK = "CONTINUE. Reply with exactly one line: ! seat <verb> [args], chosen from your card."
FIX_ASK = "Reply with exactly one line: ! seat <verb> [args], chosen from your card."


def _variant(name, base, **kw):
    sc = dict(SCENARIOS[base]); sc.update(kw); SCENARIOS[name] = sc


for b in ("S1s-stale-note", "S2s-qa-approval", "S3s-two-parcels", "S4s-ff-only-fails"):
    _variant(b.replace("s-", "a-", 1), b, extra_args=["--chat-mode", "ask"], cont=CONT_ASK, fix=FIX_ASK,
             opening=["/run seat next", CONT_ASK])

CONT_DIFF = "CONTINUE. One step: either SEARCH/REPLACE edits, or one ```bash block holding one seat command from your card."
_variant("S5d-coder-diff", "S5s-coder-git-handoff", card="coder-v3.prompt",
         extra_args=["--edit-format", "diff"], cont=CONT_DIFF,
         fix="Reply with one ```bash block holding one seat command from your card.",
         opening=["/run seat next", CONT_DIFF])

# round 3: stateful relay (lifecycle enforcement + per-turn state hints) on the ask-mode coordinator
for b in ("S1a-stale-note", "S2a-qa-approval", "S3a-two-parcels", "S4a-ff-only-fails"):
    _variant(b.replace("a-", "b-", 1), b, relay="state")

# round 3c: stateful relay + the relay names the card row that the payload matches
for b in ("S1a-stale-note", "S2a-qa-approval", "S3a-two-parcels", "S4a-ff-only-fails"):
    _variant(b.replace("a-", "c-", 1), b, relay="state", row_hints=True)


# ---------------------------------------------------------------- round 4: deterministic parcel driver
# The driver runs the whole parcel lifecycle itself (serve, merge, handoff, done) and uses aider only as
# a code-editing engine: one instruction, aider's own --auto-test loop feeds failures back to the model.
def run_driver(name):
    sc = SCENARIOS[name]
    stamp = time.strftime("%Y%m%dT%H%M%S")
    run = LAB / "runs" / f"{stamp}-{name}"
    run.mkdir(parents=True)
    repo = setup_repo(run, sc)
    t0 = time.time()
    events, executed = [], []

    def ev(kind, **kw):
        kw.update(kind=kind, t=round(time.time() - t0, 1))
        events.append(kw)
        print(f"[{name} +{kw['t']:>7}s] {kind} {json.dumps({k: v for k, v in kw.items() if k not in ('kind', 't')})[:300]}", flush=True)

    tmux("kill-session", "-t", SESSION)
    cmd = aider_cmd(run, repo, sc)
    shell = (f"export PATH='{repo}/swarmforge/scripts':$PATH; "
             "export OPENAI_API_KEY=ollama OPENAI_API_BASE=http://127.0.0.1:11434/v1 BROWSER=/usr/bin/true; "
             f"cd '{repo}' && " + " ".join("'" + a.replace("'", "'\\''") + "'" for a in cmd) + "; sleep 86400")
    tmux("new-session", "-d", "-s", SESSION, "-x", "200", "-y", "60", shell, check=True)
    if not wait_idle(120):
        ev("startup-timeout")
        return finish(run, name, sc, events, executed, [], "startup-timeout", t0)

    def run_cmd(c):
        send("/run " + c); time.sleep(1.0); wait_idle(300); executed.append(c); ev("driver-ran", cmd=c)

    def chat(text, timeout):
        n0 = len([b for b in parse_history(run / "llm.log") if b[0] == "RESP"])
        send(text)
        end = time.time() + timeout
        while time.time() < end:
            if len([b for b in parse_history(run / "llm.log") if b[0] == "RESP"]) > n0 and wait_idle(60, settle=4.0):
                return True
            time.sleep(2)
        return False

    def tests_green():
        r = subprocess.run(["python3", "-m", "unittest", "discover", "-s", "tests", "-q"], cwd=repo, capture_output=True, text=True)
        return r.returncode == 0

    run_cmd("seat next")                                   # the TASK text lands in the chat (context only)
    ip = sorted((repo / ".lab/in_process").iterdir())[0].read_text()
    hdr, _, body = ip.partition("\n\n")
    task = next(l.split(": ", 1)[1] for l in hdr.splitlines() if l.startswith("task: "))
    m = re.match(r"merge_and_process (\S+) ([0-9a-f]+)", body.strip())
    run_cmd(f"seat merge {m.group(1)} {m.group(2)}")      # deterministic: the driver parses the PAYLOAD
    # the files the inbound commit ADDED are the spec (ticket + acceptance tests): read-only
    spec = subprocess.run(["git", "diff", "--name-only", "--diff-filter=A", "HEAD~1", "HEAD"], cwd=repo,
                          capture_output=True, text=True).stdout.split()
    for f in spec:
        send(f"/read-only {f}"); time.sleep(1.0); wait_idle(60)
    ticket = next(f for f in spec if f.startswith("backlog/active/"))
    # the EXISTING files the ticket names are editable, added up front (aider drops edits to files not yet
    # in the chat: check_for_file_mentions runs before apply_updates)
    named = [f for f in re.findall(r"[\w./-]+\.\w+", (repo / ticket).read_text())
             if (repo / f).is_file() and f not in spec]
    for f in dict.fromkeys(named):
        send(f"/add {f}"); time.sleep(1.0); wait_idle(60)
    ev("chat-set", read_only=spec, editable=list(dict.fromkeys(named)))
    head0 = subprocess.run(["git", "rev-parse", "HEAD"], cwd=repo, capture_output=True, text=True).stdout.strip()
    instr = (f"Implement {task} exactly as the read-only ticket describes, so that the read-only acceptance test "
             "passes: change the code and update the existing tests to match. Change nothing else.")
    outcome, tries = None, 0
    ok = chat(instr, sc["wall_s"])
    ev("model-turn-done", ok=ok, green=tests_green())
    while not tests_green() and tries < 2 and time.time() - t0 < sc["wall_s"]:
        tries += 1
        run_cmd("seat test")                               # failure output lands in the chat
        ok = chat("The tests above still fail. Fix the code or the tests so they pass. Change nothing else.",
                  sc["wall_s"] - (time.time() - t0))
        ev("fix-turn-done", ok=ok, green=tests_green(), tries=tries)
    head1 = subprocess.run(["git", "rev-parse", "HEAD"], cwd=repo, capture_output=True, text=True).stdout.strip()
    acc_ok = all(subprocess.run(["git", "diff", "--quiet", head0, "HEAD", "--", f], cwd=repo).returncode == 0
                 for f in spec)
    ev("gate", green=tests_green(), model_committed=head1 != head0, spec_untouched=acc_ok)
    if tests_green() and head1 != head0 and acc_ok:
        run_cmd(f"seat handoff QA {task}")
        run_cmd("seat done")
        run_cmd("seat next")
        outcome = "handed-off"
    else:
        run_cmd(f'seat ask "{task}: tests still fail after {tries + 1} model turns"')
        run_cmd("seat done")
        outcome = "escalated"
    return finish(run, name, sc, events, executed, [], outcome, t0)


SCENARIOS["S6-driver-whole"] = dict(
    SCENARIOS["S5s-coder-git-handoff"], card="coder-driver.prompt",
    extra_args=["--test-cmd", "python3 -m unittest discover -s tests -q", "--auto-test"],
    expect=[r"seat next", r"seat merge coordinator [0-9a-f]+", r"seat handoff QA BL-9101", r"seat done", r"seat next"],
    wall_s=2400)
SCENARIOS["S6d-driver-diff"] = dict(SCENARIOS["S6-driver-whole"],
                                    extra_args=SCENARIOS["S6-driver-whole"]["extra_args"] + ["--edit-format", "diff"])
