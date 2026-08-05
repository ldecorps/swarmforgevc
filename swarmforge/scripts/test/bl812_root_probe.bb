#!/usr/bin/env bb
;; BL-812: thin CLI probe over the REAL handoff_lib.bb root-scoped reads
;; (never a reimplementation) so a test script can prove cwd-invariance from
;; a genuinely separate process invoked with an arbitrary cwd - same probing
;; posture the specifier used to root-cause the bug (ticket's "Specifier
;; probe" note: run the real call, don't infer from the report).
;;
;; The caller controls this process's cwd (via `cd` before invoking bb) and
;; optionally passes an explicit-root, mirroring exactly what handoffd.bb
;; does at startup (handoff-lib/set-project-root!) - or omits it ("-") to
;; exercise the plain git-common-dir/cwd fallback every other caller
;; (rotate_to_role.bb, operator_runtime.bb, operator_lib.bb) still relies on.
;;
;; Usage: bb bl812_root_probe.bb <command> [args...] [explicit-root]
;;   resident-session [explicit-root]
;;   home-role        [explicit-root]
;;   active-role      [explicit-root]
;;   tmux-socket      [explicit-root]
;;   launch-script    <role> [explicit-root]
;;   wake-session     <socket> <configured-session> [explicit-root]
;;   rotate-to        <target-role> [explicit-root]
;;
;; "-" (or a blank/absent trailing arg) means "leave the explicit root unset".

(require '[babashka.fs :as fs]
         '[clojure.string :as str])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "handoff_lib.bb")))

(defn- blank-or-dash? [s]
  (or (nil? s) (= "-" s) (str/blank? s)))

(defn- apply-explicit-root! [maybe-root]
  (when-not (blank-or-dash? maybe-root)
    (handoff-lib/set-project-root! maybe-root)))

(let [[cmd a b c] *command-line-args*]
  (case cmd
    "resident-session"
    (do (apply-explicit-root! a)
        (println (or (handoff-lib/mono-router-resident-session) "nil")))

    "home-role"
    (do (apply-explicit-root! a)
        (println (or (handoff-lib/mono-router-home-role) "nil")))

    "active-role"
    (do (apply-explicit-root! a)
        (println (or (handoff-lib/read-mono-router-active-role) "nil")))

    "tmux-socket"
    (do (apply-explicit-root! a)
        (println (handoff-lib/tmux-socket)))

    "launch-script"
    (do (apply-explicit-root! b)
        (println (handoff-lib/launch-script-path a)))

    "wake-session"
    (do (apply-explicit-root! c)
        (println (handoff-lib/wake-session a b)))

    "rotate-to"
    (do (apply-explicit-root! b)
        (println (pr-str (handoff-lib/rotate-resident-to! a))))

    (do (binding [*out* *err*] (println (str "bl812_root_probe: unknown command '" cmd "'")))
        (System/exit 1))))
