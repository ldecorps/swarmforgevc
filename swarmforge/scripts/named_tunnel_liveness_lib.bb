;; BL-1199: one shared "is the Bubble named tunnel live?" decision, consulted
;; by both surfaces that lied during the 2026-08-27 incident - ancillary
;; start (start_ancillary_services.sh, via named_tunnel_liveness_check.bb's
;; CLI wrapper) and swarm_status.bb's own "bubble-cloudflared" row - rather
;; than two hand-rolled checks that can drift apart. Pure decision only, no
;; real pidfile/process I/O here (that lives in each caller's own thin
;; adapter, matching this project's established pure/IO split).
;;
;; Loaded via load-file, not required on a classpath:
;;   (load-file (str (fs/path (fs/parent *file*) "named_tunnel_liveness_lib.bb")))
;; and referred to as named-tunnel-liveness-lib/foo.

(ns named-tunnel-liveness-lib)

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
