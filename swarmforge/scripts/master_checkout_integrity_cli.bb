#!/usr/bin/env bb
;; BL-1123: thin CLI for master checkout bare + tip-floor guard.
;; Usage: master_checkout_integrity_cli.bb <project-root> [--tip-floor N] [--no-heal]
;; Prints one JSON line. Exit 0 when bare healed/ok and tip allowed; exit 1 on alarm.

(ns master-checkout-integrity-cli
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir "master_checkout_integrity_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: master_checkout_integrity_cli.bb <project-root> [--tip-floor N] [--no-heal]"))
  (System/exit 2))

(defn parse-opts [args]
  (loop [args args floor nil heal? true]
    (if (empty? args)
      {:tip-floor floor :heal? heal?}
      (let [[a b & more] args]
        (case a
          "--tip-floor" (if b (recur more (parse-long b) heal?) (usage))
          "--no-heal" (recur (rest args) floor false)
          (usage))))))

(defn -main [args]
  (let [root (first args)
        _ (when (str/blank? root) (usage))
        opts (parse-opts (rest args))
        alarms (atom [])
        result (master-checkout-integrity-lib/run-master-checkout-integrity!
                {:project-root root
                 :tip-floor (or (:tip-floor opts)
                                master-checkout-integrity-lib/default-tip-floor)
                 :heal? (:heal? opts)
                 :emit-alarm! (fn [t] (swap! alarms conj t))})
        tip-ok? (= :allowed (get-in result [:tip :verdict]))
        exit (if (and (get-in result [:bare :inside?])
                      tip-ok?
                      (empty? @alarms))
               0
               1)]
    (println (json/generate-string
              {:bare (:bare result)
               :tip (update (:tip result) :verdict name)
               :alarms @alarms}
              {:pretty false}))
    (System/exit exit)))

(-main *command-line-args*)
