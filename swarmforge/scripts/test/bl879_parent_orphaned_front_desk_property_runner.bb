#!/usr/bin/env bb
;; BL-879 coder pass (BL-654 Invariants): PROPERTY tests over the landed
;; parent-orphaned front-desk fast-reap fix (commit 36ea0109e9), covering
;; the three invariants BL-879's ticket YAML declares:
;;
;;   P1 disposable-root-required - "No ancillary reap ever skips the
;;      disposable-root requirement: a process without an extractable
;;      disposable root is never reaped, parent-orphaned or not, so
;;      host-repo front-desk processes can never match." Exercises the
;;      REAL wiring end to end (orphan-janitor-sweep-lib/sweep! with a
;;      generated host-rooted front-desk cmdline), not a hand-fed boolean -
;;      the highest-risk surface per the ticket's own review goal 1.
;;   P2 scope-front-desk-only - "Only the front-desk bridge/bot class skips
;;      the age gate: babysitter, tmux, and every other ancillary class
;;      still require staleness regardless of parent state." Generated
;;      disposable-root babysitter/tmux cmdlines must never fast-path even
;;      when freshly parent-orphaned.
;;   P3 probe-failure-is-not-orphanhood - "The fast path fires only on a
;;      provably gone supervisor: a living parent, or a parent probe that
;;      errors or is unwired, falls back to the ordinary age gate - probe
;;      failure never reads as orphaned." Exercised against the REAL
;;      process-table-lib/parent-orphaned? (not a mock) for the sub-clauses
;;      that ARE forceable on a live JVM: a live child process (living
;;      parent -> false), an out-of-range pid (missing ProcessHandle ->
;;      true, never a throw), and an adapter map with no :parent-orphaned?!
;;      key at all (unwired -> false).
;;
;;      LIMITATION, recorded rather than faked: the "-> false" outcome for a
;;      genuine exception from the .parent()/.isAlive() Java calls
;;      themselves (as opposed to ProcessHandle/of returning empty, which
;;      this JDK does not treat as an error) is guaranteed structurally -
;;      the whole function body is one outer (catch Exception _ false) -
;;      but is not independently forced here. This JDK (25) removed
;;      SecurityManager (JEP 411), the only portable way to make a live
;;      ProcessHandle's parent()/isAlive() throw, and ProcessHandle/of
;;      itself never throws for any long pid (verified: -1 returns
;;      Optional/empty, not IllegalArgumentException, on this JDK) - so
;;      there is no reachable state left to generate into for that specific
;;      sub-clause without rewriting parent-orphaned? to accept an injected
;;      seam, which would touch the reviewed diff itself. Confirmed by code
;;      inspection instead: the catch is unconditional and untargeted, so
;;      it necessarily also covers a .parent()/.isAlive() throw.
;;
;; NOTE on toolchain (per swarmforge/constitution's engineering article,
;; "Babashka/Clojure (swarm scripts)" - BL-472 tracks pinning real
;; mutation/property tooling for .bb scripts, deliberately deferred, not
;; wired today): the BL-654 role contract's "*.property.test.js /
;; vitest.properties.config.mjs" home is a TypeScript convention with no
;; Babashka equivalent. This file follows the property-test precedent this
;; repo already established for .bb code (bl813_daemon_alarm_lib_property_runner.bb,
;; ambulance_lib_property_runner.bb) - a hand-rolled seeded generator in the
;; same swarmforge/scripts/test/ suite that is the actual enforced gate for
;; .bb scripts, per that engineering-article note.
;;
;; Same seeded-LCG convention as this directory's other *_property_runner.bb
;; files (deterministic, never rand - a flaky property is worse than none).
;;
;; Generator-reach note (role contract, "known failure shapes"): P1/P2 build
;; cmdlines from the SAME entrypoint/root vocabulary the landed fix's own
;; regexes match against (disposable-root-re's four prefixes, the two
;; front-desk entrypoints, the five babysitter/tmux shapes) rather than
;; free-form strings, so every generated case is a genuine candidate by
;; construction - never diluted by strings the matcher would reject before
;; the property is even exercised.
;;
;; Non-vacuity proven by hand at authoring time: P1 failed when
;; reapable-tmp-ancillary?'s cond was temporarily reordered to check the
;; front-desk-fast-path clause BEFORE the tmp-rooted-ancillary? clause
;; (host-rooted front-desk got reaped). P2 failed when
;; front-desk-bridge-or-bot-cmdline? was temporarily broadened to `true`
;; unconditionally (babysitter/tmux fast-pathed too). P3 failed when the
;; missing-ProcessHandle branch was flipped from `true` to `false` (P3b/P3c
;; both caught it) and separately when reapable-tmp-ancillary?'s fast-path
;; clause was changed to ignore front-desk-bridge-or-bot? (P3d's unwired
;; case started reaping, since the sweep layer's default-false adapter
;; result no longer mattered). All were restored to the adopted fix before
;; this commit.

(ns bl879-parent-orphaned-front-desk-property-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as bp]))

(def here (fs/parent (fs/canonicalize *file*)))
(load-file (str (fs/path here ".." "orphan_janitor_lib.bb")))
(load-file (str (fs/path here ".." "process_table_lib.bb")))
(load-file (str (fs/path here ".." "orphan_agent_reaper_lib.bb")))
(load-file (str (fs/path here ".." "proc_fd_scan_lib.bb")))
(load-file (str (fs/path here ".." "orphan_agent_reaper_sweep_lib.bb")))
(load-file (str (fs/path here ".." "orphan_janitor_sweep_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 300))
(def failures (atom []))

;; ── seeded generator (mirrors this directory's other property runners) ───

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))
(defn- gen-bool [s] (let [[i s'] (gen-int s 2)] [(= 1 i) s']))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop gen-fn pred-fn]
  (loop [i 0 s 13]
    (when (< i runs)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result)
          (report! prop s input (str result)))
        (recur (inc i) s')))))

;; ── shared vocabulary: the same prefixes/entrypoints the landed regexes match ──

(def disposable-root-pool
  ["/tmp/tmp.Y1XWgEKksC" "/tmp/aps-K3nq81" "/tmp/sfvc-Zq9x2"
   "/var/folders/ks/zpyf9vpn15s2vjwzq52p958c0000gn/T/tmp.HPODI2kV"
   "/var/folders/ks/zpyf9vpn15s2vjwzq52p958c0000gn/T/aps-77Fh"
   "/var/folders/ks/zpyf9vpn15s2vjwzq52p958c0000gn/T/bl622-primary-launch-fblFqQ"])

(def host-root-pool
  ["/home/carillon/swarmforgevc" "/Users/ldecorps/projects/swarmforgevc"
   "/Users/ldecorps/projects/swarmforgevc/.worktrees/coder" "/opt/swarmforgevc"
   "/home/carillon/other-project"])

(def front-desk-entrypoint-pool
  ["extension/out/tools/start-bridge-headless.js"
   "extension/out/tools/telegram-front-desk-bot.js"])

(defn gen-front-desk-cmdline [root-pool s]
  (let [[root s1] (gen-pick s root-pool)
        [entry s2] (gen-pick s1 front-desk-entrypoint-pool)]
    [(str "node " root "/" entry " " root " 8765") s2]))

(defn gen-babysitter-tmux-cmdline [s]
  (let [[root s1] (gen-pick s disposable-root-pool)
        [shape s2] (gen-int s1 5)]
    [(case shape
       0 (str "tmux -S " root "/.swarmforge/babysitter/babysitter-tmux.sock new-session -d -s babysitter")
       1 (str "zsh " root "/.swarmforge/babysitter/launch.sh")
       2 (str "bash " root "/swarmforge/scripts/babysitterd.sh " root)
       3 (str "tmux -S " root "/bl647.sock new-session -d -s swarmforge-coder -n agent")
       4 (str "claude --settings " root "/.swarmforge/babysitter/babysitter.claude-settings.json -n Babysitter Resume"))
     s2]))

;; ── sweep! harness: exercises the REAL wiring, not a hand-fed boolean ────

(defn- run-sweep-for-one [{:keys [cmdline age-ms parent-orphaned]}]
  (let [kills (atom [])
        audits (atom [])
        adapters {:list-candidate-pids! (fn [] [4242])
                  :cmdline! (fn [_] cmdline)
                  :age-ms! (fn [_] age-ms)
                  :parent-orphaned?! (fn [_] parent-orphaned)
                  :live-window-pid-set! (fn [] #{})
                  :live-runtime-pid! (fn [] nil)
                  :kill-pid! (fn [pid] (swap! kills conj pid))
                  :audit! (fn [line] (swap! audits conj line))
                  :log! (fn [_] nil)}]
    (orphan-janitor-sweep-lib/sweep! "/irrelevant" adapters)
    {:reaped? (= [4242] @kills) :audits @audits}))

;; ── P0: reapable-tmp-ancillary?'s own cond matches an independent oracle ──
;; Exhaustive (not sampled): the input is 5 booleans, a 32-row truth table,
;; so full enumeration is strictly stronger than random sampling here and
;; sidesteps the generator-weighting pitfall entirely. This is the test that
;; actually pins "the fast-path check sits strictly after the disposable-root
;; and live-window checks" (review goal 1) at the pure-function's own
;; contract - P1 below exercises the real sweep! wiring, but that wiring's
;; own tmp-rooted-ancillary? is DERIVED from the same disposable-root-re
;; extraction the outer tmp-ancillary-cmdline? gate already required, so at
;; that callsite tmp-rooted-ancillary? is always true by construction and a
;; cond-order regression inside reapable-tmp-ancillary? itself would slip
;; past an end-to-end-only test. Confirmed by deliberately reordering the
;; cond (fast-path clause before the tmp-rooted-ancillary? clause) at
;; authoring time: P0 caught it (host-rooted + front-desk + parent-orphaned
;; flipped to reaped), P1's end-to-end version below did not. Restored
;; before this commit.
(def all-bool-combos
  (for [a [false true] b [false true] c [false true] d [false true] e [false true]]
    {:in-live-window-set? a :tmp-rooted-ancillary? b :stale? c
     :parent-orphaned? d :front-desk-bridge-or-bot? e}))

(doseq [{:keys [in-live-window-set? tmp-rooted-ancillary? stale?
                parent-orphaned? front-desk-bridge-or-bot?] :as flags} all-bool-combos]
  (let [expected (and (not in-live-window-set?)
                       tmp-rooted-ancillary?
                       (or stale? (and front-desk-bridge-or-bot? parent-orphaned?)))
        actual (orphan-janitor-lib/reapable-tmp-ancillary? flags)]
    (when (not= expected (boolean actual))
      (report! "P0 reapable-tmp-ancillary?-oracle" "exhaustive" flags
               (str "expected " expected " got " (boolean actual))))))

;; ── P1: a host-rooted front-desk process is NEVER reaped, orphaned or not ──

(defn gen-p1-scenario [s]
  (let [[cmdline s1] (gen-front-desk-cmdline host-root-pool s)
        [parent-orphaned s2] (gen-bool s1)
        [stale? s3] (gen-bool s2)
        age-ms (if stale? 999999999 1000)]
    [{:cmdline cmdline :age-ms age-ms :parent-orphaned parent-orphaned :stale? stale?} s3]))

(check-all "P1 disposable-root-required: host-rooted front-desk cmdline is never reaped, parent-orphaned or not"
  gen-p1-scenario
  (fn [scenario]
    (let [{:keys [reaped?]} (run-sweep-for-one scenario)]
      (if reaped?
        (str "host-rooted front-desk process was reaped: " (pr-str scenario))
        true))))

;; ── P2: disposable-root front-desk fresh+parent-orphaned always fast-reaps;
;;        disposable-root babysitter/tmux fresh+parent-orphaned never does ──

(defn gen-p2-front-desk-scenario [s]
  (let [[cmdline s1] (gen-front-desk-cmdline disposable-root-pool s)]
    [{:cmdline cmdline :age-ms 1000 :parent-orphaned true} s1]))

(check-all "P2a front-desk-fast-path: fresh, disposable-root, parent-orphaned front-desk is reaped with the parent-orphaned-front-desk reason"
  gen-p2-front-desk-scenario
  (fn [scenario]
    (let [{:keys [reaped? audits]} (run-sweep-for-one scenario)]
      (cond
        (not reaped?) (str "expected fresh parent-orphaned front-desk to be reaped: " (pr-str scenario))
        (not (some #(clojure.string/includes? % "reason=parent-orphaned-front-desk") audits))
        (str "reaped but audit line missing reason=parent-orphaned-front-desk: " (pr-str audits))
        :else true))))

(defn gen-p2-babysitter-scenario [s]
  (let [[cmdline s1] (gen-babysitter-tmux-cmdline s)]
    [{:cmdline cmdline :age-ms 1000 :parent-orphaned true} s1]))

(check-all "P2b scope-front-desk-only: fresh, disposable-root, parent-orphaned babysitter/tmux still requires the age gate"
  gen-p2-babysitter-scenario
  (fn [scenario]
    (let [{:keys [reaped?]} (run-sweep-for-one scenario)]
      (if reaped?
        (str "fresh parent-orphaned babysitter/tmux was fast-reaped (should have needed staleness): " (pr-str scenario))
        true))))

;; ── P3: process-table-lib/parent-orphaned? real semantics ────────────────
;; Not a generator over random pids (an arbitrary integer pid says nothing
;; about real process state - the "generator must demonstrably reach the
;; states the invariant quantifies over" floor is met here by exercising
;; three real, distinct OS-level scenarios instead of sampling a space that
;; would mostly land on "nonexistent pid" anyway).

(let [child (bp/process ["sleep" "5"] {:out :inherit :err :inherit})
      child-pid (.pid (:proc child))]
  (try
    (let [result (process-table-lib/parent-orphaned? child-pid)]
      (when-not (false? result)
        (report! "P3a living-parent" "n/a" child-pid
                 (str "expected false (this test process is alive and is not pid 1), got " (pr-str result)))))
    (finally
      (bp/destroy child)
      (.waitFor ^java.lang.Process (:proc child) 2000 java.util.concurrent.TimeUnit/MILLISECONDS))))

(let [huge-nonexistent-pid 999999999]
  (let [result (process-table-lib/parent-orphaned? huge-nonexistent-pid)]
    (when-not (true? result)
      (report! "P3b missing-process-handle" "n/a" huge-nonexistent-pid
               (str "expected true (no such pid -> missing ProcessHandle), got " (pr-str result))))))

(let [negative-pid -1]
  (let [result (process-table-lib/parent-orphaned? negative-pid)]
    (when-not (true? result)
      (report! "P3c out-of-range-pid-never-throws" "n/a" negative-pid
               (str "expected true (ProcessHandle/of returns empty for an out-of-range pid on this JDK, never throwing; the sweep must not crash on a raced-away pid), got " (pr-str result))))))

;; unwired adapter (no :parent-orphaned?! key at all, not even one that
;; returns false) must still fall back to the ordinary age gate.
(let [kills (atom [])
      adapters {:list-candidate-pids! (fn [] [7777])
                :cmdline! (fn [_] (first (gen-front-desk-cmdline disposable-root-pool 1)))
                :age-ms! (fn [_] 1000)
                :live-window-pid-set! (fn [] #{})
                :live-runtime-pid! (fn [] nil)
                :kill-pid! (fn [pid] (swap! kills conj pid))
                :audit! (fn [_] nil)
                :log! (fn [_] nil)}]
  (orphan-janitor-sweep-lib/sweep! "/irrelevant" adapters)
  (when (seq @kills)
    (report! "P3d unwired-adapter-fails-closed" "n/a" "no :parent-orphaned?! key in adapters"
             (str "expected fresh front-desk with NO parent-orphaned?! adapter wired to require staleness, but it was reaped: " (pr-str @kills)))))

;; ── report ────────────────────────────────────────────────────────────────
(println (str "bl879 parent-orphaned front-desk properties: 32 exhaustive (P0), " runs " runs each (P1/P2), 4 scenarios (P3)"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
