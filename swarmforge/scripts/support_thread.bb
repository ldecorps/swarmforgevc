#!/usr/bin/env bb
;; BL-275: one-shot CLI over the SUP-### thread store + email echo -
;; mirrors swarm_handoff.sh/ready_for_next.sh's own "thin CLI wrapping a
;; pure lib" shape. This is the tool the disposable Support LLM (per its
;; future support.prompt, a separate specifier deliverable) calls to record
;; an interaction and send the email-of-record, so it never hand-rolls the
;; thread JSON shape or id assignment itself. All real fs/network I/O lives
;; HERE (the untested boundary); every decision it wires is the pure logic
;; in support_lib.bb.
;;
;; Usage:
;;   support_thread.bb <project-root> open      --channel <c> --text <t>
;;   support_thread.bb <project-root> followup  --thread <id> --channel <c> --text <t>
;;   support_thread.bb <project-root> read      --thread <id>
;;   support_thread.bb <project-root> email-echo --thread <id> --next-step <s> --options <opt1,opt2,...> [--to <email>]
;;   support_thread.bb <project-root> resolve   --thread <id>
;;     BL-276: the ONLY closing action - call this ONLY on an explicit
;;     human confirmation of resolution (thread-lifecycle-02), never on an
;;     idle/timer decision (thread-lifecycle-01 - the Operator never
;;     closes a thread of its own will).
;;   support_thread.bb <project-root> link      --thread <id> --ticket <BL-###>
;;     BL-283: records a BL-### this thread's actionable discussion spawned -
;;     never creates/specs/promotes the ticket itself (the coordinator
;;     owns that; see operator_handoff.bb for the intake+note half).
;;
;; Env:
;;   RESEND_API_KEY            operator-provided (see BL-214/BL-215) - never a key store here.
;;   SUPPORT_EMAIL_FROM        defaults to "support@resend.dev"
;;   SUPPORT_EMAIL_DRYRUN=1    print the composed {subject body to} as JSON instead of sending
;;                             (used by tests/CI; no network, no API key required)

(ns support-thread
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir "support_lib.bb")))
(load-file (str (fs/path script-dir "support_thread_store.bb")))
(load-file (str (fs/path script-dir "daemon_alarm_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: support_thread.bb <project-root> open|followup|read|email-echo [options]"))
  (System/exit 1))

(def project-root (or (nth *command-line-args* 0 nil) (usage)))
(def subcommand (or (nth *command-line-args* 1 nil) (usage)))

(defn parse-opts [args]
  (into {} (for [[k v] (partition 2 args)]
             [(keyword (str/replace k #"^--" "")) v])))

(def opts (parse-opts (drop 2 *command-line-args*)))

(def state-dir (fs/path project-root ".swarmforge"))

(defn now-iso []
  (.format (java.time.format.DateTimeFormatter/ISO_INSTANT) (java.time.Instant/now)))

;; ── real thread-store fs adapters (impure; support_lib.bb stays pure) ────
;; BL-281: delegates to support_thread_store.bb, the SAME unified store
;; operator_runtime.bb's Telegram integration reads/writes - a thread
;; opened over RC (this CLI) and one opened over Telegram share one store.
;; This CLI's own "no such thread -> exit 1" UX is preserved here, not
;; pushed into the shared lib (support_thread_store.bb's own read-thread!
;; just returns nil on a miss, for a caller like operator_runtime.bb that
;; wants to handle that case itself, not exit the whole runtime process).

(defn read-thread! [id]
  (or (support-thread-store/read-thread! state-dir id)
      (do
        (binding [*out* *err*] (println (str "support_thread.bb: no such thread " id)))
        (System/exit 1))))

(defn write-thread! [thread]
  (support-thread-store/write-thread! state-dir thread))

(defn list-existing-ids! []
  (support-thread-store/list-existing-ids! state-dir))

(def store-adapters
  {:read-thread! read-thread! :write-thread! write-thread! :list-existing-ids! list-existing-ids!})

;; ── email send (real Resend POST via daemon_alarm_lib.bb - no second client) ──

(defn send-echo! [to subject body]
  (if (= "1" (System/getenv "SUPPORT_EMAIL_DRYRUN"))
    {:success true :dryrun true :to to :subject subject :body body}
    (daemon-alarm-lib/send-alarm-email!
     (System/getenv "RESEND_API_KEY") to
     (or (System/getenv "SUPPORT_EMAIL_FROM") "support@resend.dev")
     subject body)))

;; ── subcommands ────────────────────────────────────────────────────────

(defn run-open! []
  (let [thread (support-lib/record-interaction! nil (:channel opts) (now-iso) (:text opts) store-adapters)]
    (println (json/generate-string thread))))

(defn run-followup! []
  (let [thread (support-lib/record-interaction! (:thread opts) (:channel opts) (now-iso) (:text opts) store-adapters)]
    (println (json/generate-string thread))))

(defn run-read! []
  (println (json/generate-string (read-thread! (:thread opts)))))

(defn run-resolve! []
  (let [thread (support-lib/resolve-thread (read-thread! (:thread opts)))]
    (write-thread! thread)
    (println (json/generate-string thread))))

(defn run-link! []
  (let [thread (support-lib/link-ticket (read-thread! (:thread opts)) (:ticket opts))]
    (write-thread! thread)
    (println (json/generate-string thread))))

(defn run-email-echo! []
  (let [thread (read-thread! (:thread opts))
        options (str/split (or (:options opts) "") #",")
        echo (support-lib/assemble-email-echo thread (:next-step opts) (remove str/blank? options))
        result (send-echo! (:to opts) (:subject echo) (:body echo))]
    (println (json/generate-string (assoc echo :send-result result)))))

(defn -main []
  (case subcommand
    "open" (run-open!)
    "followup" (run-followup!)
    "read" (run-read!)
    "email-echo" (run-email-echo!)
    "resolve" (run-resolve!)
    "link" (run-link!)
    (usage)))

(-main)
