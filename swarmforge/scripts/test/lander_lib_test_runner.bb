#!/usr/bin/env bb
;; TDD runner for lander_lib.bb (BL-1872): the pure decisions, plus enqueue!
;; on a mkdtemp root (never the live .swarmforge/).
(ns lander-lib-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "lander_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(def sha "0123456789abcdef0123456789abcdef01234567")

;; ── entry-id ─────────────────────────────────────────────────────────────
(assert= "an entry is keyed by task and the commit's 10-hex prefix"
         "BL-9001-0123456789" (lander-lib/entry-id "BL-9001" sha))
(assert= "the same approval keys the same entry, whatever the sha length"
         (lander-lib/entry-id "BL-9001" sha) (lander-lib/entry-id "BL-9001" (subs sha 0 12)))

;; ── next-action ──────────────────────────────────────────────────────────
(defn e [id status at & {:as more}] (merge {:id id :status status :enqueued-at at} more))

(assert= "an empty queue idles" {:action :idle} (lander-lib/next-action [] 0))
(assert= "the oldest queued entry starts first"
         {:action :start :id "b"}
         (lander-lib/next-action [(e "a" :queued 20) (e "b" :queued 10)] 100))
(assert= "a running land with no exit yet blocks every other start"
         {:action :wait :id "a"}
         (lander-lib/next-action [(e "a" :running 10 :started-at 50) (e "b" :queued 5)] 100))
(assert= "a running land whose exit is known is finished"
         {:action :finish :id "a"}
         (lander-lib/next-action [(e "a" :running 10 :started-at 50 :exit 0) (e "b" :queued 5)] 100))
(assert= "a run past an hour is reported once"
         {:action :report-overdue :id "a"}
         (lander-lib/next-action [(e "a" :running 10 :started-at 0)] (+ 1 lander-lib/overdue-ms)))
(assert= "an overdue run already reported just waits"
         {:action :wait :id "a"}
         (lander-lib/next-action [(e "a" :running 10 :started-at 0 :overdue-reported? true)] (+ 1 lander-lib/overdue-ms)))
(assert= "landed and refused entries are never started again"
         {:action :idle}
         (lander-lib/next-action [(e "a" :landed 10) (e "b" :refused 5)] 100))

;; ── outcome ──────────────────────────────────────────────────────────────
(assert= "LAND_PUBLISHED with exit 0 is a land"
         {:status :landed :sha "abcabcabca"}
         (lander-lib/outcome "LAND_CLEAN x\nLAND_PUBLISHED abcabcabcabcabc\n" 0))
(assert= "an escalation names the land step's own reason"
         {:status :refused :reason "LAND_ESCALATE land-step: nothing credited"}
         (lander-lib/outcome "LAND_ESCALATE\nland-step: nothing credited\nLAND_STOPPED: escalated\n" 3))
(assert= "an entangled-sibling block is named"
         {:status :refused :reason "ENTANGLED_SIBLING_BLOCK BL-1 withheld"}
         (lander-lib/outcome "ENTANGLED_SIBLING_BLOCK\nBL-1 withheld\n" 3))
(assert= "a stopped land names its LAND_STOPPED line"
         {:status :refused :reason "LAND_STOPPED: the single permitted rematch conflicted"}
         (lander-lib/outcome "LAND_REMATCH: x\nLAND_STOPPED: the single permitted rematch conflicted\n" 5))
(assert= "an unexplained failure names the exit code"
         {:status :refused :reason "land_main_publish.sh exited 7"}
         (lander-lib/outcome "noise\n" 7))
(assert= "exit 0 without LAND_PUBLISHED is never a land"
         {:status :refused :reason "land_main_publish.sh exited 0 with no LAND_PUBLISHED"}
         (lander-lib/outcome "noise\n" 0))

;; ── notes ────────────────────────────────────────────────────────────────
(let [n (lander-lib/outcome-note {:task "BL-9001-x" :commit sha} {:status :landed :sha "abcabcabca"})]
  (assert= "a land tells the coordinator" ["coordinator"] (:to n))
  (assert= "with QA's bookkeeping message" true (str/includes? (:message n) "BL-9001 QA-approved abcabcabca")))
(let [n (lander-lib/outcome-note {:task "BL-9001-x" :commit sha}
                                 {:status :refused :reason (apply str "LAND_STOPPED: " (repeat 200 "y"))})]
  (assert= "a refusal goes to QA" ["QA"] (:to n))
  (assert= "naming the ticket" true (str/starts-with? (:message n) "BL-9001 land refused: LAND_STOPPED"))
  (assert= "within the note cap" true (<= (count (:message n)) 80)))
(assert= "draft lines carry the note headers"
         ["type: note" "to: QA" "priority: 00" "message: hi"]
         (lander-lib/draft-lines {:to ["QA"] :message "hi"}))

;; overdue-note itself: next-action's :report-overdue branch is covered
;; above, but nothing exercised the message overdue-note actually builds -
;; hand-mutating it to garbage ({:to ["nobody"] :message "WRONG"}) survived
;; every existing suite (this runner, the property test, the 8/8 feature).
(let [n (lander-lib/overdue-note {:task "BL-9001-x" :commit sha})]
  (assert= "an overdue run is reported to QA" ["QA"] (:to n))
  (assert= "naming the ticket and that it is left alone"
           "BL-9001 land still running past an hour; left alone"
           (:message n)))

;; ── enqueue! (fixture root) ──────────────────────────────────────────────
(let [root (str (fs/create-temp-dir {:prefix "lander-lib-"}))]
  (try
    (assert= "the first enqueue queues" :queued (:result (lander-lib/enqueue! root "BL-9001" sha nil 100)))
    (assert= "the same approval again is the same entry" :already (:result (lander-lib/enqueue! root "BL-9001" sha nil 200)))
    (assert= "one entry on disk" 1 (count (lander-lib/read-entries root)))
    (assert= "it names the task, the commit and queued status"
             ["BL-9001" sha :queued 100]
             ((juxt :task :commit :status :enqueued-at) (first (lander-lib/read-entries root))))
    (assert= "enqueue writes only under .swarmforge/lander"
             [".swarmforge"] (mapv #(str (fs/file-name %)) (fs/list-dir root)))
    (finally (fs/delete-tree root))))

;; ── tick! :report-overdue (fixture root) ──────────────────────────────────
;; The ticket's own FIRM requirement ("a run still going past an hour is
;; reported to QA once and left alone") had no test anywhere that actually
;; drove tick! through this case - next-action's branch is unit-tested, but
;; nothing checked tick! sends the note, marks :overdue-reported? true on
;; disk, or that a second overdue tick never re-sends it.
(let [root (str (fs/create-temp-dir {:prefix "lander-lib-overdue-"}))
      id (lander-lib/entry-id "BL-9001" sha)
      notes (atom [])
      send-note! (fn [n] (swap! notes conj n))]
  (try
    (lander-lib/write-entry! root {:id id :task "BL-9001" :commit sha :status :running
                                   :started-at 0 :log "placeholder"})
    (let [decision (lander-lib/tick! root {:send-note! send-note! :now-ms (+ 1 lander-lib/overdue-ms)})]
      (assert= "the overdue run is reported" {:action :report-overdue :id id} decision)
      (assert= "exactly one note is sent" 1 (count @notes))
      (assert= "it is QA's overdue note" (lander-lib/overdue-note {:task "BL-9001" :commit sha}) (first @notes))
      (assert= "the entry is marked reported on disk"
               true (:overdue-reported? (first (lander-lib/read-entries root)))))
    ;; a second tick at the same (still overdue) time must not re-report it.
    (let [decision (lander-lib/tick! root {:send-note! send-note! :now-ms (+ 2 lander-lib/overdue-ms)})]
      (assert= "an already-reported overdue run just waits" {:action :wait :id id} decision)
      (assert= "no second note is sent" 1 (count @notes)))
    (finally (fs/delete-tree root))))

;; ── report ───────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: lander_lib.bb"))
