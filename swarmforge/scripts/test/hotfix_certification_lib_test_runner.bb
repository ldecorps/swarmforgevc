#!/usr/bin/env bb
;; TDD runner for hotfix_certification_lib.bb (BL-848). One block per
;; acceptance scenario in specs/features/BL-848-hotfix-swarm-certification-
;; recurring-check.feature, plus parse/render round-trip coverage.
(ns hotfix-certification-lib-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "hotfix_certification_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg expr]
  (when-not expr (swap! failures conj (str "FAIL: " msg))))

(require '[hotfix-certification-lib :as hc])

;; ── parse/render round trip ──────────────────────────────────────────────────

(def sample-ledger-text
  (str hc/ledger-header
       "- commit: f9cf29c29b\n"
       "  subject: \"Land Darwin orphan-janitor fix and file swarm stamp-off intake.\"\n"
       "  detected_at: 2026-08-07\n"
       "  state: stamp-open\n"
       "  stamp_ticket: BL-849\n"
       "  human_decision: null\n"
       "  decided_at: null\n"
       "- commit: f175bc56d1\n"
       "  subject: \"Park local WIP for host switch.\"\n"
       "  detected_at: 2026-08-07\n"
       "  state: pending\n"
       "  stamp_ticket: null\n"
       "  human_decision: null\n"
       "  decided_at: null\n"))

(let [entries (hc/parse-ledger sample-ledger-text)]
  (assert= "parse-ledger reads both entries" 2 (count entries))
  (assert= "entry 1 commit" "f9cf29c29b" (:commit (first entries)))
  (assert= "entry 1 subject unquoted" "Land Darwin orphan-janitor fix and file swarm stamp-off intake."
           (:subject (first entries)))
  (assert= "entry 1 stamp-ticket" "BL-849" (:stamp-ticket (first entries)))
  (assert= "entry 1 human-decision null -> nil" nil (:human-decision (first entries)))
  (assert= "entry 2 stamp-ticket null -> nil" nil (:stamp-ticket (second entries))))

(let [entries (hc/parse-ledger sample-ledger-text)
      rendered (hc/render-ledger entries)
      reparsed (hc/parse-ledger rendered)]
  (assert= "render->reparse round-trips" entries reparsed))

;; a trailing inline comment on a field (the R2 example's own literal shape)
;; is stripped, not left glued onto the value
(let [entries (hc/parse-ledger
               (str "- commit: f9cf29c29b          # 10-hex, the landing on main\n"
                    "  subject: \"Land Darwin orphan-janitor fix...\"\n"
                    "  detected_at: 2026-08-07\n"
                    "  state: stamp-open           # pending|stamp-open|awaiting-human|certified|waived\n"
                    "  stamp_ticket: BL-849        # BL-811-shaped review ticket, or null\n"
                    "  human_decision: null        # null | approved | waived\n"
                    "  decided_at: null\n"))]
  (assert= "inline comment stripped from commit" "f9cf29c29b" (:commit (first entries)))
  (assert= "inline comment stripped from state" "stamp-open" (:state (first entries)))
  (assert= "inline comment stripped from stamp_ticket" "BL-849" (:stamp-ticket (first entries))))

;; ── BL-848 hotfix-certification-01: a declared hotfix enters the ledger
;;    uncertified ──────────────────────────────────────────────────────────
(let [commit {:commit "abc1234567" :subject "Land emergency fix"
              :message "Land emergency fix\n\nHotfix-Certification: pending\n"
              :functional? true :hotfix-declared? true :cited-ticket-done? false}
      report (hc/assemble-report {:entries [] :now-ms 1000 :main-commits [commit]})]
  (assert= "01: exactly one new ledger entry for the declared commit"
           1 (count (:new-ledger-entries report)))
  (assert= "01: new entry's commit matches" "abc1234567" (:commit (first (:new-ledger-entries report))))
  (assert= "01: new entry starts pending (not certified)" "pending" (:state (first (:new-ledger-entries report))))
  (assert-true "01: new entry carries no stamp ticket yet"
               (nil? (:stamp-ticket (first (:new-ledger-entries report))))))

;; ── BL-848 hotfix-certification-02: an open entry is surfaced every time
;;    the check runs, not only once ─────────────────────────────────────────
(let [entry {:commit "abc1234567" :stamp-ticket nil :human-decision nil}
      cooldown 1000
      r1 (hc/assemble-report {:entries [entry] :now-ms 0 :resurface-cooldown-ms cooldown})
      _ (assert= "02: surfaced on first run (never-surfaced counts as due)" 1 (count (:due-for-surfacing r1)))
      r2 (hc/assemble-report {:entries [entry] :now-ms 500
                               :last-surfaced-ms-by-commit (:new-dedup-state r1)
                               :resurface-cooldown-ms cooldown})
      _ (assert= "02: NOT surfaced again before the cooldown elapses" 0 (count (:due-for-surfacing r2)))
      r3 (hc/assemble-report {:entries [entry] :now-ms 1000
                               :last-surfaced-ms-by-commit (:new-dedup-state r1)
                               :resurface-cooldown-ms cooldown})]
  (assert= "02: surfaced again once the cooldown elapses" 1 (count (:due-for-surfacing r3))))

;; ── BL-848 hotfix-certification-03: no stamp ticket -> routed to the
;;    coordinator to mint one ────────────────────────────────────────────────
(let [entry {:commit "abc1234567" :stamp-ticket nil :human-decision nil}
      report (hc/assemble-report {:entries [entry] :now-ms 0})]
  (assert= "03: exactly one mint-stamp-ticket request" 1 (count (:mint-requests report)))
  (assert= "03: mint request names the right commit" "abc1234567" (:commit (first (:mint-requests report)))))

;; ── BL-848 hotfix-certification-04: still short of a human decision ->
;;    never certified, still surfaced ────────────────────────────────────────
(let [in-flight {:commit "c1" :stamp-ticket "BL-900" :human-decision nil
                  :stamp-ticket-status "active" :stamp-ticket-human-approval "approved"}
      qa-no-decision {:commit "c2" :stamp-ticket "BL-901" :human-decision nil
                       :stamp-ticket-status "done" :stamp-ticket-human-approval "pending"}
      report (hc/assemble-report {:entries [in-flight qa-no-decision] :now-ms 0})
      by-commit (into {} (map (juxt :commit identity) (:decided report)))]
  (assert= "04a: ticket still moving through the pipeline -> stamp-open" "stamp-open" (:state (get by-commit "c1")))
  (assert= "04b: ticket passed QA, no human decision -> awaiting-human" "awaiting-human" (:state (get by-commit "c2")))
  (assert-true "04a: not certified" (not= "certified" (:state (get by-commit "c1"))))
  (assert-true "04b: not certified" (not= "certified" (:state (get by-commit "c2"))))
  (assert= "04: both entries still surfaced as outstanding" 2 (count (:due-for-surfacing report))))

;; ── BL-848 hotfix-certification-05: only a recorded human decision closes
;;    an entry ────────────────────────────────────────────────────────────
(let [approved {:commit "c1" :stamp-ticket "BL-900" :human-decision "approved"
                :stamp-ticket-status "done" :stamp-ticket-human-approval "approved"}
      waived {:commit "c2" :stamp-ticket "BL-901" :human-decision "waived"
              :stamp-ticket-status "done" :stamp-ticket-human-approval "approved"}
      report (hc/assemble-report {:entries [approved waived] :now-ms 0})
      by-commit (into {} (map (juxt :commit identity) (:decided report)))]
  (assert= "05: approval decision -> certified" "certified" (:state (get by-commit "c1")))
  (assert= "05: waiver decision -> waived" "waived" (:state (get by-commit "c2")))
  (assert= "05: neither entry is surfaced as outstanding any longer" 0 (count (:due-for-surfacing report))))

;; ── BL-848 hotfix-certification-06: the check never awards certification
;;    on its own ─────────────────────────────────────────────────────────
(let [entry {:commit "c1" :stamp-ticket "BL-900" :human-decision nil
             :stamp-ticket-status "done" :stamp-ticket-human-approval "pending"}
      report (hc/assemble-report {:entries [entry] :now-ms 0})
      decided (first (:decided report))]
  (assert-true "06: no resolved state written for an entry with no recorded decision"
               (not (contains? #{"certified" "waived"} (:state decided))))
  (assert= "06: entry still awaits the human" "awaiting-human" (:state decided))
  (assert-true "06: no anomaly raised when human_approval is correctly still pending"
               (empty? (:anomalies report))))

;; a ticket that reached done with human_approval NOT pending and no ledger
;; decision recorded is a wiring anomaly, reported rather than silently
;; treated as awaiting-human forever
(let [entry {:commit "c1" :stamp-ticket "BL-900" :human-decision nil
             :stamp-ticket-status "done" :stamp-ticket-human-approval "approved"}
      report (hc/assemble-report {:entries [entry] :now-ms 0})]
  (assert= "anomaly: done + human_approval already flipped + no ledger decision is reported"
           1 (count (:anomalies report)))
  (assert-true "anomaly: still not certified without a ledger decision"
               (not= "certified" (:state (first (:decided report))))))

;; ── BL-848 hotfix-certification-07: unaccounted commit is queued for
;;    disposition, framed as a review queue ──────────────────────────────────
(let [commit {:commit "z1" :subject "Unrelated fix" :message "Unrelated fix\n"
              :functional? true :hotfix-declared? false :cited-ticket-done? false}
      report (hc/assemble-report {:entries [] :now-ms 0 :main-commits [commit]})]
  (assert= "07: reported as unaccounted" 1 (count (:unaccounted report)))
  (assert-true "07: the report line frames it as a review queue, not a verdict"
               (str/includes? (hc/unaccounted-report-line commit) "review queue")))

;; a doc-only commit and one whose message cites a done ticket are NOT
;; queued (the honest false-negative this predicate accepts)
(let [doc-only {:commit "z2" :subject "docs" :message "docs\n"
                 :functional? false :hotfix-declared? false :cited-ticket-done? false}
      pipeline-work {:commit "z3" :subject "BL-1 done work" :message "BL-1 done work\n"
                      :functional? true :hotfix-declared? false :cited-ticket-done? true}
      report (hc/assemble-report {:entries [] :now-ms 0 :main-commits [doc-only pipeline-work]})]
  (assert= "07b: doc-only and pipeline-covered commits are never queued as unaccounted"
           0 (count (:unaccounted report))))

;; ── BL-848 hotfix-certification-08: a landing the ledger already knows
;;    about is not queued a second time ──────────────────────────────────────
(let [known-commit {:commit "abc1234567" :stamp-ticket nil :human-decision nil}
      main-commit {:commit "abc1234567" :subject "Land emergency fix"
                    :message "Land emergency fix\n" :functional? true
                    :hotfix-declared? false :cited-ticket-done? false}
      report (hc/assemble-report {:entries [known-commit] :now-ms 0 :main-commits [main-commit]})]
  (assert= "08: not reported unaccounted a second time" 0 (count (:unaccounted report)))
  (assert= "08: not appended as a new ledger entry either" 0 (count (:new-ledger-entries report))))

;; ── hotfix-declared?/cited-ticket-ids/functional-path? unit coverage ────────
(assert-true "hotfix-trailer-value reads the declared value"
             (= "pending" (hc/hotfix-trailer-value "Land fix\n\nHotfix-Certification: pending\n")))
(assert-true "hotfix-declared? false with no trailer" (not (hc/hotfix-declared? "Land fix\n\nBy coder.\n")))
(assert= "cited-ticket-ids finds every BL-nnn/GH-n" #{"BL-849" "GH-3"}
         (hc/cited-ticket-ids "Fixes BL-849 and GH-3, see also BL-849 again"))
(assert-true "functional-path? true for a code path" (hc/functional-path? "swarmforge/scripts/handoffd.bb"))
(assert-true "functional-path? false for docs/" (not (hc/functional-path? "docs/how-to/x.md")))
(assert-true "functional-path? false for backlog/" (not (hc/functional-path? "backlog/active/BL-1.yaml")))
(assert-true "functional-path? false for a bare .md file" (not (hc/functional-path? "README.md")))
(assert-true "functional-commit? true when ANY touched path is functional"
             (hc/functional-commit? ["docs/x.md" "swarmforge/scripts/a.bb"]))
(assert-true "functional-commit? false when every touched path is non-functional"
             (not (hc/functional-commit? ["docs/x.md" "backlog/active/BL-1.yaml"])))

(when (seq @failures)
  (binding [*out* *err*]
    (doseq [f @failures] (println f)))
  (println (str "\n" (count @failures) " failure(s)"))
  (System/exit 1))

(println "hotfix_certification_lib_test_runner: ok")
