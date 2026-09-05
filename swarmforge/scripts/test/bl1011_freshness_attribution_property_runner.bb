#!/usr/bin/env bb
;; BL-1011 property test (coder-authored, two DECLARED invariants) over the
;; REAL daemon_log_freshness_check.sh - run as a subprocess against generated
;; checkouts, never a reimplementation of its logic in Clojure. The defect was
;; in which branch the shell script computed a variable in; only the script
;; itself can answer that.
;;
;;   Invariant 1: "Self-identifying: every announced line and every durable
;;   incident record names the swarm it came from, so an alarm is attributable
;;   with no access to the sending host and no matter which credential path
;;   supplied the bot token."
;;
;;   Invariant 2: "No raw sentinel reaches a human: a value that is not an age
;;   never renders as a number. Every violation states which of the three
;;   conditions fired."
;;
;; REACH, asserted rather than hoped for (BL-654's generator-reach clause).
;; The state that actually shipped broken is CREDENTIALS ALREADY EXPORTED: the
;; swarm name was resolved only inside the branch that FILLS IN missing
;; credentials, so every run with TELEGRAM_* already set announced anonymously.
;; A generator that only ever ran with credentials absent would pass against
;; the live defect - the whole 2026-08-21 incident is that path. So the
;; credential state is generated with a floor on BOTH values, and P1 is checked
;; on every run regardless.
;;
;; The four log states are generated too, with a floor on each, because
;; invariant 2 quantifies over "the three conditions" plus the measurable case
;; that must still report a real number - a runner that only produced sentinels
;; could pass while a working age had been broken into "unknown".
;;
;; Runs are deliberately modest (default 48): each one forks the real POSIX
;; script against a real temp checkout. The generator covers a small discrete
;; state space exhaustively rather than sampling a large one, so more runs buy
;; repetition, not coverage.
;;
;; Non-vacuity PROVEN at authoring time (2026-08-22), each break applied to the
;; real script, restored, counts MEASURED (seed 1011, 48 runs):
;;   - swarm resolution moved back inside the credential branch .. P1 96
;;   - the raw sentinel printed again ............................ P2 76, P4 38
;;   - one shared reason for all three conditions ................ P3 54
;;   - EVERY age rendered as "unknown" ........................... P4 10
;; Every number is the measured count, not an estimate.
;;
;; The last break is the one worth reading. Rendering every age as "unknown"
;; satisfies P2 completely - no sentinel ever reaches a human - while destroying
;; the measurement that already worked. P4 is the only thing that catches it,
;; which is why the property is stated in BOTH directions: an unmeasurable age
;; must render as a word, and a measurable one must still render as a number.

(ns bl1011-freshness-attribution-property-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 48))
(def failures (atom []))
(def coverage (atom {:log-absent 0 :no-heartbeat-line 0 :unparseable-timestamp 0
                     :stale-heartbeat 0 :creds-set 0 :creds-unset 0
                     :identity-present 0 :identity-absent 0}))

(def script (str (fs/path (fs/parent (fs/parent (fs/canonicalize *file*))) "daemon_log_freshness_check.sh")))
(def conf (str (fs/path (fs/parent (fs/parent (fs/canonicalize *file*))) "daemon_log_freshness.conf")))
(def live-scripts-dir (str (fs/parent (fs/parent (fs/canonicalize *file*)))))

;; Each generated root gets its OWN conf naming ONLY handoffd - the same
;; per-fixture isolation BL-1012's step handlers settled on. The shipped conf
;; also lists babysitterd, whose log is absent in every generated checkout, so
;; using it would emit a second log-absent violation on every run and drown the
;; condition actually under test (it did, during authoring: the stale-heartbeat
;; runs were being judged against babysitterd's log-absent line). Pinning the
;; conf also keeps these properties independent of an ops threshold change.
(def fixture-conf-line
  "handoffd|120|.swarmforge/daemon/handoffd.log|.swarmforge/daemon/handoffd.pid|start_handoff_daemon.sh\n")

;; Fail loudly if either is not where this runner thinks it is. `:continue
;; true` below would otherwise swallow a bad path into an empty announce file,
;; and every property would "hold" against a script that never ran - the exact
;; vacuous pass this runner exists to rule out. (It did, during authoring: a
;; wrong path walk made all 48 runs produce nothing.)
(doseq [f [script conf]]
  (when-not (fs/exists? f)
    (binding [*out* *err*] (println (str "FATAL: not found: " f)))
    (System/exit 2)))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) (max 1 n)) (step s)])

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(def log-states [:log-absent :no-heartbeat-line :unparseable-timestamp :stale-heartbeat])
(def swarm-pool ["primary" "second" "third" "swarm-x"])

(def stale-epoch 1787306400)   ; 2026-08-21T10:00:00Z, pinned - never a live clock
;; Pinned by computation, not by hand: an epoch guessed wrong lands the clock
;; BEFORE the heartbeat, the age goes negative, nothing alarms, and P0 is the
;; only thing standing between that and a runner that silently proves nothing.
;; That is exactly what happened while writing this.

;; BL-1420: the registry guard's second arm (BL-784) walks scripts-dir on
;; disk for *_supervisor.bb with no seam - a conf naming only handoffd is
;; refused the instant one exists there, which is why this runner's 48 real
;; subprocess calls per run have been silently refused since 2026-08-27
;; (:continue true below swallowed the refusal into an empty announce).
;; One conf row + a fresh heartbeat per script the SAME glob the guard
;; walks finds - never a hand-written count - plus the FRESHNESS_REQUIRED
;; registry the guard's first arm reads.
(defn- supervisor-names [scripts-dir]
  (->> (fs/glob scripts-dir "*_supervisor.bb")
       (map #(str (fs/file-name %)))
       (map #(subs % 0 (- (count %) (count ".bb"))))
       sort))

(defn- iso-at [epoch-secs]
  (-> (java.time.Instant/ofEpochSecond epoch-secs)
      .toString))

(defn- write-guard-satisfying-rows!
  [root {:keys [scripts-dir now-epoch ceiling-secs required-names]
        :or {scripts-dir live-scripts-dir ceiling-secs 600 required-names ["handoffd"]}}]
  (let [daemon-dir (fs/path root ".swarmforge" "daemon")]
    (fs/create-dirs daemon-dir)
    (doseq [name (supervisor-names scripts-dir)]
      (spit (str (fs/path daemon-dir (str name ".log"))) (str (iso-at now-epoch) " heartbeat\n"))
      (spit (str (fs/path root "freshness.conf"))
            (str name "|" ceiling-secs "|.swarmforge/daemon/" name ".log|.swarmforge/daemon/" name ".pid|noop.sh\n")
            :append true))
    (spit (str (fs/path root "freshness_required.conf")) (str (str/join "\n" required-names) "\n"))))

(defn- build-checkout! [root {:keys [log-state swarm identity? now]}]
  (fs/create-dirs (fs/path root ".swarmforge" "daemon"))
  (spit (str (fs/path root "freshness.conf")) fixture-conf-line)
  (write-guard-satisfying-rows! root {:now-epoch now})
  (when identity?
    (spit (str (fs/path root ".swarmforge" "swarm-identity"))
          (str "swarm_name\t" swarm "\nswarm_mode\tautonomous\n")))
  (let [log (str (fs/path root ".swarmforge" "daemon" "handoffd.log"))]
    (case log-state
      :log-absent nil
      :no-heartbeat-line (spit log "2026-08-21T10:00:00Z handoffd started\n")
      :unparseable-timestamp (spit log "not-a-timestamp handoffd heartbeat\n")
      :stale-heartbeat (spit log "2026-08-21T10:00:00Z handoffd heartbeat\n"))))

;; BL-1420 invariant 2: an unexpected checker exit is a failed run naming the
;; stderr, never an empty observation. `:continue true` alone used to let a
;; registry-guard refusal (exit 1, before any measurement) through as a
;; silent empty announce, and every property held VACUOUSLY over zero
;; violations - only the coverage floors eventually tripped, and only at
;; high run counts. `:exit` is checked immediately after (:continue true is
;; kept only so THIS function decides what a non-zero exit means, rather
;; than babashka throwing before it can be reported with context).
(defn- run-checker! [root {:keys [creds?]} now]
  (let [env (cond-> {"FRESHNESS_ROOT" root
                     "FRESHNESS_CONF" (str (fs/path root "freshness.conf"))
                     "FRESHNESS_REQUIRED" (str (fs/path root "freshness_required.conf"))
                     "FRESHNESS_NOW_EPOCH" (str now)
                     "FRESHNESS_INCIDENT_FILE" (str (fs/path root "incidents.log"))
                     "FRESHNESS_COOL_OFF_SECS" "300"
                     "FRESHNESS_LOAD" "1"
                     "FRESHNESS_CORES" "1"
                     "PATH" (System/getenv "PATH")
                     "HOME" root
                     "FRESHNESS_ANNOUNCE_CMD" (str "printf '%s\\n' \"$1\" >> \"" root "/announces.log\"")
                     "FRESHNESS_KILL_CMD" "true"
                     "FRESHNESS_START_CMD" "true"}
              creds? (merge {"TELEGRAM_BOT_TOKEN" "already-set" "TELEGRAM_CHAT_ID" "12345"}))
        result (process/sh {:extra-env env :continue true} "/bin/sh" script)]
    (if (zero? (:exit result))
      {:ok? true
       :announced (let [f (str (fs/path root "announces.log"))] (if (fs/exists? f) (slurp f) ""))
       :incidents (let [f (str (fs/path root "incidents.log"))] (if (fs/exists? f) (slurp f) ""))}
      {:ok? false :stderr (:err result)})))

(loop [i 0 s 1011]
  (when (< i runs)
    (let [[ls s1] (gen-int s (count log-states))
          log-state (nth log-states ls)
          [sw s2] (gen-int s1 (count swarm-pool))
          [ident s3] (gen-int s2 4)                 ; ~3 in 4 have an identity file
          identity? (not (zero? ident))
          [cr s4] (gen-int s3 2)
          creds? (zero? cr)
          swarm (if identity? (nth swarm-pool sw) "primary")   ; no file -> the default
          spec {:log-state log-state :swarm swarm :identity? identity? :creds? creds?}
          ;; A stale heartbeat must be genuinely past the threshold, so the
          ;; violation actually fires - a run that never alarms would assert
          ;; over an empty file and pass vacuously.
          now (if (= log-state :stale-heartbeat) (+ stale-epoch 300) 1800000000)
          root (str (fs/create-temp-dir {:prefix "bl1011-prop-"}))]
      (try
        (build-checkout! root (assoc spec :now now))
        (let [{:keys [ok? announced incidents stderr]} (run-checker! root spec now)]
         (if-not ok?
           ;; BL-1420 invariant 2: an unexpected checker exit is a failed
           ;; run naming the stderr, never an empty observation folded into
           ;; the properties below (which would then hold vacuously, exactly
           ;; the registry-guard refusal this ticket exists to stop hiding).
           (report! "P-checker (the checker must exit 0)" s spec
                    (str "checker exited non-zero; stderr=" (pr-str stderr)))
           (do
          (swap! coverage update log-state inc)
          (swap! coverage update (if creds? :creds-set :creds-unset) inc)
          (swap! coverage update (if identity? :identity-present :identity-absent) inc)

          ;; Guard against a vacuous run: if nothing alarmed, every assertion
          ;; below is trivially satisfiable and the property proves nothing.
          (if-not (str/includes? announced "FRESHNESS_VIOLATION")
            (report! "P0 (the generator must actually produce a violation)" s spec
                     (str "no FRESHNESS_VIOLATION announced; announces=" (pr-str announced)))
            (do
              ;; ── P1 (invariant 1): self-identifying, on BOTH channels and on
              ;; EITHER credential path.
              (when-not (str/includes? announced (str "swarm=" swarm))
                (report! "P1 (invariant 1: every announced line names its swarm)" s spec
                         (str "expected swarm=" swarm " in: " announced)))
              (when-not (str/includes? incidents (str "swarm=" swarm))
                (report! "P1 (invariant 1: every durable incident record names its swarm)" s spec
                         (str "expected swarm=" swarm " in: " incidents)))

              ;; ── P2 (invariant 2): no raw sentinel reaches a human, on either
              ;; channel. Stated as absence of the literal, which is what an
              ;; operator would actually see.
              (when (str/includes? announced "999999999")
                (report! "P2 (invariant 2: no raw sentinel in an announced line)" s spec announced))
              (when (str/includes? incidents "999999999")
                (report! "P2 (invariant 2: no raw sentinel in a durable record)" s spec incidents))

              ;; ── P3 (invariant 2): every violation states WHICH condition
              ;; fired, and it is the right one for the state generated.
              (let [want (name log-state)]
                (when-not (str/includes? announced (str "reason=" want))
                  (report! "P3 (invariant 2: the announced line states which condition fired)" s spec
                           (str "expected reason=" want " in: " announced)))
                (when-not (str/includes? incidents (str "reason=" want))
                  (report! "P3 (invariant 2: the durable record states which condition fired)" s spec
                           (str "expected reason=" want " in: " incidents))))

              ;; ── P4: a MEASURABLE age must still render as a number. Without
              ;; this, replacing every age with "unknown" would satisfy P2.
              (when (= log-state :stale-heartbeat)
                (when-not (str/includes? announced "age_secs=300")
                  (report! "P4 (a real age is still reported as a number)" s spec announced)))
              ;; ...and an unmeasurable one must NOT.
              (when (not= log-state :stale-heartbeat)
                (when-not (str/includes? announced "age_secs=unknown")
                  (report! "P4 (an unmeasurable age renders as a word, not a number)" s spec announced))))))))
        (finally
          ;; Removed in a finally, never only after the last assertion.
          (fs/delete-tree root)))
      (recur (inc i) s4))))

(doseq [[k floor] {:log-absent 6 :no-heartbeat-line 6 :unparseable-timestamp 6 :stale-heartbeat 6
                   :creds-set 12 :creds-unset 12 :identity-present 20 :identity-absent 4}]
  (when (< (get @coverage k 0) floor)
    (swap! failures conj (str "FAIL coverage: the generator reached " k " only "
                              (get @coverage k 0) " time(s), floor " floor))))

(if (seq @failures)
  (do (doseq [f @failures] (binding [*out* *err*] (println f)))
      (println (str "\n" (count @failures) " failure(s)"))
      (System/exit 1))
  (println (str "bl1011 freshness-attribution properties: " runs " runs, coverage " (pr-str @coverage)
                "\nALL PROPERTIES HOLD")))
