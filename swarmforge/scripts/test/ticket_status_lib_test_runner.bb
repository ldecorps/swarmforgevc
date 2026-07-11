#!/usr/bin/env bb
;; TDD runner for ticket_status_lib.bb (BL-283) - real fs against a temp
;; fixture dir (a real filesystem read is this lib's whole job; no adapter
;; seam to fake around), no network, no real timers.
(ns ticket-status-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "ticket_status_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn mk-tmp [] (str (fs/create-temp-dir {:prefix "ticket-status-lib-test-"})))

(defn write-ticket! [root status id]
  (let [dir (fs/path root "backlog" status)]
    (fs/create-dirs dir)
    (spit (str (fs/path dir (str id ".yaml"))) (str "id: " id "\ntitle: a thing\nstatus: " status "\n"))))

(let [root (mk-tmp)]
  (write-ticket! root "active" "BL-100")
  (assert= "a ticket filed under active/ reports \"active\""
           "active"
           (ticket-status-lib/current-status root "BL-100")))

(let [root (mk-tmp)]
  (write-ticket! root "paused" "BL-100")
  (assert= "a ticket filed under paused/ reports \"paused\""
           "paused"
           (ticket-status-lib/current-status root "BL-100")))

(let [root (mk-tmp)]
  (write-ticket! root "done" "BL-100")
  (assert= "a ticket filed under done/ reports \"done\""
           "done"
           (ticket-status-lib/current-status root "BL-100")))

(let [root (mk-tmp)]
  (assert= "a ticket that does not exist anywhere reports nil, never a fabricated status"
           nil
           (ticket-status-lib/current-status root "BL-999")))

(let [root (mk-tmp)]
  (write-ticket! root "active" "BL-100")
  (write-ticket! root "active" "BL-101")
  (assert= "looking up one id among several never returns a different ticket's status"
           "active"
           (ticket-status-lib/current-status root "BL-101")))

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: ticket_status_lib.bb"))
