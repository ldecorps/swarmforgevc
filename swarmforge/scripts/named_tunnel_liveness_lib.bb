;; BL-1199: one shared "is the Bubble named tunnel live?" decision, consulted
;; by both surfaces that lied during the 2026-08-27 incident - ancillary
;; start (start_ancillary_services.sh, via named_tunnel_liveness_check.bb's
;; CLI wrapper) and swarm_status.bb's own "bubble-cloudflared" row - rather
;; than two hand-rolled checks that can drift apart. `liveness-verdict`
;; below is a pure decision, no I/O; `configured?` does read one env file,
;; but stays here too because BOTH callers need the exact same "how do we
;; decide this root has a named tunnel configured" answer - the pidfile
;; read and `kill -0` genuinely differ per caller's own IO adapter, but this
;; one config check does not, so it is the one exception to the pure/IO
;; split rather than a second hand-copied regex.
;;
;; Loaded via load-file, not required on a classpath:
;;   (load-file (str (fs/path (fs/parent *file*) "named_tunnel_liveness_lib.bb")))
;; and referred to as named-tunnel-liveness-lib/foo.

(ns named-tunnel-liveness-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

;; Same two sources launch_resident_spy_tunnel.sh itself reads: an ambient
;; env var wins outright; otherwise named-tunnel.env's own declared value
;; (never any OTHER key in that file, and a blank/absent value is
;; unconfigured, matching the launcher's own `[[ -n "$NAMED_TUNNEL" ]]`
;; gate exactly). `op` is the `.swarmforge/operator` directory.
(defn configured?
  [op]
  (let [ambient (System/getenv "SWARMFORGE_NAMED_TUNNEL")]
    (if-not (str/blank? ambient)
      true
      (let [env-file (fs/path op "named-tunnel.env")]
        (boolean
         (when (fs/exists? env-file)
           (some (fn [line]
                   (when-let [[_ v] (re-matches #"(?:export\s+)?SWARMFORGE_NAMED_TUNNEL=(.*)" (str/trim line))]
                     (not (str/blank? (str/replace v #"^[\"']|[\"']$" "")))))
                 (str/split-lines (slurp (str env-file))))))))))

;; BL-1199 constraint: "A root with no named tunnel configured must report
;; 'not configured', never 'down' — an absent tunnel is not a fault." Checked
;; FIRST, before pid-alive? is even consulted - an unconfigured root has no
;; pidfile to be stale, and "down" there would read as a fault that does not
;; exist.
(defn liveness-verdict
  "configured?: whether SWARMFORGE_NAMED_TUNNEL (ambient env or
   named-tunnel.env) names a tunnel for this root at all.
   pid-alive?: whether the recorded resident-spy-cloudflared.pid is
   currently alive (a real `kill -0`, gathered by the caller).
   Returns :up | :down | :not-configured."
  [{:keys [configured? pid-alive?]}]
  (cond
    (not configured?) :not-configured
    pid-alive? :up
    :else :down))
