#!/usr/bin/env bb
;; BL-886 coder pass (BL-654 Invariants): PROPERTY test over the landed
;; janitor-side hung-vitest reap fix (commit 1ecbe049f), covering invariant
;; 2's janitor half: "Neither subsystem's scoping ever widens beyond the
;; host root and registered worktrees: a vitest process whose cmdline and
;; cwd are both outside those paths is never a candidate." (the supervisor
;; half of invariant 2, and all of invariant 1, are covered by
;; bl886_vitest_orphan_reaper_supervisor_property_runner.js instead -
;; handoffd_supervisor.bb self-executes on load and has no adapter seam, so
;; its own property coverage has to drive real spawned processes, which
;; Babashka has no fork() primitive for; see that file's own header.)
;;
;; NOTE on toolchain (per swarmforge/constitution's engineering article,
;; "Babashka/Clojure (swarm scripts)"): follows the property-test precedent
;; this repo already established for .bb code
;; (bl879_parent_orphaned_front_desk_property_runner.bb) - a hand-rolled
;; seeded generator in the same swarmforge/scripts/test/ suite that is the
;; actual enforced gate for .bb scripts.
;;
;; Exercises the REAL orphan-janitor-sweep-lib/sweep! wiring with a
;; cmdline/cwd generator drawn from BOTH the host-root pool and the
;; disposable/unrelated pool, over ALL THREE covered vitest cmdline shapes
;; (not just the 3 fixed Examples the acceptance scenario pins) - so the
;; scope guarantee covers "any covered cmdline shape's process at any
;; scoped or unscoped path", never just the acceptance layer's 3 literal
;; strings. Generator reach: cwd is drawn independently of cmdline shape,
;; so every (shape x scoped/unscoped) combination is reachable, and
;; parent-orphaned/stale flags are independently randomized too so the
;; scope gate is proven to win regardless of what would otherwise make the
;; process reapable.
;;
;; Non-vacuity proven by hand at authoring time: P1 failed when
;; project-scoped-path?'s in-path? predicate was temporarily changed from
;; str/starts-with? to a bare str/includes? (an unrelated host-rooted path
;; that merely CONTAINS a worktree substring started matching). Restored
;; before this commit.

(ns bl886-vitest-orphan-reaper-janitor-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def here (fs/parent (fs/canonicalize *file*)))
(load-file (str (fs/path here ".." "orphan_janitor_lib.bb")))
(load-file (str (fs/path here ".." "process_table_lib.bb")))
(load-file (str (fs/path here ".." "orphan_agent_reaper_lib.bb")))
(load-file (str (fs/path here ".." "proc_fd_scan_lib.bb")))
(load-file (str (fs/path here ".." "orphan_agent_reaper_sweep_lib.bb")))
(load-file (str (fs/path here ".." "orphan_janitor_sweep_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 300))
(def failures (atom []))

;; ── seeded generator (mirrors this directory's other property runners) ──
(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))
(defn- gen-bool [s] (let [[i s'] (gen-int s 2)] [(= 1 i) s']))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop gen-fn pred-fn]
  (loop [i 0 s 97]
    (when (< i runs)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result)
          (report! prop s input (str result)))
        (recur (inc i) s')))))

;; ── shared vocabulary: the same shapes the landed regex matches against ──

(def cmdline-shape-pool
  ["npm exec vitest run --config vitest.properties.config.mjs --reporter=json"
   "npx vitest run --config vitest.properties.config.mjs"
   "node (vitest 3) worker"
   "node (vitest) worker"])

(def project-root "/bl886-property-project-root")
(def worktree-root (str project-root "/.worktrees/coder"))

(def in-scope-cwd-pool
  [(str project-root "/extension") worktree-root (str worktree-root "/extension")])

;; The last two entries deliberately CONTAIN project-root/worktree-root as
;; a substring without starting with it - a str/includes?-based scope check
;; (instead of the landed str/starts-with?) would incorrectly treat these
;; as in-scope. Without this pair the pool never actually distinguishes the
;; two predicates (confirmed by hand: P1 kept holding against a str/includes?
;; mutant until these were added).
(def out-of-scope-cwd-pool
  ["/tmp/tmp.unrelated-checkout" "/Users/someone/other-project" "/home/carillon/a-sibling-repo"
   (str "/somewhere-else" project-root) (str "/opt/parent" worktree-root "-decoy")])

(defn- run-sweep-for-one [{:keys [cmdline cwd age-ms parent-orphaned]}]
  (let [kills (atom [])
        audits (atom [])
        adapters {:list-candidate-pids! (fn [] [9191])
                  :cmdline! (fn [_] cmdline)
                  :cwd! (fn [_] cwd)
                  :age-ms! (fn [_] age-ms)
                  :parent-orphaned?! (fn [_] parent-orphaned)
                  :live-window-pid-set! (fn [] #{})
                  :live-runtime-pid! (fn [] nil)
                  :kill-pid! (fn [pid] (swap! kills conj pid))
                  :audit! (fn [line] (swap! audits conj line))
                  :log! (fn [_] nil)}]
    (orphan-janitor-sweep-lib/sweep! project-root adapters)
    {:reaped? (= [9191] @kills) :audits @audits}))

;; ── P1: an out-of-scope hung-vitest process is NEVER reaped, however
;;        favorable every other flag is (parent-orphaned + stale) ─────────
(defn- gen-p1-scenario [s]
  (let [[cmdline s1] (gen-pick s cmdline-shape-pool)
        [cwd s2] (gen-pick s1 out-of-scope-cwd-pool)
        [parent-orphaned s3] (gen-bool s2)]
    [{:cmdline cmdline :cwd cwd :age-ms 999999999 :parent-orphaned parent-orphaned} s3]))

(check-all "P1 janitor-scope-required: an out-of-scope hung-vitest process is never reaped, orphaned or stale or both"
  gen-p1-scenario
  (fn [scenario]
    (let [{:keys [reaped?]} (run-sweep-for-one scenario)]
      (if reaped?
        (str "out-of-scope process was reaped: " (pr-str scenario))
        true))))

;; ── P2: an in-scope hung-vitest process is reaped whenever it is
;;        genuinely reapable (parent-orphaned OR stale), across every
;;        covered cmdline shape and every in-scope cwd ────────────────────
(defn- gen-p2-scenario [s]
  (let [[cmdline s1] (gen-pick s cmdline-shape-pool)
        [cwd s2] (gen-pick s1 in-scope-cwd-pool)
        [parent-orphaned s3] (gen-bool s2)
        [stale? s4] (gen-bool s3)
        age-ms (if stale? 999999999 1000)]
    [{:cmdline cmdline :cwd cwd :age-ms age-ms :parent-orphaned parent-orphaned :expect-reaped (or parent-orphaned stale?)} s4]))

(check-all "P2 janitor-in-scope-reapable: an in-scope hung-vitest process is reaped iff parent-orphaned or stale"
  gen-p2-scenario
  (fn [{:keys [expect-reaped] :as scenario}]
    (let [{:keys [reaped?]} (run-sweep-for-one scenario)]
      (if (= expect-reaped reaped?)
        true
        (str "expected reaped=" expect-reaped " got=" reaped? " for " (pr-str scenario))))))

;; ── report ────────────────────────────────────────────────────────────────
(println (str "bl886 janitor scope properties: " runs " runs each (P1/P2)"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
