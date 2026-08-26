#!/usr/bin/env bb
;; BL-1078: the launcher's admission check for a Cursor seat.
;;
;; A thin wrapper over cursor_seat_guard_lib.bb - it reads the registry and the
;; env, hands both to the pure decision, prints the message and exits. Every
;; branch worth testing is in the lib, driven in-process by
;; cursor_seat_guard_lib_test_runner.bb (engineering.prompt's CLI rule).
;;
;; Usage (from swarmforge.sh):
;;   bb cursor_seat_guard.bb check <project-root> <role> <extra-cli-args>
;;
;; Exit 0 admits; exit 1 refuses, naming the escape that would admit it.

(ns cursor-seat-guard
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(def script-dir (fs/parent (fs/canonicalize *file*)))
(load-file (str (fs/path script-dir "cursor_seat_guard_lib.bb")))
;; The registry's LOCATION already has one definition; a second would be the
;; hand-copy drift BL-571 documented across six sites. Its read-registry! is
;; deliberately NOT used: that function SEEDS and writes the registry when the
;; file is absent, and a launch-time admission check must not create state -
;; least of all on the path where it is about to refuse.
(load-file (str (fs/path script-dir "model_steward_store.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: cursor_seat_guard.bb check <project-root> <role> [extra-cli-args]"))
  (System/exit 2))

(defn -main []
  (let [args (vec *command-line-args*)]
    (when (or (< (count args) 3) (not= (first args) "check"))
      (usage))
    (let [project-root (nth args 1)
          role (nth args 2)
          extra-cli (nth args 3 "")
          state-dir (str (fs/path project-root model-steward-store/default-state-dir-rel))
          registry-path (model-steward-store/registry-file state-dir)
          ;; A missing, unreadable or malformed registry is not an error here -
          ;; it is `unknown`, which admission refuses exactly like a candidate.
          ;; Failing closed is the whole posture.
          registry (try (when (fs/exists? registry-path)
                          (json/parse-string (slurp (str registry-path))))
                        (catch Exception _ nil))
          verdict (cursor-seat-guard-lib/admission
                   {:registry registry
                    :provider "cursor"
                    :model (cursor-seat-guard-lib/model-from-cli extra-cli)
                    :escape (System/getenv cursor-seat-guard-lib/escape-env)})]
      (if (:admit? verdict)
        (do (println (str "SwarmForge: " role " — " (:message verdict)))
            (System/exit 0))
        (do (binding [*out* *err*]
              (println (str "Error: cannot staff " role " with a cursor seat — " (:message verdict))))
            (System/exit 1))))))

(-main)
