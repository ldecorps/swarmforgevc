#!/usr/bin/env bb
;; BL-1491 coder pass (BL-654 Invariants): PROPERTY tests encoding this
;; ticket's two declared invariants:
;;
;;   1. "Every alarm-and-halt leaves exactly one kill-all-audit row naming
;;      the supervisor and its verdict and exactly one availability stop
;;      record of class swarm-stop whose source names the supervisor, both
;;      written BEFORE the first role session is killed." P1 drives the
;;      REAL handoffd_supervisor.bb record-halt! (never a reimplementation)
;;      against a fresh fixture root per run (daemon-dir/kill-all-audit-file/
;;      project-root redirected via with-redefs, never a real project root)
;;      across randomly generated verdict keywords, asserting exactly one
;;      row/record and correct naming. P1b reuses the REAL record-halt! as
;;      daemon-alarm-lib/alarm-and-halt!'s :record-halt! adapter with a
;;      halt-swarm! stub that samples both files' existence AT THE MOMENT it
;;      is called, proving write-ahead ordering across the same random
;;      verdicts.
;;   2. "A record that cannot be written never prevents the halt... the
;;      failure log, the alarm and the halt are not [best-effort]." P2
;;      drives the PURE daemon-alarm-lib/alarm-and-halt! with a fake
;;      :record-halt! that always throws a randomly generated exception,
;;      across random verdicts, asserting halt-swarm! and write-status!
;;      (state "halted") still run every time.
;;
;; Same deterministic-seeded-LCG shape as bl1405_hand_built_land_records_
;; approval_property_runner.bb (BL-472: no mutation/property tooling wired
;; for Babashka).
;;
;; Non-vacuity proven by hand at authoring time (restored before this
;; commit; `git diff` confirmed exact restoration):
;;   - P1 was run against a deliberately broken write-kill-all-audit-row!
;;     that appended the row WITHOUT the verdict text - failed on every
;;     generated case (the row-names-reason assertion never matched).
;;   - P1b was run against alarm-and-halt! with the record-halt! call moved
;;     to AFTER halt-swarm! - failed on every generated case (the sampled
;;     bothExistAtHalt read false for at least one of the two files).
;;   - P2 was run against alarm-and-halt! with the record-halt! try/catch
;;     removed - failed on every generated case (the throw propagated and
;;     halt-swarm!/write-status! were never reached).

(ns bl1491-halt-records-itself-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def scripts-dir (str (fs/parent (fs/canonicalize *file*)) "/.."))

;; handoffd_supervisor.bb unconditionally calls (-main) at load time, which
;; (with no --check-once flag) enters its supervision while-loop. Pre-seed
;; stop-file so that loop is a no-op at load (same trick the BL-1490/BL-1491
;; acceptance fixture CLIs rely on), then remove it.
(def boot-root (str (fs/create-temp-dir {:prefix "bl1491-prop-boot-"})))
(def boot-daemon-dir (fs/path boot-root ".swarmforge" "daemon"))
(fs/create-dirs boot-daemon-dir)
(def boot-stop-file (fs/path boot-daemon-dir "stop"))
(spit (str boot-stop-file) "")
(binding [*command-line-args* [boot-root]]
  (load-file (str (fs/path scripts-dir "handoffd_supervisor.bb"))))
(fs/delete-if-exists boot-stop-file)
(fs/delete-tree boot-root)

(load-file (str (fs/path scripts-dir "daemon_alarm_lib.bb")))
(load-file (str (fs/path scripts-dir "availability_ledger_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 150))
(def failures (atom []))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- pick [s coll] (let [[n s'] (gen-int s (count coll))] [(nth coll n) s']))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop gen-fn pred-fn]
  (loop [i 0 s 31]
    (when (< i runs)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result)
          (report! prop s input (str result)))
        (recur (inc i) s')))))

;; A wide pool, deliberately not limited to :dead/:stalled - the invariant's
;; own wording ("its verdict", not "dead or stalled") makes no claim the
;; verdict is one of those two specific keywords.
(def verdict-pool [:dead :stalled :wedged :unresponsive :timeout :flaky-heartbeat])

;; ── P1: record-halt! (the REAL writer) leaves exactly one row/record,
;;    correctly named, on a fresh fixture root ──────────────────────────────

(defn gen-p1 [s]
  (let [[reason s1] (pick s verdict-pool)]
    [{:reason reason} s1]))

(check-all "P1: record-halt! leaves exactly one correctly-named kill-all-audit row and availability stop record"
  gen-p1
  (fn [{:keys [reason]}]
    (let [root (str (fs/create-temp-dir {:prefix "bl1491-p1-"}))
          daemon-dir (fs/path root ".swarmforge" "daemon")
          audit-file (fs/path daemon-dir "kill-all-audit.log")]
      (try
        (with-redefs [handoffd-supervisor/daemon-dir daemon-dir
                      handoffd-supervisor/kill-all-audit-file audit-file
                      handoffd-supervisor/project-root root]
          (handoffd-supervisor/record-halt! reason))
        (let [audit-lines (if (fs/exists? audit-file)
                             (remove str/blank? (str/split-lines (slurp (str audit-file))))
                             [])
              records (availability-ledger-lib/read-records (str root "/.swarmforge"))
              stop-records (filter #(= "stop" (:event %)) records)]
          (cond
            (not= 1 (count audit-lines))
            (str "expected exactly 1 audit line, got " (count audit-lines) ": " (pr-str audit-lines))

            (not (and (str/includes? (first audit-lines) "handoffd_supervisor")
                      (str/includes? (first audit-lines) (name reason))))
            (str "audit row does not name handoffd_supervisor and " (name reason) ": " (first audit-lines))

            (not= 1 (count stop-records))
            (str "expected exactly 1 stop record, got " (count stop-records) ": " (pr-str stop-records))

            (not= "swarm-stop" (:class (first stop-records)))
            (str "expected class swarm-stop, got " (:class (first stop-records)))

            (not= "handoffd_supervisor" (:source (first stop-records)))
            (str "expected source handoffd_supervisor, got " (:source (first stop-records)))

            :else true))
        (finally (fs/delete-tree root))))))

;; ── P1b: record-halt!, wired as alarm-and-halt!'s :record-halt! adapter,
;;    always completes before halt-swarm! is invoked ─────────────────────────

(check-all "P1b: record-halt! runs write-ahead of halt-swarm! (both files already exist at halt time)"
  gen-p1
  (fn [{:keys [reason]}]
    (let [root (str (fs/create-temp-dir {:prefix "bl1491-p1b-"}))
          daemon-dir (fs/path root ".swarmforge" "daemon")
          audit-file (fs/path daemon-dir "kill-all-audit.log")
          both-exist (atom nil)]
      (try
        (with-redefs [handoffd-supervisor/daemon-dir daemon-dir
                      handoffd-supervisor/kill-all-audit-file audit-file
                      handoffd-supervisor/project-root root]
          (daemon-alarm-lib/alarm-and-halt!
           {:reason reason
            :status {}
            :now-iso! (fn [] "2026-07-07T08:00:00Z")
            :log-tail! (fn [] [])
            :role-counts! (fn [] [])
            :write-failure-log! (fn [_content] (str (fs/path daemon-dir "failure.log")))
            :send-email! (fn [_subject _text _attachments] {:success true})
            :record-halt! handoffd-supervisor/record-halt!
            :halt-swarm! (fn []
                           (reset! both-exist
                                   {:audit (and (fs/exists? audit-file) (not (str/blank? (slurp (str audit-file)))))
                                    :availability (some #(= "stop" (:event %))
                                                         (availability-ledger-lib/read-records (str root "/.swarmforge")))}))
            :write-status! (fn [_status] nil)}))
        (cond
          (nil? @both-exist) "halt-swarm! was never invoked"
          (not (:audit @both-exist)) (str "kill-all-audit row did not exist at halt time: " (pr-str @both-exist))
          (not (:availability @both-exist)) (str "availability stop record did not exist at halt time: " (pr-str @both-exist))
          :else true)
        (finally (fs/delete-tree root))))))

;; ── P2: a throwing record-halt! never blocks halt-swarm!/write-status! ──────

(def exception-pool
  [(fn [reason] (ex-info "record-halt boom" {:reason reason}))
   (fn [reason] (RuntimeException. (str "unwritable telemetry dir for " (name reason))))
   (fn [_reason] (ex-info "" {}))])

(defn gen-p2 [s]
  (let [[reason s1] (pick s verdict-pool)
        [exc-fn s2] (pick s1 exception-pool)]
    [{:reason reason :exc-fn exc-fn} s2]))

(check-all "P2: a throwing record-halt! never prevents halt-swarm!/write-status!"
  gen-p2
  (fn [{:keys [reason exc-fn]}]
    (let [halted (atom false)
          written (atom nil)]
      (daemon-alarm-lib/alarm-and-halt!
       {:reason reason
        :status {}
        :now-iso! (fn [] "2026-07-07T08:00:00Z")
        :log-tail! (fn [] [])
        :role-counts! (fn [] [])
        :write-failure-log! (fn [_content] "/dev/null")
        :send-email! (fn [_subject _text _attachments] {:success true})
        :record-halt! (fn [reason] (throw (exc-fn reason)))
        :halt-swarm! (fn [] (reset! halted true))
        :write-status! (fn [status] (reset! written status))})
      (cond
        (not @halted) "halt-swarm! was never invoked after record-halt! threw"
        (not= "halted" (:state @written)) (str "expected terminal state halted, got " (pr-str @written))
        :else true))))

;; ── generator coverage (asserted reachability floors) ────────────────────────

(defn- sweep-coverage [seed0 gen-fn]
  (loop [i 0 s seed0 acc []]
    (if (= i runs) acc (let [[in s'] (gen-fn s)] (recur (inc i) s' (conj acc in))))))

(let [p1-inputs (sweep-coverage 31 gen-p1)
      p2-inputs (sweep-coverage 31 gen-p2)
      distinct-verdicts-p1 (count (distinct (map :reason p1-inputs)))
      distinct-verdicts-p2 (count (distinct (map :reason p2-inputs)))
      distinct-exc-p2 (count (distinct (map (comp class #(% :dead) :exc-fn) p2-inputs)))]
  (println (str "  generator coverage: p1-distinct-verdicts=" distinct-verdicts-p1
                " p2-distinct-verdicts=" distinct-verdicts-p2
                " p2-distinct-exception-types=" distinct-exc-p2))
  (when (< distinct-verdicts-p1 3)
    (report! "COVERAGE p1-verdicts" 31 p1-inputs "fewer than 3 distinct verdicts generated"))
  (when (< distinct-verdicts-p2 3)
    (report! "COVERAGE p2-verdicts" 31 p2-inputs "fewer than 3 distinct verdicts generated"))
  (when (< distinct-exc-p2 2)
    (report! "COVERAGE p2-exceptions" 31 p2-inputs "fewer than 2 distinct exception types generated")))

;; ── report ────────────────────────────────────────────────────────────────
(println (str "bl1491 halt-records-itself properties: " runs " runs each"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
