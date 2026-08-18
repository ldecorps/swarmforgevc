#!/usr/bin/env bb
;; BL-930 coder pass (BL-654 Invariants): PROPERTY tests over the two
;; invariants BL-930's ticket YAML declares for the tmp-rooted onboarder
;; ancillary class added to orphan_janitor_lib.bb's admission gate:
;;
;;   P1 host-repo-never-candidate - "A process whose command line carries no
;;      extractable disposable root is never a candidate for this class,
;;      however orphaned or however old. The host-repo onboarder is BL-928's
;;      territory and this ticket must not be able to touch it even by
;;      accident." Exercises the REAL sweep! wiring against generated
;;      host-rooted onboarder cmdlines (both entry points), every
;;      parent-orphaned/staleness combination.
;;   P2 no-parent-orphaned-fast-path - "Parent-orphaned status is not a reap
;;      licence for this class. A tmp-rooted onboarder is reaped on the
;;      ordinary ancillary age gate and on nothing else, because a
;;      --check-once supervisor exits by design and orphans a LIVE fixture's
;;      poll-loop within milliseconds." Fresh, disposable-root onboarder
;;      cmdlines (both entry points) with parent-orphaned true must never be
;;      reaped - unlike BL-879's front-desk class, which fast-reaps under
;;      the identical condition (see that ticket's P2a for the contrast).
;;
;;      P2b is a positive control, not a declared invariant: stale
;;      disposable-root onboarder cmdlines ARE reaped via the ordinary age
;;      gate regardless of parent state. Without it, P1/P2 alone would pass
;;      just as well if the two predicates were silently mis-wired and never
;;      matched anything at all - the "reaped=true" path has to be shown
;;      reachable too, or "never reaped" proves nothing.
;;
;; Generator-reach: both entry-point cmdline shapes are built from the same
;; vocabulary the landed regexes match (disposable-root-re's prefixes, the
;; two real onboarder cmdline shapes test_onboarder_supervisor_tick.sh
;; spawns - `bb <root>/swarm/onboarder_supervisor.bb <root>/swarm
;; [--check-once]` and `node <root>/swarm/extension/out/tools/onboarder-
;; reconcile.js <root>/swarm poll-loop`), so every generated case is a
;; genuine class member by construction.
;;
;; Non-vacuity proven by hand at authoring time: P1 failed when
;; onboarder-reconcile-cmdline?/onboarder-supervisor-cmdline? were
;; temporarily wired into tmp-ancillary-cmdline?'s `or` OUTSIDE the
;; extract-disposable-root AND-gate (host-rooted onboarder got reaped). P2
;; failed when reapable-tmp-ancillary? was temporarily called with
;; front-desk-bridge-or-bot? hardcoded true (fresh parent-orphaned
;; onboarder started fast-reaping). P2b failed (nothing reaped, invisible
;; regression) when both onboarder predicates were temporarily deleted from
;; tmp-ancillary-cmdline?'s `or` entirely. All three restored to the
;; adopted fix before this commit.
;;
;; Same seeded-LCG convention as this directory's other *_property_runner.bb
;; files (deterministic, never rand - a flaky property is worse than none).

(ns bl930-orphan-janitor-onboarder-ancillary-property-runner
  (:require [babashka.fs :as fs]))

(def here (fs/parent (fs/canonicalize *file*)))
(load-file (str (fs/path here ".." "orphan_janitor_lib.bb")))
(load-file (str (fs/path here ".." "process_table_lib.bb")))
(load-file (str (fs/path here ".." "orphan_agent_reaper_lib.bb")))
(load-file (str (fs/path here ".." "proc_fd_scan_lib.bb")))
(load-file (str (fs/path here ".." "orphan_agent_reaper_sweep_lib.bb")))
(load-file (str (fs/path here ".." "orphan_janitor_sweep_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 300))
(def failures (atom []))

;; ── seeded generator (mirrors bl879_parent_orphaned_front_desk_property_runner.bb) ──

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))
(defn- gen-bool [s] (let [[i s'] (gen-int s 2)] [(= 1 i) s']))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop gen-fn pred-fn]
  (loop [i 0 s 7]
    (when (< i runs)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result)
          (report! prop s input (str result)))
        (recur (inc i) s')))))

;; ── shared vocabulary: the same prefixes/entrypoints the landed regexes match ──

(def disposable-root-pool
  ["/tmp/tmp.Y1XWgEKksC" "/tmp/aps-K3nq81" "/tmp/sfvc-Zq9x2"
   "/var/folders/ks/zpyf9vpn15s2vjwzq52p958c0000gn/T/tmp.KTEWg2bJ"
   "/var/folders/ks/zpyf9vpn15s2vjwzq52p958c0000gn/T/aps-77Fh"
   "/var/folders/ks/zpyf9vpn15s2vjwzq52p958c0000gn/T/bl622-primary-launch-fblFqQ"])

(def host-root-pool
  ["/home/carillon/swarmforgevc" "/Users/ldecorps/projects/swarmforgevc"
   "/Users/ldecorps/projects/swarmforgevc/.worktrees/coder" "/opt/swarmforgevc"
   "/home/carillon/other-project"])

(defn gen-onboarder-reconcile-cmdline [root-pool s]
  (let [[root s1] (gen-pick s root-pool)]
    [(str "node " root "/swarm/extension/out/tools/onboarder-reconcile.js " root "/swarm poll-loop") s1]))

(defn gen-onboarder-supervisor-cmdline [root-pool s]
  (let [[root s1] (gen-pick s root-pool)
        [check-once? s2] (gen-bool s1)]
    [(str "bb " root "/swarm/onboarder_supervisor.bb " root "/swarm" (when check-once? " --check-once")) s2]))

(defn gen-onboarder-cmdline [root-pool s]
  (let [[shape s1] (gen-int s 2)]
    (if (zero? shape)
      (gen-onboarder-reconcile-cmdline root-pool s1)
      (gen-onboarder-supervisor-cmdline root-pool s1))))

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

;; ── P1: host-rooted onboarder (either entry point) is never reaped ───────

(defn gen-p1-scenario [s]
  (let [[cmdline s1] (gen-onboarder-cmdline host-root-pool s)
        [parent-orphaned s2] (gen-bool s1)
        [stale? s3] (gen-bool s2)
        age-ms (if stale? 999999999 1000)]
    [{:cmdline cmdline :age-ms age-ms :parent-orphaned parent-orphaned} s3]))

(check-all "P1 host-repo-never-candidate: host-rooted onboarder cmdline is never reaped, parent-orphaned or not, stale or not"
  gen-p1-scenario
  (fn [scenario]
    (let [{:keys [reaped?]} (run-sweep-for-one scenario)]
      (if reaped?
        (str "host-rooted onboarder process was reaped: " (pr-str scenario))
        true))))

;; ── P2: fresh disposable-root onboarder is never reaped even when
;;        parent-orphaned - no fast path for this class ──────────────────

(defn gen-p2-scenario [s]
  (let [[cmdline s1] (gen-onboarder-cmdline disposable-root-pool s)]
    [{:cmdline cmdline :age-ms 1000 :parent-orphaned true} s1]))

(check-all "P2 no-parent-orphaned-fast-path: fresh, disposable-root, parent-orphaned onboarder is NOT reaped"
  gen-p2-scenario
  (fn [scenario]
    (let [{:keys [reaped?]} (run-sweep-for-one scenario)]
      (if reaped?
        (str "fresh parent-orphaned onboarder was fast-reaped (should have needed staleness): " (pr-str scenario))
        true))))

;; ── P2b: positive control - stale disposable-root onboarder IS reaped ────

(defn gen-p2b-scenario [s]
  (let [[cmdline s1] (gen-onboarder-cmdline disposable-root-pool s)
        [parent-orphaned s2] (gen-bool s1)]
    [{:cmdline cmdline :age-ms 999999999 :parent-orphaned parent-orphaned} s2]))

(check-all "P2b age-gate-still-works (positive control): stale, disposable-root onboarder IS reaped regardless of parent state"
  gen-p2b-scenario
  (fn [scenario]
    (let [{:keys [reaped? audits]} (run-sweep-for-one scenario)]
      (cond
        (not reaped?) (str "stale disposable-root onboarder was NOT reaped: " (pr-str scenario))
        (not (some #(clojure.string/includes? % "reaped-tmp-ancillary") audits))
        (str "reaped but audit line missing reaped-tmp-ancillary: " (pr-str audits))
        :else true))))

(if (seq @failures)
  (do (doseq [f @failures] (println f))
      (System/exit 1))
  (println (str "bl930_orphan_janitor_onboarder_ancillary_property_runner: "
                runs " runs each (P1/P2/P2b) - ALL PROPERTIES HOLD")))
