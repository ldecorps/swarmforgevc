#!/usr/bin/env bb
;; TDD runner for chase_sweep_lib.bb's BL-222 dispatch-gap functions.
;; decide-dispatch-gaps/extract-ticket-id are pure assertions, no real
;; mailbox I/O; the scanning functions below get their own fixture-based
;; tests further down (they do real fs I/O against a temp dir, same as
;; scan-inbox-new's own coverage, but no live swarm/tmux/daemon).
(ns dispatch-gap-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "chase_sweep_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

;; ── decide-dispatch-gaps (pure) ───────────────────────────────────────────

(assert= "dispatch-gap-01: an active item with no dispatch trail is auto-routed"
         [{:id "BL-217" :assigned-to "coder"}]
         (chase-sweep-lib/decide-dispatch-gaps [{:id "BL-217" :assigned-to "coder"}] #{}))

(assert= "dispatch-gap-02a: an item already dispatched to its assignee is not re-routed"
         []
         (chase-sweep-lib/decide-dispatch-gaps [{:id "BL-217" :assigned-to "coder"}] #{"BL-217"}))

(assert= "dispatch-gap-02b: an item that progressed to a later role (any trail at all) is not re-routed"
         []
         (chase-sweep-lib/decide-dispatch-gaps [{:id "BL-217" :assigned-to "coder"}] #{"BL-217"}))

(assert= "a mix of gapped and dispatched items is partitioned correctly"
         [{:id "BL-2" :assigned-to "coder"}]
         (chase-sweep-lib/decide-dispatch-gaps
          [{:id "BL-1" :assigned-to "coder"} {:id "BL-2" :assigned-to "coder"} {:id "BL-3" :assigned-to "cleaner"}]
          #{"BL-1" "BL-3"}))

(assert= "no active items yields no gaps"
         []
         (chase-sweep-lib/decide-dispatch-gaps [] #{"BL-1"}))

;; ── extract-ticket-id (pure) ───────────────────────────────────────────────

(assert= "extracts the ticket id from a task-style value"
         "BL-217"
         (chase-sweep-lib/extract-ticket-id "BL-217-inbound-email-webhook"))

(assert= "extracts the ticket id from a routing note's own message text"
         "BL-217"
         (chase-sweep-lib/extract-ticket-id "BL-217 active, spec-complete — pick up next (chmod-0000 test flake)."))

(assert= "returns nil for text with no leading ticket id"
         nil
         (chase-sweep-lib/extract-ticket-id "just a note with no ticket reference"))

(assert= "returns nil for nil input"
         nil
         (chase-sweep-lib/extract-ticket-id nil))

;; ── dispatch-gap-note-message / dispatch-gap-draft-lines (pure) ───────────

(assert= "the auto-route note message leads with the ticket id (the swarm's own convention)"
         "BL-217"
         (chase-sweep-lib/extract-ticket-id (chase-sweep-lib/dispatch-gap-note-message "BL-217")))

(assert= "the auto-route note message stays within swarm_handoff.sh's 80-char limit"
         true
         (<= (count (chase-sweep-lib/dispatch-gap-note-message "BL-217")) chase-sweep-lib/dispatch-gap-note-max-length))

(assert= "dispatch-gap-draft-lines builds a valid note draft addressed to the assignee"
         ["type: note" "to: coder" "priority: 00" "message: BL-217 is active with no dispatch on record - auto-routed by the sweep."]
         (chase-sweep-lib/dispatch-gap-draft-lines {:id "BL-217" :assigned-to "coder"}))

;; ── collect-dispatched-ticket-ids / read-active-items (fixture-based fs I/O,
;;    no live swarm) ─────────────────────────────────────────────────────────

(defn mk-tmp []
  (str (fs/create-temp-dir {:prefix "dispatch-gap-test-"})))

(defn write-handoff! [dir filename headers]
  (fs/create-dirs dir)
  (spit (str (fs/path dir filename))
        (str (str/join "\n" (map (fn [[k v]] (str (name k) ": " v)) headers)) "\n\nbody\n")))

(defn write-active-item! [active-dir id assigned-to]
  (fs/create-dirs active-dir)
  (spit (str (fs/path active-dir (str id "-demo.yaml")))
        (str "id: " id "\ntitle: \"demo\"\nstatus: todo\nassigned_to: " assigned-to "\n")))

(let [tmp (mk-tmp)
      new-dir (str (fs/path tmp "new"))]
  (write-handoff! new-dir "00_a.handoff" {:from "coordinator" :to "coder" :type "git_handoff" :task "BL-100-something"})
  (assert= "collect-dispatched-ticket-ids finds a ticket id in a task header"
           #{"BL-100"}
           (chase-sweep-lib/collect-dispatched-ticket-ids [new-dir])))

(let [tmp (mk-tmp)
      new-dir (str (fs/path tmp "new"))]
  (write-handoff! new-dir "00_a.handoff" {:from "coordinator" :to "coder" :type "note" :message "BL-217 active, spec-complete"})
  (assert= "collect-dispatched-ticket-ids falls back to a note's message header"
           #{"BL-217"}
           (chase-sweep-lib/collect-dispatched-ticket-ids [new-dir])))

(let [tmp (mk-tmp)
      in-process-dir (str (fs/path tmp "in_process"))
      batch-dir (str (fs/path in-process-dir "batch_20260710T000000Z_01"))]
  (write-handoff! batch-dir "00_a.handoff" {:from "coder" :to "cleaner" :type "git_handoff" :task "BL-9-batched"})
  (assert= "collect-dispatched-ticket-ids includes handoffs nested in a batch_* subdirectory"
           #{"BL-9"}
           (chase-sweep-lib/collect-dispatched-ticket-ids [in-process-dir])))

(let [tmp (mk-tmp)]
  (assert= "collect-dispatched-ticket-ids returns an empty set for directories with no handoffs at all"
           #{}
           (chase-sweep-lib/collect-dispatched-ticket-ids [(str (fs/path tmp "new")) (str (fs/path tmp "completed"))])))

(let [tmp (mk-tmp)
      active-dir (str (fs/path tmp "active"))]
  (write-active-item! active-dir "BL-217" "coder")
  (assert= "read-active-items reads id and assigned_to from a backlog/active/*.yaml file"
           [{:id "BL-217" :assigned-to "coder"}]
           (chase-sweep-lib/read-active-items active-dir)))

(let [tmp (mk-tmp)
      active-dir (str (fs/path tmp "active"))]
  (fs/create-dirs active-dir)
  (spit (str (fs/path active-dir "BL-1-demo.yaml")) "id: BL-1\ntitle: \"no assignee\"\nstatus: todo\n")
  (assert= "read-active-items skips an item with no assigned_to (nothing to route)"
           []
           (chase-sweep-lib/read-active-items active-dir)))

(assert= "read-active-items returns an empty vector when backlog/active/ does not exist"
         []
         (chase-sweep-lib/read-active-items (str (fs/path (mk-tmp) "nonexistent-active"))))

;; ── dispatch-gap-items (full pipeline, fixture-based) ─────────────────────

(let [tmp (mk-tmp)
      active-dir (str (fs/path tmp "active"))
      new-dir (str (fs/path tmp "coder-new"))]
  (write-active-item! active-dir "BL-217" "coder")
  (assert= "dispatch-gap-items auto-routes an active item with no dispatch trail anywhere"
           [{:id "BL-217" :assigned-to "coder"}]
           (chase-sweep-lib/dispatch-gap-items active-dir [new-dir])))

(let [tmp (mk-tmp)
      active-dir (str (fs/path tmp "active"))
      new-dir (str (fs/path tmp "coder-new"))]
  (write-active-item! active-dir "BL-217" "coder")
  (write-handoff! new-dir "00_a.handoff" {:from "coordinator" :to "coder" :type "git_handoff" :task "BL-217-inbound-email"})
  (assert= "dispatch-gap-items does not re-route an item that already has a dispatch trail"
           []
           (chase-sweep-lib/dispatch-gap-items active-dir [new-dir])))

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: chase_sweep_lib.bb dispatch-gap functions"))
