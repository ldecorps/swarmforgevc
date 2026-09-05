#!/usr/bin/env bb
;; BL-1413 property test (coder-authored, two DECLARED invariants) over the
;; REAL daemon_log_freshness_check.sh / heartbeat_age_secs - run as a
;; subprocess against generated checkouts, never a reimplementation of the
;; shell logic in Clojure. The defect was in which BYTES a grep call saw;
;; only the real script can answer that.
;;
;;   Invariant 1: "The measured age of a log is NOW minus the timestamp of
;;   the newest line containing the heartbeat token anywhere in the file,
;;   for every byte sequence the file may contain (NUL, partial line,
;;   invalid UTF-8); a byte can only ever make one line unparseable, never
;;   hide the lines after it."
;;
;;   Invariant 2: "The check never restarts or announces a daemon whose
;;   measured age is within its effective threshold; a line that is
;;   unparseable is skipped, never turned into a sentinel while a newer
;;   parseable heartbeat exists."
;;
;; REACH, asserted rather than hoped for (BL-654's generator-reach clause):
;; every noise placement (none / a NUL-filled line before the real newest
;; heartbeat / a NUL-filled line after it / a torn-timestamp line AFTER it,
;; forcing the fallback walk) and both threshold sides (fresh / stale) must
;; each be hit at least once, or the run fails closed on coverage.
;;
;; CONF: the SHIPPED daemon_log_freshness.conf/_required.conf, never a
;; scoped fixture conf - BL-784's registry guard (called unconditionally by
;; the real checker) scans the real swarmforge/scripts/*_supervisor.bb files
;; on disk, which a minimal custom conf can never satisfy. DISCOVERED WHILE
;; AUTHORING THIS: BL-1011's own pre-existing property runner
;; (bl1011_freshness_attribution_property_runner.bb) and its acceptance
;; feature are both silently broken by exactly this gap, post-dating BL-784 -
;; every run reports "no FRESHNESS_VIOLATION announced" because the guard's
;; refusal is swallowed by :continue true. Recorded in this ticket's evidence
;; for the specifier to triage; not this ticket's fix (BL-1413 is scoped to
;; heartbeat_age_secs, not the registry guard).
;;
;; Non-vacuity PROVEN at authoring time, each break applied to the real
;; script, restored, counts MEASURED - see backlog evidence for the exact
;; numbers so this comment does not rot.

(ns bl1413-freshness-nul-byte-property-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 40))
(def failures (atom []))
(def coverage (atom {:noise-none 0 :noise-nul-before 0 :noise-nul-after 0 :noise-torn-after 0
                      :fresh 0 :stale 0}))

(def scripts-dir (str (fs/parent (fs/canonicalize *file*))))
(def scripts-root (str (fs/parent (fs/path scripts-dir))))
(def checker (str (fs/path scripts-root "daemon_log_freshness_check.sh")))
(def probe (str (fs/path scripts-dir "lib" "bl1413_heartbeat_age_probe.sh")))

;; Fail loudly if either is not where this runner thinks it is - a wrong
;; path walk would otherwise make every property "hold" against a script
;; that never ran (the exact vacuous pass BL-1011's own runner header warns
;; about, and the same class of bug now hiding it - see the CONF note above).
(doseq [f [checker probe]]
  (when-not (fs/exists? f)
    (binding [*out* *err*] (println (str "FATAL: not found: " f)))
    (System/exit 2)))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) (max 1 n)) (step s)])

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(def noise-kinds [:none :nul-before :nul-after :torn-after])
(def now-epoch 1700000000) ; pinned, never a live clock

(defn- iso-at [offset-secs]
  (str (java.time.Instant/ofEpochSecond (- now-epoch offset-secs))))

(defn- nul-bytes [n] (apply str (repeat n (char 0))))

(defn- build-log-content [{:keys [noise-kind age old-count]}]
  (let [old-lines (map #(str (iso-at (+ age 1000 (* 100 %))) " heartbeat\n") (range old-count))
        canonical (str (iso-at age) " heartbeat\n")
        nul (nul-bytes 3)
        torn "not-a-timestamp heartbeat\n"]
    (apply str
           (concat old-lines
                   (case noise-kind
                     :none [canonical]
                     :nul-before [nul "\n" canonical]
                     :nul-after [canonical nul]
                     :torn-after [canonical torn])))))

(defn- run-checker! [root now]
  (let [env {"FRESHNESS_ROOT" root
             "FRESHNESS_NOW_EPOCH" (str now)
             "FRESHNESS_INCIDENT_FILE" (str (fs/path root "incidents.log"))
             "FRESHNESS_COOL_OFF_SECS" "300"
             "FRESHNESS_LOAD" "1"
             "FRESHNESS_CORES" "1"
             "PATH" (System/getenv "PATH")
             "HOME" root
             "FRESHNESS_ANNOUNCE_CMD" (str "printf '%s\\n' \"$1\" >> \"" root "/announces.log\"")
             "FRESHNESS_KILL_CMD" (str "printf '%s\\n' \"$1\" >> \"" root "/kills.log\"")
             "FRESHNESS_START_CMD" (str "printf '%s %s\\n' \"$1\" \"$2\" >> \"" root "/starts.log\"")}]
    (process/sh {:extra-env env :continue true} "/bin/sh" checker)
    {:announced (let [f (str (fs/path root "announces.log"))] (if (fs/exists? f) (slurp f) ""))
     :starts (let [f (str (fs/path root "starts.log"))] (if (fs/exists? f) (slurp f) ""))
     :kills (let [f (str (fs/path root "kills.log"))] (if (fs/exists? f) (slurp f) ""))}))

(defn- probe-age! [log-path now]
  (let [{:keys [out]} (process/sh {:extra-env {"PATH" (System/getenv "PATH") "NOW" (str now)}}
                                   "/bin/sh" probe checker log-path)
        [age reason] (str/split (str/trim out) #" ")]
    {:age (parse-long age) :reason reason}))

(loop [i 0 s 1413]
  (when (< i runs)
    (let [[nk s1] (gen-int s (count noise-kinds))
          noise-kind (nth noise-kinds nk)
          [st s2] (gen-int s1 2)
          stale? (zero? st)
          [ao s3] (gen-int s2 1880)
          age (if stale? (+ 121 ao) (mod ao 120)) ; stale: 121..2000; fresh: 0..119 (handoffd|120)
          [oc s4] (gen-int s3 3)                  ; 0..2 older heartbeat lines further back
          spec {:noise-kind noise-kind :stale? stale? :age age :old-count oc}
          root (str (fs/create-temp-dir {:prefix "bl1413-prop-"}))]
      (try
        (fs/create-dirs (fs/path root ".swarmforge" "daemon"))
        (fs/create-dirs (fs/path root ".swarmforge" "babysitterd"))
        ;; babysitterd is in the shipped required registry with no pid-file
        ;; skip (only *_supervisor rows get that) - a fresh heartbeat keeps
        ;; it from adding an unrelated violation to every run.
        (spit (str (fs/path root ".swarmforge" "babysitterd" "babysitterd.log")) (str (iso-at 0) " heartbeat\n"))
        (let [log-path (str (fs/path root ".swarmforge" "daemon" "handoffd.log"))]
          (spit log-path (build-log-content spec))
          (swap! coverage update (keyword (str "noise-" (name noise-kind))) inc)
          (swap! coverage update (if stale? :stale :fresh) inc)

          ;; ── Invariant 1: the probed age is EXACTLY the canonical
          ;; heartbeat's real age and reason, regardless of noise placement -
          ;; a NUL byte or a torn line can never hide it or masquerade as it.
          (let [{:keys [age reason]} (probe-age! log-path now-epoch)]
            (when-not (= age (:age spec))
              (report! "P1 (invariant 1: measured age is exactly the newest heartbeat's real age)" s spec
                       (str "probed age=" age " reason=" reason ", expected age=" (:age spec))))
            (when-not (= reason "stale-heartbeat")
              (report! "P1 (invariant 1: reason is stale-heartbeat, never a sentinel reason)" s spec
                       (str "probed reason=" reason))))

          ;; ── Invariant 2: restart/announce iff the age is past the
          ;; effective threshold (120s, handoffd's shipped base at
          ;; contention factor 1), naming the real age - never suppressed by
          ;; noise, never fired on noise alone.
          (let [{:keys [announced starts]} (run-checker! root now-epoch)]
            (if stale?
              (do
                (when-not (str/includes? starts "start_handoff_daemon.sh")
                  (report! "P2 (invariant 2: a genuinely stale heartbeat still restarts)" s spec
                           (str "starts=" (pr-str starts))))
                (when-not (str/includes? announced (str "age_secs=" (:age spec)))
                  (report! "P2 (invariant 2: the announce names the real age, never the sentinel)" s spec
                           (str "announced=" (pr-str announced))))
                (when (str/includes? announced "999999999")
                  (report! "P2 (invariant 2: no raw sentinel reaches the announce)" s spec announced)))
              (do
                (when-not (= starts "")
                  (report! "P2 (invariant 2: a fresh heartbeat within threshold is never restarted)" s spec
                           (str "starts=" (pr-str starts))))
                (when-not (= announced "")
                  (report! "P2 (invariant 2: a fresh heartbeat within threshold is never announced)" s spec
                           (str "announced=" (pr-str announced))))))))
        (finally
          (fs/delete-tree root)))
      (recur (inc i) s4))))

(doseq [[k floor] {:noise-none 3 :noise-nul-before 3 :noise-nul-after 3 :noise-torn-after 3
                    :fresh 6 :stale 6}]
  (when (< (get @coverage k 0) floor)
    (swap! failures conj (str "FAIL coverage: the generator reached " k " only "
                              (get @coverage k 0) " time(s), floor " floor))))

(if (seq @failures)
  (do (doseq [f @failures] (binding [*out* *err*] (println f)))
      (println (str "\n" (count @failures) " failure(s)"))
      (System/exit 1))
  (println (str "bl1413 freshness-nul-byte properties: " runs " runs, coverage " (pr-str @coverage)
                "\nALL PROPERTIES HOLD")))
