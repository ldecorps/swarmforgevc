#!/usr/bin/env bb
;; BL-657: thin CLI wrapper so swarmforge.sh (zsh) can get the list of
;; harness-marker variable names to scrub from the tmux server's global
;; environment. Reads `tmux show-environment -g` output on stdin, prints
;; each matching name on its own line on stdout. Prints nothing (exit 0)
;; on empty/no-marker input - never a silent non-zero exit for the common
;; case, since the caller loop must not abort the launch over this.
;;
;; BL-1049: `--provider <backends>` switches to the provider-secret half -
;; the same stdin, classified against a comma- or space-separated list of
;; the running configuration's window backends. This is where the derived
;; keep-list becomes observable without a live launch: an operator can ask
;; "what would this configuration remove?" and read the answer, rather than
;; inferring it from a server that has already been scrubbed.
;;
;; Neither mode ever prints a VALUE. A prior manual repro of this exact
;; scenario, run from a live harness session, dumped every real provider API
;; key on that shell's PATH into a transcript; names only, always.
;;
;; Usage:
;;   tmux -S "$SOCKET" show-environment -g | bb harness_env_scrub_names.bb
;;   tmux -S "$SOCKET" show-environment -g | bb harness_env_scrub_names.bb --provider claude,vibe

(require '[babashka.fs :as fs]
         '[clojure.string :as str])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "harness_env_scrub_lib.bb")))

(defn- parse-backends [s]
  (into #{} (remove str/blank?) (str/split (or s "") #"[,\s]+")))

(defn -main [& args]
  (let [input (slurp *in*)
        names (if (= "--provider" (first args))
                (harness-env-scrub-lib/provider-secret-names
                  input (parse-backends (str/join " " (rest args))))
                (harness-env-scrub-lib/harness-marker-names input))]
    (doseq [name names]
      (println name))))

(apply -main *command-line-args*)
