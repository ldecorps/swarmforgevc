#!/usr/bin/env bb
;; TDD runner for standing_red_register_lib.bb (BL-1428) - the pure decision
;; core for the standing-red register's single reader.

(ns standing-red-register-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "standing_red_register_lib.bb")))

(def failures (atom []))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))
(defn assert-true [msg actual] (assert= msg true actual))
(defn assert-false [msg actual] (assert= msg false actual))

;; ── parse-allowlist-rows ─────────────────────────────────────────────────

(assert= "parse-allowlist-rows: skips the header row"
         [{:file "test/a.property.test.js" :disposition "allowlist" :rationale "owner BL-1"}]
         (standing-red-register-lib/parse-allowlist-rows
          "file\tdisposition\trationale\ntest/a.property.test.js\tallowlist\towner BL-1\n"))

(assert= "parse-allowlist-rows: skips comment and blank lines"
         [{:file "test/a.property.test.js" :disposition "allowlist" :rationale "x"}]
         (standing-red-register-lib/parse-allowlist-rows
          "# a comment\nfile\tdisposition\trationale\n\ntest/a.property.test.js\tallowlist\tx\n"))

(assert= "parse-allowlist-rows: empty text yields no rows"
         [] (standing-red-register-lib/parse-allowlist-rows ""))

;; ── parse-register-rows ──────────────────────────────────────────────────

(assert= "parse-register-rows: skips leading comment lines, no header to skip"
         [{:lane "unit" :file "extension/test/a.test.js" :ticket "BL-1" :first-seen "2026-09-01" :note "n"}]
         (standing-red-register-lib/parse-register-rows
          "# header comment\n# more comment\nunit\textension/test/a.test.js\tBL-1\t2026-09-01\tn\n"))

(assert= "parse-register-rows: a row with an EMPTY ticket column still parses (ticket is empty string, not shifted)"
         [{:lane "unit" :file "extension/test/a.test.js" :ticket "" :first-seen "2026-09-01" :note "n"}]
         (standing-red-register-lib/parse-register-rows
          "unit\textension/test/a.test.js\t\t2026-09-01\tn\n"))

;; ── allowlist-file->register-path ────────────────────────────────────────

(assert= "allowlist-file->register-path: adds the extension/ prefix"
         "extension/test/a.property.test.js"
         (standing-red-register-lib/allowlist-file->register-path "test/a.property.test.js"))

(assert= "allowlist-file->register-path: idempotent on an already-prefixed path"
         "extension/test/a.property.test.js"
         (standing-red-register-lib/allowlist-file->register-path "extension/test/a.property.test.js"))

;; ── age-days ─────────────────────────────────────────────────────────────

(assert= "age-days: whole days between two ISO dates"
         10 (standing-red-register-lib/age-days "2026-08-27" "2026-09-06"))

(assert= "age-days: zero for the same date"
         0 (standing-red-register-lib/age-days "2026-09-06" "2026-09-06"))

(assert= "age-days: nil when first-seen is nil - never a guessed age"
         nil (standing-red-register-lib/age-days nil "2026-09-06"))

(assert= "age-days: nil when now is nil"
         nil (standing-red-register-lib/age-days "2026-09-06" nil))

(assert= "age-days: nil on an unparseable date, never an exception escaping"
         nil (standing-red-register-lib/age-days "not-a-date" "2026-09-06"))

;; ── build-report ─────────────────────────────────────────────────────────

(defn- ticket-state-fn [open-set closed-set]
  (fn [ticket]
    (cond (contains? open-set ticket) :open
          (contains? closed-set ticket) :closed
          :else :absent)))

;; A register row is ALWAYS emitted directly, whatever its ticket's state.
(let [report (standing-red-register-lib/build-report
              {:allowlist-rows []
               :register-rows [{:lane "unit" :file "extension/test/a.test.js" :ticket "BL-1" :first-seen "2026-08-27"}]
               :ledger-rows []
               :ticket-state-fn (ticket-state-fn #{"BL-1"} #{})
               :now "2026-09-06"})]
  (assert= "build-report: a register row with an open ticket is owned"
           [{:lane "unit" :file "extension/test/a.test.js" :ticket "BL-1"
             :first_seen "2026-08-27" :age_days 10 :owned true}]
           (:rows report))
  (assert= "build-report: count matches the row count" 1 (:count report))
  (assert= "build-report: oldest_age_days is that one row's age" 10 (:oldest_age_days report))
  (assert= "build-report: no unowned rows" [] (:unowned report)))

(let [report (standing-red-register-lib/build-report
              {:allowlist-rows []
               :register-rows [{:lane "unit" :file "extension/test/a.test.js" :ticket "BL-1" :first-seen "2026-08-27"}]
               :ledger-rows []
               :ticket-state-fn (ticket-state-fn #{} #{"BL-1"})
               :now "2026-09-06"})]
  (assert-false "build-report: a register row with a CLOSED ticket is not owned"
                (:owned (first (:rows report))))
  (assert= "build-report: it appears in :unowned" 1 (count (:unowned report))))

;; An allowlist row whose (property,file) the register ALREADY covers is
;; NOT re-emitted a second time - the register row wins.
(let [report (standing-red-register-lib/build-report
              {:allowlist-rows [{:file "test/a.property.test.js" :disposition "allowlist" :rationale "x"}]
               :register-rows [{:lane "property" :file "extension/test/a.property.test.js" :ticket "BL-1" :first-seen "2026-08-27"}]
               :ledger-rows []
               :ticket-state-fn (ticket-state-fn #{"BL-1"} #{})
               :now "2026-09-06"})]
  (assert= "build-report: an allowlist row already covered by the register appears exactly once"
           1 (count (:rows report)))
  (assert-true "build-report: and it is owned (from the register)"
               (:owned (first (:rows report)))))

;; An allowlist row the register does NOT cover contributes its own row,
;; UNOWNED (invariant: "an allowlist file with no register row is unowned").
(let [report (standing-red-register-lib/build-report
              {:allowlist-rows [{:file "test/orphan.property.test.js" :disposition "allowlist" :rationale "x"}]
               :register-rows []
               :ledger-rows []
               :ticket-state-fn (ticket-state-fn #{} #{})
               :now "2026-09-06"})]
  (assert= "build-report: an uncovered allowlist row is emitted"
           [{:lane "property" :file "extension/test/orphan.property.test.js" :ticket nil
             :first_seen nil :age_days nil :owned false}]
           (:rows report))
  (assert= "build-report: it is unowned" 1 (count (:unowned report))))

;; A non-"allowlist" disposition row (e.g. some future "waived" value) is
;; never treated as a red needing an owner.
(let [report (standing-red-register-lib/build-report
              {:allowlist-rows [{:file "test/notreallyallowlisted.property.test.js" :disposition "other" :rationale "x"}]
               :register-rows []
               :ledger-rows []
               :ticket-state-fn (ticket-state-fn #{} #{})
               :now "2026-09-06"})]
  (assert= "build-report: a non-allowlist disposition row contributes nothing"
           [] (:rows report)))

;; A ledger row the register does not already cover (lane hardening)
;; contributes its own row, using the ledger's OWN ticket/first-seen.
(let [report (standing-red-register-lib/build-report
              {:allowlist-rows []
               :register-rows []
               :ledger-rows [{:ticket "BL-2" :file "a.ts,b.ts" :first-seen "2026-08-19"}]
               :ticket-state-fn (ticket-state-fn #{} #{"BL-2"})
               :now "2026-09-06"})]
  (assert= "build-report: a ledger row not covered by the register is emitted, using its OWN ticket"
           [{:lane "hardening" :file "a.ts,b.ts" :ticket "BL-2"
             :first_seen "2026-08-19" :age_days 18 :owned false}]
           (:rows report)))

;; A ledger row the register ALREADY covers (lane hardening) is not
;; re-emitted - same de-dup rule as the allowlist join.
(let [report (standing-red-register-lib/build-report
              {:allowlist-rows []
               :register-rows [{:lane "hardening" :file "a.ts,b.ts" :ticket "BL-3" :first-seen "2026-08-01"}]
               :ledger-rows [{:ticket "BL-2" :file "a.ts,b.ts" :first-seen "2026-08-19"}]
               :ticket-state-fn (ticket-state-fn #{"BL-3"} #{})
               :now "2026-09-06"})]
  (assert= "build-report: a ledger row already covered by the register appears exactly once, from the register"
           [{:lane "hardening" :file "a.ts,b.ts" :ticket "BL-3"
             :first_seen "2026-08-01" :age_days 36 :owned true}]
           (:rows report)))

;; oldest_age_days ignores rows whose age could not be computed (nil),
;; never treating an unknown age as zero.
(let [report (standing-red-register-lib/build-report
              {:allowlist-rows [{:file "test/orphan.property.test.js" :disposition "allowlist" :rationale "x"}]
               :register-rows [{:lane "unit" :file "extension/test/a.test.js" :ticket "BL-1" :first-seen "2026-08-27"}]
               :ledger-rows []
               :ticket-state-fn (ticket-state-fn #{"BL-1"} #{})
               :now "2026-09-06"})]
  (assert= "build-report: oldest_age_days ignores the nil-age orphan row"
           10 (:oldest_age_days report)))

;; oldest_age_days is nil (never 0) when NO row has a computable age.
(let [report (standing-red-register-lib/build-report
              {:allowlist-rows [{:file "test/orphan.property.test.js" :disposition "allowlist" :rationale "x"}]
               :register-rows []
               :ledger-rows []
               :ticket-state-fn (ticket-state-fn #{} #{})
               :now "2026-09-06"})]
  (assert= "build-report: oldest_age_days is nil when nothing has a known age"
           nil (:oldest_age_days report)))

(if (seq @failures)
  (do
    (doseq [f @failures] (println f))
    (println (str (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: standing_red_register_lib.bb"))
