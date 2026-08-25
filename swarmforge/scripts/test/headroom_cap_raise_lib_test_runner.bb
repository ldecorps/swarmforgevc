#!/usr/bin/env bb
;; TDD runner for headroom_cap_raise_lib.bb (BL-1128).
(ns headroom-cap-raise-lib-test-runner
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "headroom_cap_raise_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual] (assert= msg true (boolean actual)))
(defn assert-false [msg actual] (assert= msg false (boolean actual)))

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                  (Thread. (fn [] (doseq [d @created-temp-dirs]
                                    (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn mk-root []
  (let [d (str (fs/create-temp-dir {:prefix "bl1128-headroom-"}))]
    (swap! created-temp-dirs conj d)
    d))

;; ── pure: sustained CPU headroom (mirror BL-822 trailing-window shape) ────

(let [interval 300000
      sustained (* 15 60 1000)
      ok-events [{:ratio 0.2} {:ratio 0.3} {:ratio 0.1} {:ratio 0.25}]
      pressure [{:ratio 0.2} {:ratio 0.3} {:ratio 2.5} {:ratio 0.1}]]
  (assert-true "four trailing low samples cover 15m at 5m interval"
               (headroom-cap-raise-lib/sustained-cpu-headroom? ok-events 1.0 sustained interval))
  (assert-false "a trailing high sample breaks the headroom streak"
                (headroom-cap-raise-lib/sustained-cpu-headroom? pressure 1.0 sustained interval))
  (assert-false "one sample alone never counts as sustained"
                (headroom-cap-raise-lib/sustained-cpu-headroom? [{:ratio 0.1}] 1.0 sustained interval))
  ;; Killer: interval == sustained would satisfy the duration arm for trailing=1;
  ;; the count arm must still refuse (kills `> trailing 1` → `>= trailing 1`).
  (assert-false "one sample spanning the whole window still never counts"
                (headroom-cap-raise-lib/sustained-cpu-headroom? [{:ratio 0.1}] 1.0 interval interval)))
(assert-true "memory at/above floor is headroom"
             (headroom-cap-raise-lib/memory-headroom? 4096 2048))
(assert-false "memory below floor is pressure"
              (headroom-cap-raise-lib/memory-headroom? 1000 2048))
(assert-false "nil memory is not headroom"
              (headroom-cap-raise-lib/memory-headroom? nil 2048))

;; ── pure: raise decision ─────────────────────────────────────────────────

(assert= "raise when below ceiling with headroom and clear throttle"
         {:action :raise :to 4}
         (headroom-cap-raise-lib/decide-raise
          {:configured 3 :ceiling 8 :step 1 :headroom? true
           :throttle-severity nil :cooldown-active? false}))

(assert= "no raise under degraded throttle"
         {:action :noop :reason "throttle"}
         (headroom-cap-raise-lib/decide-raise
          {:configured 3 :ceiling 8 :step 1 :headroom? true
           :throttle-severity "degraded" :cooldown-active? false}))

(assert= "no raise under severe throttle"
         {:action :noop :reason "throttle"}
         (headroom-cap-raise-lib/decide-raise
          {:configured 3 :ceiling 8 :step 1 :headroom? true
           :throttle-severity "severe" :cooldown-active? false}))

(assert= "no raise without headroom"
         {:action :noop :reason "pressure"}
         (headroom-cap-raise-lib/decide-raise
          {:configured 3 :ceiling 8 :step 1 :headroom? false
           :throttle-severity nil :cooldown-active? false}))

(assert= "no raise at ceiling"
         {:action :noop :reason "ceiling"}
         (headroom-cap-raise-lib/decide-raise
          {:configured 8 :ceiling 8 :step 1 :headroom? true
           :throttle-severity nil :cooldown-active? false}))

(assert= "no raise during cooldown"
         {:action :noop :reason "cooldown"}
         (headroom-cap-raise-lib/decide-raise
          {:configured 3 :ceiling 8 :step 1 :headroom? true
           :throttle-severity nil :cooldown-active? true}))

(assert= "step never crosses ceiling"
         {:action :raise :to 8}
         (headroom-cap-raise-lib/decide-raise
          {:configured 7 :ceiling 8 :step 3 :headroom? true
           :throttle-severity nil :cooldown-active? false}))

;; ── conf rewrite ─────────────────────────────────────────────────────────

(assert= "rewrites existing depth line"
         "config active_backlog_max_depth 4\n"
         (headroom-cap-raise-lib/rewrite-max-depth-line "config active_backlog_max_depth 3\n" 4))

(assert= "appends when line absent"
         "config mutation_cooldown_days 3\nconfig active_backlog_max_depth 4\n"
         (headroom-cap-raise-lib/rewrite-max-depth-line "config mutation_cooldown_days 3\n" 4))

;; ── eligibility / depth preference ───────────────────────────────────────

(assert-true "policy tag makes a hold eligible"
             (headroom-cap-raise-lib/unhold-eligible?
              "id: BL-1\nheadroom_unhold: eligible\n"))
(assert-false "untagged hold is not mass-unheld"
              (headroom-cap-raise-lib/unhold-eligible?
               "id: BL-1\ntitle: human parked\n"))
(assert-false "explicit refuse stays held"
              (headroom-cap-raise-lib/unhold-eligible?
               "id: BL-1\nheadroom_unhold: refuse\n"))

(assert-true "title depth keyword prefers"
             (headroom-cap-raise-lib/depth-cap-throttle-ticket?
              "id: BL-683\ntitle: \"handoff depth warning off-by-one\"\npriority: 90\n"))
(assert-true "title throttle keyword prefers"
             (headroom-cap-raise-lib/depth-cap-throttle-ticket?
              "id: BL-2\ntitle: Article 3.5 throttle wiring\n"))
(assert-false "unrelated title is not preferred"
              (headroom-cap-raise-lib/depth-cap-throttle-ticket?
               "id: BL-9\ntitle: unrelated low-priority work\npriority: 1\n"))

;; ── fixture: raise writes conf + audit; unhold moves eligible only ───────

(let [root (mk-root)
      conf (str (fs/path root "swarmforge" "swarmforge.conf"))
      _ (fs/create-dirs (fs/path root "swarmforge"))
      _ (fs/create-dirs (fs/path root ".swarmforge" "coordinator"))
      _ (fs/create-dirs (fs/path root "backlog" "hold"))
      _ (fs/create-dirs (fs/path root "backlog" "paused"))
      _ (spit conf "config active_backlog_max_depth 3\nconfig active_backlog_max_depth_ceiling 8\n")
      _ (spit (str (fs/path root "backlog" "hold" "BL-1-eligible.yaml"))
              "id: BL-1\nheadroom_unhold: eligible\ntitle: eligible\n")
      _ (spit (str (fs/path root "backlog" "hold" "BL-2-human.yaml"))
              "id: BL-2\ntitle: human parked\n")
      ;; Force headroom via override so this runner stays hermetic.
      _ (spit (str (headroom-cap-raise-lib/signal-override-path root))
              (json/generate-string {:cpuHeadroom true :memAvailableMb 8192}))
      result (headroom-cap-raise-lib/run-raise! root {:now-ms 1700000000000})]
  (assert= "raise action applied" :raise (:action result))
  (assert= "configured depth became 4" 4 (headroom-cap-raise-lib/parse-conf-depth (slurp conf)))
  (assert-true "audit file exists" (fs/exists? (headroom-cap-raise-lib/audit-path root)))
  (let [audit (json/parse-string (str/trim (last (str/split-lines (slurp (str (headroom-cap-raise-lib/audit-path root)))))) true)]
    (assert= "audit from" 3 (:from audit))
    (assert= "audit to" 4 (:to audit)))
  (headroom-cap-raise-lib/run-unhold! root)
  (assert-true "eligible moved to paused"
               (fs/exists? (fs/path root "backlog" "paused" "BL-1-eligible.yaml")))
  (assert-false "eligible left hold"
                (fs/exists? (fs/path root "backlog" "hold" "BL-1-eligible.yaml")))
  (assert-true "human hold untouched"
               (fs/exists? (fs/path root "backlog" "hold" "BL-2-human.yaml")))
  (assert-true "UNHOLD note written"
               (str/includes? (slurp (str (fs/path root "backlog" "paused" "BL-1-eligible.yaml"))) "UNHOLD"))
  (assert-false "not auto-promoted to active"
                (fs/exists? (fs/path root "backlog" "active" "BL-1-eligible.yaml"))))

(let [root (mk-root)
      conf (str (fs/path root "swarmforge" "swarmforge.conf"))
      _ (fs/create-dirs (fs/path root "swarmforge"))
      _ (fs/create-dirs (fs/path root ".swarmforge" "coordinator"))
      _ (fs/create-dirs (fs/path root "backlog" "hold"))
      _ (spit conf "config active_backlog_max_depth 3\n")
      _ (spit (str (fs/path root "backlog" "hold" "BL-1-eligible.yaml"))
              "id: BL-1\nheadroom_unhold: eligible\n")
      _ (spit (str (headroom-cap-raise-lib/signal-override-path root))
              (json/generate-string {:cpuHeadroom false :memAvailableMb 100}))
      _ (spit (str (fs/path root ".swarmforge" "coordinator" "throttle-recommendation.json"))
              (json/generate-string {:severity "degraded" :recommendedCap 1}))
      result (headroom-cap-raise-lib/run-raise! root {:now-ms 1700000000000})]
  (assert= "pressure/throttle blocks raise" :noop (:action result))
  (assert= "conf unchanged" 3 (headroom-cap-raise-lib/parse-conf-depth (slurp conf)))
  (headroom-cap-raise-lib/run-unhold! root)
  (assert-true "hold left alone when raise did not succeed"
               (fs/exists? (fs/path root "backlog" "hold" "BL-1-eligible.yaml"))))

(let [root (mk-root)
      conf (str (fs/path root "swarmforge" "swarmforge.conf"))
      _ (fs/create-dirs (fs/path root "swarmforge"))
      _ (fs/create-dirs (fs/path root ".swarmforge" "coordinator"))
      _ (spit conf "config active_backlog_max_depth 3\nconfig active_backlog_max_depth_ceiling 8\n")
      _ (spit (str (headroom-cap-raise-lib/signal-override-path root))
              (json/generate-string {:cpuHeadroom true :memAvailableMb 8192}))
      _ (headroom-cap-raise-lib/run-raise! root {:now-ms 1700000000000})
      undo (headroom-cap-raise-lib/run-undo! root)]
  (assert= "undo restores prior" :undo (:action undo))
  (assert= "conf back to 3" 3 (headroom-cap-raise-lib/parse-conf-depth (slurp conf))))

(let [root (mk-root)
      conf (str (fs/path root "swarmforge" "swarmforge.conf"))
      _ (fs/create-dirs (fs/path root "swarmforge"))
      _ (fs/create-dirs (fs/path root ".swarmforge" "coordinator"))
      _ (spit conf "config active_backlog_max_depth 3\nconfig active_backlog_max_depth_ceiling 8\n")
      _ (spit (str (headroom-cap-raise-lib/signal-override-path root))
              (json/generate-string {:cpuHeadroom true :memAvailableMb 8192}))
      _ (headroom-cap-raise-lib/run-raise! root {:now-ms 1700000000000})
      again (headroom-cap-raise-lib/run-raise! root {:now-ms 1700000000100})]
  (assert= "cooldown blocks immediate second raise" :noop (:action again))
  (assert= "reason cooldown" "cooldown" (:reason again)))

(when (seq @failures)
  (doseq [f @failures] (println f))
  (System/exit 1))
(println "ALL CHECKS PASSED")
