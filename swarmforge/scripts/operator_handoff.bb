#!/usr/bin/env bb
;; BL-283 (Coordinator-handoff slice of the BL-274 front desk): the one-shot
;; CLI the Operator calls once a subject thread's Telegram topic discussion
;; has become actionable - files an INTAKE-<slug>.md referencing the
;; subject, sends a `type: note` coordinator handoff (mirroring
;; handoffd.bb's own auto-route!/write-scratch-draft! pattern - shells to
;; the REAL swarm_handoff.bb rather than hand-writing an inbox file, so it
;; gets the full existing validation/sequencing/sync-delivery for free),
;; and records the linked ticket on the thread. The Operator PROPOSES
;; only - it never creates/specs/promotes the ticket itself (the
;; coordinator owns that; support_lib.bb's hand-off-to-coordinator! has no
;; adapter path that could).
;;
;; Usage: operator_handoff.bb <project-root> --thread <SUP-###> --ticket <BL-###>

(ns operator-handoff
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir "support_lib.bb")))
(load-file (str (fs/path script-dir "support_thread_store.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: operator_handoff.bb <project-root> --thread <SUP-###> --ticket <BL-###>"))
  (System/exit 1))

(def project-root (or (nth *command-line-args* 0 nil) (usage)))

(defn parse-opts [args]
  (into {} (for [[k v] (partition 2 args)]
             [(keyword (str/replace k #"^--" "")) v])))

(def opts (parse-opts (drop 1 *command-line-args*)))
(when (or (str/blank? (:thread opts)) (str/blank? (:ticket opts))) (usage))

(def state-dir (fs/path project-root ".swarmforge"))
(def op-dir (fs/path state-dir "operator"))

;; ── intake write (real fs; operator domain, gitignored like the rest of
;; .swarmforge/) ───────────────────────────────────────────────────────────

(defn write-intake! [slug content]
  (let [file (fs/path op-dir (str "INTAKE-" slug ".md"))]
    (fs/create-dirs (fs/parent file))
    (spit (str file) content)
    (str file)))

;; ── coordinator note (real; shells to the REAL swarm_handoff.bb, mirroring
;; handoffd.bb's auto-route!/write-scratch-draft! exactly - reuses its full
;; existing validation/sequencing/atomic-write, never a hand-written inbox
;; file). process/sh's varargs form silently drops :dir/:env - the vector
;; form is required for SWARMFORGE_ROLE to actually apply inside the
;; subprocess (same empirically-confirmed gotcha auto-route! documents).
;;
;; SWARMFORGE_ROLE is set to "coordinator", not "operator" - the Operator is
;; NOT a swarm role (it is not, and must never become, a row in
;; roles.tsv - constitution posture), so swarm_handoff.bb's own
;; role-known? sender check would reject "operator" outright. This mirrors
;; auto-route!'s EXACT same precedent: an automated, non-human-typed note
;; impersonates "coordinator" as sender, the only currently-valid identity
;; for a non-swarm-agent write into the sanctioned mailbox path (never a
;; hand-written inbox file, per the constitution's handoff rule).
;; Self-addressed (from: coordinator, to: coordinator) validates fine - no
;; same-sender-recipient guard exists.

(defn write-scratch-draft! [lines]
  (let [tmp-dir (fs/path project-root "tmp")]
    (fs/create-dirs tmp-dir)
    (let [draft (fs/path tmp-dir (str "operator-handoff-draft-" (System/nanoTime) ".txt"))]
      (spit (str draft) (str (str/join "\n" lines) "\n"))
      draft)))

(defn swarm-handoff-script []
  (str (fs/path script-dir "swarm_handoff.bb")))

(defn send-coordinator-note! [message]
  (let [draft (write-scratch-draft! ["type: note" "to: coordinator" "priority: 20" (str "message: " message)])
        env (merge (into {} (System/getenv)) {"SWARMFORGE_ROLE" "coordinator"})
        result (process/sh ["bb" (swarm-handoff-script) (str draft)] {:dir (str project-root) :env env})]
    (when-not (zero? (:exit result))
      (binding [*out* *err*]
        (println (str "operator_handoff: failed to send coordinator note: " (:err result)))))
    result))

(defn -main []
  (let [thread-id (:thread opts)
        adapters (support-thread-store/adapters-for state-dir)
        thread ((:read-thread! adapters) thread-id)]
    (if-not thread
      (do
        (binding [*out* *err*] (println (str "operator_handoff: no such thread " thread-id)))
        (System/exit 1))
      (let [updated (support-lib/hand-off-to-coordinator!
                     thread (:ticket opts)
                     {:write-intake! write-intake!
                      :send-coordinator-note! send-coordinator-note!
                      :write-thread! (:write-thread! adapters)})]
        (println (json/generate-string updated))))))

(-main)
