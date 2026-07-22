#!/usr/bin/env bb
;; TDD runner for ticket_close_guard_lib.bb — close gate, done-ticket send
;; guard, and abandon-on-close plumbing.

(ns ticket-close-guard-lib-test-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "ticket_close_guard_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "commit_integrity_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual] (assert= msg true (boolean actual)))
(defn assert-false [msg actual] (assert= msg false (boolean actual)))

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                  (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn mk-root []
  (let [d (str (fs/create-temp-dir {:prefix "ticket-close-guard-test-"}))]
    (swap! created-temp-dirs conj d)
    d))

(defn sh! [dir & args]
  (let [res (process/sh (into ["git" "-C" dir] args))]
    (when-not (zero? (:exit res))
      (throw (ex-info (str "git fixture setup failed: " (str/join " " args)) res)))
    res))

(defn real-git-root []
  (let [dir (mk-root)]
    (sh! dir "init" "-q")
    (sh! dir "config" "user.email" "t@t")
    (sh! dir "config" "user.name" "t")
    (sh! dir "commit" "-q" "-m" "init" "--allow-empty")
    dir))

(defn write-ticket! [root status id]
  (let [dir (fs/path root "backlog" status)]
    (fs/create-dirs dir)
    (spit (str (fs/path dir (str id "-slug.yaml")))
          (str "id: " id "\ntitle: thing\nstatus: " status "\n"))))

(defn write-roles! [root]
  (fs/create-dirs (fs/path root ".swarmforge"))
  (spit (str (fs/path root ".swarmforge" "roles.tsv"))
        (str "architect\tarchitect-wt\t" root "/architect\tswarmforge-architect\tArchitect\tclaude\ttask\n"
             "coordinator\tmaster\t" root "\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n")))

(defn write-coordinator-handoff! [root state filename content]
  (write-roles! root)
  (let [dir (fs/path root ".swarmforge" "handoffs" "coordinator" "inbox" (name state))]
    (fs/create-dirs dir)
    (spit (str (fs/path dir filename)) content)))

(defn write-architect-handoff! [root state filename content]
  (write-roles! root)
  (let [dir (fs/path root "architect" ".swarmforge" "handoffs" "inbox" (name state))]
    (fs/create-dirs dir)
    (spit (str (fs/path dir filename)) content)))

;; ── parse-close-move ─────────────────────────────────────────────────────

(assert= "active/ + done/ for same ticket is a close move"
         "BL-551"
         (:ticket-id (ticket-close-guard-lib/parse-close-move
                      ["backlog/active/BL-551-llm-cost.yaml"
                       "backlog/done/M8/BL-551-llm-cost.yaml"])))

(assert= "ordinary multi-path commit is not a close move"
         nil
         (ticket-close-guard-lib/parse-close-move
          ["backlog/active/BL-100-a.yaml" "backlog/active/BL-101-b.yaml"]))

;; ── validate-close-allowed ───────────────────────────────────────────────

(let [root (mk-root)]
  (write-ticket! root "active" "BL-551")
  (write-coordinator-handoff! root :new "10_qa.handoff"
                              (str "id: x\nfrom: QA\nto: coordinator\npriority: 00\ntype: git_handoff\n"
                                   "task: BL-551-llm-cost\ncommit: a1b2c3d4e5\n\nbody\n"))
  (assert= "close allowed when QA git_handoff references the ticket"
           true
           (:allowed (ticket-close-guard-lib/validate-close-allowed
                       root ["backlog/active/BL-551-slug.yaml"
                             "backlog/done/M8/BL-551-slug.yaml"]))))

(let [root (mk-root)]
  (write-ticket! root "active" "BL-551")
  (write-coordinator-handoff! root :new "10_coder.handoff"
                              (str "id: x\nfrom: coder\nto: coordinator\npriority: 50\ntype: note\n"
                                   "message: BL-551 bookkeeping stale on main\n\nbody\n"))
  (assert= "coder bookkeeping note does not authorize close"
           :missing-qa-approval
           (:reason (ticket-close-guard-lib/validate-close-allowed
                     root ["backlog/active/BL-551-slug.yaml"
                           "backlog/done/M8/BL-551-slug.yaml"]))))

(let [root (mk-root)]
  (write-ticket! root "done" "BL-551")
  (assert-true "ticket-done? reflects backlog/done/"
               (ticket-close-guard-lib/ticket-done? root "BL-551")))

;; ── git-handoff blocked for done tickets ─────────────────────────────────

(let [root (mk-root)]
  (write-ticket! root "done" "BL-551")
  (assert-true "git_handoff blocked when ticket is in done/"
               (ticket-close-guard-lib/git-handoff-blocked-for-task? root "BL-551-llm-cost")))

(let [root (mk-root)]
  (write-ticket! root "active" "BL-551")
  (assert-false "git_handoff allowed while ticket is still active"
                (ticket-close-guard-lib/git-handoff-blocked-for-task? root "BL-551-llm-cost")))

;; ── abandon-inflight ─────────────────────────────────────────────────────

(let [root (mk-root)]
  (write-ticket! root "active" "BL-551")
  (write-architect-handoff! root :new "20_test.handoff"
                            (str "id: x\nfrom: architect\nto: hardender\npriority: 20\ntype: git_handoff\n"
                                 "task: BL-551-llm-cost\ncommit: a1b2c3d4e5\n\nbody\n"))
  (let [arch-new (fs/path root "architect" ".swarmforge" "handoffs" "inbox" "new")
        arch-abandoned (fs/path root "architect" ".swarmforge" "handoffs" "inbox" "abandoned")
        moved (ticket-close-guard-lib/abandon-inflight-for-ticket! root "BL-551")]
    (assert= "abandon moves matching in-flight handoffs"
             1
             (count moved))
    (assert-true "handoff lands in abandoned/"
                 (fs/exists? (fs/path arch-abandoned "20_test.handoff")))
    (assert-false "new/ copy is gone"
                  (fs/exists? (fs/path arch-new "20_test.handoff")))))

;; ── end-to-end close commit after git mv (coordinator shape) ─────────────

(let [root (real-git-root)
      old-path "backlog/active/BL-551-slug.yaml"
      new-path "backlog/done/M8/BL-551-slug.yaml"
      content "id: BL-551\ntitle: thing\nstatus: active\n"]
  (fs/create-dirs (fs/path root "backlog" "active"))
  (fs/create-dirs (fs/path root "backlog" "done" "M8"))
  (spit (str (fs/path root old-path)) content)
  (sh! root "add" "--" old-path)
  (sh! root "commit" "-q" "-m" "seed BL-551")
  (write-coordinator-handoff! root :new "00_qa.handoff"
                              (str "id: x\nfrom: QA\nto: coordinator\npriority: 00\ntype: git_handoff\n"
                                   "task: BL-551-slug\ncommit: a1b2c3d4e5\n\nbody\n"))
  (assert-true "QA-approved close move passes validate-close-allowed after git mv"
               (:allowed (ticket-close-guard-lib/validate-close-allowed root [old-path new-path])))
  (sh! root "mv" old-path new-path)
  (let [result (commit-integrity-lib/commit-with-integrity!
                {:project-root root :paths [old-path new-path] :message "Close BL-551: move to done"})]
    (assert-true "commit-with-integrity! succeeds for git-mv-shaped close paths"
                 (:success result))))

(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: ticket_close_guard_lib.bb"))
