#!/usr/bin/env bb
;; BL-1254 acceptance driver: EXECUTES the pure decisions the three reviewed
;; hotfixes landed in swarmforge/scripts/expedite_lib.bb, rather than asserting
;; on their source text. A source-text assertion cannot tell a wired decision
;; from a dead one, and the fault under review (BL-1248) was exactly a decision
;; that read correctly and was never consulted.
;;
;; The functions driven here are the landed ones, loaded from the real lib:
;;   max-missing-verdict-recoveries / should-recover-missing-verdict?
;;   bounce-payload-valid?
;;   stage-user-prompt
;;   finalize-stage-result
;;
;; Usage: bb bl1254ExpediteDecisionCli.bb <query> <json-args>
;;   recover '{"attempt":0}'
;;     -> {"max":2,"recover":bool,"finalVerdict":str,"finalReason":str}
;;   prompt  '{"recovery":true,"attempt":2}'
;;     -> {"text":str}
;;   bounce  '{"reason":"...","class":"...","reasonKeyword":bool}'
;;     -> {"valid":bool}
;;   batch   '[{"query":"recover","args":{...}}, ...]'
;;     -> [{...}, ...]  — one bb start for a whole property run, so a property
;;        over these decisions costs one process rather than one per case.
;; Prints one JSON line.

(require '[babashka.fs :as fs]
         '[cheshire.core :as json]
         '[clojure.string :as str])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*))
                         ".." ".." ".." ".." "swarmforge" "scripts" "expedite_lib.bb")))

(defn answer
  "The landed decision for one query. Every branch calls a function the
   reviewed commits added; nothing here reimplements what they decide."
  [query args]
  (case query
    ;; Scenario 01: does the driver re-invoke, and what does it land on when it
    ;; stops recovering? Both halves come from the landed functions — the gate
    ;; AND the verdict the CLI's loop hands to finalize-stage-result on the
    ;; same inputs (parsed nil, no timeout, no overrun).
    "recover"
    (let [recover? (expedite-lib/should-recover-missing-verdict?
                    {:timed-out? (boolean (:timedOut args))
                     :overrun? (boolean (:overrun args))
                     :parsed (:parsed args)
                     :attempt (:attempt args)})
          final (expedite-lib/finalize-stage-result
                 {:timed-out? (boolean (:timedOut args))
                  :overrun? (boolean (:overrun args))
                  :parsed (:parsed args)
                  :role "cleaner" :exit 0 :elapsed {:overrun? false}})]
      {:max expedite-lib/max-missing-verdict-recoveries
       :recover recover?
       :finalVerdict (name (:verdict final))
       :finalReason (some-> (:reason final) name)})

    ;; Scenario 02: the prompt the driver actually builds for a recovery.
    "prompt"
    {:text (expedite-lib/stage-user-prompt
            {:role "cleaner" :ticket "BL-1254"
             :verdict-file "/run/verdict.json"
             :recovery? (boolean (:recovery args))
             :attempt (:attempt args)})}

    ;; Scenario 03: the bounce payload gate. `reason` reaches the driver as a
    ;; keyword on the parsed-verdict path, so that spelling is driven too.
    "bounce"
    {:valid (boolean (expedite-lib/bounce-payload-valid?
                      {:reason (if (:reasonKeyword args)
                                 (keyword (:reason args))
                                 (:reason args))
                       :class (:class args)}))}

    (throw (ex-info (str "unknown query: " query) {}))))

(let [[query payload] *command-line-args*]
  (if (= query "batch")
    (println (json/generate-string
              (mapv #(answer (:query %) (:args %))
                    (json/parse-string (or payload "[]") true))))
    (println (json/generate-string
              (answer query (json/parse-string (or payload "{}") true))))))
