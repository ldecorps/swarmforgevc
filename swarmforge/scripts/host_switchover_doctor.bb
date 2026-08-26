#!/usr/bin/env bb
;; BL-1057: the host switchover doctor - the command a human runs right after
;; moving this swarm to a new machine or path.
;;
;; Usage:
;;   bb swarmforge/scripts/host_switchover_doctor.bb [<repo-root>] [--json]
;;   bb swarmforge/scripts/host_switchover_doctor.bb --inventory
;;
;; <repo-root> defaults to the checkout this script lives in, so the ordinary
;; invocation needs no argument; passing one is how a test (or an operator
;; checking a second checkout) points it elsewhere without touching $PWD.
;;
;; Exits 0 when every host-pinned location describes this host, 1 when any of
;; them is STALE, MISSING or BLOCKED. "The doctor could not tell" and "this
;; host is fine" are opposite answers, so BLOCKED exits non-zero too.
;;
;; Per the thin-wrapper rule, everything below is argument parsing and I/O:
;; the inventory, every verdict and the report text all live in the unit- and
;; property-tested host_switchover_doctor_lib.bb.
;;
;; This command NEVER writes - see invariant 1 in the lib. A future repair
;; capability is a separate command, never a --fix flag added here.

(ns host-switchover-doctor
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir "host_switchover_doctor_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: host_switchover_doctor.bb [<repo-root>] [--json | --inventory]"))
  (System/exit 2))

;; swarmforge/scripts/<this file> -> the checkout root two levels up, then
;; through main-checkout-root so a run from a per-role worktree checks the
;; forge's own root rather than reporting the main checkout's paths as stale.
(defn default-repo-root []
  (let [checkout (str (fs/parent (fs/parent script-dir)))
        git-entry (fs/path checkout ".git")
        content (when (fs/regular-file? git-entry)
                  (:content (host-switchover-doctor-lib/default-read-file (str git-entry))))]
    (host-switchover-doctor-lib/main-checkout-root checkout content)))

(defn parse-args [args]
  (reduce (fn [acc arg]
            (cond
              (= "--json" arg) (assoc acc :json? true)
              (= "--inventory" arg) (assoc acc :inventory? true)
              (str/starts-with? arg "--") (usage)
              (:repo-root acc) (usage)
              :else (assoc acc :repo-root arg)))
          {:json? false :inventory? false}
          args))

;; --inventory prints the DECLARED inventory itself, so a caller that has to
;; build a fixture host (the acceptance step handlers) reads the one
;; definition in the lib rather than keeping a second copy of it in another
;; language, where the two would drift.
(defn print-inventory []
  (println (json/generate-string
            (mapv (fn [row]
                    {"id" (:id row)
                     "base" (name (:base row))
                     "rel" (:rel row)
                     "check" (name (:check row))
                     "keys" (vec (:keys row))
                     "pattern" (:pattern row)
                     "required" (boolean (:required? row))
                     "remediation" (:remediation row)})
                  host-switchover-doctor-lib/default-inventory)))
  (System/exit 0))

(defn -main [args]
  (let [{:keys [repo-root json? inventory?]} (parse-args args)
        _ (when inventory? (print-inventory))
        result (host-switchover-doctor-lib/run-doctor
                {:repo-root (or repo-root (default-repo-root))
                 :env (into {} (System/getenv))})]
    (if json?
      (println (json/generate-string
                {"repoRoot" (:repo-root result)
                 "findings" (mapv (fn [f]
                                    {"id" (:id f)
                                     "path" (:path f)
                                     "verdict" (str/upper-case (name (:verdict f)))
                                     "found" (:found f)
                                     "remediation" (:remediation f)})
                                  (:findings result))}))
      (println (host-switchover-doctor-lib/format-report result)))
    (System/exit (host-switchover-doctor-lib/exit-code result))))

(-main *command-line-args*)
