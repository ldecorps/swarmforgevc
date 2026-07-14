#!/usr/bin/env bb
;; BL-371: one-shot CLI the disposable Operator LLM calls when the human
;; asks it something it judges it cannot answer itself. Files the question
;; as a RAW intake item in the backlog ROOT (the SAME channel the human's
;; own raw asks land in - constitution: Backlog Intake Order), never a new
;; queue/routing authority: the specifier's existing "drain the root before
;; all other work" convention picks it up with zero new machinery. The
;; Operator FILES only - it never creates/specs/promotes the resulting
;; ticket itself (support_lib.bb's hand-off-to-coordinator! sets this same
;; anti-fabrication precedent for the ticket-linked case).
;;
;; "Reuse the reply path it already has for talking to the human" (the
;; ticket's own instruction): after filing, this shells to the REAL
;; operator_reply.bb as a subprocess - the SAME established cross-CLI reuse
;; shape operator_handoff.bb's send-coordinator-note! already uses (shell to
;; swarm_handoff.bb rather than duplicate its logic) - never a second,
;; divergent reply mechanism.
;;
;; MUST be committed, not merely written. Every pipeline role reads from its
;; own isolated checkout, so a file written into ONE working tree and never
;; committed is INVISIBLE to the specifier - the exact failure mode BL-314
;; already taught this codebase, and the intake document that seeded THIS
;; ticket was itself left sitting untracked. There is no downstream
;; durability-check layer for this file the way BL-331 built for topic
;; records, so a commit failure is reported LOUDLY (non-zero exit) rather
;; than silently "succeeding" on an uncommitted write - that would lose the
;; question a second time while reporting success.
;;
;; Usage: operator_file_question.bb <project-root> --thread <SUP-###> --question <text>

(ns operator-file-question
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir "operator_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: operator_file_question.bb <project-root> --thread <SUP-###> --question <text>"))
  (System/exit 1))

(def project-root (or (nth *command-line-args* 0 nil) (usage)))

(defn parse-opts [args]
  (into {} (for [[k v] (partition 2 args)]
             [(keyword (str/replace k #"^--" "")) v])))

(def opts (parse-opts (drop 1 *command-line-args*)))
(when (or (str/blank? (:thread opts)) (str/blank? (:question opts))) (usage))

(defn now-iso []
  (.format (java.time.format.DateTimeFormatter/ISO_INSTANT) (java.time.Instant/now)))

;; Scoped `git add -- <path>` / `git commit -- <path>` - never a broader
;; `git add -A`/`.`, which would sweep in whatever else happens to be
;; sitting dirty in the backlog root at the time (engineering.prompt: "a
;; script that cd's..."/one-bad-pathspec-stages-nothing guardrails apply
;; here in spirit - stay narrowly scoped to exactly the file this CLI
;; itself just wrote). Returns false (never throws) on any git failure -
;; the caller decides how loudly to report it.
(defn write-and-commit-intake! [abs-path content]
  (fs/create-dirs (fs/parent abs-path))
  (spit (str abs-path) content)
  (try
    (let [add (process/sh ["git" "-C" project-root "add" "--" (str abs-path)])]
      (if-not (zero? (:exit add))
        false
        (let [commit (process/sh ["git" "-C" project-root "commit" "-m"
                                   "Operator: file a question as raw intake for the swarm\n\nBy operator."
                                   "--" (str abs-path)])]
          (zero? (:exit commit)))))
    (catch Exception _ false)))

(defn -main []
  (let [question (:question opts)
        thread-id (:thread opts)
        slug (operator-lib/question-intake-slug (System/currentTimeMillis))
        content (operator-lib/question-intake-content question (now-iso))
        rel-path (str "backlog/INTAKE-" slug ".md")
        abs-path (fs/path project-root rel-path)
        committed? (write-and-commit-intake! abs-path content)]
    (if-not committed?
      (do
        (binding [*out* *err*]
          (println (str "operator_file_question: FAILED to commit " rel-path
                         " - the question is NOT durably filed, refusing to report success or tell the human it was filed.")))
        (System/exit 1))
      (let [reply-text (str "Filed for the swarm: " rel-path)
            reply (process/sh ["bb" (str (fs/path script-dir "operator_reply.bb")) project-root
                                "--thread" thread-id "--text" reply-text])]
        (when-not (zero? (:exit reply))
          (binding [*out* *err*]
            (println (str "operator_file_question: the intake was filed and committed at " rel-path
                           " but telling the human failed: " (:err reply)))))
        (println (json/generate-string {:filed rel-path :committed true :told_human (zero? (:exit reply))}))))))

(-main)
