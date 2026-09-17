;; Shared helpers for the receive-mode dispatcher scripts (ready_for_next.bb,
;; done_with_current.bb). Loaded via load-file, not required on a classpath, so
;; callers do:
;;   (load-file (str (fs/path (fs/parent *file*) "dispatch_lib.bb")))
;; and refer to symbols as dispatch-lib/foo.

(ns dispatch-lib
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.java.shell :as sh]
            [clojure.string :as str]))

(def script-dir (fs/parent *file*))

(defn exit! [status message]
  (binding [*out* *err*]
    (println message))
  (System/exit status))

(defn command [& args]
  (apply sh/sh args))

(defn git-root []
  (let [result (command "git" "rev-parse" "--show-toplevel")]
    (when (zero? (:exit result))
      (str/trim (:out result)))))

(defn git-common-dir []
  (let [result (command "git" "rev-parse" "--git-common-dir")]
    (when (zero? (:exit result))
      (let [path (str/trim (:out result))]
        (if (fs/absolute? path)
          path
          (str (fs/absolutize path)))))))

(defn project-root []
  (if-let [root (git-root)]
    (if (fs/exists? (fs/path root ".swarmforge" "roles.tsv"))
      root
      (if-let [common (git-common-dir)]
        (let [candidate (str (fs/parent common))]
          (if (fs/exists? (fs/path candidate ".swarmforge" "roles.tsv"))
            candidate
            (exit! 1 "Cannot find SwarmForge project root")))
        (exit! 1 "Cannot find SwarmForge project root")))
    (exit! 1 "Cannot find SwarmForge project root")))

(defn role []
  (or (not-empty (System/getenv "SWARMFORGE_ROLE"))
      (exit! 1 "Set SWARMFORGE_ROLE.")))

(defn receive-mode [role-name]
  (let [roles (str/split-lines (slurp (str (fs/path (project-root) ".swarmforge" "roles.tsv"))))]
    (or (some (fn [line]
                (let [fields (str/split line #"\t" -1)]
                  (when (= role-name (first fields))
                    (not-empty (get fields 6 "task")))))
              roles)
        (exit! 1 (str "Unknown role: " role-name)))))

(defn run-helper! [script & args]
  (apply process/exec (str (fs/path script-dir script)) args))

(defn- reason-flag-args?
  "The shared shape both --no-work (BL-1422) and --no-op (BL-1609) accept:
   exactly [flag \"<non-blank reason>\"]. A bare flag, a blank reason, or
   anything else (including --help) is not this shape and stays refused."
  [flag args]
  (and (= 2 (count args))
       (= flag (first args))
       (not (str/blank? (second args)))))

(defn no-work-args?
  "BL-1422: the Work-note-completion exception - see reason-flag-args!."
  [args]
  (reason-flag-args? "--no-work" args))

(defn no-op-args?
  "BL-1609: the forwarding-git_handoff-completion exception - see
   reason-flag-args!."
  [args]
  (reason-flag-args? "--no-op" args))

(defn no-work-reason
  "The --no-work reason from this process's own argv, when
   refuse-unexpected-args! has already let it through; nil for a plain
   invocation or one carrying --no-op instead."
  []
  (let [args *command-line-args*]
    (when (no-work-args? args) (second args))))

(defn no-op-reason
  "The --no-op reason from this process's own argv, when
   refuse-unexpected-args! has already let it through; nil for a plain
   invocation or one carrying --no-work instead."
  []
  (let [args *command-line-args*]
    (when (no-op-args? args) (second args))))

(defn refuse-unexpected-args!
  "BL-652: done_with_current family takes no arguments, with two exceptions:
   --no-work \"<reason>\" (BL-1422, a Work-note completion) and --no-op
   \"<reason>\" (BL-1609, a forwarding git_handoff completion), each
   non-blank. Any other argv (including --help, either flag with no/blank
   reason, or both flags together) still fails fast with usage text and
   zero completion side effects. Call before any mailbox mutation or helper
   dispatch."
  []
  (let [args *command-line-args*]
    (when (and (seq args) (not (or (no-work-args? args) (no-op-args? args))))
      (exit! 2 "Usage: done_with_current.sh takes no arguments, or --no-work \"<reason>\" or --no-op \"<reason>\""))))

(defn run-dispatch!
  "Dispatch to the shell helper configured for the current role's receive mode.
   mode->script maps receive-mode string (\"task\"/\"batch\") to the sibling
   .sh wrapper to exec. Forwards no argv - unchanged since before BL-1422
   (ready_for_next's own dispatch calls this and never validated argv to
   begin with; it must keep its exact prior behavior)."
  [mode->script]
  (let [role-name (role)
        mode      (receive-mode role-name)]
    (if-let [script (get mode->script mode)]
      (run-helper! script)
      (exit! 2 (str "INVALID_RECEIVE_MODE: " mode " for role " role-name)))))

(defn run-dispatch-forwarding-args!
  "BL-1422: like run-dispatch! above, but forwards this process's own argv
   (already vetted by refuse-unexpected-args!) through to the invoked
   script unchanged, so --no-work \"<reason>\" reaches
   done_with_current_task.sh exactly as typed. done_with_current family
   only - kept separate from run-dispatch! so ready_for_next's own
   dispatch (which never validates argv) is not newly exposed to whatever
   argv it happens to be called with."
  [mode->script]
  (let [role-name (role)
        mode      (receive-mode role-name)]
    (if-let [script (get mode->script mode)]
      (apply run-helper! script *command-line-args*)
      (exit! 2 (str "INVALID_RECEIVE_MODE: " mode " for role " role-name)))))
