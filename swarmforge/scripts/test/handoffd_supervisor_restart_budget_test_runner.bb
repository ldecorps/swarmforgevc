#!/usr/bin/env bb
;; BL-1492: unit tests for decide-response (pure, kept alongside
;; evaluate-health per the ticket's own "How" direction). No real daemon, no
;; real clock, no real timers - a fixed now-ms and hand-built restart-history
;; entries throughout.

(require '[babashka.fs :as fs])

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(def fixture-root (str (fs/create-temp-dir {:prefix "supervisor-restart-budget-"})))
;; A pre-existing stop file makes the supervisor's own -main return at once
;; when the script is load-file'd (same trick startup-grace's runner relies on).
(fs/create-dirs (fs/path fixture-root ".swarmforge" "daemon"))
(spit (str (fs/path fixture-root ".swarmforge" "daemon" "stop")) "")
(binding [*command-line-args* [fixture-root]]
  (load-file (str (fs/path script-dir ".." "handoffd_supervisor.bb"))))
(try (fs/delete-tree fixture-root) (catch Exception _ nil))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(def WINDOW 600000)
(def BUDGET 2)

(defn decide [history now-ms]
  (handoffd-supervisor/decide-response {:restart-history history
                                        :now-ms now-ms
                                        :budget-window-ms WINDOW
                                        :budget-count BUDGET}))

(assert= "no prior restarts: headroom, :restart"
         :restart (decide [] 1000000))

(assert= "one prior restart well inside the window: still headroom, :restart"
         :restart (decide [{:at 900000 :result "succeeded"}] 1000000))

(assert= "budget-count prior restarts all inside the window: exhausted, :halt"
         :halt (decide [{:at 900000 :result "succeeded"} {:at 950000 :result "failed"}] 1000000))

(assert= "more than budget-count prior restarts inside the window: still :halt"
         :halt (decide [{:at 900000} {:at 920000} {:at 950000}] 1000000))

(assert= "budget-count prior restarts, both now OLDER than the window: re-armed, :restart"
         :restart (decide [{:at 0} {:at 50000}] (+ WINDOW 1000000)))

(assert= "exactly at the window boundary (age == window) does not count as recent"
         :restart (decide [{:at (- 1000000 WINDOW)} {:at (- 1000000 WINDOW)}] 1000000))

(assert= "one entry just inside, one just outside the window: only the inside one counts, headroom remains"
         :restart (decide [{:at (- 1000000 WINDOW 1)} {:at (- 1000000 WINDOW -1)}] 1000000))

(assert= "a malformed :at (non-numeric) never counts as recent - fails toward :halt-safe accounting, not toward more restarts"
         :restart (decide [{:at "not-a-number"} {:at nil}] 1000000))

(assert= "a future :at (negative age) never counts as recent"
         :restart (decide [{:at 2000000} {:at 3000000}] 1000000))

(assert= "budget-count of 0 always halts, even with no history"
         :halt (handoffd-supervisor/decide-response {:restart-history [] :now-ms 1000000
                                                      :budget-window-ms WINDOW :budget-count 0}))

(if (empty? @failures)
  (println "handoffd_supervisor restart-budget (decide-response): ALL TESTS PASS")
  (do (println (str (count @failures) " FAILURE(S):"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
