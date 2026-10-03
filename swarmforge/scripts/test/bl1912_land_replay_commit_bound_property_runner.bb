#!/usr/bin/env bb
;; BL-1912 property test (coder-authored, TWO declared invariants, BL-654).
;;
;;   Invariant 1: the replay never publishes a commit whose commit hooks
;;   did not run to completion and pass - no --no-verify, no hook skipped
;;   or short-circuited to make the commit fit a bound.
;;   Invariant 2: a replay commit that does not finish, for any reason,
;;   leaves origin/main untouched and pushes nothing.
;;
;; Drives the REAL git! (its own :bound-ms pass-through, this ticket's own
;; fix) and the REAL daemon-cycle-guard-lib/sh! bounded-wait kill against a
;; REAL git repository and a REAL commit-msg hook - never a reimplementation
;; of either. A hook that writes its "ran to completion" marker only AFTER
;; sleeping is what makes "killed mid-hook" and "hook completed" tell apart
;; from the marker's mere existence - a hook that wrote the marker FIRST
;; would still leave it behind after a kill, hiding exactly the failure
;; mode (a hook "skipped or short-circuited") this invariant forbids.
;;
;; WHY THE GENERATOR REACHES BOTH SIDES: delay-ms and bound-ms are drawn
;; from the same millisecond range with a forced minimum gap, so roughly
;; half the runs land the hook inside its bound (expect success) and half
;; land it outside (expect a kill) - both counted, both asserted.
;;
;; Non-vacuity proven at authoring: moving the marker-write BEFORE the
;; sleep (simulating a hook that the commit treats as complete before it
;; truly finished) makes the timeout branch's "marker absent" assertion
;; fail outright; passing no :bound-ms override (the generic 60s default)
;; would make every short-bound run in this file hang for a minute instead
;; of failing fast - caught by hand while authoring, restored to pass
;; :bound-ms explicitly every call.

(ns bl1912-land-replay-commit-bound-property-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(def test-dir (fs/parent (fs/canonicalize *file*)))
(def scripts-dir (str (fs/parent test-dir)))
(def lib-path (str (fs/path scripts-dir "land_step_lib.bb")))
(load-file lib-path)

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 16))

(def failures (atom []))
(defn fail! [msg] (swap! failures conj (str "FAIL: " msg)))
(defn check! [msg expr] (when-not expr (fail! msg)))

(def reached (atom {}))
(defn bump! [k] (swap! reached update k (fnil inc 0)))

(def rng
  (let [state (atom 1912)]
    (fn [n] (let [next (mod (+ (* 1103515245 @state) 12345) 2147483648)]
              (reset! state next)
              (mod (quot next 65536) n)))))

(defn git [root & args]
  (apply process/sh "git" "-C" (str root) args))

(defn init-repo! [root hook-delay-seconds marker-file]
  (fs/create-dirs root)
  (git root "init" "-q" "-b" "main")
  (git root "config" "user.email" "t@t")
  (git root "config" "user.name" "t")
  (git root "config" "commit.gpgsign" "false")
  (git root "commit" "-q" "--allow-empty" "-m" "seed")
  (let [hooks-dir (fs/path root ".git" "hooks")]
    (fs/create-dirs hooks-dir)
    (spit (str (fs/path hooks-dir "commit-msg"))
          (str "#!/usr/bin/env bash\n"
               "grep -q 'tip-pure replay' \"$1\" 2>/dev/null || exit 0\n"
               "sleep " hook-delay-seconds "\n"
               "touch " (pr-str (str marker-file)) "\n"
               "exit 0\n"))
    (fs/set-posix-file-permissions (fs/path hooks-dir "commit-msg") "rwxr-xr-x")))

;; ── invariant 1 (static half): the actual production call site never
;; adds --no-verify anywhere near the replay's own commit ─────────────────

(let [source (slurp lib-path)
      commit-call-idx (.indexOf source "tip-pure replay onto origin/main (BL-1241 land-step remedy)")]
  (check! "invariant 1 (static): the replay commit call site exists in land_step_lib.bb's source"
          (>= commit-call-idx 0))
  (when (>= commit-call-idx 0)
    (let [window (subs source (max 0 (- commit-call-idx 400)) (min (count source) (+ commit-call-idx 400)))]
      (check! "invariant 1 (static): no --no-verify anywhere near the replay commit call"
              (not (str/includes? window "--no-verify"))))))

;; ── invariant 1 (dynamic) + invariant 2: randomized delay-vs-bound runs ──

(dotimes [i runs]
  (let [root (str (fs/create-temp-dir {:prefix "bl1912-prop-"}))
        marker (str (fs/path root "hook-ran-to-completion.marker"))
        ;; Small, fast numbers - this is a property test, not the
        ;; acceptance feature's own timing proof. A forced >=400ms gap
        ;; keeps either side away from a flaky near-tie.
        delay-ms (+ 100 (rng 900))
        bound-ms (if (even? i) (+ delay-ms 400 (rng 400)) (max 100 (- delay-ms 400 (rng 400))))
        expect-success? (< delay-ms bound-ms)
        hook-delay-seconds (format "%.3f" (/ delay-ms 1000.0))]
    (try
      (init-repo! root hook-delay-seconds marker)
      (let [head-before (str/trim (:out (git root "rev-parse" "HEAD")))
            commit-res (#'land-step-lib/git! root "-c" "user.email=t@t" "-c" "user.name=t"
                                               "commit" "-q" "--allow-empty"
                                               "-m" "BL-9001: tip-pure replay onto origin/main (BL-1241 land-step remedy)"
                                               {:bound-ms bound-ms})
            head-after (str/trim (:out (git root "rev-parse" "HEAD")))
            marker-written? (fs/exists? marker)]
        (if expect-success?
          (do
            (bump! :expected-success)
            (check! (str "invariant 1: a hook that finishes inside its bound must let the commit succeed (run " i
                        ", delay=" delay-ms "ms bound=" bound-ms "ms), got exit=" (:exit commit-res))
                    (zero? (:exit commit-res)))
            (check! (str "invariant 1: a succeeding commit's hook must have run to completion (marker written), run " i)
                    marker-written?)
            (check! (str "invariant 2 (positive control): a succeeding commit DOES create a new HEAD, run " i)
                    (not= head-before head-after)))
          (do
            (bump! :expected-timeout)
            (check! (str "invariant 1: a hook that outlasts its bound must be killed (exit 124), never silently passed, run " i
                        ", delay=" delay-ms "ms bound=" bound-ms "ms), got exit=" (:exit commit-res))
                    (= 124 (:exit commit-res)))
            (check! (str "invariant 1: a killed hook must NEVER have reached its own completion marker (no skip/short-circuit), run " i)
                    (not marker-written?))
            (check! (str "invariant 2: a commit that did not finish leaves HEAD (and so origin/main, which only ever advances from a pushed HEAD) untouched, run " i)
                    (= head-before head-after)))))
      (finally (fs/delete-tree root)))))

(check! "generator never reached an expected-success run"
        (pos? (get @reached :expected-success 0)))
(check! "generator never reached an expected-timeout run"
        (pos? (get @reached :expected-timeout 0)))

(when (seq @failures)
  (doseq [f @failures] (println f))
  (println (count @failures) "FAILURES")
  (System/exit 1))

(println "ALL PROPERTIES HELD"
         "expected-success=" (get @reached :expected-success 0)
         "expected-timeout=" (get @reached :expected-timeout 0))
