#!/usr/bin/env bb
;; BL-839: thin CLI wrapper over master_checkout_drift_lib.bb's
;; check-master-checkout-drift!, so acceptance step handlers (and any
;; shell-driven caller) can run the real check against a real project root
;; without embedding Babashka. Per the thin-wrapper rule, main() is argument
;; parsing and I/O only - all real logic lives in the unit- and property-
;; tested lib.
;;
;; Usage: master_checkout_drift_cli.bb <project-root> [--entrypoint <bare.bb>]...
;;
;; Prints one JSON line ({"overall": "...", "perFile": {...}, "alarmText":
;; "..."|null}) and always exits 0 - this is a REPORT-only check (see the
;; ticket's approval_context for why not repair); a non-:no-drift verdict is
;; communicated in the JSON payload and the alarm text, not via exit code, so
;; a caller that only wants the structured result never has to parse stderr.

(ns master-checkout-drift-cli
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir "master_checkout_drift_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: master_checkout_drift_cli.bb <project-root> [--entrypoint <bare.bb>]..."))
  (System/exit 1))

(defn parse-args [args]
  (loop [args args entrypoints []]
    (if (empty? args)
      entrypoints
      (let [[flag value & more] args]
        (when (nil? value) (usage))
        (case flag
          "--entrypoint" (recur more (conj entrypoints value))
          (usage))))))

(defn -main [args]
  (let [project-root (first args)
        _ (when (str/blank? project-root) (usage))
        entrypoints (parse-args (rest args))
        opts (cond-> {:project-root project-root}
               (seq entrypoints) (assoc :entrypoints (set entrypoints)))
        result (master-checkout-drift-lib/check-master-checkout-drift! opts)]
    (println (json/generate-string
              {"overall" (name (:overall result))
               "perFile" (into {} (map (fn [[k v]] [k (name v)]) (:per-file result)))
               "alarmText" (master-checkout-drift-lib/format-alarm-text result)}))))

(-main *command-line-args*)
