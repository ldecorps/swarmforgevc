#!/usr/bin/env bb
;; BL-1726: thin CLI probe over the REAL reapable-ollama-ghost? decision -
;; never a reimplementation of the ownership-marks logic in JS.
;;
;; Usage:
;;   bb bl1726_ollama_ghost_reaper_probe.bb reap-verdict <cmdline>

(require '[babashka.fs :as fs])

(def here (fs/parent (fs/canonicalize *file*)))
(load-file (str (fs/path here ".." "orphan_janitor_lib.bb")))

(def cli-args *command-line-args*)
(def cmd (first cli-args))

(case cmd
  "reap-verdict"
  (let [[_ cmdline] cli-args
        reaped? (orphan-janitor-lib/reapable-ollama-ghost?
                 {:in-live-window-set? false
                  :cmdline cmdline
                  :parent-orphaned? true
                  :parent-live-ollama-serve? false
                  :age-ms 999999
                  :grace-ms 0})]
    (println (if reaped? "reaped" "kept")))

  (do (binding [*out* *err*] (println (str "bl1726 probe: unknown command '" cmd "'")))
      (System/exit 1)))
