#!/usr/bin/env bb
;; TDD runner for required_stages_lib.bb (BL-606) - pure assertions only,
;; mirroring backlog_depth_test_runner.bb's own shape.
(ns required-stages-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "required_stages_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

;; ── read-required-stages ──────────────────────────────────────────────────

(assert= "absent field reads as not present"
         {:present? false :raw nil}
         (required-stages-lib/read-required-stages "id: BL-1\nstatus: todo\n"))

(assert= "present flow-list field is read verbatim after the colon"
         {:present? true :raw "[coder, cleaner, qa]"}
         (required-stages-lib/read-required-stages "id: BL-1\nrequired_stages: [coder, cleaner, qa]\nstatus: todo\n"))

(assert= "present empty-list field"
         {:present? true :raw "[]"}
         (required-stages-lib/read-required-stages "id: BL-1\nrequired_stages: []\n"))

(assert= "present non-list scalar field"
         {:present? true :raw "coder"}
         (required-stages-lib/read-required-stages "id: BL-1\nrequired_stages: coder\n"))

(assert= "nil content degrades to absent, never a crash"
         {:present? false :raw nil}
         (required-stages-lib/read-required-stages nil))

;; ── normalize-token ────────────────────────────────────────────────────────

(assert= "lower-case token normalizes to its canonical casing" "QA" (required-stages-lib/normalize-token "qa"))
(assert= "already-canonical token is unchanged" "coder" (required-stages-lib/normalize-token "coder"))
(assert= "upper-case input normalizes the same" "cleaner" (required-stages-lib/normalize-token "CLEANER"))
(assert= "the hardener alias normalizes to hardender" "hardender" (required-stages-lib/normalize-token "hardener"))
(assert= "hardender is already canonical" "hardender" (required-stages-lib/normalize-token "hardender"))
(assert= "specifier is never a member of the canonical chain" nil (required-stages-lib/normalize-token "specifier"))
(assert= "coordinator is never a member of the canonical chain" nil (required-stages-lib/normalize-token "coordinator"))
(assert= "an unrecognized stage normalizes to nil" nil (required-stages-lib/normalize-token "deploy"))
(assert= "nil token normalizes to nil" nil (required-stages-lib/normalize-token nil))

;; ── parse ──────────────────────────────────────────────────────────────────

(assert= "parses a well-formed flow list" ["coder" "cleaner" "qa"] (required-stages-lib/parse "[coder, cleaner, qa]"))
(assert= "parses an empty flow list to an empty vector (valid, not :invalid)" [] (required-stages-lib/parse "[]"))
(assert= "trims whitespace and strips quotes inside the list"
         ["coder" "qa"]
         (required-stages-lib/parse "[ \"coder\" , 'qa' ]"))
(assert= "a bare scalar is :invalid (not list-shaped)" :invalid (required-stages-lib/parse "coder"))
(assert= "a blank after-colon value (e.g. a would-be block-style list, unsupported here) is :invalid" :invalid (required-stages-lib/parse ""))
(assert= "unmatched brackets are :invalid" :invalid (required-stages-lib/parse "[coder, qa"))
(assert= "nil raw is :invalid" :invalid (required-stages-lib/parse nil))

;; ── resolve-effective ────────────────────────────────────────────────────

(assert= "absent declaration -> default-full, not rejected"
         required-stages-lib/default-full-decision
         (required-stages-lib/resolve-effective {:present? false :raw nil}))

(assert= "empty-list declaration -> default-full, not rejected (scenario 01)"
         required-stages-lib/default-full-decision
         (required-stages-lib/resolve-effective {:present? true :raw "[]"}))

(assert= "non-list scalar declaration -> default-full, not rejected (scenario 01)"
         required-stages-lib/default-full-decision
         (required-stages-lib/resolve-effective {:present? true :raw "coder"}))

(let [decision (required-stages-lib/resolve-effective {:present? true :raw "[coder, cleaner, qa]"})]
  (assert= "a valid strict subset resolves to exactly that set" #{"coder" "cleaner" "QA"} (:effective decision))
  (assert= "a valid subset is :declared, not default-full" :declared (:source decision))
  (assert= "a valid subset including QA is never rejected" false (:rejected? decision))
  (assert= "QA present -> qa-omission :none" :none (:qa-omission decision)))

(let [decision (required-stages-lib/resolve-effective {:present? true :raw "[documenter]"})]
  (assert= "a non-code ticket (coder omitted) may also omit QA"
           #{"documenter"}
           (:effective decision))
  (assert= "non-code + QA-omitted is accepted, not rejected" false (:rejected? decision))
  (assert= "QA omission is recorded as accepted" :accepted (:qa-omission decision)))

(let [decision (required-stages-lib/resolve-effective {:present? true :raw "[coder, cleaner]"})]
  (assert= "coder present + QA omitted is rejected to default-full (with QA)"
           required-stages-lib/canonical-set
           (:effective decision))
  (assert= "coder-present QA-omission is rejected" true (:rejected? decision))
  (assert= "coder-present QA-omission records :rejected" :rejected (:qa-omission decision)))

(let [decision (required-stages-lib/resolve-effective {:present? true :raw "[coder, deploy, qa]"})]
  (assert= "an out-of-chain token rejects the whole declaration to default-full"
           required-stages-lib/canonical-set
           (:effective decision))
  (assert= "an out-of-chain token is rejected" true (:rejected? decision)))

(let [decision (required-stages-lib/resolve-effective {:present? true :raw "[specifier, coder, qa]"})]
  (assert= "a declaration naming specifier is rejected to default-full" true (:rejected? decision)))

(let [decision (required-stages-lib/resolve-effective {:present? true :raw "[coordinator, coder, qa]"})]
  (assert= "a declaration naming coordinator is rejected to default-full" true (:rejected? decision)))

(let [decision (required-stages-lib/resolve-effective {:present? true :raw "[coder, coder, qa]"})]
  (assert= "a duplicate token (same spelling) rejects to default-full" true (:rejected? decision)))

(let [decision (required-stages-lib/resolve-effective {:present? true :raw "[hardener, hardender, qa, coder]"})]
  (assert= "the hardener/hardender alias colliding with itself is a duplicate" true (:rejected? decision)))

;; ── next-required-stage ────────────────────────────────────────────────────

(assert= "next-required-stage-06a" "cleaner" (required-stages-lib/next-required-stage #{"coder" "cleaner" "qa"} "coder"))
(assert= "next-required-stage-06b" "QA" (required-stages-lib/next-required-stage #{"coder" "cleaner" "qa"} "cleaner"))
(assert= "next-required-stage-06c" "QA" (required-stages-lib/next-required-stage #{"coder" "qa"} "coder"))
(assert= "next-required-stage-06d: the last stage has no next" nil (required-stages-lib/next-required-stage #{"coder" "cleaner" "qa"} "QA"))
(assert= "current not in canonical-order at all resolves to nil, never throws"
         nil
         (required-stages-lib/next-required-stage #{"coder" "qa"} "coordinator"))
(assert= "an empty required-set has no next stage from any current"
         nil
         (required-stages-lib/next-required-stage #{} "coder"))

;; ── skipped-stages ─────────────────────────────────────────────────────────

(assert= "skipped-stages is canonical-order minus the required set, in order"
         ["cleaner" "architect" "hardender" "documenter"]
         (required-stages-lib/skipped-stages #{"coder" "qa"}))

(assert= "skipped-stages is empty for the full canonical set"
         []
         (required-stages-lib/skipped-stages required-stages-lib/canonical-set))

(assert= "skipped-stages of an empty set is the full canonical order"
         required-stages-lib/canonical-order
         (required-stages-lib/skipped-stages #{}))

;; ── read-stage-skip-reasons ────────────────────────────────────────────────

(assert= "absent block reads as an empty map"
         {}
         (required-stages-lib/read-stage-skip-reasons "id: BL-1\nrequired_stages: [coder, qa]\n"))

(assert= "a present block is read as stage->reason, keys normalized"
         {"cleaner" "not touched, config-only change" "architect" "no design impact"}
         (required-stages-lib/read-stage-skip-reasons
          (str "id: BL-1\n"
               "required_stages: [coder, qa]\n"
               "stage_skip_reasons:\n"
               "  cleaner: not touched, config-only change\n"
               "  architect: no design impact\n"
               "status: todo\n")))

;; ── ran-and-skipped (acceptance scenario 08) ──────────────────────────────

(let [content (str "id: BL-606\nrequired_stages: [coder, qa]\nstatus: done\n")
      report (required-stages-lib/ran-and-skipped content)]
  (assert= "ran-and-skipped-08a: ran names exactly the effective set, in canonical order"
           ["coder" "QA"]
           (:ran report))
  (assert= "ran-and-skipped-08b: skipped names the rest, in canonical order"
           ["cleaner" "architect" "hardender" "documenter"]
           (:skipped report)))

(let [content "id: BL-1\nstatus: done\n"
      report (required-stages-lib/ran-and-skipped content)]
  (assert= "ran-and-skipped for a ticket with no declaration reports the full chain as ran"
           required-stages-lib/canonical-order
           (:ran report))
  (assert= "and nothing skipped"
           []
           (:skipped report)))

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: required_stages_lib.bb"))
