#!/usr/bin/env bb
;; Unit tests for daemon_cycle_guard_lib.bb (BL-967): the bounded-subprocess
;; chokepoint (sh!) and the sweep-boundary wrapper (run-sweep!).

(require '[babashka.fs :as fs]
         '[clojure.string :as str])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "daemon_cycle_guard_lib.bb")))

(def failures (atom []))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))
(defn assert-true [msg actual] (assert= msg true (boolean actual)))
(defn assert-false [msg actual] (assert= msg false (boolean actual)))

;; The env seam is read per call; tests must run with a small bound. The
;; suite is invoked plainly, so set it through a subshell-safe check first.
(def bound (daemon-cycle-guard-lib/subprocess-wait-bound-ms))

;; ── sh! call shapes and passthrough ───────────────────────────────────────

(let [r (daemon-cycle-guard-lib/sh! "echo" "hello")]
  (assert= "sh! varargs: exit 0" 0 (:exit r))
  (assert= "sh! varargs: stdout captured" "hello" (str/trim (:out r))))

(let [r (daemon-cycle-guard-lib/sh! ["echo" "vec"])]
  (assert= "sh! vector form: exit 0 and stdout" ["vec" 0] [(str/trim (:out r)) (:exit r)]))

;; The fixture dir is removed in a FINALLY, never merely after the last
;; assertion: an assert that throws would otherwise leak the temp root
;; permanently (engineering rule; enforced by tempDirTrapGuard.test.js).
(let [d (str (fs/create-temp-dir {:prefix "dcg-test-"}))]
  (try
    (let [r (daemon-cycle-guard-lib/sh! ["pwd"] {:dir d})]
      (assert-true "sh! vector+opts form: :dir honored"
                   (str/includes? (str/trim (:out r)) (fs/file-name d))))
    (finally
      (fs/delete-tree d))))

(let [r (daemon-cycle-guard-lib/sh! "false")]
  (assert= "sh! non-zero exit passes through untouched" 1 (:exit r))
  (assert-false "a real non-zero exit is not a spawn failure" (:spawn-failed? r)))

;; ── BL-1102: spawn failure returns, never throws ──────────────────────────

(let [r (daemon-cycle-guard-lib/sh! "definitely-not-a-real-binary-bl1102")]
  (assert-true "absent binary: returns a result (no throw)" (map? r))
  (assert-true "absent binary: spawn-failed? marker" (:spawn-failed? r))
  (assert= "absent binary: synthesised exit 127" 127 (:exit r)))

(let [missing (str (fs/path (fs/create-temp-dir {:prefix "dcg-missing-"}) "no-such-file"))]
  (try
    (let [r (daemon-cycle-guard-lib/sh! missing)]
      (assert-true "nonexistent path: spawn-failed?" (:spawn-failed? r)))
    (finally
      (fs/delete-tree (fs/parent missing)))))

(let [d (str (fs/create-temp-dir {:prefix "dcg-nx-"}))
      f (str (fs/path d "not-exec"))]
  (try
    (spit f "#!/bin/sh\necho hi\n")
    ;; leave without executable bit
    (let [r (daemon-cycle-guard-lib/sh! f)]
      (assert-true "non-executable path: spawn-failed?" (:spawn-failed? r))
      (assert-false "non-executable is not a bare non-zero without marker"
                    (and (= 1 (:exit r)) (not (:spawn-failed? r)))))
    (finally
      (fs/delete-tree d))))

(let [spawned (daemon-cycle-guard-lib/sh! "definitely-not-a-real-binary-bl1102")
      failed (daemon-cycle-guard-lib/sh! "false")]
  (assert-true "spawn vs ran-failed differ on :spawn-failed?"
               (not= (boolean (:spawn-failed? spawned)) (boolean (:spawn-failed? failed)))))

;; ── sh! bounded wait (the invariant-1 core) ───────────────────────────────
;; Run in a subprocess-scoped env so the bound seam is small without leaking
;; into other assertions: re-exec bb with the env set is heavier than needed
;; - the seam is read per call, so setting it via a wrapper script is
;; equivalent to what the daemon wiring tests do. Here: call through env.

(let [fired (atom nil)]
  (reset! daemon-cycle-guard-lib/on-timeout!
          (fn [info] (reset! fired info)))
  (reset! daemon-cycle-guard-lib/current-context "test-sweep")
  ;; A genuinely hung child: sleep far past the bound.
  (let [t0 (System/currentTimeMillis)
        r (with-redefs [daemon-cycle-guard-lib/subprocess-wait-bound-ms (fn [] 200)]
            (daemon-cycle-guard-lib/sh! "sleep" "10"))
        elapsed (- (System/currentTimeMillis) t0)]
    (assert= "a hung child returns exit 124, never hangs the caller" 124 (:exit r))
    (assert-true "the bounded wait returns promptly (well under the child's own duration)"
                 (< elapsed 5000))
    (assert-true "the timeout error names the bound and the command"
                 (and (str/includes? (:err r) "200ms") (str/includes? (:err r) "sleep")))
    (assert= "on-timeout! fired with the current sweep context" "test-sweep" (:context @fired))
    (assert= "on-timeout! carries the command" ["sleep" "10"] (:cmd @fired))
    (assert= "on-timeout! carries the bound" 200 (:bound-ms @fired)))
  (reset! daemon-cycle-guard-lib/on-timeout! (fn [_] nil))
  (reset! daemon-cycle-guard-lib/current-context "outside-sweep"))

(assert= "the default bound is 60s - well under the 300s freshness threshold"
         60000 daemon-cycle-guard-lib/default-subprocess-wait-bound-ms)

;; ── the timeout actually KILLS the wedged child (hardener, BL-967) ────────
;; The block above proves a timeout HAPPENS - the caller is freed, 124 comes
;; back, on-timeout! fires. None of it proves the wedged child DIED, and a
;; hand-authored mutation sweep confirmed the gap: deleting
;; `(process/destroy-tree proc)` passed the whole unit and property suite.
;;
;; That is invariant 1's second half. "A wedged tmux/git process may cost one
;; bounded wait, never the heartbeat" only holds if the wedged process is
;; reaped; otherwise every timeout leaks a live child into a daemon whose
;; whole failure mode is a restart storm, and the leak compounds silently
;; because the caller sees an ordinary failure and moves on.
;;
;; Asserted by BEHAVIOUR, not by pid bookkeeping: the child would write a
;; marker file shortly after the bound. If the tree is destroyed the marker
;; never appears; if it is not, the orphan keeps running and writes it. Only
;; destroy-tree can distinguish the two.
(let [d (str (fs/create-temp-dir {:prefix "bl967-destroy-"}))
      marker (str (fs/path d "child-survived"))]
  (try
    (reset! daemon-cycle-guard-lib/current-context "destroy-tree-probe")
    (let [r (with-redefs [daemon-cycle-guard-lib/subprocess-wait-bound-ms (fn [] 200)]
              (daemon-cycle-guard-lib/sh! "bash" "-c"
                                          (str "sleep 1.5; echo alive > '" marker "'")))]
      (assert= "the wedged child's bounded wait still returns 124" 124 (:exit r)))
    ;; Outlast the child's own delay by a wide margin, so a surviving orphan
    ;; has had every chance to write. Under load this waits longer than it
    ;; needs to rather than racing.
    (Thread/sleep 3000)
    (assert-true "a bounded-wait timeout DESTROYS the wedged child - it never runs on past the bound"
                 (not (fs/exists? marker)))
    (finally
      (reset! daemon-cycle-guard-lib/current-context "outside-sweep")
      (fs/delete-tree d))))

;; ── the bound covers the STREAM DRAIN, not just the exit code (BL-1021) ───
;; The live deadlock: handoffd's dispatch-gap-sweep shelled out to
;; swarm_handoff.bb, which left a process holding the inherited stdout/err
;; write ends. The direct child exited PROMPTLY, so the exit-code wait never
;; hit its bound and the timeout branch was never taken - and babashka.process
;; then resolved the :out/:err pump futures with NO bound, blocking in read()
;; forever because the pipe never reached EOF. Sampled live 2026-08-21: two
;; pump threads in read(), one wait4 on an already-exited pid, and no
;; on-timeout! line at all.
;;
;; So the two cases below are genuinely different children and BOTH are
;; asserted. The bound is over the CALL, at any process depth - not over the
;; exit code (invariant 1: "a bound that cannot be observed firing is not a
;; bound").
;;
;; The sh! call is itself run under a suite-level deref guard: a regression
;; here does not fail an assertion, it HANGS, and a hung runner reports
;; nothing at all. The guard converts that back into a readable red.

(defn- bounded-call
  "Runs (sh! ...) under a wall-clock guard well past the bound, so a
   regression that blocks forever surfaces as a failed assertion instead of
   an unkillable runner. Returns [result elapsed-ms] or [::hung guard-ms]."
  [guard-ms bound-ms & args]
  (let [t0 (System/currentTimeMillis)
        call (future (with-redefs [daemon-cycle-guard-lib/subprocess-wait-bound-ms (fn [] bound-ms)]
                       (apply daemon-cycle-guard-lib/sh! args)))
        r (deref call guard-ms ::hung)]
    (when (= ::hung r) (future-cancel call))
    [r (- (System/currentTimeMillis) t0)]))

;; Case A - the DEFECT shape: the child exits immediately, but the process it
;; backgrounded still holds the inherited stdout/stderr, so the pipe never
;; sees EOF. `sleep 5` outlives the 200ms bound by a wide margin, and reaps
;; itself long before the suite ends (destroy-tree cannot reach it: it was
;; reparented the instant its parent exited).
;;
;; BL-1031 QA bounce: bare `sleep 5 & exit 0` races on WSL — the grandchild
;; sometimes never retains the write end, so sh! correctly returns exit 0 and
;; the suite flakes (silent "success"). Handshake via a fifo so the parent
;; only exits after the pipe-holder is alive and holding the fds.
(def undrainable-cmd
  ["bash" "-c"
   (str "echo child-output; "
        "s=$(mktemp -u); mkfifo \"$s\" || exit 1; "
        "(echo ready >\"$s\"; exec sleep 5) & "
        "read _ <\"$s\"; rm -f \"$s\"; exit 0")])

(let [fired (atom nil)]
  (reset! daemon-cycle-guard-lib/on-timeout! (fn [info] (reset! fired info)))
  (reset! daemon-cycle-guard-lib/current-context "dispatch-gap-sweep")
  (let [[r elapsed] (apply bounded-call 15000 200 undrainable-cmd)]
    (assert-true "a child whose grandchild holds the pipe open still RETURNS - the bound covers the stream drain, not only the exit code"
                 (not= ::hung r))
    (when (not= ::hung r)
      (assert= "the undrainable call is reported as a bounded-wait timeout" 124 (:exit r))
      (assert-true "the undrainable call returns at the bound, not at the pipe-holder's own lifetime"
                   (< elapsed 5000))
      (assert-true "the timeout error names the bound and the command"
                   (and (str/includes? (:err r) "200ms") (str/includes? (:err r) "bash")))
      (assert= "the timeout is ANNOUNCED, attributed to the sweep that owns the call - never silent"
               "dispatch-gap-sweep" (:context @fired))
      (assert= "the announcement carries the command" undrainable-cmd
               (:cmd @fired))))
  (reset! daemon-cycle-guard-lib/on-timeout! (fn [_] nil))
  (reset! daemon-cycle-guard-lib/current-context "outside-sweep"))

;; Case B - the CONTROL, which passed BEFORE this fix and must keep passing:
;; a direct child that never exits. Bounding the stream drain must not cost
;; the exit-code bound that already worked (qa_e2e_procedure step 2).
(let [fired (atom nil)]
  (reset! daemon-cycle-guard-lib/on-timeout! (fn [info] (reset! fired info)))
  (reset! daemon-cycle-guard-lib/current-context "control-sweep")
  (let [[r elapsed] (bounded-call 15000 200 "sleep" "10")]
    (assert-true "CONTROL: a direct child that never exits still returns" (not= ::hung r))
    (when (not= ::hung r)
      (assert= "CONTROL: the exit-wait bound still reports 124" 124 (:exit r))
      (assert-true "CONTROL: still returns at the bound" (< elapsed 5000))
      (assert= "CONTROL: still announced against its sweep" "control-sweep" (:context @fired))))
  (reset! daemon-cycle-guard-lib/on-timeout! (fn [_] nil))
  (reset! daemon-cycle-guard-lib/current-context "outside-sweep"))

;; A child that exits promptly AND closes its streams is untouched by any of
;; this - the fast path must not acquire a bound-length delay.
(let [[r elapsed] (bounded-call 15000 3000 "bash" "-c" "echo fast; exit 7")]
  (assert= "a prompt, drainable child still passes its own exit code through" 7 (:exit r))
  (assert= "a prompt, drainable child still passes its stdout through" "fast" (str/trim (:out r)))
  (assert-true "a prompt, drainable child returns immediately, never waiting out the bound"
               (< elapsed 3000)))

;; ── run-sweep! boundary observability (the invariant-2 core) ──────────────

(let [logged (atom [])
      log-fn (fn [event detail] (swap! logged conj [event detail]))
      clock (atom 1000)
      now-fn (fn [] @clock)]
  ;; A no-action sweep still emits its boundary with a duration.
  (daemon-cycle-guard-lib/run-sweep! log-fn now-fn "idle-sweep" (fn [] (swap! clock + 40) nil))
  (assert= "an idle sweep still emits exactly its boundary line"
           [["sweep-boundary" "sweep=idle-sweep ms=40"]]
           @logged)

  ;; A throwing sweep logs the pre-existing "<name>-error" event AND the boundary.
  (reset! logged [])
  (daemon-cycle-guard-lib/run-sweep! log-fn now-fn "chase-sweep"
                                     (fn [] (swap! clock + 7) (throw (Exception. "boom"))))
  (assert= "a throwing sweep keeps the existing error event name and still emits its boundary"
           [["chase-sweep-error" "boom"]
            ["sweep-boundary" "sweep=chase-sweep ms=7"]]
           @logged)

  ;; The context is the sweep's name while the thunk runs (timeout attribution).
  (let [seen (atom nil)]
    (daemon-cycle-guard-lib/run-sweep! log-fn now-fn "push-sweep"
                                       (fn [] (reset! seen @daemon-cycle-guard-lib/current-context)))
    (assert= "current-context names the running sweep inside the thunk" "push-sweep" @seen)
    (assert= "current-context resets after the sweep" "outside-sweep"
             @daemon-cycle-guard-lib/current-context)))

;; ── invariant 1's structural half (BL-967 architect bounce D2) ────────────
;; The routing half of invariant 1 - the daemon reaches no subprocess path
;; outside this chokepoint - was previously a stated claim, and a false one:
;; D1 arrived through two in-cycle libs the claim missed. This gate makes the
;; claim executable. Over the TRANSITIVE load-file closure from handoffd.bb
;; (computed by master_checkout_drift_lib's BFS - never a hand-maintained
;; file list, which gets patched one name at a time and re-drifts), no file
;; except daemon_cycle_guard_lib.bb itself may reference babashka.process,
;; clojure.java.shell, process/sh, or process/process. Banning the two
;; namespace tokens is complete for those namespaces - an aliased call
;; cannot exist without naming the namespace in its require. Comments and
;; string contents are stripped first: handoff_lib.bb's docstrings NAME
;; clojure.java.shell while forbidding it, and prose must never trip a gate
;; that exists to catch calls.

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "master_checkout_drift_lib.bb")))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "daemon_api_ban_lib.bb")))

;; ── BL-1022 hardening: strip-comments-and-strings isolated edge cases ──────
;; The end-to-end closure check below proves comment/string stripping works
;; against the REAL tree's docstrings (handoff_lib.bb), but two shapes that
;; do not happen to occur verbatim anywhere in the current tree - an escaped
;; quote inside a string, and a real multi-line string - are otherwise
;; untested. A hand-mutation sweep (breaking escape handling; making a
;; newline close a string early) proved both cases are genuinely
;; discriminating: each mutant made a probe below flip from false to true.
(let [hit? (fn [content]
             (boolean (re-find daemon-api-ban-lib/forbidden-re
                                (daemon-api-ban-lib/strip-comments-and-strings content))))]
  (assert-false "bl1022 scan: a comment naming the banned API is not a call"
                (hit? "; this forbids clojure.java.shell forever\n(defn x [] 1)"))
  (assert-true "bl1022 scan: a real call is a call"
               (hit? "(defn x [] (clojure.java.shell/sh \"ls\"))"))
  (assert-false "bl1022 scan: the banned API named inside a string literal is not a call"
                (hit? "(def doc \"do not use clojure.java.shell here\")"))
  (assert-false "bl1022 scan: an escaped quote keeps the string open, so text after it is still string content"
                (hit? "(def doc \"a \\\" clojure.java.shell mention\")"))
  (assert-false "bl1022 scan: a real multi-line string is all string content, not code"
                (hit? "(def doc \"line one\nclojure.java.shell\nline three\")"))
  (assert-true "bl1022 scan: a char-literal escaped quote does not toggle string state, so code right after it is still scanned"
               (hit? "(def c \\\") (process/sh \"ls\")"))
  (assert-false "bl1022 scan: a semicolon inside a string does not start a comment"
                (hit? "(def doc \"; not a comment babashka.process\")"))
  (assert-true "bl1022 scan: the bare namespace token alone is a call site"
               (hit? "(require '[babashka.process :as p])")))

(let [scripts-dir (fs/path (fs/parent (fs/canonicalize *file*)) "..")
      read-file (fn [bare]
                  (let [p (fs/path scripts-dir bare)]
                    (when (fs/exists? p) (slurp (str p)))))
      reach (master-checkout-drift-lib/resolve-daemon-reachability
             {:entrypoints #{"handoffd.bb"} :read-file read-file})
      closure (:closure reach)
      offenders-in (fn [files] (daemon-api-ban-lib/offenders files read-file))
      ;; The closure the ORIGINAL gate covered - load edges only. Held at zero,
      ;; exactly as before: BL-1022 widens what is gated and weakens nothing.
      load-closure (master-checkout-drift-lib/resolve-daemon-executed-paths
                    {:entrypoints #{"handoffd.bb"} :read-file read-file})
      violations (offenders-in load-closure)
      ;; What following SPAWN edges newly brought into view.
      spawn-only (remove load-closure closure)
      spawn-offender-files (into (sorted-set)
                                 (map #(first (str/split % #":")) (offenders-in spawn-only)))]
  (assert-true "closure gate sanity: the BFS actually resolved handoffd.bb's dependency closure"
               (> (count closure) 20))
  (assert= "invariant 1 structural half: no subprocess path outside the chokepoint anywhere in handoffd.bb's reachability closure"
           [] violations)

  ;; ── BL-1022 ─────────────────────────────────────────────────────────────
  ;; The walk above now follows SPAWN edges as well as load-file edges. Three
  ;; things have to hold for that to be worth anything.

  ;; 1. The edge kind that was missing is actually being followed. Asserting
  ;;    the specific file AND the specific edge kind, not just a bigger count:
  ;;    a count grows for any reason, and this is the file that took production
  ;;    down while the gate read green.
  (assert-true "bl1022: swarm_handoff.bb is in the closure, reached by a SPAWN edge from handoffd.bb"
               (contains? (get-in reach [:reached-by "swarm_handoff.bb"]) [:spawn "handoffd.bb"]))

  ;; 2. Nothing was skipped on the way. A spawn target this walk cannot resolve
  ;;    statically is reported and fails here rather than being dropped -
  ;;    silently skipping one is the same blind spot one level up.
  (assert= "bl1022: every spawn target in the daemon's closure resolved - an unresolvable one fails loudly, never silently"
           [] (:unresolved reach))

  ;; 2b. BL-1031 retired the BL-1022 ratchet: the three spawn-reachable
  ;;    offenders (handoff_inject / pre_qa_gate_gather / salvage) now route
  ;;    through daemon-cycle-guard-lib/sh!. Equality on the empty set — a new
  ;;    offender fails, and a stale ratchet entry would fail too.
  (assert= "bl1031: spawn-reachable subtree carries no banned-API debt (ratchet retired empty)"
           #{} (set spawn-offender-files))

  ;; 3. The gate reports what it covered, so a closure that silently SHRINKS is
  ;;    visible instead of passing for the wrong reason. Every file carries how
  ;;    it was reached; a file in the closure with no recorded edge would mean
  ;;    the report and the walk had drifted apart.
  (assert= "bl1022: the report accounts for every file in the closure, and how each was reached"
           #{} (set (remove #(seq (get-in reach [:reached-by %])) closure)))

  (println (str "  BL-1022 closure: " (count closure) " files ("
                (count (filter #(contains? (get-in reach [:reached-by %]) :entrypoint) closure)) " entrypoint, "
                (count (filter (fn [f] (some (fn [e] (and (vector? e) (= :spawn (first e))))
                                             (get-in reach [:reached-by f]))) closure))
                " reached by spawn), non-bb spawns recorded: "
                (pr-str (:non-bb reach))
                "\n  BL-1031 spawn-only banned-API debt: " (pr-str (vec spawn-offender-files)))))

;; ── report ────────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "ALL PASS: daemon_cycle_guard_lib.bb")
  (do (doseq [f @failures] (println f))
      (System/exit 1)))
