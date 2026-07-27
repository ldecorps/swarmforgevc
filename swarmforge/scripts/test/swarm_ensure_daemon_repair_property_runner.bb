#!/usr/bin/env bb
;; BL-690: PROPERTY tests over swarm_ensure.bb's daemon-repair path, covering
;; the two invariants the ticket YAML declares (coder-authored first, per
;; BL-654):
;;
;;   P1 never-halts - for every daemon state (absent, empty, stale, live,
;;      already-halted) crossed with whether the repair succeeds or fails,
;;      ensure kills no tmux session, writes no daemon/stop marker, and
;;      records no halt (handoffd.status.json state never becomes "halted",
;;      no handoffd-failure-*.log is written).
;;   P2 idempotence - from any daemon state, a second consecutive ensure run
;;      reports the daemon OK and leaves exactly one live handoffd pid,
;;      never a second one.
;;
;; The domain (5 states x 2 outcomes = 10 combinations for P1; 5 states for
;; P2) is small and fully enumerable, so this runs an EXHAUSTIVE sweep rather
;; than random sampling - the strongest form of the "generator must
;; demonstrably reach the states the invariant quantifies over" requirement:
;; every combination the invariant names is covered on every run, not
;; probabilistically.
;;
;; Each case spawns the REAL swarm_ensure.bb as a subprocess with NO
;; SWARM_ENSURE_SUPERVISOR_CMD override, so the actual default command
;; (bash start_handoff_daemon.sh - BL-690's fix) is what gets exercised, not
;; a re-derived approximation of it. Only the daemon start's OWN dependents
;; (HANDOFFD_BB / HANDOFFD_SUPERVISOR_BB) are swapped for fast deterministic
;; fakes, controlling the succeed/fail outcome without flakiness.
;;
;; NOTE on toolchain (per swarmforge/constitution's engineering article,
;; "Babashka/Clojure (swarm scripts)" - BL-472 tracks pinning real
;; mutation/property tooling for .bb scripts, deliberately deferred, not
;; wired today): the BL-654 role contract's "*.property.test.js /
;; vitest.properties.config.mjs" home is a TypeScript convention with no
;; Babashka equivalent. This follows the property-test precedent this repo
;; already established for .bb code instead (ambulance_lib_property_runner.bb,
;; expedite_lib_property_runner.bb) - a deterministic sweep in the same
;; swarmforge/scripts/test/ suite that is the actual enforced gate for .bb
;; scripts, per that engineering-article note.

(ns swarm-ensure-daemon-repair-property-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(def script-dir (str (fs/path (fs/parent (fs/canonicalize *file*)) "..")))
(def ensure-script (str (fs/path script-dir "swarm_ensure.bb")))

(def failures (atom []))
(def live-pids (atom #{}))

;; Backstop: if this process itself gets killed mid-run, still try to reap
;; every fake daemon pid this runner spawned (mirrors ambulance_lib_property_
;; runner.bb's temp-dir shutdown hook, one level up - pids instead of dirs).
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn []
                              (doseq [pid @live-pids]
                                (try
                                  (some-> (java.lang.ProcessHandle/of (long pid))
                                          (.orElse nil) (.destroyForcibly))
                                  (catch Exception _ nil))))))

(defn- report! [prop input msg]
  (swap! failures conj (str "FAIL " prop "\n  input: " (pr-str input) "\n  " msg)))

;; ── fixture construction ─────────────────────────────────────────────────

(defn mk-tmp []
  (str (fs/create-temp-dir {:prefix "swarm-ensure-daemon-prop-"})))

(defn daemon-dir [root] (fs/path root ".swarmforge" "daemon"))
(defn pid-file [root] (fs/path (daemon-dir root) "handoffd.pid"))
(defn supervisor-pid-file [root] (fs/path (daemon-dir root) "handoffd-supervisor.pid"))
(defn stop-file [root] (fs/path (daemon-dir root) "stop"))
(defn status-file [root] (fs/path (daemon-dir root) "handoffd.status.json"))
(defn audit-file [root] (fs/path (daemon-dir root) "daemon-start-audit.log"))
(defn tmux-kill-log [root] (fs/path root "tmux-kill.log"))

(defn base-fixture!
  "Every property case gets: an extension that always reports healthy (out
   of scope for this invariant), a single healthy coder pane on a fake tmux
   that logs any kill-session call, and operator/front-desk/babysitter
   skipped entirely - isolating the fixture to the daemon component alone."
  []
  (let [root (mk-tmp)
        fake-bin (fs/path root "bin")]
    (fs/create-dirs (daemon-dir root))
    (fs/create-dirs (fs/path root ".swarmforge" "launch"))
    (fs/create-dirs (fs/path root ".worktrees" "coder"))
    (fs/create-dirs fake-bin)
    (spit (str (fs/path root ".swarmforge" "tmux-socket")) (str (fs/path root "fake.sock")))
    (spit (str (fs/path root ".swarmforge" "roles.tsv"))
          (str "coder\tcoder\t" (fs/path root ".worktrees" "coder")
               "\tswarmforge-coder\tCoder\tclaude\ttask\n"))
    (spit (str (tmux-kill-log root)) "")
    (let [tmux-fake (fs/path fake-bin "tmux")]
      (spit (str tmux-fake)
            (str "#!/usr/bin/env bash\n"
                 "if [[ \"$3\" == \"list-panes\" ]]; then echo \"0\"; exit 0; fi\n"
                 "if [[ \"$3\" == \"kill-session\" ]]; then echo \"KILL $*\" >> " (str (tmux-kill-log root)) "; exit 0; fi\n"
                 "exit 0\n"))
      (fs/set-posix-file-permissions tmux-fake "rwxr-xr-x"))
    (let [ext-fake (fs/path fake-bin "fake_ext.sh")]
      (spit (str ext-fake) "#!/usr/bin/env bash\nexit 0\n")
      (fs/set-posix-file-permissions ext-fake "rwxr-xr-x"))
    {:root root :fake-bin (str fake-bin)}))

(defn seed-daemon-state!
  "Prepares handoffd.pid (and, for :already-halted, a pre-existing stop
   marker) for one of the five states the invariant names. :live uses this
   runner's OWN pid as a real, currently-alive process - same idiom the
   existing shell suite uses ($$)."
  [root state]
  (case state
    :absent nil
    :empty (spit (str (pid-file root)) "")
    :stale (spit (str (pid-file root)) "999999")
    :live (spit (str (pid-file root)) (str (.pid (java.lang.ProcessHandle/current))))
    :already-halted (do (spit (str (pid-file root)) "999999")
                         (spit (str (stop-file root)) ""))))

(defn write-outcome-fakes!
  "A :succeed fake claims its pid file and stays alive (same real-
   background-process survival idiom the .bb daemon fixtures already use);
   a :fail fake exits immediately without ever claiming it, so
   start_handoff_daemon.sh's bounded wait loop times out and reports FAILED
   - never a probe, never anything that could reach alarm-and-halt!."
  [root outcome]
  (let [handoffd-bb (fs/path root "fake_handoffd.bb")
        supervisor-bb (fs/path root "fake_supervisor.bb")]
    (case outcome
      :succeed
      (do
        (spit (str handoffd-bb)
              (str "(spit \"" (pid-file root) "\" (str (.pid (java.lang.ProcessHandle/current))))\n"
                   "(Thread/sleep 60000)\n"))
        (spit (str supervisor-bb)
              (str "(spit \"" (supervisor-pid-file root) "\" (str (.pid (java.lang.ProcessHandle/current))))\n"
                   "(Thread/sleep 60000)\n")))
      :fail
      (do
        (spit (str handoffd-bb) "(System/exit 1)\n")
        (spit (str supervisor-bb) "(System/exit 1)\n")))
    {:handoffd-bb (str handoffd-bb) :supervisor-bb (str supervisor-bb)}))

(defn run-ensure!
  [{:keys [root fake-bin]} {:keys [handoffd-bb supervisor-bb]}]
  (let [env (merge (into {} (System/getenv))
                    {"PATH" (str fake-bin ":" (System/getenv "PATH"))
                     "SWARM_ENSURE_EXTENSION_CHECK_CMD" (str (fs/path fake-bin "fake_ext.sh"))
                     "SWARM_ENSURE_EXTENSION_BOUNCE_CMD" (str (fs/path fake-bin "fake_ext.sh"))
                     "SWARMFORGE_SKIP_OPERATOR" "1"
                     "SWARMFORGE_SKIP_FRONT_DESK" "1"
                     "SWARMFORGE_SKIP_BABYSITTER" "1"
                     "HANDOFFD_BB" handoffd-bb
                     "HANDOFFD_SUPERVISOR_BB" supervisor-bb
                     "PID_WAIT_ATTEMPTS" "5"})
        result (process/sh ["bb" ensure-script root] {:env env})]
    (when-let [pid (try (parse-long (str/trim (slurp (str (pid-file root))))) (catch Exception _ nil))]
      (swap! live-pids conj pid))
    (when-let [pid (try (parse-long (str/trim (slurp (str (supervisor-pid-file root))))) (catch Exception _ nil))]
      (swap! live-pids conj pid))
    result))

(defn cleanup! [root]
  (doseq [f [(pid-file root) (supervisor-pid-file root)]]
    (when-let [pid (try (parse-long (str/trim (slurp (str f)))) (catch Exception _ nil))]
      (try (some-> (java.lang.ProcessHandle/of (long pid)) (.orElse nil) (.destroyForcibly))
           (catch Exception _ nil))))
  (try (fs/delete-tree root) (catch Exception _ nil)))

;; ── P1: never halts, for every (state, outcome) combination ────────────────

(def states [:absent :empty :stale :live :already-halted])
(def outcomes [:succeed :fail])

;; Independent literal domain for the reachability floor below - NOT derived
;; from states/outcomes (which also drive the loop), so a future edit that
;; narrows the loop's own driver (a filter, a slice, an accidental drop)
;; still gets caught instead of the check trivially staying in sync with
;; whatever the loop happened to visit. Transcribed directly from the
;; ticket's own invariant text ("absent, empty, stale, live, already-halted"
;; x "succeed or fail").
(def expected-p1-combos
  (set (for [s [:absent :empty :stale :live :already-halted]
             o [:succeed :fail]]
         [s o])))

(defn expect-daemon-line [state outcome]
  (if (= state :live)
    "daemon: HEALTHY"
    (case outcome
      :succeed "daemon: FIXED (restarted the handoff daemon)"
      :fail "daemon: FAILED")))

(def p1-combos (for [s states o outcomes] [s o]))
(def p1-visited (atom #{}))

(doseq [[state outcome] p1-combos]
  (let [{:keys [root] :as fixture} (base-fixture!)]
    (try
      (swap! p1-visited conj [state outcome])
      (seed-daemon-state! root state)
      (let [fakes (write-outcome-fakes! root outcome)
            {:keys [out]} (run-ensure! fixture fakes)
            expected-line (expect-daemon-line state outcome)]
        (when-not (str/includes? out expected-line)
          (report! "P1 never-halts" [state outcome]
                    (str "expected report to contain " (pr-str expected-line) ", got:\n" out)))
        (when (fs/exists? (stop-file root))
          (report! "P1 never-halts" [state outcome] "daemon/stop marker exists after ensure ran"))
        (let [kills (str/trim (slurp (str (tmux-kill-log root))))]
          (when-not (str/blank? kills)
            (report! "P1 never-halts" [state outcome] (str "a tmux session was killed: " kills))))
        (when (fs/exists? (status-file root))
          (let [status-text (slurp (str (status-file root)))]
            (when (str/includes? status-text "\"halted\"")
              (report! "P1 never-halts" [state outcome] (str "status file recorded a halt: " status-text)))))
        (when (seq (filter #(str/starts-with? (fs/file-name %) "handoffd-failure-")
                            (fs/list-dir (daemon-dir root))))
          (report! "P1 never-halts" [state outcome] "a handoffd-failure log was written (alarm-and-halt! ran)")))
      (finally (cleanup! root)))))

;; Asserted reachability floor, not a hoped-for one: every (state, outcome)
;; combination the invariant quantifies over was actually exercised above,
;; not merely assumed by the shape of the doseq.
(when-not (= expected-p1-combos @p1-visited)
  (report! "P1 never-halts" :reachability
            (str "expected every combination visited; missing="
                 (pr-str (remove @p1-visited expected-p1-combos))
                 " unexpected=" (pr-str (remove expected-p1-combos @p1-visited)))))

;; ── P2: idempotent from any state - second run is OK, one live handoffd ────

;; Independent literal domain, same rationale as expected-p1-combos above.
(def expected-p2-states (set [:absent :empty :stale :live :already-halted]))
(def p2-visited (atom #{}))

(doseq [state states]
  (let [{:keys [root] :as fixture} (base-fixture!)]
    (try
      (swap! p2-visited conj state)
      (seed-daemon-state! root state)
      (let [fakes (write-outcome-fakes! root :succeed)
            _first (run-ensure! fixture fakes)
            first-pid (try (str/trim (slurp (str (pid-file root)))) (catch Exception _ nil))
            {:keys [out]} (run-ensure! fixture fakes)
            second-pid (try (str/trim (slurp (str (pid-file root)))) (catch Exception _ nil))]
        (when-not (str/includes? out "daemon: HEALTHY")
          (report! "P2 idempotent" [state] (str "second consecutive run did not report OK, got:\n" out)))
        (when-not (= first-pid second-pid)
          (report! "P2 idempotent" [state]
                    (str "second run left a different handoffd pid behind: first=" first-pid " second=" second-pid))))
      (finally (cleanup! root)))))

(when-not (= expected-p2-states @p2-visited)
  (report! "P2 idempotent" :reachability
            (str "expected every state visited; missing=" (pr-str (remove @p2-visited expected-p2-states)))))

;; ── report ────────────────────────────────────────────────────────────────
(println (str "swarm_ensure daemon-repair properties: "
              (count p1-combos) " P1 combinations, " (count states) " P2 states (exhaustive)"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 20 @failures)] (println f))
      (System/exit 1)))
