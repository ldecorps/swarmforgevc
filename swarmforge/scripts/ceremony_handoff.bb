#!/usr/bin/env bb
;; ceremony_handoff.bb — BL-1360: compose and send a fixed pipeline ceremony.
;;
;; Usage:
;;   ceremony_handoff.sh <ceremony> --ticket BL-042 [--commit a1b2c3d4e5] [--dry-run]
;;
;; A thin wrapper over `swarm_handoff.sh`, deliberately: this is a FRONT END,
;; never a second way into a mailbox (invariant 1). Every send-time gate still
;; arms, the tmux wake still fires, and a refusal is the gate's own text passed
;; through unchanged - this script adds no verdict of its own.
;;
;; `--dry-run` prints the draft and sends nothing, so a sceptical role can
;; inspect the composition once instead of re-deriving it every time.

(require '[babashka.fs :as fs]
         '[babashka.process :as process]
         '[clojure.string :as str])

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir "ceremony_handoff_lib.bb")))

(defn- usage []
  (str "usage: ceremony_handoff.sh <ceremony> --ticket BL-042 [--commit a1b2c3d4e5] [--dry-run]\n"
       "ceremonies: " (str/join ", " (ceremony-handoff-lib/ceremony-names)) "\n"))

(defn -main [& argv]
  (let [parsed (ceremony-handoff-lib/parse-args argv)]
    (when-let [err (:error parsed)]
      (binding [*out* *err*] (println err) (print (usage)) (flush))
      (System/exit 2))
    (let [composed (ceremony-handoff-lib/compose parsed)]
      (when-let [err (:error composed)]
        (binding [*out* *err*] (println err) (flush))
        (System/exit 2))
      (if (:dry-run? parsed)
        (do (print (:draft composed)) (flush)
            (System/exit 0))
        ;; Worktree-local tmp, never /tmp (workflow article), and the draft is
        ;; handed to swarm_handoff.sh exactly as a hand-written one would be.
        (let [draft-file (str (fs/path "tmp" "ceremony-handoff.txt"))]
          (fs/create-dirs "tmp")
          (spit draft-file (:draft composed))
          (let [{:keys [exit out err]}
                (process/sh {:continue true}
                            (str (fs/path script-dir "swarm_handoff.sh")) draft-file)]
            ;; The gate's own words, unchanged - this wrapper never rewrites a
            ;; refusal, and never turns one into a success.
            ;;
            ;; Each stream is flushed INSIDE its own binding. Flushing after
            ;; the binding has been popped flushes stdout twice and never
            ;; touches stderr, which silently swallowed the whole refusal: the
            ;; sender saw exit 2 and not one word of why.
            (when (seq out) (print out) (flush))
            (when (seq err) (binding [*out* *err*] (print err) (flush)))
            (System/exit exit)))))))

(apply -main *command-line-args*)
