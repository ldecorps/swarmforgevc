#!/usr/bin/env bb
;; BL-657: thin CLI wrapper so swarmforge.sh (zsh) can get the list of
;; harness-marker variable names to scrub from the tmux server's global
;; environment. Reads `tmux show-environment -g` output on stdin, prints
;; each matching name on its own line on stdout. Prints nothing (exit 0)
;; on empty/no-marker input - never a silent non-zero exit for the common
;; case, since the caller loop must not abort the launch over this.
;;
;; Usage: tmux -S "$SOCKET" show-environment -g | bb harness_env_scrub_names.bb

(require '[babashka.fs :as fs])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "harness_env_scrub_lib.bb")))

(defn -main []
  (let [input (slurp *in*)]
    (doseq [name (harness-env-scrub-lib/harness-marker-names input)]
      (println name))))

(-main)
