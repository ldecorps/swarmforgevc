#!/usr/bin/env bb
;; TDD runner for chase_sweep_lib.bb's BL-1104 landed-but-open pure core.
(ns landed-but-open-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "chase_sweep_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual]
  (when-not actual
    (swap! failures conj (str "FAIL: " msg "\n  expected truthy, got: " (pr-str actual)))))

;; ── subject predicates ────────────────────────────────────────────────────

(assert-true "qa-approval: landing subject"
             (chase-sweep-lib/qa-approval-subject?
              "Merge origin/main into QA-approved BL-2001 (aaaaaaaaaa) for landing"
              "BL-2001"))

(assert-true "qa-approval: inventory subject"
             (chase-sweep-lib/qa-approval-subject?
              "BL-2001: QA pass inventory NONE (hotfix)."
              "BL-2001"))

(assert= "qa-approval: wrong ticket on approved subject → false"
         false
         (boolean (chase-sweep-lib/qa-approval-subject?
                   "Merge origin/main into QA-approved BL-2006 (aaaaaaaaaa) for landing"
                   "BL-2005")))

(assert= "qa-approval: no signal → false even when id is named"
         false
         (boolean (chase-sweep-lib/qa-approval-subject?
                   "Spec BL-2002 from the coder follow-up"
                   "BL-2002")))

(assert-true "close-subject: Close BL-####"
             (chase-sweep-lib/close-subject? "Close BL-2001: move to done" "BL-2001"))

(assert= "close-subject: wrong id → false"
         false
         (boolean (chase-sweep-lib/close-subject? "Close BL-9999: move to done" "BL-2001")))

;; ── indexes ignore body (caller must only pass subjects) ──────────────────

(assert= "index-qa-approvals: subject-anchored only"
         {"BL-2006" "aaaaaaaaaa"}
         (chase-sweep-lib/index-qa-approvals
          [{:sha "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
            :subject "Merge origin/main into QA-approved BL-2006 (aaaaaaaaaa) for landing"}]))

(assert= "index-closed-tickets"
         #{"BL-2001"}
         (chase-sweep-lib/index-closed-tickets
          [{:sha "bbbbbbbbbb" :subject "Close BL-2001: move to done"}
           {:sha "cccccccccc" :subject "BL-2001: QA pass inventory NONE"}]))

;; ── decide-landed-but-open ────────────────────────────────────────────────

(assert= "decide-01: approval + active + not closed + not nudged → flag"
         [{:id "BL-2001" :approval-commit "aaaaaaaaaa"}]
         (chase-sweep-lib/decide-landed-but-open
          #{"BL-2001"} {"BL-2001" "aaaaaaaaaa"} #{} #{}))

(assert= "decide-02: no approval → empty"
         []
         (chase-sweep-lib/decide-landed-but-open
          #{"BL-2002"} {} #{} #{}))

(assert= "decide-03: closed → empty"
         []
         (chase-sweep-lib/decide-landed-but-open
          #{"BL-2001"} {"BL-2001" "aaaaaaaaaa"} #{"BL-2001"} #{}))

(assert= "decide-05: already nudged → empty"
         []
         (chase-sweep-lib/decide-landed-but-open
          #{"BL-2007"} {"BL-2007" "aaaaaaaaaa"} #{} #{"BL-2007"}))

(assert= "draft lines address QA and name the approval commit"
         ["type: note" "to: QA" "priority: 00"
          "message: BL-2001 landed-but-open aaaaaaaaaa - resend coordinator notify"]
         (chase-sweep-lib/landed-but-open-draft-lines
          {:id "BL-2001" :approval-commit "aaaaaaaaaa"}))

(assert= "boundary detail none"
         "none"
         (chase-sweep-lib/landed-but-open-boundary-detail []))

(assert= "boundary detail names id=sha"
         "BL-2001=aaaaaaaaaa"
         (chase-sweep-lib/landed-but-open-boundary-detail
          [{:id "BL-2001" :approval-commit "aaaaaaaaaa"}]))

;; ── fixture: body-only mention never indexes ──────────────────────────────
;; Simulates trap (a): a commit whose SUBJECT names BL-2006; BODY would name
;; BL-2005 but read-ref-subject-commits never supplies body — so the index
;; built from subject-only commits cannot flag BL-2005.

(let [tmp (str (fs/create-temp-dir {:prefix "lbo-body-"}))]
  (try
    (fs/create-dirs (fs/path tmp "backlog" "active"))
    (spit (str (fs/path tmp "backlog" "active" "BL-2005.yaml"))
          "id: BL-2005\ntitle: x\nstatus: todo\nassigned_to: coder\n")
    (let [commits [{:sha "dddddddddddddddddddddddddddddddddddddddd"
                    :subject "Merge origin/main into QA-approved BL-2006 (dddddddddd) for landing"}]
          items (chase-sweep-lib/landed-but-open-items
                 (str (fs/path tmp "backlog" "active")) commits [])]
      (assert= "trap (a): body-only ticket never flagged from subject-only commits"
               []
               items))
    (finally
      (fs/delete-tree tmp))))

;; BL-1104 required_wiring: the sweep must be CALLED from handoffd, not merely
;; defined. Acceptance drives the harness; without this check, deleting the
;; run-sweep! call leaves every suite green (BL-419 shape).
(let [handoffd (slurp (str (fs/path (fs/parent (fs/canonicalize *file*))
                                    ".." "handoffd.bb")))]
  (assert-true "handoffd cycle calls run-sweep! landed-but-open"
               (boolean (re-find #"run-sweep!\s+\"landed-but-open\"" handoffd)))
  (assert-true "handoffd defines landed-but-open-sweep!"
               (str/includes? handoffd "landed-but-open-sweep!")))

(when (seq @failures)
  (doseq [f @failures] (println f))
  (System/exit 1))

(println "landed_but_open_test_runner: OK")
