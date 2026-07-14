;; BL-367: pure decision logic for where the swarm's tmux control socket
;; should live. Loaded via load-file, not required on a classpath:
;;   (load-file (str (fs/path (fs/parent *file*) "swarm_socket_lib.bb")))
;; and referred to as swarm-socket-lib/foo.
;;
;; INCIDENT: the entire /tmp/swarmforge-<uid>/ directory was deleted out
;; from under a running tmux server on 2026-07-14. tmux and all 8 agent
;; processes stayed alive; a unix socket cannot be re-linked once unlinked
;; and tmux has no command to rebind a running server to a new path, so
;; control was lost PERMANENTLY for the life of those processes. /tmp is
;; explicitly everybody's shared scratch space (systemd-tmpfiles, cleanup
;; scripts, a human's `rm -rf /tmp/*`) - the defect is the LOCATION, not
;; whatever reaped it that one time. The Operator's own tmux socket already
;; lives under the project's gitignored .swarmforge/ tree
;; (operator_runtime.bb's operator-tmux.sock) and survived the same
;; incident untouched - that asymmetry is the fix.
;;
;; CONSTRAINT: a unix socket path (sun_path) is capped at ~108 bytes on
;; Linux (104 on macOS). Nesting the socket under the project root makes
;; the path length a function of WHERE THE PROJECT LIVES, so a deeply-
;; nested checkout can overrun that limit - the failure mode is an obscure
;; errno at bind time, not a clear message. resolve-socket-path guards this
;; explicitly rather than ever binding blind.

(ns swarm-socket-lib
  (:require [clojure.string :as str]))

;; Conservative margin under Linux's 108-byte sun_path (104 on macOS) -
;; leaves room for the trailing NUL and any implementation slack rather
;; than binding exactly at the documented limit.
(def max-safe-socket-path-len 100)

(defn primary-socket-path
  "Inside the project's own gitignored, user-owned .swarmforge/ tree -
   matches the Operator's own proven-safe posture. Never /tmp."
  [working-dir hash]
  (str working-dir "/.swarmforge/tmux/" hash ".sock"))

(defn xdg-fallback-socket-path
  "A short, still-private, per-user path when the primary is too long -
   $XDG_RUNTIME_DIR (typically /run/user/<uid>), never /tmp. This is a
   FALLBACK for the path-length overrun case only, not the primary
   location (see this file's header: splitting runtime state across two
   homes when .swarmforge/ already exists and is already trusted is only
   worth it when the primary genuinely will not fit)."
  [xdg-runtime-dir hash]
  (str xdg-runtime-dir "/swarmforge/" hash ".sock"))

(defn resolve-socket-path
  "Where should this project's tmux control socket live? Returns
   {:path ... :source (:primary or :xdg-fallback)} on success, or
   {:error :path-too-long :message \"...\"} when there is no route to a
   safe path - never a blind bind past the OS's own sun_path limit.
   xdg-runtime-dir may be nil/blank (unset on some WSL2/headless/
   systemd-less hosts) - that alone is not a failure unless the primary
   path also happens to be too long."
  [{:keys [working-dir hash xdg-runtime-dir max-len]
    :or {max-len max-safe-socket-path-len}}]
  (let [primary (primary-socket-path working-dir hash)]
    (if (<= (count primary) max-len)
      {:path primary :source :primary}
      (if (not (str/blank? xdg-runtime-dir))
        (let [fallback (xdg-fallback-socket-path xdg-runtime-dir hash)]
          (if (<= (count fallback) max-len)
            {:path fallback :source :xdg-fallback}
            {:error :path-too-long
             :message (str "Socket path exceeds the operating system's unix-socket path limit "
                           "(" max-len " chars) even under XDG_RUNTIME_DIR. primary=" primary
                           " (" (count primary) " chars) fallback=" fallback
                           " (" (count fallback) " chars)")}))
        {:error :path-too-long
         :message (str "Socket path exceeds the operating system's unix-socket path limit "
                       "(" max-len " chars) and XDG_RUNTIME_DIR is not set for a fallback. "
                       "primary=" primary " (" (count primary) " chars)")}))))
