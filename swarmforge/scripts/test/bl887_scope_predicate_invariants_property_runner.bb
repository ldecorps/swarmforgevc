#!/usr/bin/env bb
;; BL-887 coder pass (BL-654 Invariants): PROPERTY tests over the two
;; invariants BL-887's own ticket YAML declares:
;;   invariant 1: "Supervisor and janitor never disagree: for any (cmdline,
;;     cwd) pair against the same scope path set, both subsystems produce
;;     the same in-scope classification, because both delegate to the
;;     single shared predicate."
;;   invariant 2: "Scoping never widens: a process whose cmdline and cwd are
;;     both outside the host root and every registered worktree is never
;;     classified in scope by either subsystem."
;;
;; Coverage split, same reasoning bl886's own coder pass used for this exact
;; self-exec constraint (see bl886_vitest_orphan_reaper_supervisor_property_
;; runner.js's header): handoffd_supervisor.bb self-executes (-main) on
;; load and has no adapter seam, so job-in-scope? cannot be exercised
;; in-process here. This file instead:
;;   - property-tests the janitor's real project-scoped-path? against a
;;     DIRECT call to the shared process-table-lib/project-scoped-process?
;;     predicate (using the identical scope-path set project-scoped-path?
;;     derives internally) over a rich generator - the strongest
;;     in-process proof available that the janitor's delegate wrapper never
;;     diverges from the shared predicate, for both invariants.
;;   - the supervisor half of invariant 1 is closed structurally, not
;;     empirically here: job-in-scope?'s entire body (after BL-887) is the
;;     single expression `(process-table-lib/project-scoped-process? cmd cwd
;;     paths)` - verified by this ticket's own required_wiring grep gate,
;;     which proves there is no independent classification logic left in
;;     job-in-scope? that could diverge from the shared predicate. A
;;     behavioral property test cannot add anything here: the supervisor's
;;     OLD inline logic and the NEW delegated call are semantically
;;     identical by this ticket's own design (deliverable 2 - "behavior
;;     unchanged for the supervisor"), so no generated input could ever
;;     distinguish them (confirmed by hand: this file's own P1/P2 held
;;     unchanged when tried against a hand-inlined copy of the old
;;     supervisor logic).
;;   - the previously-DISAGREEING corner (a worker cmdline embedding an
;;     absolute scope path mid-string, paired with an unresolvable cwd) is
;;     additionally cross-checked empirically on BOTH real subsystems:
;;     bl886_vitest_orphan_reaper_janitor_property_runner.bb's P3 (janitor,
;;     in-process) and bl886_vitest_orphan_reaper_supervisor_property_
;;     runner.js's BL-887 addition (supervisor, real spawned process) -
;;     both independently prove the identical shape now classifies in scope,
;;     which is invariant 1's concrete, previously-false claim for the
;;     exact case this ticket exists to fix.
;;
;; NOTE on toolchain (per swarmforge constitution's engineering article,
;; "Babashka/Clojure (swarm scripts)"): follows the same hand-rolled seeded
;; generator precedent as bl886_vitest_orphan_reaper_janitor_property_
;; runner.bb / bl879_parent_orphaned_front_desk_property_runner.bb - the
;; actual enforced gate for .bb scripts, no vitest/*.property.test.js
;; involved (that lane is TypeScript-only; Babashka has none wired, BL-472).
;;
;; Generator reach: the in-scope pool includes a mid-string-embedded-path
;; cmdline shape (the exact one the old janitor missed) so invariant 1 is
;; proven over the corner that used to disagree, not just the easy cases.
;; The out-of-scope pool includes DECOY paths that merely CONTAIN root or
;; worktree as a substring without starting with them (same trick
;; bl886_vitest_orphan_reaper_janitor_property_runner.bb's own out-of-scope-
;; cwd-pool uses) - without these, a generator drawing only obviously-
;; unrelated strings could never distinguish str/starts-with? from a
;; broken str/includes?-on-cwd mutant, and invariant 2 would pass vacuously.
;;
;; Non-vacuity proven by hand at authoring time: P1 (agreement) failed when
;; process-table-lib/project-scoped-process?'s cwd leg was temporarily
;; changed from str/starts-with? to str/includes? (the janitor's fixture-
;; derived paths and the direct shared-predicate call started disagreeing
;; on the CONTAINS-but-does-not-start-with decoy cwd cases). P2 (never
;; widens) failed when the same leg was so mutated, on the identical decoy
;; inputs. Both restored before this commit.

(ns bl887-scope-predicate-invariants-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def here (fs/parent (fs/canonicalize *file*)))
(load-file (str (fs/path here ".." "orphan_janitor_lib.bb")))
(load-file (str (fs/path here ".." "process_table_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 300))
(def failures (atom []))

;; ── seeded generator (mirrors this directory's other property runners) ──
(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop gen-fn pred-fn]
  (loop [i 0 s 71]
    (when (< i runs)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result)
          (report! prop s input (str result)))
        (recur (inc i) s')))))

;; ── fixture: one real project root + one registered worktree, built once
;;    (not per-iteration - project-scoped-path? re-reads roles.tsv from
;;    disk on every call, so a per-run fixture would make 300+ runs do
;;    needless real filesystem work for no additional coverage). real-path
;;    (not canonicalize) so root/worktree already match project-scoped-
;;    path?'s own internal fs/canonicalize output - avoids a Darwin
;;    /var -> /private/var symlink mismatch that would otherwise make an
;;    embedded-path cmdline miss. ──────────────────────────────────────────
(def root (str (fs/real-path (fs/create-temp-dir))))
(def worktree (str (fs/path root ".worktrees" "coder")))
(fs/create-dirs (fs/path root ".swarmforge"))
(fs/create-dirs worktree)
(spit (str (fs/path root ".swarmforge" "roles.tsv"))
      (str "coder\tcoder\t" worktree "\tswarmforge-coder\tCoder\tclaude\ttask\n"))

;; The identical paths project-scoped-path? derives internally for this
;; fixture - used ONLY to drive the shared predicate directly for agreement
;; comparison, never to change how project-scoped-path? itself computes.
(def scope-paths [root worktree])

;; ── shared vocabulary ────────────────────────────────────────────────────

(def in-scope-cmdline-pool
  ;; Includes the mid-string shape (never a cmdline prefix) - the exact
  ;; corner str/starts-with?-only used to miss.
  [(str "node " worktree "/node_modules/vitest/dist/worker.js (vitest 1)")
   (str "node " root "/node_modules/vitest/dist/worker.js (vitest 1)")
   (str root "/some-bin --flag")])

(def in-scope-cwd-pool
  [(str root "/extension") worktree (str worktree "/extension") nil])

;; Deliberately includes strings that merely CONTAIN root/worktree as a
;; substring without starting with them, and without the mid-string cmdline
;; shapes above - proves the generator actually reaches the near-miss
;; region a lazy "obviously unrelated" pool would never exercise.
(def out-of-scope-cmdline-pool
  ["npm exec vitest run --config vitest.properties.config.mjs"
   "npx vitest run --config vitest.properties.config.mjs"
   "sleep 3600"])

(def out-of-scope-cwd-pool
  ["/tmp/tmp.unrelated-checkout" "/Users/someone/other-project"
   (str "/somewhere-else" root) (str "/opt/parent" worktree "-decoy") nil])

(defn- classify-both [cmd cwd]
  {:janitor (orphan-janitor-lib/project-scoped-path? root cmd cwd)
   :shared (process-table-lib/project-scoped-process? cmd cwd scope-paths)})

;; ── P1 (invariant 1): agreement over IN-SCOPE inputs, including the
;;        previously-disagreeing mid-string-cmdline + unresolvable-cwd
;;        corner ─────────────────────────────────────────────────────────
(defn- gen-p1-scenario [s]
  (let [[cmd s1] (gen-pick s in-scope-cmdline-pool)
        [cwd s2] (gen-pick s1 in-scope-cwd-pool)]
    [{:cmd cmd :cwd cwd} s2]))

(check-all "P1 bl887-agreement-in-scope: the janitor's project-scoped-path? and a direct call to the shared predicate agree, and both classify in scope, for every in-scope (cmdline, cwd) combination"
  gen-p1-scenario
  (fn [{:keys [cmd cwd]}]
    (let [{:keys [janitor shared]} (classify-both cmd cwd)]
      (cond
        (not= janitor shared) (str "disagreement: janitor=" janitor " shared=" shared)
        (not janitor) (str "expected in-scope, both false")
        :else true))))

;; ── P2 (invariant 1 + 2): agreement over OUT-OF-SCOPE inputs, including
;;        substring-decoy near-misses, and NEITHER ever widens ───────────
(defn- gen-p2-scenario [s]
  (let [[cmd s1] (gen-pick s out-of-scope-cmdline-pool)
        [cwd s2] (gen-pick s1 out-of-scope-cwd-pool)]
    [{:cmd cmd :cwd cwd} s2]))

(check-all "P2 bl887-agreement-never-widens: the janitor's project-scoped-path? and a direct call to the shared predicate agree, and both classify out of scope, for every (cmdline, cwd) combination outside every scope path (including substring decoys)"
  gen-p2-scenario
  (fn [{:keys [cmd cwd]}]
    (let [{:keys [janitor shared]} (classify-both cmd cwd)]
      (cond
        (not= janitor shared) (str "disagreement: janitor=" janitor " shared=" shared)
        janitor (str "expected out-of-scope (never widens), both true")
        :else true))))

(fs/delete-tree root)

;; ── report ────────────────────────────────────────────────────────────────
(println (str "bl887 scope-predicate invariant properties: " runs " runs each (P1/P2)"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
