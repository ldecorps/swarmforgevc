#!/usr/bin/env bb
;; BL-1719: thin CLI probe over the REAL wake-skip behavior on both
;; delivery paths - handoff_inject_lib.bb's deliver-parcel! ("the sender's
;; own send") and handoffd.bb's own notify! ("the handoff daemon") - never
;; a reimplementation of either. Both libraries are load-filed
;; unconditionally, at the top level, before any code referencing their
;; namespace-qualified symbols is analyzed (SCI resolves a namespace
;; reference when the referencing top-level form is READ, not deferred to
;; call time - a reference inside a function body used only by one
;; subcommand still fails to resolve for every OTHER subcommand unless the
;; dependency was already loaded before that form was read at all).
;;
;; handoffd.bb is load-filed with an explicit project-root binding
;; (`binding [*command-line-args* [root]]`, the established pattern this
;; file's own BL-1395 comment documents and
;; bl1494_post_qa_sweep_wake_field_test_runner.bb already uses) so its
;; module-level daemon-dir/log-file resolve against the REAL fixture root,
;; never the load-probe placeholder - readable back by this test's own
;; shell script, regardless of which subcommand is invoked.
;;
;; Usage:
;;   bb bl1719_wake_no_session_probe.bb sync-deliver <root> <outbox-file> <sender-role>
;;   bb bl1719_wake_no_session_probe.bb daemon-notify <root> <socket> <session> <agent>
;;   bb bl1719_wake_no_session_probe.bb daemon-resume <root> <socket> <session> <agent>
;;   bb bl1719_wake_no_session_probe.bb daemon-context-clear <root> <socket> <role> <session> <agent>
;;   bb bl1719_wake_no_session_probe.bb babysitter-nudge <root> <role> <text>

(require '[babashka.fs :as fs]
         '[clojure.string :as str])

(def here (fs/parent (fs/canonicalize *file*)))

(def cli-args *command-line-args*)
(def cmd (first cli-args))
(def root (second cli-args))

(load-file (str (fs/path here ".." "handoff_inject_lib.bb")))
(binding [*command-line-args* [root]]
  (load-file (str (fs/path here ".." "handoffd.bb"))))
(load-file (str (fs/path here ".." "babysitter_nudge_lib.bb")))

(case cmd
  "sync-deliver"
  (let [[_ _ outbox sender] cli-args
        outcome (handoff-inject-lib/deliver-parcel!
                 root outbox sender
                 :log-fn (fn [& parts] (println "LOG:" (str/join " " parts))))]
    (println "OUTCOME:" (pr-str outcome)))

  "daemon-notify"
  (let [[_ _ socket session agent] cli-args]
    (handoffd/notify! socket session agent)
    (println "NOTIFY_DONE"))

  ;; "the handoff daemon" - the in-process resume path (chat-order stuck
  ;; nudge, never the initial wake).
  "daemon-resume"
  (let [[_ _ socket session agent] cli-args]
    (handoffd/notify-in-process-resume! socket session agent)
    (println "RESUME_DONE"))

  ;; "the handoff daemon" - the context-clear path (`/clear` + startup
  ;; re-read), which calls agent-runtime-inject/notify-agent! directly,
  ;; never through notify!'s own nil-check.
  "daemon-context-clear"
  (let [[_ _ socket role session agent] cli-args
        role-info {:role role :session session :agent agent}
        injectors (handoffd/context-clear-injectors socket role-info)]
    (println "INJECT_CLEAR:" (pr-str ((:inject-clear! injectors))))
    (println "INJECT_STARTUP_REREAD:" (pr-str ((:inject-startup-reread! injectors) "re-read"))))

  ;; the babysitter's own nudge path (a SEPARATE mechanism from handoffd,
  ;; never handoffd.bb's own notify! - see this file's own header).
  "babysitter-nudge"
  (let [[_ _ role text] cli-args]
    (println "NUDGE_RESULT:" (pr-str (babysitter-nudge-lib/nudge-resident! root role text))))

  (do (binding [*out* *err*] (println (str "bl1719 probe: unknown command '" cmd "'")))
      (System/exit 1)))
