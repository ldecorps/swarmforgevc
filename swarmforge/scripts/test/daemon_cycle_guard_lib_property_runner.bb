#!/usr/bin/env bb
;; Property tests for daemon_cycle_guard_lib.bb (BL-967, declared invariants;
;; coder-authored per BL-654).
;;
;;   Invariant 1: "No single subprocess or file-I/O wait inside the daemon's
;;   poll cycle can silently exceed the freshness threshold: every such wait
;;   carries a bound well under the threshold, and hitting the bound is
;;   logged and survived - a wedged tmux/git/child process may cost one
;;   bounded wait, never the heartbeat." P1's executable core: over draws of
;;   child behavior constructed BY THE GENERATOR to straddle the bound
;;   (fast-and-clean, fast-and-failing, hung), sh! (a) returns within
;;   bound + slack even for a hung child, (b) reports exit 124 + fires
;;   on-timeout! naming the drawn context exactly when the child hung,
;;   (c) passes fast children through untouched (their own exit/out), and
;;   (d) never throws. The remainder of the invariant - that the DAEMON
;;   routes every in-cycle subprocess through this chokepoint - is wiring
;;   over ~60 call sites, not a pure module, so it is not a property over
;;   generated inputs; it IS executable, and is ENCODED as the structural
;;   closure gate in daemon_cycle_guard_lib_test_runner.bb: the transitive
;;   load-file closure from handoffd.bb (computed, never hand-listed) must
;;   reference no subprocess namespace outside this lib. (Architect bounce
;;   D2: the earlier stated reason claimed this held structurally with no
;;   gate, and was false - two in-cycle libs still spawned directly.) Also
;;   asserted end-to-end by acceptance scenario 01. File-I/O waits: the cycle's file
;;   reads are ordinary local files (no FIFOs/sockets); the subprocess pipe
;;   was the only blocking class observed (BL-057/BL-061 family) - also
;;   recorded as stated reason.
;;
;;   Invariant 2: "After a heavy cycle, the log alone localizes any stall to
;;   one sweep: each sweep in the heavy bundle emits a boundary line (sweep
;;   name + duration) even when it took no action... at bounded volume." P2:
;;   over generated bundles (idle, acting, and throwing sweeps mixed), (a)
;;   exactly ONE boundary line per sweep, in run order, each carrying its
;;   fake-clock duration; (b) THE LOCALIZATION PROPERTY ITSELF: for EVERY
;;   possible prefix cut of the emitted log (a stall can freeze the log at
;;   any point), the first bundle sweep whose boundary is missing from the
;;   prefix is exactly the sweep that ground truth says was running (or next
;;   to run) at that point; (c) volume is exactly (count sweeps) boundary
;;   lines - no more. The never-on-idle-ticks half is main-loop wiring
;;   (run-sweep! is only called in the heavy bundle) - acceptance scenario
;;   03 asserts it; stated reason here.
;;
;; BL-1021 (declared invariants, coder-authored per BL-654) - the same two
;; properties, restated over the mechanism BL-967's phrasing did not reach:
;;
;;   Invariant 1: "No subprocess the daemon spawns can block a sweep past the
;;   configured wait bound, AT ANY PROCESS DEPTH - a bound that cannot be
;;   observed firing is not a bound." BL-967's P1 drew only depth-1 children
;;   (the direct child hangs), and that is exactly the state the old bound
;;   handled: `(deref proc bound ...)` bounds the exit-code wait, so a hanging
;;   direct child always hit it. The live 2026-08-21 deadlock was at depth 2 -
;;   the direct child EXITED promptly and a process it spawned inherited the
;;   stdout/stderr write ends, so the pipe never reached EOF and the pump
;;   futures blocked unbounded AFTER the exit code arrived. P1 now draws the
;;   pipe-holder's DEPTH as a first-class dimension (1, 2, or 3) and the
;;   generator's coverage floor asserts depth>=2 is reached in bulk, never
;;   hoped for: a depth-1-only generator passes against the live defect, which
;;   is how it survived BL-967's suite.
;;
;;   Invariant 2: "A bounded-wait timeout is always announced: no subprocess
;;   call ends the cycle silently." P3 below. The pre-fix failure was silence
;;   in the strict sense - on-timeout! was never reached at all, so the live
;;   log showed a 165s dispatch-gap-sweep boundary and NO timeout line, and
;;   the operator had nothing to read. P3 runs each drawn child INSIDE
;;   run-sweep! and asserts the announcement is complete (event with the
;;   sweep's name, the exact command, the exact bound), corroborated in the
;;   returned :err, and that the owning sweep still emits its boundary - and,
;;   symmetrically, that a child that did NOT time out announces nothing.
;;
;; Non-vacuity proven at authoring time (2026-08-20), each break restored:
;;   - sh!'s deref bound multiplied by 1000 (wait effectively unbounded) ->
;;     P1's hung-draw predicate fired "hung child was not bounded: elapsed
;;     30035ms against bound 150" (demonstrated on a single draw: under the
;;     break every hung draw waits out the child's full 30s, so the full
;;     runner would need ~300s to print what one draw shows);
;;   - run-sweep!'s boundary emission made conditional on the thunk's truthy
;;     return ("log only when something happened") -> P2 failed 64/90 runs:
;;     every bundle containing an idle sweep lost that boundary line.
;;
;; Non-vacuity re-proven for BL-1021 (2026-08-21), each break restored:
;;   - BREAK 1, sh!'s whole-call drain bound reverted to the pre-fix
;;     exit-code-only `(deref proc bound ::timed-out)`: 14 failures, and THE
;;     DISTRIBUTION IS THE EVIDENCE - every one of them was a depth-2 or
;;     depth-3 draw ("pipe-holder at depth 2 was not bounded: elapsed 8020ms
;;     against bound 150"; "a depth-3 hang ended the sweep with exit 0 and no
;;     announcement"), and NOT ONE depth-1 draw failed. Depth 1 is the shape
;;     BL-967 drew exclusively, and it passes against the live defect. That is
;;     the whole reason depth is stratified here rather than assumed.
;;     (Two deep draws slipped past P1 under this break: at a 150ms bound the
;;     fixture's own bash startup sometimes exceeds it, so the exit-code
;;     branch fires by luck. They failed in P3 instead - the two properties
;;     covered each other. The flake is in the BREAK, not in the fix: with the
;;     drain bounded, a deep draw times out deterministically.)
;;   - BREAK 2, the `((deref on-timeout!) ...)` call deleted from sh!'s
;;     timeout branch, leaving the bound itself intact: 24 failures - every
;;     hang draw at every depth, in BOTH properties ("on-timeout! never fired
;;     for a depth-1 hang" ... "for a depth-3 hang"). This is what keeps P3's
;;     announcement-completeness clauses (sweep name, exact argv, exact bound,
;;     :err corroboration) from being decorative: BREAK 1 alone would leave
;;     them unexercised, because under it nothing ever reaches the branch.

(require '[babashka.fs :as fs]
         '[clojure.string :as str])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "daemon_cycle_guard_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 500))
(def failures (atom []))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop n gen-fn pred-fn]
  (loop [i 0 s 7]
    (when (< i n)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result)
          (report! prop s input (str result)))
        (recur (inc i) s')))))

;; ── P1: the bounded wait, real subprocesses ───────────────────────────────
;; Spawns real children, so this lane runs a REDUCED count (runs/10, floor
;; 20): the property is about the bound, and 20+ mixed draws exercise every
;; branch. The generator weights hung draws heavily BY CONSTRUCTION - the
;; deep/terminal state must be common, never astronomically rare.

(def p1-runs (max 21 (quot runs 10)))
(def p1-bound-ms 150)
(def p1-slack-ms 1500) ; process spawn + destroy overhead budget

;; The pipe-holder outlives bound+slack by a wide margin (so a draw can never
;; pass because the pipe happened to close in time) while still self-reaping
;; quickly - destroy-tree CANNOT reach a holder at depth >= 2, since it was
;; reparented the moment its parent exited, so every one of them is an orphan
;; until it exits on its own. The runner also kills them explicitly (below).
(def p1-hang-secs 8)

;; The depth fixture. `hang-at-depth <d> <secs> <pidfile>` puts the process
;; that HOLDS the inherited stdout/stderr exactly d processes below sh!'s
;; direct child: d=1 execs sleep in the direct child itself (BL-967's only
;; shape, and the one the exit-code bound already caught), d=2 is the live
;; BL-1021 shape (child exits immediately, grandchild holds the pipe), d=3
;; puts one more hop between them. Self-recursion via "$0" keeps this free of
;; nested shell quoting. Stock /bin/bash 3.2: POSIX `[` only.
(def p1-fixture-dir (str (fs/create-temp-dir {:prefix "dcg-bl1021-depth-"})))
(def p1-pidfile (str (fs/path p1-fixture-dir "spawned.pids")))
(def p1-hang-script (str (fs/path p1-fixture-dir "hang_at_depth.sh")))

;; BL-1031 QA bounce: bare `"$0" … &; exit 0` races on WSL the same way as
;; `sleep & exit` — the deeper pipe-holder sometimes never retains stdout,
;; so sh! returns exit 0 with no on-timeout. Handshake on a fifo so the
;; parent exits only after the child (which inherits the write ends) is live.
(spit p1-hang-script
      (str "#!/bin/bash\n"
           "d=\"$1\"; secs=\"$2\"; pidfile=\"$3\"\n"
           "echo \"$$\" >> \"$pidfile\"\n"
           "if [ \"$d\" -le 1 ]; then\n"
           "  exec sleep \"$secs\"\n"
           "fi\n"
           "syncf=$(mktemp -u \"$pidfile.sync.XXXXXX\")\n"
           "mkfifo \"$syncf\" || exit 1\n"
           "(\n"
           "  echo $$ >> \"$pidfile\"\n"
           "  echo ready > \"$syncf\"\n"
           "  exec \"$0\" $((d-1)) \"$secs\" \"$pidfile\"\n"
           ") &\n"
           "read _ < \"$syncf\"\n"
           "rm -f \"$syncf\"\n"
           "exit 0\n"))
(fs/set-posix-file-permissions p1-hang-script "rwxr-xr-x")
(spit p1-pidfile "")

(defn- hang-cmd
  "sh! argv for a child whose pipe-holder sits `depth` processes down."
  [depth]
  [p1-hang-script (str depth) (str p1-hang-secs) p1-pidfile])

(defn- reap-spawned!
  "Kills every process the depth fixture recorded. Orphans at depth >= 2 are
   unreachable by destroy-tree by construction, so the suite reaps them
   itself rather than leaving them to time out."
  []
  (doseq [line (str/split-lines (try (slurp p1-pidfile) (catch Exception _ "")))
          :let [pid (str/trim line)]
          :when (not (str/blank? pid))]
    (try (daemon-cycle-guard-lib/sh! ["kill" "-9" pid]) (catch Exception _ nil))))

;; Depth is the dimension this invariant quantifies over, so it is STRATIFIED
;; BY CONSTRUCTION rather than drawn independently and hoped for. Drawing it
;; from the shared LCG was tried first and rejected: `gen-int s 2`/`s 3` reads
;; a narrow bit range of a power-of-2-modulus LCG, and at this lane's run
;; count (real children, so it runs ~1/10 of the property budget) the depths
;; came out 4/3/2 and 7/1/4 - the deepest state, the one the live defect
;; lived in, drawn twice in twenty runs. Tuning the seed or the run count
;; until that tally looked acceptable would be the documented failure shape
;; itself: a reachability floor that is hoped for rather than asserted.
;;
;; So: the KIND is drawn (which keeps the fast/hang mix and the sweep names
;; seeded and unpredictable), and each hang draw's depth is assigned
;; round-robin across the hang draws. Every depth is then reached in equal
;; measure by construction, and the floors below assert it over the ACTUAL
;; draw list rather than re-deriving it.
(def child-kinds [:hang :hang :hang :fast-clean :fast-fail]) ; hangs 3/5

(def p1-depths [1 2 3])

(defn- hang? [kind] (= :hang kind))

(defn- build-draws
  "The materialized P1/P3 draw list. Returned once and shared by both
   properties AND by the coverage floors, so the floors describe exactly what
   ran - never a second, independently re-derived sequence that could drift
   from it."
  [n]
  (loop [i 0 s 7 acc []]
    (if (= i n)
      acc
      (let [[kind s1] (gen-pick s child-kinds)
            [ctx-n s2] (gen-int s1 1000)
            hangs-so-far (count (filter (comp hang? :kind) acc))]
        (recur (inc i) s2
               (conj acc {:index i
                          :kind kind
                          :context (str "sweep-" ctx-n)
                          :depth (if (hang? kind)
                                   (nth p1-depths (mod hangs-so-far (count p1-depths)))
                                   0)}))))))

(def p1-draws (build-draws p1-runs))

(defn- check-draws
  "check-all's counterpart for a materialized, stratified draw list."
  [prop draws pred-fn]
  (doseq [input draws]
    (let [result (pred-fn input)]
      (when-not (true? result)
        (report! prop (:index input) input (str result))))))

(defn- run-drawn-child
  "Runs one drawn child through sh! under the small bound, capturing the
   announcement, the elapsed wall clock, and the exact argv used. Never lets
   a draw hang the runner: an unbounded sh! would freeze the whole lane with
   nothing printed, so the call itself carries a wall-clock guard far above
   bound+slack. Tripping the guard IS a failure, reported as one."
  [{:keys [kind context depth]}]
  (let [fired (atom nil)
        argv (case kind
               :hang (hang-cmd depth)
               :fast-clean ["echo" "ok"]
               :fast-fail ["false"])]
    (reset! daemon-cycle-guard-lib/on-timeout! (fn [info] (reset! fired info)))
    (reset! daemon-cycle-guard-lib/current-context context)
    (let [t0 (System/currentTimeMillis)
          call (future (try (with-redefs [daemon-cycle-guard-lib/subprocess-wait-bound-ms (fn [] p1-bound-ms)]
                              (daemon-cycle-guard-lib/sh! argv))
                            (catch Exception e {::threw (.getMessage e)})))
          r (deref call (+ p1-bound-ms p1-slack-ms 20000) ::hung-forever)
          elapsed (- (System/currentTimeMillis) t0)]
      (when (= ::hung-forever r) (future-cancel call))
      (reset! daemon-cycle-guard-lib/on-timeout! (fn [_] nil))
      (reset! daemon-cycle-guard-lib/current-context "outside-sweep")
      {:result r :elapsed elapsed :fired @fired :argv argv})))

(check-draws "P1 bounded wait AT ANY PROCESS DEPTH: whether the direct child blocks or a process it spawned holds the pipe open beneath it, sh! returns inside the bound with 124 and an attributed report; a fast child passes through untouched; sh! never throws"
  p1-draws
  (fn [{:keys [kind context depth] :as draw}]
    (let [{:keys [result elapsed fired]} (run-drawn-child draw)
          r result]
      (cond
        (= ::hung-forever r)
        (str "sh! NEVER RETURNED for a depth-" depth " pipe-holder - the bound did not hold at this depth")

        (::threw r) (str "sh! threw: " (::threw r))

        (hang? kind)
        (cond
          (> elapsed (+ p1-bound-ms p1-slack-ms))
          (str "pipe-holder at depth " depth " was not bounded: elapsed " elapsed
               "ms against bound " p1-bound-ms)
          (not= 124 (:exit r)) (str "depth-" depth " hang exit " (:exit r) ", not 124")
          (nil? fired) (str "on-timeout! never fired for a depth-" depth " hang")
          (not= context (:context fired))
          (str "timeout attributed to " (pr-str (:context fired)) ", drew " context)
          :else true)

        (= kind :fast-clean)
        (cond
          (not= 0 (:exit r)) (str "fast clean child exit " (:exit r))
          (some? fired) "on-timeout! fired for a fast child"
          :else true)

        :else ; :fast-fail
        (cond
          (not= 1 (:exit r)) (str "fast failing child exit " (:exit r) ", not its own 1")
          (some? fired) "on-timeout! fired for a fast failing child"
          :else true)))))

;; ── P3: a bounded-wait timeout is ALWAYS announced (BL-1021 invariant 2) ───
;; Same generated children as P1, but run INSIDE run-sweep! - because the
;; invariant is about the CYCLE, not the call: "no subprocess call ends the
;; cycle silently". Pre-fix, a depth-2 hang reached neither on-timeout! nor
;; the sweep's own boundary line: the log's last entry was the boundary of the
;; PREVIOUS sweep, and the operator had a frozen daemon with nothing naming
;; what it was stuck on. Asserted in both directions - a timeout announces
;; completely, and a child that did not time out announces nothing.

(check-draws "P3 announcement: every bounded-wait timeout is reported with its sweep, its exact command and its exact bound, is corroborated in the returned :err, and leaves the owning sweep's boundary line intact - and a child that did not time out announces nothing"
  p1-draws
  (fn [{:keys [kind context depth] :as draw}]
    (let [logged (atom [])
          log-fn (fn [event detail] (swap! logged conj [event detail]))
          clock (atom 0)
          captured (atom nil)]
      ;; run-sweep! owns the context; the draw's sweep name is the sweep's.
      (daemon-cycle-guard-lib/run-sweep!
       log-fn (fn [] (swap! clock + 1)) context
       (fn [] (reset! captured (run-drawn-child (assoc draw :context context)))))
      (let [{:keys [result fired argv]} @captured
            boundary (first (filter (fn [[e _]] (= e "sweep-boundary")) @logged))
            timed-out? (and (map? result) (= 124 (:exit result)))]
        (cond
          (= ::hung-forever result)
          (str "the sweep never regained control from a depth-" depth " pipe-holder")

          (nil? boundary)
          (str "the sweep emitted NO boundary line - the cycle went silent on a depth-" depth " " (name kind) " child")

          (not (str/starts-with? (second boundary) (str "sweep=" context " ")))
          (str "boundary does not name the owning sweep: " (pr-str (second boundary)))

          ;; A drawn hang MUST have produced an announcement. This is the
          ;; clause that bites on the live defect: pre-fix, a depth>=2 hang
          ;; was never bounded at all, so on-timeout! was never reached and
          ;; the cycle carried NOTHING naming what it was stuck on - the
          ;; operator's actual experience on 2026-08-21. "Never announced"
          ;; and "never bounded" are the same silence from the log's side.
          (and (hang? kind) (not timed-out?))
          (str "a depth-" depth " hang ended the sweep with exit " (:exit result)
               " and no announcement - the cycle went silent on it")

          timed-out?
          (cond
            (nil? fired) "the call timed out but nothing was announced - a silent bounded wait"
            (not= context (:context fired))
            (str "announcement names " (pr-str (:context fired)) ", the sweep was " context)
            (not= argv (:cmd fired))
            (str "announcement carries " (pr-str (:cmd fired)) ", the command was " (pr-str argv))
            (not= p1-bound-ms (:bound-ms fired))
            (str "announcement carries bound " (:bound-ms fired) ", the bound was " p1-bound-ms)
            (not (str/includes? (str (:err result)) (str p1-bound-ms "ms")))
            (str "the returned :err does not corroborate the bound: " (pr-str (:err result)))
            :else true)

          ;; symmetric half: no timeout, no announcement.
          (some? fired)
          (str "a child that returned " (:exit result) " was announced as a timeout anyway")

          :else true)))))

;; ── P2: boundary lines localize any stall, pure fake clock ────────────────

(def sweep-kinds [:idle :acting :throwing])

(defn- gen-bundle [s]
  (let [[n s1] (gen-int s 7)] ; 1..7 sweeps
    (reduce (fn [[acc sx] i]
              (let [[kind sy] (gen-pick sx sweep-kinds)
                    [dur sz] (gen-int sy 50)]
                [(conj acc {:name (str "sweep-" i) :kind kind :dur (inc dur)}) sz]))
            [[] s1] (range (inc n)))))

(check-all "P2 localization: one boundary per sweep in order with its duration, and EVERY log prefix cut names the guilty sweep as the first one missing its boundary"
  (- runs (quot runs 10))
  gen-bundle
  (fn [bundle]
    (let [logged (atom [])   ; [[event detail sweep-running-at-emit]]
          clock (atom 0)
          running (atom nil) ; ground truth: which sweep is in flight
          log-fn (fn [event detail] (swap! logged conj [event detail @running]))]
      (doseq [{:keys [name kind dur]} bundle]
        (reset! running name)
        (daemon-cycle-guard-lib/run-sweep!
         log-fn (fn [] @clock) name
         (fn []
           (swap! clock + dur)
           (case kind
             :idle nil
             :acting (log-fn "some-action" (str name "-did-a-thing"))
             :throwing (throw (Exception. (str name "-boom"))))))
        (reset! running nil))
      (let [lines @logged
            boundaries (filterv (fn [[e _ _]] (= e "sweep-boundary")) lines)
            expected (mapv (fn [{:keys [name dur]}] (str "sweep=" name " ms=" dur)) bundle)]
        (cond
          (not= expected (mapv second boundaries))
          (str "boundaries wrong: " (pr-str (mapv second boundaries)) " expected " (pr-str expected))

          ;; volume: exactly one per sweep, no boundary noise beyond the bundle
          (not= (count bundle) (count boundaries))
          (str (count boundaries) " boundary lines for " (count bundle) " sweeps")

          :else
          ;; localization: cut the log after every line; the first sweep
          ;; whose boundary is absent from the prefix must be the sweep
          ;; ground truth says was running when the next line would land.
          (or (some (fn [cut]
                      (let [prefix (subvec lines 0 cut)
                            seen (set (keep (fn [[e d _]] (when (= e "sweep-boundary") d)) prefix))
                            blamed (first (remove #(contains? seen (str "sweep=" (:name %) " ms=" (:dur %))) bundle))
                            truth (if (< cut (count lines)) (nth (nth lines cut) 2) nil)]
                        ;; truth nil = the bundle finished; blamed nil matches.
                        ;; A between-sweeps truth (nil mid-log) cannot occur:
                        ;; every emitted line lands while some sweep runs.
                        (when (and truth blamed (not= (:name blamed) truth))
                          (str "cut at " cut ": log blames " (:name blamed) " but " truth " was running"))))
                    (range (inc (count lines))))
              true))))))

;; ── generator coverage floors (reach asserted, never hoped) ───────────────

(let [tally-p1 (frequencies (map :kind p1-draws))
      ;; Read off the ACTUAL draw list both properties ran, never a second
      ;; re-derived sequence: a floor computed from a re-derivation can drift
      ;; from what was really executed and then certifies nothing.
      tally-depth (frequencies (map :depth (filter (comp hang? :kind) p1-draws)))
      tally-p2 (loop [i 0 s 7 acc {}]
                 (if (= i (- runs (quot runs 10)))
                   acc
                   (let [[bundle s'] (gen-bundle s)]
                     (recur (inc i) s' (merge-with + acc (frequencies (map :kind bundle)))))))]
  (println (str "  generator coverage: P1/P3 (" p1-runs " draws) " (pr-str tally-p1)))
  (println (str "  generator coverage: pipe-holder depth over hang draws "
                (pr-str (into (sorted-map) tally-depth))))
  (println (str "  generator coverage: P2 " (pr-str tally-p2)))
  (doseq [k [:hang :fast-clean :fast-fail]]
    (when (< (get tally-p1 k 0) (max 3 (quot p1-runs 10)))
      (report! (str "COVERAGE P1 " k) 7 {:count (get tally-p1 k 0)} "this child kind is barely exercised")))
  ;; The reachability floor this ticket exists for. Depth 1 alone is the shape
  ;; that already passed pre-fix - a run that thinned out the deep draws would
  ;; certify the bound at exactly the depth that was never broken.
  (doseq [d p1-depths]
    (when (< (get tally-depth d 0) 3)
      (report! (str "COVERAGE P1 pipe-holder-depth-" d) 7 {:count (get tally-depth d 0)}
               "the invariant quantifies over process depth; this depth is barely reached")))
  (let [deep (+ (get tally-depth 2 0) (get tally-depth 3 0))]
    (when (< deep (quot p1-runs 4))
      (report! "COVERAGE P1 deep-draws" 7 {:deep deep :of p1-runs}
               "fewer than a quarter of draws put the pipe-holder BELOW the direct child - the BL-1021 state is too rare to call this tested")))
  (doseq [k sweep-kinds]
    (when (< (get tally-p2 k 0) (quot runs 20))
      (report! (str "COVERAGE P2 " k) 7 {:count (get tally-p2 k 0)} "this sweep kind is barely exercised"))))

;; ── report ────────────────────────────────────────────────────────────────
;; Every spawned pipe-holder is reaped and the fixture tree removed BEFORE
;; the verdict is printed, and in a finally, so a failing property cannot
;; leak an orphan `sleep` or a temp dir (engineering rule: fixture teardown
;; never hangs off the last assertion).
(try
  (reap-spawned!)
  (finally
    (fs/delete-tree p1-fixture-dir)))

(println (str "daemon_cycle_guard_lib properties: P1=" p1-runs " runs (real children, depths 1-3), P3=" p1-runs " runs, P2=" (- runs (quot runs 10)) " runs"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
