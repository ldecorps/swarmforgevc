#!/usr/bin/env bb
;; BL-1492 coder pass (BL-654 Invariants): PROPERTY tests encoding this
;; ticket's two declared invariants:
;;
;;   1. "A :stalled or :dead verdict never kills a role session while the
;;      restart budget has headroom: the daemon is restarted through the
;;      one start owner (start_handoff_daemon.sh, BL-690), and every
;;      restart, successful or failed, is alarmed and recorded in the
;;      status file." P1 drives the REAL handoffd_supervisor.bb
;;      respond-to-verdict! (never a reimplementation) with a randomly
;;      generated verdict and 0..budget-count-1 prior restart-history
;;      entries all inside the window (headroom remains), stubbing only
;;      the adapters that would otherwise touch a real process/network -
;;      halt-swarm!, start-daemon!, send-configured-alarm-email!,
;;      write-status! - and asserts halt-swarm! is never invoked,
;;      start-daemon! is invoked exactly once, exactly one alarm email
;;      names a restart, and restart_history grows by exactly one entry
;;      whose :result matches the stubbed start-daemon! outcome.
;;   2. "Budget exhaustion is BL-144's halt unchanged... and the budget
;;      re-arms only after a healthy-uptime window, never by the passage
;;      of time while the daemon keeps dying." P2 drives the same real
;;      wiring with budget-count..budget-count+2 prior restarts all still
;;      inside the window (the daemon "keeps dying") and asserts the
;;      unchanged BL-144 halt: start-daemon! never invoked, halt-swarm!
;;      invoked exactly once, terminal status state "halted". P3 is the
;;      formal half of "never by the passage of time": decide-response
;;      (pure) is proven time-translation-invariant - shifting every
;;      history timestamp AND now-ms by the same random offset never
;;      changes the verdict, since only relative recency (age = now - at)
;;      may ever matter, never an absolute calendar anchor.
;;
;; Same deterministic-seeded-LCG shape as
;; bl1491_halt_records_itself_property_runner.bb (BL-472: no
;; mutation/property tooling wired for Babashka).
;;
;; Non-vacuity proven by hand at authoring time (restored before this
;; commit; `git diff` confirmed exact restoration):
;;   - decide-response's final `(if (< (count recent) budget-count) ...)`
;;     was mutated to `<=` (off-by-one: allows one MORE restart than the
;;     real budget permits, halting one cycle too late) - caught by P2:
;;     every generated case with exactly budget-count prior entries now
;;     read :restart instead of :halt ("expected exactly one halt, got 0").
;;   - restart-daemon! (daemon_alarm_lib.bb) had its `(write-status! ...)`
;;     call removed - caught by P1: every generated case failed
;;     ("write-status! was never called - the restart was not recorded").
;;   - respond-to-verdict!'s `:halt` branch was replaced with a second call
;;     to restart-daemon! (the budget never actually escalates) - caught
;;     by P2: every generated case failed ("expected exactly one halt,
;;     got 0").
;;   - decide-response's window check was changed from `(< age
;;     budget-window-ms)` to `(< at budget-window-ms)` (an absolute-time
;;     bug: comparing the raw timestamp instead of its age) - caught by
;;     P3: 15/150 generated cases flipped verdict under the shift (a
;;     minority, since the bug only bites when an entry's raw :at value
;;     straddles the window threshold differently before and after the
;;     shift; P1/P2 did not catch this one, since their own generators
;;     only ever produce large positive :at values far above the window
;;     threshold either way - first caught by fixing gen-int itself,
;;     below, which originally truncated to the LCG's low 15 bits and so
;;     never generated an :at/offset combination able to straddle the
;;     threshold in either direction: 0/20000 diffs before the fix,
;;     15/150 after).

(ns bl1492-restart-in-place-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def scripts-dir (str (fs/parent (fs/canonicalize *file*)) "/.."))

;; handoffd_supervisor.bb unconditionally calls (-main) at load time, which
;; (with no --check-once flag) enters its supervision while-loop. Pre-seed
;; stop-file so that loop is a no-op at load (same trick the BL-1490/BL-1491
;; property/acceptance fixtures rely on), then remove it.
(def boot-root (str (fs/create-temp-dir {:prefix "bl1492-prop-boot-"})))
(def boot-daemon-dir (fs/path boot-root ".swarmforge" "daemon"))
(fs/create-dirs boot-daemon-dir)
(def boot-stop-file (fs/path boot-daemon-dir "stop"))
(spit (str boot-stop-file) "")
(binding [*command-line-args* [boot-root]]
  (load-file (str (fs/path scripts-dir "handoffd_supervisor.bb"))))
(fs/delete-if-exists boot-stop-file)

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 150))
(def failures (atom []))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
;; BL-1492: unlike bl1491's own gen-int (`(mod (quot s 65536) n)`), this one
;; is used for LARGE moduli too (WINDOW-sized ranges, not just small pools) -
;; `quot s 65536` throws away all but the low 15 bits of the 31-bit LCG
;; state, so for any n bigger than 32768 the result is silently truncated to
;; 0..32767 regardless of n, an "astronomically rare deep state" generator
;; defect (BL-654's own named failure shape) that let P3 below pass 20000
;; runs against a live, reproducible mutant before this fix (confirmed by
;; hand: every generated :at/:now-ms/:offset landed within ~33000 of the
;; range's own minimum). Using the full state mod n covers the whole
;; requested range for both small pools and WINDOW-sized ranges alike.
(defn- gen-int [s n] [(mod s n) (step s)])
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

(def WINDOW handoffd-supervisor/restart-budget-window-ms)
(def BUDGET handoffd-supervisor/restart-budget-count)
(def verdict-pool [:dead :stalled])
(def NOW 100000000)

;; ── P1: headroom -> restart-in-place, no session touched, alarmed and
;;    recorded (Invariant 1) ─────────────────────────────────────────────────

(defn gen-history [s n]
  (loop [i 0 s s acc []]
    (if (= i n)
      [acc s]
      (let [[age s'] (gen-int s WINDOW)]
        (recur (inc i) s' (conj acc {:at (- NOW age) :result "succeeded"}))))))

(defn gen-p1 [s]
  (let [[verdict s1] (pick s verdict-pool)
        [n s2] (gen-int s1 BUDGET) ;; 0..BUDGET-1 prior restarts: headroom remains
        [succeeds-flag s3] (gen-int s2 2)
        [history s4] (gen-history s3 n)]
    [{:verdict verdict :history history :succeeds? (= 1 succeeds-flag)} s4]))

(check-all "P1: restart budget headroom -> restart-in-place, no session touched, alarmed and recorded"
  gen-p1
  (fn [{:keys [verdict history succeeds?]}]
    (let [halt-count (atom 0)
          start-count (atom 0)
          email-subjects (atom [])
          written-status (atom nil)]
      (with-redefs [handoffd-supervisor/now-ms (fn [] NOW)
                    handoffd-supervisor/now-iso (fn [] "2026-09-08T00:00:00Z")
                    handoffd-supervisor/halt-swarm! (fn [] (swap! halt-count inc))
                    handoffd-supervisor/start-daemon! (fn [] (swap! start-count inc) {:success succeeds?})
                    handoffd-supervisor/send-configured-alarm-email!
                    (fn [subject _text _attachments]
                      (swap! email-subjects conj subject)
                      {:success true})
                    handoffd-supervisor/write-status! (fn [status] (reset! written-status status))]
        (handoffd-supervisor/respond-to-verdict! verdict {:restart_history history}))
      (let [expected-result (if succeeds? "succeeded" "failed")
            after (:restart_history @written-status)]
        (cond
          (not= 0 @halt-count)
          (str "halt-swarm! was called " @halt-count " time(s) while the budget had headroom")

          (not= 1 @start-count)
          (str "start-daemon! was called " @start-count " time(s), expected exactly 1")

          (not= 1 (count @email-subjects))
          (str "expected exactly one alarm email, got " (count @email-subjects))

          (not (str/includes? (first @email-subjects) "restart"))
          (str "alarm email subject does not name a restart: " (pr-str (first @email-subjects)))

          (nil? after)
          "write-status! was never called - the restart was not recorded"

          (not= (inc (count history)) (count after))
          (str "expected restart_history to grow by exactly 1 (from " (count history)
               " to " (inc (count history)) "), got " (count after))

          (not= expected-result (:result (last after)))
          (str "expected the new entry's :result to be " expected-result ", got " (pr-str (last after)))

          :else true)))))

;; ── P2: budget exhausted, still dying (every entry recent) -> BL-144's
;;    halt, unchanged (Invariant 2, first half) ───────────────────────────────

(defn gen-p2 [s]
  (let [[verdict s1] (pick s verdict-pool)
        [extra s2] (gen-int s1 3) ;; 0..2 restarts beyond the budget
        [history s3] (gen-history s2 (+ BUDGET extra))]
    [{:verdict verdict :history history} s3]))

(check-all "P2: restart budget exhausted (still dying, every restart recent) -> BL-144's halt, unchanged"
  gen-p2
  (fn [{:keys [verdict history]}]
    (let [halt-count (atom 0)
          start-count (atom 0)
          written-status (atom nil)]
      (with-redefs [handoffd-supervisor/now-ms (fn [] NOW)
                    handoffd-supervisor/now-iso (fn [] "2026-09-08T00:00:00Z")
                    handoffd-supervisor/halt-swarm! (fn [] (swap! halt-count inc))
                    handoffd-supervisor/start-daemon! (fn [] (swap! start-count inc) {:success true})
                    handoffd-supervisor/send-configured-alarm-email!
                    (fn [_subject _text _attachments] {:success true})
                    handoffd-supervisor/write-status! (fn [status] (reset! written-status status))]
        (handoffd-supervisor/respond-to-verdict! verdict {:restart_history history}))
      (cond
        (not= 1 @halt-count) (str "expected exactly one halt, got " @halt-count)
        (not= 0 @start-count) (str "start-daemon! was called " @start-count " time(s) - the budget was exhausted")
        (not= "halted" (:state @written-status)) (str "expected terminal state halted, got " (pr-str @written-status))
        :else true))))

;; ── P3: decide-response depends only on relative recency, never on
;;    absolute time (Invariant 2, second half - the formal proof that mere
;;    passage of wall-clock time cannot re-arm the budget) ───────────────────

;; :at and now-ms are drawn from a range straddling budget-window-ms on both
;; sides (including negative values) - not derived from a single large NOW
;; constant - so a bug that compares an absolute :at (or now-ms) against
;; budget-window-ms directly, instead of the age (now-ms - at), actually has
;; a chance to flip its own verdict as the pair is shifted, the same way a
;; real bug would surface once the absolute clock crossed some threshold
;; independent of the true elapsed time.
(defn- gen-signed [s n]
  (let [[raw s'] (gen-int s (* 2 n))]
    [(- raw n) s']))

(defn gen-p3 [s]
  (let [[n s1] (gen-int s 5) ;; 0..4 history entries
        [history s2] (loop [i 0 s s1 acc []]
                       (if (= i n)
                         [acc s]
                         (let [[at s'] (gen-signed s (* 2 WINDOW))]
                           (recur (inc i) s' (conj acc {:at at})))))
        [now-ms s3] (gen-signed s2 (* 2 WINDOW))
        [offset s4] (gen-signed s3 (* 4 WINDOW))]
    [{:history history :now-ms now-ms :offset offset} s4]))

(check-all "P3: decide-response is time-translation-invariant - shifting every timestamp and now-ms by the same offset never changes the verdict"
  gen-p3
  (fn [{:keys [history now-ms offset]}]
    (let [base (handoffd-supervisor/decide-response {:restart-history history :now-ms now-ms
                                                      :budget-window-ms WINDOW :budget-count BUDGET})
          shifted-history (mapv #(update % :at + offset) history)
          shifted (handoffd-supervisor/decide-response {:restart-history shifted-history :now-ms (+ now-ms offset)
                                                         :budget-window-ms WINDOW :budget-count BUDGET})]
      (if (= base shifted)
        true
        (str "shifting every timestamp by " offset "ms changed the verdict: " base " -> " shifted)))))

;; ── generator coverage (asserted reachability floors) ────────────────────────

(defn- sweep-coverage [seed0 gen-fn]
  (loop [i 0 s seed0 acc []]
    (if (= i runs) acc (let [[in s'] (gen-fn s)] (recur (inc i) s' (conj acc in))))))

(let [p1-inputs (sweep-coverage 31 gen-p1)
      p2-inputs (sweep-coverage 31 gen-p2)
      p3-inputs (sweep-coverage 31 gen-p3)
      p1-distinct-verdicts (count (distinct (map :verdict p1-inputs)))
      p1-both-outcomes? (and (some :succeeds? p1-inputs) (some (complement :succeeds?) p1-inputs))
      p2-distinct-verdicts (count (distinct (map :verdict p2-inputs)))
      p3-base-verdicts (into #{}
                              (map (fn [{:keys [history now-ms]}]
                                     (handoffd-supervisor/decide-response
                                      {:restart-history history :now-ms now-ms
                                       :budget-window-ms WINDOW :budget-count BUDGET})))
                              p3-inputs)]
  (println (str "  generator coverage: p1-distinct-verdicts=" p1-distinct-verdicts
                " p1-both-outcomes=" p1-both-outcomes?
                " p2-distinct-verdicts=" p2-distinct-verdicts
                " p3-distinct-base-verdicts=" (count p3-base-verdicts)))
  (when (< p1-distinct-verdicts 2)
    (report! "COVERAGE p1-verdicts" 31 p1-inputs "fewer than 2 distinct verdicts generated"))
  (when-not p1-both-outcomes?
    (report! "COVERAGE p1-start-outcomes" 31 p1-inputs "start-daemon! outcome never varied across generated cases"))
  (when (< p2-distinct-verdicts 2)
    (report! "COVERAGE p2-verdicts" 31 p2-inputs "fewer than 2 distinct verdicts generated"))
  (when (< (count p3-base-verdicts) 2)
    (report! "COVERAGE p3-base-verdicts" 31 p3-inputs "generated cases never reached both :restart and :halt")))

;; ── report ────────────────────────────────────────────────────────────────
(try (fs/delete-tree boot-root) (catch Exception _ nil))
(println (str "bl1492 restart-in-place properties: " runs " runs each"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
