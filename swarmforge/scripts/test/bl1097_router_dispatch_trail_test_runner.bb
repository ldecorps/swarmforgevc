#!/usr/bin/env bb
;; BL-1097 TDD runner for chase_sweep_lib.bb's router-side dispatch-trail
;; surface - the half the coordinator's router asks, as opposed to the half
;; the daemon's BL-222 sweep asks.
;;
;; The point of this file is invariant 2: "the router and the daemon's
;; dispatch-gap sweep agree on whether a ticket has been dispatched - two
;; components must not hold contradictory answers to the same question."
;; The way that is made true here is that there is only ONE answer:
;; ticket-dispatched? is defined in terms of decide-dispatch-gaps itself, not
;; as a second membership test kept in step with it. The agreement assertions
;; below therefore check a property of that definition rather than a
;; coincidence between two implementations - and they would catch a later
;; "optimisation" that reintroduced a second copy.
;;
;; Fixture-based fs I/O against a temp dir, same posture as
;; dispatch_gap_test_runner.bb: no live swarm, tmux or daemon.
(ns bl1097-router-dispatch-trail-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "chase_sweep_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

;; ── ticket-dispatched? (pure) ─────────────────────────────────────────────

(assert= "bl1097-01: a ticket with no trail at all is not dispatched - the router may route it"
         false
         (chase-sweep-lib/ticket-dispatched? "BL-9097" #{}))

(assert= "bl1097-02: a ticket already in the trail set is dispatched - the router must not route it again"
         true
         (chase-sweep-lib/ticket-dispatched? "BL-9097" #{"BL-9097"}))

(assert= "bl1097-03: another ticket's trail does not make this one dispatched"
         false
         (chase-sweep-lib/ticket-dispatched? "BL-9097" #{"BL-1" "BL-2"}))

;; ── invariant 2: the router's answer IS the sweep's answer ────────────────
;; Stated as an equivalence over a mixed corpus, in both directions: every
;; item the sweep calls gapped is one the router calls undispatched, and
;; every item the sweep leaves alone is one the router calls dispatched.

(let [items [{:id "BL-1" :assigned-to "coder"}
             {:id "BL-2" :assigned-to "cleaner"}
             {:id "BL-3" :assigned-to "coder"}
             {:id "BL-4" :assigned-to "specifier"}]
      dispatched #{"BL-2" "BL-4"}
      sweep-says (set (map :id (chase-sweep-lib/decide-dispatch-gaps items dispatched)))
      router-says (set (remove #(chase-sweep-lib/ticket-dispatched? % dispatched) (map :id items)))]
  (assert= "bl1097-04: the router and the sweep name exactly the same undispatched tickets"
           sweep-says router-says)
  (assert= "bl1097-04b: and that set is not vacuously empty (the assertion above has teeth)"
           #{"BL-1" "BL-3"}
           sweep-says))

(let [items [{:id "BL-1" :assigned-to "coder"}]]
  (assert= "bl1097-05: agreement holds when NOTHING is dispatched"
           (set (map :id (chase-sweep-lib/decide-dispatch-gaps items #{})))
           (set (remove #(chase-sweep-lib/ticket-dispatched? % #{}) (map :id items))))
  (assert= "bl1097-06: agreement holds when EVERYTHING is dispatched"
           (set (map :id (chase-sweep-lib/decide-dispatch-gaps items #{"BL-1"})))
           (set (remove #(chase-sweep-lib/ticket-dispatched? % #{"BL-1"}) (map :id items)))))

;; ── dispatch-trail-states / dispatch-trail-dirs ───────────────────────────
;; The daemon used to own this list privately (handoffd.bb's
;; dispatch-gap-scan-dirs). It moved here so the router reads the same
;; directories - a router scanning fewer states than the sweep would answer
;; "undispatched" for a ticket the sweep knows about, which is exactly the
;; contradiction invariant 2 forbids.

(assert= "bl1097-07: the trail states are every mailbox state a sent parcel can be sitting in"
         [:new :in_process :completed :sent :outbox]
         chase-sweep-lib/dispatch-trail-states)

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                  (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn mk-tmp []
  (let [d (str (fs/create-temp-dir {:prefix "bl1097-router-trail-"}))]
    (swap! created-temp-dirs conj d)
    d))

(let [tmp (mk-tmp)
      role-infos [{:role "coder" :worktree-name "coder" :worktree-path tmp}
                  {:role "coordinator" :worktree-name "master" :worktree-path tmp}]
      dirs (chase-sweep-lib/dispatch-trail-dirs role-infos)]
  (assert= "bl1097-08: one directory per role per trail state"
           (* (count role-infos) (count chase-sweep-lib/dispatch-trail-states))
           (count dirs))
  ;; The master-resident roles' per-role subdirectory layout is the half a
  ;; hand-rolled path would get wrong - the ticket records an investigation
  ;; misled by exactly that, reading a stale `.swarmforge/handoffs/<role>/`
  ;; path instead of the live per-worktree one. Going through
  ;; handoff-lib/mailbox-dir is what keeps both shapes right.
  (assert= "bl1097-09: the coder's five dirs are its worktree-flat mailbox"
           (mapv #(str (fs/path tmp ".swarmforge" "handoffs" %))
                 ["inbox/new" "inbox/in_process" "inbox/completed" "sent" "outbox"])
           (vec (take 5 dirs)))
  (assert= "bl1097-09b: the master-resident coordinator's five are its own per-role subdirectory"
           (mapv #(str (fs/path tmp ".swarmforge" "handoffs" "coordinator" %))
                 ["inbox/new" "inbox/in_process" "inbox/completed" "sent" "outbox"])
           (vec (drop 5 dirs)))
  (assert= "bl1097-10: dirs are plain strings, ready for collect-dispatched-ticket-ids"
           true
           (every? string? dirs)))

;; ── ticket-dispatched-in? (full pipeline, fixture-based) ──────────────────

(defn write-handoff! [dir filename headers]
  (fs/create-dirs dir)
  (spit (str (fs/path dir filename))
        (str (str/join "\n" (map (fn [[k v]] (str (name k) ": " v)) headers)) "\n\nbody\n")))

(let [tmp (mk-tmp)
      new-dir (str (fs/path tmp "new"))]
  (fs/create-dirs new-dir)
  (assert= "bl1097-11: an empty mailbox tree means the ticket has never been dispatched"
           false
           (chase-sweep-lib/ticket-dispatched-in? "BL-9097" [new-dir])))

(let [tmp (mk-tmp)
      new-dir (str (fs/path tmp "new"))]
  (write-handoff! new-dir "10_a.handoff"
                  {:from "coordinator" :to "coder" :type "note"
                   :message "Work BL-9097-demo: read file in backlog/active"})
  (assert= "bl1097-12: the router's OWN earlier Work note is a dispatch trail - this is the re-route the ticket is about"
           true
           (chase-sweep-lib/ticket-dispatched-in? "BL-9097" [new-dir])))

(let [tmp (mk-tmp)
      completed-dir (str (fs/path tmp "completed"))]
  (write-handoff! completed-dir "50_a.handoff"
                  {:from "coder" :to "cleaner" :type "git_handoff" :task "BL-9097-demo"})
  (assert= "bl1097-13: a trail in ANY state counts - work that has moved on is still dispatched"
           true
           (chase-sweep-lib/ticket-dispatched-in? "BL-9097" [completed-dir])))

(let [tmp (mk-tmp)
      new-dir (str (fs/path tmp "new"))]
  (write-handoff! new-dir "10_a.handoff"
                  {:from "coordinator" :to "coder" :type "note"
                   :message "Work BL-1-other: read file in backlog/active"})
  (assert= "bl1097-14: a different ticket's trail leaves this one routable"
           false
           (chase-sweep-lib/ticket-dispatched-in? "BL-9097" [new-dir])))

;; The whole pipeline, against the same corpus, agreeing with the sweep's own
;; whole pipeline - invariant 2 at the level the two components actually run.
(let [tmp (mk-tmp)
      active-dir (str (fs/path tmp "active"))
      new-dir (str (fs/path tmp "new"))]
  (fs/create-dirs active-dir)
  (doseq [[id assignee] [["BL-1" "coder"] ["BL-2" "cleaner"] ["BL-3" "coder"]]]
    (spit (str (fs/path active-dir (str id "-demo.yaml")))
          (str "id: " id "\ntitle: \"demo\"\nstatus: todo\nassigned_to: " assignee "\n")))
  (write-handoff! new-dir "10_a.handoff"
                  {:from "coordinator" :to "cleaner" :type "note" :message "Work BL-2-demo: read file"})
  (let [sweep-says (set (map :id (chase-sweep-lib/dispatch-gap-items active-dir [new-dir])))
        router-says (set (remove #(chase-sweep-lib/ticket-dispatched-in? % [new-dir]) ["BL-1" "BL-2" "BL-3"]))]
    (assert= "bl1097-15: full-pipeline agreement between router and sweep over a real fixture tree"
             sweep-says router-says)
    (assert= "bl1097-15b: and it is not vacuous - BL-2 is the one with a trail"
             #{"BL-1" "BL-3"}
             sweep-says)))

;; ── report ────────────────────────────────────────────────────────────────

(if (seq @failures)
  (do (doseq [f @failures] (println f))
      (println (str "\n" (count @failures) " failure(s)"))
      (System/exit 1))
  (println "ALL PASS: bl1097 router dispatch-trail"))
