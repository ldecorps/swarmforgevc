#!/usr/bin/env bb
;; BL-324: TDD runner for role_lifecycle_lib.bb's pure/adapter-injected
;; functions - no filesystem, no tmux, no clock. Mirrors
;; operator_lib_test_runner.bb.

(ns role-lifecycle-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "role_lifecycle_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual] (assert= msg true (boolean actual)))
(defn assert-false [msg actual] (assert= msg false (boolean actual)))

;; ── role-needed? ────────────────────────────────────────────────────────
(assert-true "warm-core (coordinator) is always needed, even with an empty manifest"
             (role-lifecycle-lib/role-needed? "coordinator" [] []))
(assert-true "a role named by the current ticket's manifest is needed"
             (role-lifecycle-lib/role-needed? "coder" ["coder" "QA"] []))
(assert-true "a role named ONLY by the next queued ticket's manifest is still needed (hysteresis)"
             (role-lifecycle-lib/role-needed? "architect" ["coder" "QA"] ["architect" "QA"]))
(assert-false "a role named by neither manifest, and not warm-core, is not needed"
              (role-lifecycle-lib/role-needed? "hardender" ["coder" "QA"] ["coder" "QA"]))

;; ── parkable? ──────────────────────────────────────────────────────────
(assert-true "an idle, unneeded role is parkable"
             (role-lifecycle-lib/parkable? {:role "architect" :idle? true} ["coder" "QA"] []))
(assert-false "a BUSY unneeded role is never parkable - drain before park, no exception"
              (role-lifecycle-lib/parkable? {:role "architect" :idle? false} ["coder" "QA"] []))
(assert-false "an idle but NEEDED role is not parkable"
              (role-lifecycle-lib/parkable? {:role "coder" :idle? true} ["coder" "QA"] []))
(assert-false "coordinator is never parkable regardless of idleness"
              (role-lifecycle-lib/parkable? {:role "coordinator" :idle? true} [] []))

;; ── roles-to-park (per-role-lifecycle-01/03/04/05) ────────────────────────
(assert= "per-role-lifecycle-01: only the roles the manifest does not need are parked, coordinator excluded"
         #{"cleaner" "architect"}
         (role-lifecycle-lib/roles-to-park
          [{:role "coordinator" :idle? true} {:role "specifier" :idle? true} {:role "coder" :idle? true}
           {:role "cleaner" :idle? true} {:role "architect" :idle? true} {:role "QA" :idle? true}]
          ["specifier" "coder" "QA"] []))

(assert= "per-role-lifecycle-03: a role holding an in-process parcel is NEVER parked, even though its manifest doesn't need it"
         #{}
         (role-lifecycle-lib/roles-to-park [{:role "cleaner" :idle? false}] [] []))

(assert= "per-role-lifecycle-04: a role needed by the NEXT queued ticket is not parked"
         #{}
         (role-lifecycle-lib/roles-to-park [{:role "architect" :idle? true}] [] ["architect" "QA"]))

(assert= "per-role-lifecycle-05: a ticket with no manifest (the full chain) parks nothing"
         #{}
         (role-lifecycle-lib/roles-to-park
          [{:role "coordinator" :idle? true} {:role "specifier" :idle? true} {:role "coder" :idle? true}
           {:role "cleaner" :idle? true} {:role "architect" :idle? true} {:role "hardender" :idle? true}
           {:role "documenter" :idle? true} {:role "QA" :idle? true}]
          ["specifier" "coder" "cleaner" "architect" "hardender" "documenter" "QA"] []))

;; ── roles-to-unpark (per-role-lifecycle-02) ────────────────────────────────
(assert= "per-role-lifecycle-02: a needed role absent from the roster (previously parked) is brought back"
         #{"architect"}
         (role-lifecycle-lib/roles-to-unpark ["coder" "QA"] ["coder" "QA" "architect"]))

(assert= "roles-to-unpark never re-adds a role already present"
         #{}
         (role-lifecycle-lib/roles-to-unpark ["coder" "QA"] ["coder" "QA"]))

;; ── next-queued-roles (lookahead candidate picker) ─────────────────────────
(assert= "next-queued-roles: the lowest-priority-number eligible candidate wins"
         ["coder" "QA"]
         (role-lifecycle-lib/next-queued-roles
          [{:status "todo" :priority 30 :roles ["architect" "QA"]}
           {:status "todo" :priority 10 :roles ["coder" "QA"]}]))

(assert= "next-queued-roles: a blocked candidate is never picked, even at higher priority"
         ["coder" "QA"]
         (role-lifecycle-lib/next-queued-roles
          [{:status "blocked" :priority 1 :roles ["architect" "QA"]}
           {:status "todo" :priority 10 :roles ["coder" "QA"]}]))

(assert= "next-queued-roles: nil when no eligible candidate exists (nothing to look ahead to)"
         nil
         (role-lifecycle-lib/next-queued-roles [{:status "blocked" :priority 1 :roles ["coder"]}]))

(assert= "next-queued-roles: nil for an empty paused backlog"
         nil
         (role-lifecycle-lib/next-queued-roles []))

;; ── park-role!/unpark-role! (adapter-injected, ordering) ───────────────────
;; still-idle? defaults true (the common case) unless overridden per-role -
;; simulates the FRESH re-check role_lifecycle_cli.bb's real adapter
;; performs immediately before each kill.
(defn spy-adapters
  ([] (spy-adapters {}))
  ([still-idle-overrides]
   (let [calls (atom [])]
     {:calls calls
      :adapters {:remove-role-row! (fn [role] (swap! calls conj [:remove-role-row! role]) (str "removed-row-for-" role))
                 :still-idle? (fn [role] (get still-idle-overrides role true))
                 :kill-role-session! (fn [role] (swap! calls conj [:kill-role-session! role]))
                 :restore-role-row! (fn [role removed-row] (swap! calls conj [:restore-role-row! role removed-row]))
                 :add-role-row! (fn [role] (swap! calls conj [:add-role-row! role]))
                 :respawn-role! (fn [role] (swap! calls conj [:respawn-role! role]))}})))

(let [{:keys [calls adapters]} (spy-adapters)]
  (role-lifecycle-lib/park-role! "architect" adapters)
  (assert= "park-role!: the roster row is removed, THEN a fresh idle re-check, THEN the session is killed"
           [[:remove-role-row! "architect"] [:kill-role-session! "architect"]]
           @calls))

(let [{:keys [calls adapters]} (spy-adapters)]
  (role-lifecycle-lib/unpark-role! "architect" adapters)
  (assert= "unpark-role!: the roster row is added BEFORE the session is respawned"
           [[:add-role-row! "architect"] [:respawn-role! "architect"]]
           @calls))

;; ── per-role-lifecycle-07/08: THE IDLE CHECK MUST BE PER-KILL, NOT
;;    PER-BATCH - a role that claims work AFTER the batch snapshot but
;;    BEFORE its own kill must never actually be killed ──────────────────
(let [{:keys [calls adapters]} (spy-adapters {"architect" false})
      result (role-lifecycle-lib/park-role! "architect" adapters)]
  (assert= "park-role!: a role no longer idle at the fresh re-check is NEVER killed"
           [[:remove-role-row! "architect"] [:restore-role-row! "architect" "removed-row-for-architect"]]
           @calls)
  (assert= "park-role!: an aborted park is reported as such, not silently reported identically to a real one"
           {:parked "architect" :aborted? true}
           result))

(let [{:keys [calls adapters]} (spy-adapters)
      result (role-lifecycle-lib/park-role! "architect" adapters)]
  (assert= "park-role!: a role still idle at the fresh re-check is reported as a plain, non-aborted park"
           {:parked "architect"}
           result))

;; ── evaluate-role-lifecycle! (the whole pass, adapter-injected) ───────────
(let [{:keys [calls adapters]} (spy-adapters)
      roster [{:role "coordinator" :idle? true} {:role "coder" :idle? true} {:role "cleaner" :idle? true}]
      result (role-lifecycle-lib/evaluate-role-lifecycle! roster ["coder" "QA"] [] adapters)]
  (assert= "evaluate-role-lifecycle!: reports exactly which roles were parked"
           [{:parked "cleaner"}]
           (:parked result))
  (assert= "evaluate-role-lifecycle!: reports exactly which roles were unparked"
           [{:unparked "QA"}]
           (:unparked result))
  (assert= "evaluate-role-lifecycle!: every park happens before every unpark in the same pass"
           [[:remove-role-row! "cleaner"] [:kill-role-session! "cleaner"]
            [:add-role-row! "QA"] [:respawn-role! "QA"]]
           @calls))

(let [{:keys [calls adapters]} (spy-adapters)
      roster [{:role "coordinator" :idle? true} {:role "cleaner" :idle? false}]]
  (role-lifecycle-lib/evaluate-role-lifecycle! roster [] [] adapters)
  (assert= "evaluate-role-lifecycle!: a busy role (per the BATCH snapshot) is never even attempted"
           []
           @calls))

(let [{:keys [calls adapters]} (spy-adapters {"cleaner" false})
      roster [{:role "coordinator" :idle? true} {:role "cleaner" :idle? true}]
      result (role-lifecycle-lib/evaluate-role-lifecycle! roster [] [] adapters)]
  (assert= "per-role-lifecycle-08 invariant: a role idle at snapshot time but busy at the fresh re-check is left alive, never left parked"
           [{:parked "cleaner" :aborted? true}]
           (:parked result))
  (assert= "per-role-lifecycle-08 invariant: the abort path never reaches kill-role-session!"
           [[:remove-role-row! "cleaner"] [:restore-role-row! "cleaner" "removed-row-for-cleaner"]]
           @calls))

(if (seq @failures)
  (do (doseq [f @failures] (println f))
      (println (str (count @failures) " FAILURE(S)"))
      (System/exit 1))
  (println "role_lifecycle_lib: ALL TESTS PASSED"))
