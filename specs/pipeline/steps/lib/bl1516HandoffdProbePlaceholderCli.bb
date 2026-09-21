#!/usr/bin/env bb
;; BL-1516 scenario 03: loads handoffd.bb as a genuine BL-1395 probe (no
;; command-line-args at all - the exact `load-file` shape a plain
;; `(load-file "handoffd.bb")` with no argv override produces), then drives
;; the REAL post-qa-branch-sweep-tell! for a role, from a cwd this script
;; controls and never the live checkout. Reports the daemon log's own
;; resolved path and whether the old relative placeholder ever appeared at
;; that cwd's top level - never a reimplementation of either.
;;
;; Usage: bl1516HandoffdProbePlaceholderCli.bb <isolated-cwd>

(require '[babashka.fs :as fs])
(require '[cheshire.core :as json])

(def isolated-cwd (first *command-line-args*))
(when (nil? isolated-cwd)
  (binding [*out* *err*] (println "usage: bl1516HandoffdProbePlaceholderCli.bb <isolated-cwd>"))
  (System/exit 2))

(def scripts-dir (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." ".." ".." ".." "swarmforge" "scripts")))

;; The probe placeholder resolves under the system temp dir (BL-1516's own
;; fix), which BL-406's own guard reads as a throwaway test/temp root and
;; refuses without SWARMFORGE_ALLOW_TMP_DAEMON=1 - bl1458/bl1494's own
;; idiom (re-exec self with the env var set, since bb has no setenv for the
;; current process).
(when (nil? (System/getenv "SWARMFORGE_ALLOW_TMP_DAEMON"))
  (let [{:keys [exit out err]} (babashka.process/shell
                                 {:continue true :out :string :err :string :dir isolated-cwd
                                  :extra-env {"SWARMFORGE_ALLOW_TMP_DAEMON" "1"}}
                                 "bb" (str *file*) isolated-cwd)]
    (print out) (flush)
    (binding [*out* *err*] (print err) (flush))
    (System/exit exit)))

;; A genuine probe: no *command-line-args* override at all, exactly what a
;; plain `(load-file "handoffd.bb")` produces from a caller supplying none.
(binding [*command-line-args* []]
  (load-file (str (fs/path scripts-dir "handoffd.bb"))))
(load-file (str (fs/path scripts-dir "post_qa_branch_sweep_lib.bb")))

(def captured (atom nil))

(with-redefs [daemon-cycle-guard-lib/sh!
              (fn [cmd & _rest]
                (reset! captured (slurp (last cmd)))
                {:exit 0 :out "" :err ""})]
  (handoffd/post-qa-branch-sweep-tell! "cleaner" :divergent-branch "branch behind abcdefabcd: probe" true))

(println (json/generate-string
          {:log-file (str handoffd/log-file)
           :probe-entry-exists-at-cwd?
           (fs/exists? (fs/path isolated-cwd "bl1395-load-probe-no-root"))}))
