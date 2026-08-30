#!/usr/bin/env bb
;; BL-1288 property harness: evaluates a BATCH of generated push results
;; against the REAL master_main_reconcile_lib.bb rematch-with-push-first!.
;;
;; A helper, not a test - `_test_runner.bb` is what the bb suite discovers and
;; this deliberately is not one. Its only consumer is the property lane
;; (extension/test/bl1288OnlyRejectionDiscardsInvariants.property.test.js),
;; which owns the generators, the oracle and the verdict; everything here is
;; the call into the real function and a faithful report of what it returned.
;;
;; Batched because the invariants quantify over the TEXT of a push failure -
;; a space real git cannot be made to enumerate - so the cases must be
;; generated, and one bb start-up per generated case would buy nothing but
;; latency. Both adapters are fakes for the same reason: the input under test
;; is the error string and the observable is whether :reset! was invoked at
;; all, neither of which needs a real repository. The acceptance feature is
;; where this same function meets real git and real pushes.
;;
;; Usage: bb bl1288_push_classification_harness.bb <cases.json>
;;   cases.json: [{"pushSuccess": bool, "error": str|null}, ...]
;; Prints one JSON line: [{"resetCalled": bool, "success": bool,
;;                         "outcome": str|null, "error": str|null}, ...]
(require '[babashka.fs :as fs]
         '[cheshire.core :as json])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." ".." "master_main_reconcile_lib.bb")))

;; Deliberately unmistakable: if this string ever reaches a caller's :error,
;; the reset's reason displaced the push's, which invariant 2 forbids.
(def RESET-ERROR "BL1288-RESET-ERROR-MUST-NOT-SURFACE")

(def cases-path (first *command-line-args*))
(when-not cases-path
  (binding [*out* *err*] (println "usage: bl1288_push_classification_harness.bb <cases.json>"))
  (System/exit 2))

(defn evaluate [{:keys [pushSuccess error]}]
  (let [reset-called? (atom false)
        result (master-main-reconcile-lib/rematch-with-push-first!
                {:push! (fn [] (if pushSuccess
                                 {:success true}
                                 {:success false :error error}))
                 :reset! (fn []
                           (reset! reset-called? true)
                           {:success false :error RESET-ERROR :outcome :rematch-bookkeeping})})]
    {:resetCalled @reset-called?
     :success (boolean (:success result))
     :outcome (some-> (:outcome result) name)
     :error (:error result)}))

(println (json/generate-string
          (mapv evaluate (json/parse-string (slurp cases-path) true))))
(System/exit 0)
