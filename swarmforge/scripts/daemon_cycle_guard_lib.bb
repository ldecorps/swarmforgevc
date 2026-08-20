;; daemon_cycle_guard_lib.bb (BL-967) - the bounded-subprocess chokepoint and
;; sweep-boundary wrapper for handoffd's poll cycle.
;;
;; Invariant 1: no single subprocess wait inside the daemon's poll cycle can
;; silently exceed the freshness threshold. sh! is a drop-in for
;; babashka.process/sh whose wait carries a bound WELL UNDER the 300s
;; threshold; hitting the bound destroys the child's process tree, reports
;; through on-timeout! (the daemon wires its log there, naming the current
;; sweep), and returns a normal {:exit 124 :out "" :err ...} result map -
;; survived, never thrown, so a wedged tmux/git/child costs one bounded wait,
;; never the heartbeat. The historical failure this closes is the
;; BL-057/BL-061 family: clojure.java.shell/sh's stream-read shim blocking in
;; read() forever on a wedged child (handoff_lib.bb's session-exists? still
;; carried it - see BL-967's evidence file).
;;
;; Invariant 2: run-sweep! emits one boundary line per sweep (name +
;; duration) even when the sweep took no action, so "last log line" always
;; localizes a stall to one sweep. The daemon calls it only around the
;; heavy-cycle bundle - idle 1s ticks add no boundary lines (that half is
;; main-loop wiring, asserted by acceptance scenario 03).
;;
;; Loaded via load-file and referred to as daemon-cycle-guard-lib/foo. Pure
;; enough for tests: run-sweep! takes its log and clock as parameters; sh!'s
;; bound comes from the SWARMFORGE_SUBPROCESS_WAIT_BOUND_MS env seam (the
;; daemon wiring tests' standard override style), defaulting to 60s.

(ns daemon-cycle-guard-lib
  (:require [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def default-subprocess-wait-bound-ms 60000)

(defn subprocess-wait-bound-ms []
  (or (some-> (System/getenv "SWARMFORGE_SUBPROCESS_WAIT_BOUND_MS") parse-long)
      default-subprocess-wait-bound-ms))

;; The sweep (or cycle phase) any timeout is attributed to. The daemon's
;; run-sweep! keeps this current; "outside-sweep" covers startup and
;; between-sweep gaps.
;;
;; defonce, not def, for both atoms below: four files load-file this lib
;; (handoffd.bb directly, plus handoff_lib.bb / briefing_email_lib.bb /
;; control_plane_lib.bb, each of which handoffd also loads), so the ns is
;; evaluated several times in one daemon process. Under `def` every reload
;; installs a FRESH atom, and any reload landing after handoffd wires its
;; logger would silently restore the silent default - the timeout
;; attribution would vanish with nothing to show for it. defonce makes the
;; wiring order-independent instead of merely lucky.
(defonce current-context (atom "outside-sweep"))

;; BL-977: the in-flight sweep marker hook. current-context above is
;; in-memory only, which is exactly why the 2026-08-20T07:55:35Z halt
;; happened: the supervisor could not see that a 143s dropped-parcel-sweep
;; was legitimately in flight, so heartbeat-file mtime alone crossed the
;; 30s window and alarm-and-halt! killed a progressing daemon. run-sweep!
;; now ALSO publishes its transitions through this hook - sweep start with
;; the sweep's name, sweep end as idle - so the marker on disk advances
;; only with the poll loop's own progress (invariant 2: no free-running
;; pulser; a wedged loop's marker freezes at its last transition and ages
;; past the in-sweep budget). defonce for the same multi-load-file reason
;; as the atoms above. Default no-op keeps every pure test caller silent.
(defonce sweep-marker! (atom (fn [_] nil)))

(defn install-sweep-marker-writer!
  "Wires sweep-marker! to publish marker-path as one small JSON object:
   {\"sweep\": <name>, \"started_at_ms\": <wall-clock ms>} while a sweep is
   in flight, {\"sweep\": \"idle\"} between sweeps. The wall clock is
   stamped HERE at transition time (the supervisor computes the in-flight
   age from it), and a write failure is swallowed - the marker is
   observability, never allowed to fail a sweep."
  [marker-path]
  (reset! sweep-marker!
          (fn [{:keys [sweep]}]
            (try
              (spit marker-path
                    (str (json/generate-string
                          (if (= sweep "idle")
                            {:sweep "idle"}
                            {:sweep sweep :started_at_ms (System/currentTimeMillis)}))
                         "\n"))
              (catch Exception _ nil)))))

;; Wired by the daemon to its log!; the default is silent so library
;; consumers (swarm_handoff.bb and tests loading handoff_lib.bb) never
;; crash for lack of a logger.
(defonce on-timeout! (atom (fn [_info] nil)))

(defn- split-sh-args
  "Normalizes the three call shapes the codebase uses (mirroring
   babashka.process/sh): varargs strings, a command vector, and a command
   vector followed by an opts map. Returns [cmd-vec opts]."
  [args]
  (cond
    (vector? (first args)) [(vec (first args)) (or (second args) {})]
    (map? (first args)) [(vec (rest args)) (first args)]
    :else [(mapv str args) {}]))

(defn sh!
  "Bounded babashka.process/sh: same call shapes, same result map shape.
   On a wait-bound hit: the child's tree is destroyed, on-timeout! fires
   with {:context :cmd :bound-ms}, and {:exit 124 :out \"\" :err ...} is
   returned - callers' existing (:exit result) checks treat it as an
   ordinary failure. 124 mirrors coreutils timeout(1)."
  [& args]
  (let [[cmd opts] (split-sh-args args)
        bound (subprocess-wait-bound-ms)
        proc (process/process cmd (merge {:out :string :err :string} opts))
        result (deref proc bound ::timed-out)]
    (if (= ::timed-out result)
      (do
        (try (process/destroy-tree proc) (catch Exception _ nil))
        ((deref on-timeout!) {:context @current-context :cmd cmd :bound-ms bound})
        {:exit 124 :out ""
         :err (str "daemon-cycle-guard: bounded-wait timeout after " bound "ms: "
                   (str/join " " (take 4 cmd)))})
      result)))

(defn run-sweep!
  "Runs one sweep thunk under boundary observability (invariant 2): sets
   current-context to sweep-name for timeout attribution, catches and logs
   any exception as \"<sweep-name>-error\" (the pre-existing per-sweep event
   names, preserved exactly), and ALWAYS emits one
   `sweep-boundary sweep=<name> ms=<duration>` line - action or no action,
   error or clean. log-fn is (fn [event detail]); now-fn returns ms."
  [log-fn now-fn sweep-name thunk]
  (reset! current-context sweep-name)
  ;; BL-977: publish the transition - the marker advances only here, with
  ;; the poll loop's own progress, never on a timer.
  ((deref sweep-marker!) {:sweep sweep-name})
  (let [t0 (now-fn)]
    (try
      (thunk)
      (catch Exception e
        (log-fn (str sweep-name "-error") (.getMessage e))))
    (log-fn "sweep-boundary" (str "sweep=" sweep-name " ms=" (- (now-fn) t0)))
    (reset! current-context "outside-sweep")
    ((deref sweep-marker!) {:sweep "idle"})))
