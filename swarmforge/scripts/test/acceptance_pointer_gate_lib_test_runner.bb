#!/usr/bin/env bb
;; TDD runner for acceptance_pointer_gate_lib.bb — BL-880 pure decision
;; surface: applicable?/evaluate. No git, no filesystem - every fact this
;; lib needs is passed in as plain data by the caller
;; (pre_qa_gate_gather_lib.bb owns the git/fs legwork).

(ns acceptance-pointer-gate-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "acceptance_pointer_gate_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual] (assert= msg true (boolean actual)))
(defn assert-false [msg actual] (assert= msg false (boolean actual)))

;; ── applicable? ──────────────────────────────────────────────────────────

(assert-true "a single-line path is applicable"
             (acceptance-pointer-gate-lib/applicable? "specs/features/x.feature"))

(assert-true "a single-line path ending in .feature.draft is applicable (draft-ness is not this gate's concern)"
             (acceptance-pointer-gate-lib/applicable? "specs/features/x.feature.draft"))

(assert-false "nil is not applicable" (acceptance-pointer-gate-lib/applicable? nil))
(assert-false "blank is not applicable" (acceptance-pointer-gate-lib/applicable? ""))
(assert-false "whitespace-only is not applicable" (acceptance-pointer-gate-lib/applicable? "   "))
(assert-false "multi-line (inline Gherkin) is not applicable"
              (acceptance-pointer-gate-lib/applicable? "Feature: inline\n  Scenario: x\n    Given a known step\n"))

;; the ticket-yaml reader this gate's caller uses only ever captures the
;; `acceptance:` line's own tail - a block-scalar declaration's indented
;; body is invisible to it, leaving just the bare indicator behind.
(assert-false "the bare '|' block-scalar residue is not applicable"
              (acceptance-pointer-gate-lib/applicable? "|"))
(assert-false "the bare '>' block-scalar residue is not applicable"
              (acceptance-pointer-gate-lib/applicable? ">"))
(assert-false "'|-' (strip chomping) residue is not applicable"
              (acceptance-pointer-gate-lib/applicable? "|-"))
(assert-false "'|+' (keep chomping) residue is not applicable"
              (acceptance-pointer-gate-lib/applicable? "|+"))
(assert-true "a real path that merely CONTAINS a pipe-like character elsewhere is still applicable"
             (acceptance-pointer-gate-lib/applicable? "specs/features/x|y.feature"))

;; ── evaluate: not applicable -> clean pass regardless of the other flags ──

(doseq [tree-readable? [true false]
        path-exists? [true false nil]]
  (assert= (format "blank declaration is never refused (tree-readable?=%s path-exists?=%s)" tree-readable? path-exists?)
           {:findings [] :warnings []}
           (acceptance-pointer-gate-lib/evaluate
            {:ticket-id "BL-999" :raw-declaration "" :cited-commit "cccccccccc"
             :tree-readable? tree-readable? :path-exists? path-exists?})))

(assert= "an absent declaration (nil) is never refused"
         {:findings [] :warnings []}
         (acceptance-pointer-gate-lib/evaluate
          {:ticket-id "BL-999" :raw-declaration nil :cited-commit "cccccccccc"
           :tree-readable? true :path-exists? false}))

(assert= "a multi-line (inline Gherkin) declaration is never refused, even if the flags say 'missing'"
         {:findings [] :warnings []}
         (acceptance-pointer-gate-lib/evaluate
          {:ticket-id "BL-999" :raw-declaration "Feature: inline\n  Scenario: x\n    Given a known step\n"
           :cited-commit "cccccccccc" :tree-readable? true :path-exists? false}))

;; ── evaluate: tree unreadable -> fails OPEN, a warning naming the ticket,
;;    commit, and declared path ─────────────────────────────────────────

(let [result (acceptance-pointer-gate-lib/evaluate
              {:ticket-id "BL-999" :raw-declaration "specs/features/x.feature"
               :cited-commit "cccccccccc" :tree-readable? false :path-exists? nil})]
  (assert= "an unreadable tree produces no findings" [] (:findings result))
  (assert= "an unreadable tree produces exactly one warning" 1 (count (:warnings result)))
  (assert-true "the warning names the ticket" (re-find #"BL-999" (first (:warnings result))))
  (assert-true "the warning names the cited commit" (re-find #"cccccccccc" (first (:warnings result))))
  (assert-true "the warning names the declared path" (re-find #"specs/features/x\.feature" (first (:warnings result)))))

;; ── evaluate: readable tree, path absent -> fails CLOSED, one finding ────

(let [result (acceptance-pointer-gate-lib/evaluate
              {:ticket-id "BL-999" :raw-declaration "specs/features/x.feature"
               :cited-commit "cccccccccc" :tree-readable? true :path-exists? false})]
  (assert= "a missing path produces no warnings" [] (:warnings result))
  (assert= "a missing path produces exactly one finding" 1 (count (:findings result)))
  (assert= "the finding's class is :acceptance-pointer" :acceptance-pointer (:class (first (:findings result))))
  (assert= "the finding's ticket-id is threaded through" "BL-999" (:ticket-id (first (:findings result))))
  (assert-true "the detail names the declared path" (re-find #"specs/features/x\.feature" (:detail (first (:findings result)))))
  (assert-true "the detail names the cited commit" (re-find #"cccccccccc" (:detail (first (:findings result))))))

;; ── evaluate: readable tree, path present -> clean pass ──────────────────

(assert= "a resolvable path (readable tree, exists) is a clean pass"
         {:findings [] :warnings []}
         (acceptance-pointer-gate-lib/evaluate
          {:ticket-id "BL-999" :raw-declaration "specs/features/x.feature"
           :cited-commit "cccccccccc" :tree-readable? true :path-exists? true}))

(assert= "a resolvable PARKED .feature.draft path is a clean pass - draft-ness is never policed here"
         {:findings [] :warnings []}
         (acceptance-pointer-gate-lib/evaluate
          {:ticket-id "BL-999" :raw-declaration "specs/features/x.feature.draft"
           :cited-commit "cccccccccc" :tree-readable? true :path-exists? true}))

(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: acceptance_pointer_gate_lib.bb"))
