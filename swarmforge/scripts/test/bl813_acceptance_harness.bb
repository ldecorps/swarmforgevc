#!/usr/bin/env bb
;; BL-813 acceptance step-handler harness: drives the REAL library logic
;; (ambulance_lib.bb) for the two ambulance-race scenarios and prints a JSON
;; result, so the JS step handlers assert against the real code instead of
;; reimplementing it (same convention as email_missing_key_warn_harness.bb).
;;
;; Usage:
;;   bl813_acceptance_harness.bb ticket-has-file-vanish-race <fixture-root> <ticket-id>
;;   bl813_acceptance_harness.bb vanished-ticket-degrade <fixture-root> <ticket-id>

(ns bl813-acceptance-harness
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "ambulance_lib.bb")))

(def real-glob fs/glob)

(def mode (nth *command-line-args* 0))
(def fixture-root (nth *command-line-args* 1))
(def ticket-id (nth *command-line-args* 2))

(defn write-ticket! [subdir]
  (fs/create-dirs (fs/path fixture-root "backlog" subdir))
  (spit (str (fs/path fixture-root "backlog" subdir (str ticket-id "-handoffd-cwd-breaks-mono-router-wake-remap.yaml")))
        (str "id: " ticket-id "\ntitle: \"demo\"\nstatus: " subdir "\n")))

;; fs/glob lists the real active/ match, then - before ticket-has-file? gets
;; to slurp it - MOVES it to done/, matching the acceptance scenario's own
;; wording ("that file is moved to backlog/done/ before slurp") rather than
;; deleting it outright.
(defn glob-then-move-to-done [dir pattern]
  (let [matches (real-glob dir pattern)]
    (doseq [p matches
            :when (= (str (fs/file-name p)) (str ticket-id "-handoffd-cwd-breaks-mono-router-wake-remap.yaml"))]
      (fs/create-dirs (fs/path fixture-root "backlog" "done"))
      (fs/move p (fs/path fixture-root "backlog" "done" (str (fs/file-name p))) {:replace-existing true}))
    matches))

(defn run! []
  (case mode
    "ticket-has-file-vanish-race"
    (do
      (write-ticket! "active")
      (with-redefs [fs/glob glob-then-move-to-done]
        (let [[threw? result] (try [false (ambulance-lib/ticket-has-file? fixture-root ticket-id)]
                                    (catch Exception e [true (.getMessage e)]))
              [poll-threw? _] (try [false (ambulance-lib/read-ambulance-state fixture-root)]
                                    (catch Exception e [true (.getMessage e)]))]
          {:threw threw? :result result :pollContinuesThrew poll-threw?})))

    "vanished-ticket-degrade"
    (do
      ;; No backlog file anywhere for ticket-id - engage! itself refuses
      ;; (ticket-has-file? guard), so the marker is written RAW here to
      ;; simulate an already-engaged marker whose ticket has since vanished
      ;; entirely (the deadlock-guard scenario, not a mid-glob race).
      (fs/create-dirs (fs/parent (ambulance-lib/marker-path fixture-root)))
      (spit (str (ambulance-lib/marker-path fixture-root))
            (json/generate-string {:active true :ticket ticket-id :engagedAtMs 1 :by "test"}))
      (let [[threw? state] (try [false (ambulance-lib/read-ambulance-state fixture-root)]
                                 (catch Exception e [true (.getMessage e)]))]
        {:threw threw? :active (if threw? nil (:active state))}))

    (throw (ex-info (str "unknown mode: " mode) {}))))

(println (json/generate-string (run!)))
