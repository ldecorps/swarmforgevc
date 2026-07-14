#!/usr/bin/env bb
;; TDD runner for closing_context_clear_lib.bb (BL-309) - pure assertions
;; only, no real fs/tmux/clock.
(ns closing-context-clear-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "closing_context_clear_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual] (assert= msg true (boolean actual)))
(defn assert-false [msg actual] (assert= msg false (boolean actual)))

;; ── new-close? (pure) ─────────────────────────────────────────────────────

(assert-true "a closed ticket never cleared before is a new close"
             (closing-context-clear-lib/new-close? "BL-308" nil))
(assert-true "a closed ticket different from the last-cleared one is a new close"
             (closing-context-clear-lib/new-close? "BL-309" "BL-308"))
(assert-false "the same closed ticket as the last-cleared one is not a new close"
              (closing-context-clear-lib/new-close? "BL-308" "BL-308"))
(assert-false "no closed ticket at all (empty backlog/done/) is never a new close"
              (closing-context-clear-lib/new-close? nil nil))

;; ── decide-context-clear (pure) ───────────────────────────────────────────
;; BL-309 clear-fires-at-safe-close-01 / no-clear-while-not-idle-02

(assert= "clear-fires-at-safe-close-01: idle + new close -> clear"
         {:action :clear}
         (closing-context-clear-lib/decide-context-clear {:idle? true :new-close? true}))
(assert= "no-clear-while-not-idle-02: not idle -> no clear even with a new close"
         {:action nil}
         (closing-context-clear-lib/decide-context-clear {:idle? false :new-close? true}))
(assert= "no-repeat-clear-same-close-03: idle but not a new close -> no clear"
         {:action nil}
         (closing-context-clear-lib/decide-context-clear {:idle? true :new-close? false}))
(assert= "neither condition -> no clear"
         {:action nil}
         (closing-context-clear-lib/decide-context-clear {:idle? false :new-close? false}))

;; ── startup-reread-instruction (pure) ─────────────────────────────────────

(let [text (closing-context-clear-lib/startup-reread-instruction "coordinator")]
  (assert-true "names the constitution" (clojure.string/includes? text "swarmforge/constitution.prompt"))
  (assert-true "names PIPELINE.md" (clojure.string/includes? text "swarmforge/PIPELINE.md"))
  (assert-true "names the role's own prompt file"
               (clojure.string/includes? text "swarmforge/roles/coordinator.prompt")))

;; ── evaluate-closing-context-clear! (adapter-injected) ───────────────────
;; clear-fires-at-safe-close-01: exactly clear -> reread -> record, in order.

(let [calls (atom [])
      adapters {:inject-clear! (fn [] (swap! calls conj [:inject-clear]))
                :inject-startup-reread! (fn [text] (swap! calls conj [:inject-startup-reread text]))
                :record-clear! (fn [ticket-id] (swap! calls conj [:record-clear ticket-id]))}
      result (closing-context-clear-lib/evaluate-closing-context-clear!
              {:idle? true :closed-ticket-id "BL-308" :last-cleared-ticket-id nil :role-name "coordinator"}
              adapters)]
  (assert= "clear-fires-at-safe-close-01: fires the clear action" {:action :clear} result)
  (assert= "clear-fires-at-safe-close-01: injects clear, then the re-read instruction, then records - in that exact order"
           [[:inject-clear]
            [:inject-startup-reread (closing-context-clear-lib/startup-reread-instruction "coordinator")]
            [:record-clear "BL-308"]]
           @calls))

;; no-clear-while-not-idle-02: an in-process task or a pending inbox item
;; (either surfaces as idle?=false to this pure fn) -> no adapter is ever
;; touched.
(doseq [reason ["an in-process task" "a pending inbox item"]]
  (let [calls (atom [])
        adapters {:inject-clear! (fn [] (swap! calls conj :inject-clear))
                  :inject-startup-reread! (fn [_] (swap! calls conj :inject-startup-reread))
                  :record-clear! (fn [_] (swap! calls conj :record-clear))}
        result (closing-context-clear-lib/evaluate-closing-context-clear!
                {:idle? false :closed-ticket-id "BL-308" :last-cleared-ticket-id nil :role-name "coordinator"}
                adapters)]
    (assert= (str "no-clear-while-not-idle-02 (" reason "): no clear action") {:action nil} result)
    (assert= (str "no-clear-while-not-idle-02 (" reason "): touches no adapter at all") [] @calls)))

;; no-repeat-clear-same-close-03: already cleared for the current close,
;; nothing new since -> no adapter touched.
(let [calls (atom [])
      adapters {:inject-clear! (fn [] (swap! calls conj :inject-clear))
                :inject-startup-reread! (fn [_] (swap! calls conj :inject-startup-reread))
                :record-clear! (fn [_] (swap! calls conj :record-clear))}
      result (closing-context-clear-lib/evaluate-closing-context-clear!
              {:idle? true :closed-ticket-id "BL-308" :last-cleared-ticket-id "BL-308" :role-name "coordinator"}
              adapters)]
  (assert= "no-repeat-clear-same-close-03: no clear action" {:action nil} result)
  (assert= "no-repeat-clear-same-close-03: touches no adapter at all" [] @calls))

;; new-close-triggers-again-04: a later, different close while idle fires again.
(let [calls (atom [])
      adapters {:inject-clear! (fn [] (swap! calls conj [:inject-clear]))
                :inject-startup-reread! (fn [text] (swap! calls conj [:inject-startup-reread text]))
                :record-clear! (fn [ticket-id] (swap! calls conj [:record-clear ticket-id]))}
      result (closing-context-clear-lib/evaluate-closing-context-clear!
              {:idle? true :closed-ticket-id "BL-309" :last-cleared-ticket-id "BL-308" :role-name "coordinator"}
              adapters)]
  (assert= "new-close-triggers-again-04: fires the clear action again" {:action :clear} result)
  (assert= "new-close-triggers-again-04: records the NEW ticket id, not the old one"
           [[:inject-clear]
            [:inject-startup-reread (closing-context-clear-lib/startup-reread-instruction "coordinator")]
            [:record-clear "BL-309"]]
           @calls))

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: closing_context_clear_lib.bb"))
