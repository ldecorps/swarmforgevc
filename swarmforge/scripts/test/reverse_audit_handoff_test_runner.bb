#!/usr/bin/env bb
;; Unit coverage for reverse-hop recipient selection, terminal stamping and
;; propagation parsing - reverse_hop_lib.bb, the single implementation
;; swarm_handoff.bb's pack-role-names / last-pack-role? / role-propagation /
;; reverse-roles all delegate to.
;;
;; BL-1299: this file previously called handoff-lib/role-propagation and
;; handoff-lib/pack-pipeline-role-names, neither of which has ever existed -
;; it threw "Unable to resolve symbol" before asserting anything, so the
;; reverse-hop feature shipped with unit coverage that never ran. It also
;; asserted the defect as correct (architect's reverse recipients including
;; "specifier").

(ns reverse-audit-handoff-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir ".." "reverse_hop_lib.bb")))

(def fails (atom 0))
(defn pass [msg] (println "PASS:" msg))
(defn fail [msg]
  (println "FAIL:" msg)
  (swap! fails inc))

(defn check [label expected actual]
  (if (= expected actual)
    (pass label)
    (fail (str label " - expected " (pr-str expected) " got " (pr-str actual)))))

(defn row
  "A realistic roles.tsv row. A master-resident role pairs worktree name
   'master' with the repo root as its path, exactly as swarmforge.sh's
   parse_config writes the pair."
  ([role worktree propagation] (row role worktree propagation "/repo"))
  ([role worktree propagation root]
   (let [master? (contains? reverse-hop-lib/master-worktree-names worktree)
         path (if master? root (str root "/.worktrees/" worktree))]
     (str/join "\t" [role worktree path (str "swarmforge-" role)
                     (str/capitalize role) "claude" "task" "off" propagation]))))

(def live-table
  [(row "specifier" "master" "forward-only")
   (row "coder" "coder" "forward-only")
   (row "cleaner" "cleaner" "back-one")
   (row "architect" "architect" "back-all")
   (row "hardender" "hardender" "forward-only")
   (row "documenter" "documenter" "forward-only")
   (row "QA" "QA" "forward-only")
   (row "coordinator" "master" "forward-only")])

;; ── pipeline order excludes every master-resident role ──────────────────
(check "pipeline roles exclude specifier and coordinator"
       ["coder" "cleaner" "architect" "hardender" "documenter" "QA"]
       (reverse-hop-lib/pipeline-roles live-table))

(check "a 'none' worktree is master-resident too"
       ["coder"]
       (reverse-hop-lib/pipeline-roles [(row "specifier" "none" "forward-only")
                                        (row "coder" "coder" "forward-only")]))

(check "a real worktree row is not master-resident"
       false (reverse-hop-lib/master-resident-row? (row "coder" "coder" "forward-only")))
(check "a master worktree row is master-resident"
       true (reverse-hop-lib/master-resident-row? (row "specifier" "master" "forward-only")))
(check "a row with no worktree column is not master-resident"
       false (reverse-hop-lib/master-resident-row? "lonely"))
(check "blank rows are dropped, not treated as roles"
       ["coder"] (reverse-hop-lib/pipeline-roles ["" (row "coder" "coder" "forward-only") ""]))

;; ── reverse recipients (feature scenarios 01/02) ────────────────────────
(check "architect back-all reaches back only to code-worktree roles"
       ["coder" "cleaner"] (reverse-hop-lib/reverse-recipients live-table "architect"))
(check "cleaner back-one reaches coder"
       ["coder"] (reverse-hop-lib/reverse-recipients live-table "cleaner"))
(check "coder is first, so back-all reaches nobody"
       [] (reverse-hop-lib/reverse-recipients live-table "coder" "back-all"))
(check "QA back-all reaches every code-worktree role before it"
       ["coder" "cleaner" "architect" "hardender" "documenter"]
       (reverse-hop-lib/reverse-recipients live-table "QA" "back-all"))
(check "forward-only sends no reverse copy"
       [] (reverse-hop-lib/reverse-recipients live-table "QA"))
(check "a sender absent from the table sends no reverse copy"
       [] (reverse-hop-lib/reverse-recipients live-table "ghost" "back-all"))

(doseq [sender ["architect" "QA" "cleaner" "coder"]
        mode ["back-all" "back-one" "forward-only"]]
  (let [got (reverse-hop-lib/reverse-recipients live-table sender mode)]
    (when (some #{"specifier" "coordinator"} got)
      (fail (str "master-resident role addressed a reverse copy: "
                 sender "/" mode " -> " (pr-str got))))))
(pass "no sender/mode pair ever addresses specifier or coordinator")

;; ── terminal stamping (feature scenario 03) ─────────────────────────────
(check "terminal pack role is QA" "QA" (reverse-hop-lib/last-pipeline-role live-table))
(check "terminal role is unchanged by an extra master-resident role"
       "QA"
       (reverse-hop-lib/last-pipeline-role
         (conj (vec live-table) (row "auditor" "master" "forward-only"))))

;; ── residency is DERIVED, not a role-name list (feature scenario 04) ────
(check "an ordinary role made master-resident by its row drops out"
       ["coder" "architect" "hardender" "documenter"]
       (reverse-hop-lib/reverse-recipients
         (assoc (vec live-table) 2 (row "cleaner" "master" "back-one"))
         "QA" "back-all"))
(check "a coordinator row with a real worktree still stays excluded"
       ["coder"]
       (reverse-hop-lib/pipeline-roles [(row "coder" "coder" "forward-only")
                                        (row "coordinator" "coordinator" "back-all")]))

;; ── propagation parsing ─────────────────────────────────────────────────
(check "declared back-one is read" "back-one" (reverse-hop-lib/propagation-for live-table "cleaner"))
(check "declared back-all is read" "back-all" (reverse-hop-lib/propagation-for live-table "architect"))
(check "undeclared defaults to forward-only" "forward-only" (reverse-hop-lib/propagation-for live-table "coder"))
(check "an unknown role defaults to forward-only" "forward-only" (reverse-hop-lib/propagation-for live-table "ghost"))
(check "a typo'd mode defaults to forward-only"
       "forward-only" (reverse-hop-lib/propagation-for [(row "coder" "coder" "back-alll")] "coder"))

(if (zero? @fails)
  (do (println "ALL PASS") (System/exit 0))
  (do (println "FAILURES:" @fails) (System/exit 1)))
