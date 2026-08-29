#!/usr/bin/env bb
;; BL-607: the role-facing ASK leg. A pipeline role (specifier first; the
;; mechanism itself is role-generic) raises a clarifying question into ITS
;; OWN Telegram topic instead of the shared agent-questions topic
;; operator_ask.bb's --thread SUP-### asks always use. Reuses BL-483's
;; option normalization (operator-lib/ask-options) and appends to the SAME
;; reply-outbox operator_ask.bb already writes - never a second, parallel
;; outbox - marking the entry "roleQuestion": role (instead of
;; "agentQuestion": true) as the routing signal
;; telegramFrontDeskBotCore.ts's relayOneRecord uses to retarget delivery
;; to that role's own topic (deliverRoleQuestion) rather than the shared
;; one (deliverAgentQuestion).
;;
;; ONE pending question PER ROLE (not one globally - operator_ask.bb's own
;; awaiting-answer.json is a SEPARATE, unrelated single-pending guard for
;; the Operator's SUP-thread ask): a per-role marker file at
;; .swarmforge/operator/role-awaiting/<role>.json refuses a second ask for
;; the SAME role while the first is still pending, but never blocks a
;; DIFFERENT role from asking concurrently.
;;
;; This CLI never resolves a Telegram topic id itself (that lookup - role
;; -> topic id via role-topic-map.json - happens entirely on the TS side,
;; same "bb owns state, TS owns Telegram" split as every other ask/reply
;; CLI in this directory).
;;
;; Usage:
;;   Ask mode:     role_ask.bb <project-root> --role <role> --question <q> [--options '["a","b"]']
;;   Resolve mode: role_ask.bb <project-root> --role <role> --resolve --reason <reason>
;;
;; BL-1245: the resolve verb lets the ASKING ROLE reopen its own pending
;; slot when the answer never reached the answer store (the swarm was down,
;; no bot ran to pair it). A non-blank reason is mandatory - it is recorded
;; alongside the preserved question. The preserved record is written to
;; .swarmforge/operator/role-awaiting-archive/<role>-<asked_at_ms>.json,
;; NEVER to a .json inside role-awaiting/ (operator_runtime.bb scans that
;; directory for *.json and would read a preserved copy back as a live
;; marker). The live marker at role-awaiting/<role>.json is removed so the
;; role-ask-blocked? guard has nothing to read back as pending.

(ns role-ask
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir "operator_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage:")
    (println "  Ask mode:     role_ask.bb <project-root> --role <role> --question <q> [--options '[\"a\",\"b\"]']")
    (println "  Resolve mode: role_ask.bb <project-root> --role <role> --resolve --reason <reason>"))
  (System/exit 1))

(def project-root (or (nth *command-line-args* 0 nil) (usage)))

;; BL-1245: --resolve is a boolean flag (takes no value). parse-opts treats
;; any key in BOOLEAN-FLAGS as a true-valued flag, leaving the next arg to
;; pair with the following option rather than being consumed as the flag's
;; own value. Without this, `--resolve --reason housekeeping` parses as
;; {:resolve "--reason"} and housekeeping is dropped as an orphan.
;; Implemented via a named recursive helper (not a `loop` form) so BL-773's
;; structural guard "role_ask.bb must ask once and return" cannot mistake
;; an arg-parser reduction for a polling loop.
(def ^:private boolean-flags #{"resolve"})

(defn- parse-opts-step [remaining acc flag?]
  (if (empty? remaining)
    acc
    (let [k (first remaining)]
      (if (flag? k)
        (parse-opts-step (rest remaining)
                         (assoc acc (keyword (str/replace k #"^--" "")) true)
                         flag?)
        (parse-opts-step (drop 2 remaining)
                         (assoc acc (keyword (str/replace k #"^--" "")) (second remaining))
                         flag?)))))

(defn parse-opts [args]
  (let [flag? (fn [k] (contains? boolean-flags (str/replace k #"^--" "")))]
    (parse-opts-step args {} flag?)))

(def opts (parse-opts (drop 1 *command-line-args*)))
(def resolve-mode? (some? (:resolve opts)))
(when (str/blank? (:role opts)) (usage))
;; BL-1245: in resolve mode, --reason validation happens inside resolve-main
;; so the CLI can emit a structured "reason-required" JSON response instead
;; of a bare usage exit. Only ask mode's --question is validated up front.
(when (and (not resolve-mode?) (str/blank? (:question opts))) (usage))

(def role (:role opts))
(def state-dir (fs/path project-root ".swarmforge"))
(def op-dir (fs/path state-dir "operator"))
(def reply-outbox-file (fs/path op-dir "telegram-reply-outbox.jsonl"))
(def awaiting-file (fs/path op-dir "role-awaiting" (str role ".json")))

;; Mirrors telegramFrontDeskBotCore.ts's own ROLE_ASK_THREAD_PREFIX exactly
;; - the synthetic threadId under which the ask-message mapping
;; (recordAskMessage/readAskMessage/resolveAskOptions, all keyed by an
;; opaque threadId string) is reused for a role question, never a second
;; storage schema. Colon-free by construction (role names never contain
;; one) so it round-trips through composeAskButtons' "ask:<threadId>:<idx>"
;; callback_data and its ASK_CALLBACK_DATA_PATTERN `[^:]+` capture intact.
(defn ask-thread-id [role]
  (str "role-ask-" role))

(defn now-iso []
  (.format (java.time.format.DateTimeFormatter/ISO_INSTANT) (java.time.Instant/now)))

(defn append-to-outbox! [thread-id text extra]
  (fs/create-dirs (fs/parent reply-outbox-file))
  (spit (str reply-outbox-file)
        (str (json/generate-string (merge {"threadId" thread-id "text" text} extra)) "\n")
        :append true))

(defn atomic-spit! [path content]
  (fs/create-dirs (fs/parent path))
  (let [tmp (fs/path (fs/parent path) (str "." (fs/file-name path) ".tmp"))]
    (spit (str tmp) content)
    (fs/move tmp path {:replace-existing true :atomic-move true})))

(defn parse-options
  "Same malformed-input-degrades-to-nil posture as operator_ask.bb's own
   parse-options - never crashes the ask CLI over a bad --options value."
  [raw]
  (when raw
    (try
      (operator-lib/ask-options (json/parse-string raw))
      (catch Exception e
        (binding [*out* *err*]
          (println (str "role_ask.bb: --options was not a usable JSON array of strings/label-objects (" (.getMessage e) ") - falling back to a plain message")))
        nil))))

(defn read-awaiting-marker
  "The existing marker's parsed contents, or nil if no marker file exists.
   GH-26: unreadable/corrupt content degrades to {} (present but no :state)
   rather than nil, so operator-lib/role-ask-blocked? still fails CLOSED on
   it - the same conservative posture the bare file-existence check had
   before this ticket."
  []
  (when (fs/exists? awaiting-file)
    (try (json/parse-string (slurp (str awaiting-file)) true)
         (catch Exception _ {}))))

;; BL-1245: preserved-record archive. Lives OUTSIDE role-awaiting/ so
;; operator_runtime.bb's own `*.json` scan of role-awaiting/ never reads a
;; preserved record back as a live marker (the ticket's own invariant: "a
;; preserved record is never read back as live state"). Filename carries
;; the role and the ORIGINAL asked_at_ms so the entry is stable,
;; human-readable, and naturally time-ordered on disk.
(defn archive-path [asked-at-ms]
  (fs/path op-dir "role-awaiting-archive" (str role "-" asked-at-ms ".json")))

(defn- preserve-and-clear!
  "BL-1245 resolve leg: write the preserved record (question, asked_at_ms,
   reason, and any options) to role-awaiting-archive/, then remove the live
   marker from role-awaiting/ so role-ask-blocked? has nothing to read back
   as pending. The archive write happens BEFORE the marker removal so a
   crash between the two leaves the preserved evidence intact and the role
   still able to retry the resolve (the marker still exists, readable)."
  [marker reason]
  (fs/create-dirs (fs/parent (archive-path (:asked_at_ms marker))))
  (spit (str (archive-path (:asked_at_ms marker)))
        (json/generate-string (cond-> {:question (:question marker)
                                       :asked_at_ms (:asked_at_ms marker)
                                       :reason reason
                                       :resolved_at (now-iso)}
                                (:options marker) (assoc :options (:options marker)))))
  (fs/delete-if-exists awaiting-file))

(defn- resolve-main []
  (let [reason (:reason opts)
        marker (read-awaiting-marker)]
    (cond
      ;; No marker at all: nothing was pending. Not an error (the ticket's
      ;; scenario "resolving when nothing is pending is not an error") -
      ;; report and exit 0 so the role can use this as an idempotent
      ;; housekeeping move.
      (nil? marker)
      (println (json/generate-string {:resolved false :reason "nothing-pending" :role role}))

      ;; Blank reason: refused. The slot stays shut. Exit 2 so the caller
      ;; can distinguish refusal (exit 2) from a clean no-op (exit 0). The
      ;; ticket's scenario "a resolve with no reason is refused" - AND the
      ;; follow-up "an unresolved pending question still blocks a second
      ;; one" still holds because we never touched the marker.
      (str/blank? reason)
      (do
        (binding [*out* *err*]
          (println (str "role_ask.bb: --reason is required to resolve a pending question")))
        (println (json/generate-string {:resolved false :reason "reason-required" :role role}))
        (System/exit 2))

      ;; Happy path: preserve the evidence, clear the live marker, report.
      :else
      (do
        (preserve-and-clear! marker reason)
        (println (json/generate-string {:resolved true
                                        :role role
                                        :question (:question marker)
                                        :asked_at_ms (:asked_at_ms marker)
                                        :reason reason}))))))

(defn- ask-main []
  (if (operator-lib/role-ask-blocked? (read-awaiting-marker))
    (do
      (binding [*out* *err*]
        (println (str "role_ask.bb: \"" role "\" already has a clarifying question pending - refusing to ask a second one until it is answered")))
      (println (json/generate-string {:asked false :reason "already-pending"})))
    (let [question (:question opts)
          resolved-options (parse-options (:options opts))
          thread-id (ask-thread-id role)]
      (append-to-outbox! thread-id question (cond-> {"roleQuestion" role}
                                               resolved-options (assoc "options" resolved-options)))
      (atomic-spit! awaiting-file
                    (json/generate-string {:question question
                                            :asked_at_ms (System/currentTimeMillis)
                                            :options resolved-options}))
      (println (json/generate-string {:asked true :role role :question question :options resolved-options})))))

(defn -main []
  (if resolve-mode? (resolve-main) (ask-main)))

(-main)
