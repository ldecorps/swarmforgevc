#!/usr/bin/env bb
;; TDD runner for in_process_ticket_guard_lib.bb - swarm_handoff.bb refuses
;; a git_handoff naming a ticket other than the sender's in-process parcel
;; (hotfix 2026-10-03, the stale BL-1858 draft sent while BL-1916 was held).

(ns in-process-ticket-guard-lib-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "in_process_ticket_guard_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(def bounce-1916 {:type "git_handoff" :task "BL-1916 [behavior: coder evidence is template text + literal $(date) path]"})

(defn decision [facts] (:decision (in-process-ticket-guard-lib/decide facts)))

;; the incident: a BL-1858 draft sent while BL-1916's bounce is in process
(assert= "a git_handoff for another ticket than the in-process bounce is refused"
         :refuse (decision {:type "git_handoff" :task "BL-1858" :in-process [bounce-1916]}))
(let [msg (:message (in-process-ticket-guard-lib/decide
                     {:type "git_handoff" :task "BL-1858" :in-process [bounce-1916]}))]
  (assert= "the refusal names the drafted ticket and the held one"
           true (boolean (and (str/includes? msg "IN_PROCESS_TICKET_MISMATCH")
                              (str/includes? msg "names BL-1858")
                              (str/includes? msg "parcel is BL-1916")))))

(assert= "the in-process ticket's own forward is allowed"
         :allow (decision {:type "git_handoff" :task "BL-1916" :in-process [bounce-1916]}))
(assert= "a bounce-shaped task header leads with its id and is allowed"
         :allow (decision {:type "git_handoff" :task "BL-1916 [behavior: x]" :in-process [bounce-1916]}))
(assert= "a coordinator Work note names its ticket: a forward of another ticket is refused"
         :refuse (decision {:type "git_handoff" :task "BL-1917"
                            :in-process [{:type "note" :message "Work BL-1456: merge main first, then read backlog/active"}]}))
(assert= "a Work note's own ticket is allowed"
         :allow (decision {:type "git_handoff" :task "BL-1456"
                           :in-process [{:type "note" :message "Work BL-1456: merge main first, then read backlog/active"}]}))

;; fail-open shapes
(assert= "a note that names no Work ticket allows any forward"
         :allow (decision {:type "git_handoff" :task "BL-1858"
                           :in-process [{:type "note" :message "branch behind 5fe17578f2: merge up"}]}))
(assert= "a note mentioning a ticket in passing is not a Work note"
         :allow (decision {:type "git_handoff" :task "BL-1858"
                           :in-process [{:type "note" :message "BL-1916 bounced; see evidence"}]}))
(assert= "nothing in process allows any forward"
         :allow (decision {:type "git_handoff" :task "BL-1858" :in-process []}))
(assert= "a master-resident role is never refused"
         :allow (decision {:type "git_handoff" :task "BL-1858" :master-resident? true :in-process [bounce-1916]}))
(assert= "a task naming no ticket is allowed"
         :allow (decision {:type "git_handoff" :task "tracer-bullet" :in-process [bounce-1916]}))
(assert= "a note is never refused"
         :allow (decision {:type "note" :task nil :in-process [bounce-1916]}))
(assert= "GH ids are read the same way"
         :refuse (decision {:type "git_handoff" :task "GH-12" :in-process [{:type "git_handoff" :task "GH-11"}]}))

(if (seq @failures)
  (do (doseq [f @failures] (println f))
      (println (str (count @failures) " FAILED"))
      (System/exit 1))
  (println "ALL TESTS PASSED"))
