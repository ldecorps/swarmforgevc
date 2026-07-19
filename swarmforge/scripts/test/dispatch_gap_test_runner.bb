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

(assert= "Spec BL-### verb-first notes count as a dispatch trail (no auto-route spam)"
         "BL-538"
         (chase-sweep-lib/extract-ticket-id
          "Spec BL-538 console paused-ticket pager — high priority, epic swarmforge-console"))

(assert= "Work BL-### verb-first notes count as a dispatch trail"
         "BL-512"
         (chase-sweep-lib/extract-ticket-id
          "Work BL-512-recurring-failure-mode-audit: read file in backlog/active"))

(assert= "returns nil for nil input"
         nil
         (chase-sweep-lib/extract-ticket-id nil))

;; BL-488-VIOLATION: mirrors pipeline_stage_lib_test_runner.bb's own
;; glued-letter-prefix coverage for this sweep's sibling extract-ticket-id.
(assert= "a letter glued directly in front of a real id resolves to nil, not the glued prefix"
         nil
         (chase-sweep-lib/extract-ticket-id "ABL-217 active, spec-complete."))

(assert= "the known-prefix allowlist still recognizes a real GH- ticket id"
         "GH-42"
         (chase-sweep-lib/extract-ticket-id "GH-42-inbound-email-webhook"))

;; BL-503: the prefix hyphen is OPTIONAL (a no-hyphen task header, "blNNN",
;; is the form ~14 in-flight coder tickets were actually minted with), and
;; every match is now CANONICALIZED to upper-case hyphenated form - this
;; extractor previously returned the raw, un-canonicalized match, so a
;; lower-case hyphenated id ("bl-493-...") silently failed the case-sensitive
;; active-set join downstream.
(assert= "BL-503: a no-hyphen lower-case leading id resolves and canonicalizes"
         "BL-493"
         (chase-sweep-lib/extract-ticket-id "bl493-fold-ticket-events"))
(assert= "BL-503: a hyphenated but lower-case leading id now canonicalizes (was returned raw)"
         "BL-493"
         (chase-sweep-lib/extract-ticket-id "bl-493-fold-ticket-events"))
(assert= "BL-503: the canonical hyphenated upper-case form is unaffected (regression)"
         "BL-493"
         (chase-sweep-lib/extract-ticket-id "BL-493-fold-ticket-events"))
(assert= "BL-503: a no-hyphen GH- id resolves and canonicalizes"
         "GH-77"
         (chase-sweep-lib/extract-ticket-id "gh77-issue-seeded"))
(assert= "BL-503: a glued prefix still resolves to nil with the hyphen optional (no over-match)"
         nil
         (chase-sweep-lib/extract-ticket-id "ABL-217-glued-prefix"))
(assert= "BL-503: a glued word with no hyphen still resolves to nil (no over-match)"
         nil
         (chase-sweep-lib/extract-ticket-id "usable493-not-a-ticket"))

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

(def created-temp-dirs (atom []))
;; BL-459: every temp dir this runner creates is tracked here and removed by
;; a JVM shutdown hook, registered ONCE below - fires on both a clean run
;; and an uncaught assertion/exception propagating out of this script
;; (verified empirically: Runtime/addShutdownHook runs on System/exit and on
;; an uncaught throwable unwinding to the top level), never on SIGKILL/OOM
;; (BL-413's periodic /tmp sweep is the backstop for that - out of scope
;; here).
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn mk-tmp []
  (let [d (str (fs/create-temp-dir {:prefix "dispatch-gap-test-"}))]
    (swap! created-temp-dirs conj d)
    d))

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


;; ── Unassigned-active → coordinator nudge (not auto-assign) ───────────────

(let [tmp (mk-tmp)
      active-dir (str (fs/path tmp "active"))]
  (fs/create-dirs active-dir)
  (spit (str (fs/path active-dir "BL-523-demo.yaml"))
        "id: BL-523\ntitle: \"demo\"\nstatus: todo\n")
  (assert= "read-unassigned-active-items finds active with no assigned_to"
           [{:id "BL-523" :assigned-to nil}]
           (chase-sweep-lib/read-unassigned-active-items active-dir))
  (assert= "read-active-items still skips unassigned (BL-222 assignee auto-route unchanged)"
           []
           (chase-sweep-lib/read-active-items active-dir)))

(let [tmp (mk-tmp)
      active-dir (str (fs/path tmp "active"))]
  (write-active-item! active-dir "BL-1" "coder")
  (assert= "read-unassigned-active-items skips items that already have assigned_to"
           []
           (chase-sweep-lib/read-unassigned-active-items active-dir)))

(let [tmp (mk-tmp)
      active-dir (str (fs/path tmp "active"))
      scan (str (fs/path tmp "empty-mail"))]
  (fs/create-dirs active-dir)
  (fs/create-dirs scan)
  (spit (str (fs/path active-dir "BL-523-demo.yaml")) "id: BL-523\ntitle: \"x\"\n")
  (assert= "unassigned-active-items returns unassigned with no trail"
           [{:id "BL-523" :assigned-to nil}]
           (chase-sweep-lib/unassigned-active-items active-dir [scan])))

(let [tmp (mk-tmp)
      active-dir (str (fs/path tmp "active"))
      coord-new (str (fs/path tmp "coord-new"))]
  (fs/create-dirs active-dir)
  (spit (str (fs/path active-dir "BL-523-demo.yaml")) "id: BL-523\ntitle: \"x\"\n")
  (write-handoff! coord-new "00_nudge.handoff"
                  {:from "coordinator" :to "coordinator" :type "note"
                   :message "BL-523 active unassigned - assign_to and route it."})
  (assert= "unassigned-active-items does not re-nudge once a trail exists"
           []
           (chase-sweep-lib/unassigned-active-items active-dir [coord-new])))

(assert= "unassigned-active-draft-lines address the coordinator only"
         ["type: note" "to: coordinator" "priority: 00"
          "message: BL-523 active unassigned - assign_to and route it."]
         (chase-sweep-lib/unassigned-active-draft-lines {:id "BL-523" :assigned-to nil}))

(assert= "unassigned draft never targets coder/specifier"
         true
         (not (some #(str/includes? % "to: coder")
                    (chase-sweep-lib/unassigned-active-draft-lines {:id "BL-1"}))))

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: chase_sweep_lib.bb dispatch-gap functions"))
