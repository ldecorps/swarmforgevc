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
         (:ticket-id (first (ticket-close-guard-lib/parse-close-move
                              ["backlog/active/BL-551-llm-cost.yaml"
                               "backlog/done/M8/BL-551-llm-cost.yaml"]))))

(assert= "ordinary multi-path commit is not a close move"
         nil
         (ticket-close-guard-lib/parse-close-move
          ["backlog/active/BL-100-a.yaml" "backlog/active/BL-101-b.yaml"]))

;; BL-869 fault B: a close commit moving MULTIPLE tickets active -> done
;; must return one entry PER ticket, not `(first ...)` collapsed to one -
;; the false-ALLOW fault where tickets 2..N rode through with zero
;; validation.
(assert= "a close commit moving two tickets returns one entry per ticket, grouped order"
         [{:ticket-id "BL-857" :active-path "backlog/active/BL-857-a.yaml" :done-path "backlog/done/BL-857-a.yaml"}
          {:ticket-id "BL-849" :active-path "backlog/active/BL-849-b.yaml" :done-path "backlog/done/BL-849-b.yaml"}]
         (ticket-close-guard-lib/parse-close-move
          ["backlog/active/BL-857-a.yaml" "backlog/done/BL-857-a.yaml"
           "backlog/active/BL-849-b.yaml" "backlog/done/BL-849-b.yaml"]))

;; BL-869 fault B, second reported shape: with the paths interleaved so the
;; FIRST active and FIRST done path name DIFFERENT tickets, `(first
;; (filter active))` + `(first (filter done))` used to pair BL-857's
;; active path with BL-849's done path (different ids, same-id check
;; failed) and return nil, which validate-close-allowed then read as "not
;; a close move at all" - {:allowed true} for an unvalidated close. Every
;; ticket must still resolve correctly by matching on shared id, regardless
;; of which path arrives first.
(assert= "path order does not change which active pairs with which done"
         [{:ticket-id "BL-857" :active-path "backlog/active/BL-857-a.yaml" :done-path "backlog/done/BL-857-a.yaml"}
          {:ticket-id "BL-849" :active-path "backlog/active/BL-849-b.yaml" :done-path "backlog/done/BL-849-b.yaml"}]
         (ticket-close-guard-lib/parse-close-move
          ["backlog/active/BL-857-a.yaml" "backlog/active/BL-849-b.yaml"
           "backlog/done/BL-849-b.yaml" "backlog/done/BL-857-a.yaml"]))

;; ── BL-1378: the expedite verdict record as a second approval PATH ───────
;;
;; The mailbox check asks for a QA git_handoff or note in the coordinator's
;; mailbox. An expedite run is forbidden by design from touching the mailboxes
;; at all (BL-567), so it can never produce one, and no ticket it finishes
;; could be committed to done/ by any route. The expeditor does already write a
;; durable QA-hat verdict record (BL-1025) that the ONE approval predicate
;; reads, so the guard reads the same store - an additional PATH to approval,
;; never a second definition of it (BL-925 invariant 2).
;;
;; close-verdict is the pure decision: three answers in, one verdict out. The
;; fs and git legwork is beside it, so every branch below is checked without a
;; fixture.

(defn- verdict [& {:as over}]
  (ticket-close-guard-lib/close-verdict
   (merge {:qa-mailbox? false :store {:kind :absent} :ancestor? nil} over)))

;; The mailbox path decides first and decides alone. A store that cannot be
;; read must never break a close the mailbox already approved: invariant 1
;; says the normal path is exactly as it was, and an unrelated corrupt file
;; taking the pipeline's own close route down would be a far worse defect than
;; the one this ticket fixes.
(assert-true "a QA mailbox handoff still allows the close"
             (:allowed? (verdict :qa-mailbox? true)))
(assert-true "and it allows it even when the expedite store is unusable"
             (:allowed? (verdict :qa-mailbox? true :store {:kind :problem :detail "unreadable"})))

;; The new path.
(let [v (verdict :store {:kind :approved :commit "c370d1e28a" :store-file ".swarmforge/expedite-approvals/2026-09.jsonl"}
                 :ancestor? true)]
  (assert-true "an approved expedite record whose commit reached main allows the close" (:allowed? v))
  (assert-true "and the verdict names the record it relied on"
               (str/includes? (str (:detail v)) "c370d1e28a"))
  (assert-true "including the store it came from"
               (str/includes? (str (:detail v)) "expedite-approvals")))

;; The human's ruling (option 1, 2026-09-03): the record is not enough on its
;; own. A ticket in backlog/done/ whose code is on no branch anyone reads is
;; exactly the BL-1375 situation this must not make official.
(let [v (verdict :store {:kind :approved :commit "c370d1e28a"} :ancestor? false)]
  (assert-false "an approved commit that never reached main does not close its ticket" (:allowed? v))
  (assert= "and the refusal says so" :expedite-commit-not-on-main (:reason v))
  (assert-true "naming the commit, so it can be looked up"
               (str/includes? (str (:detail v)) "c370d1e28a")))

;; An ancestry question that could not be answered is not a yes.
(let [v (verdict :store {:kind :approved :commit "c370d1e28a"} :ancestor? nil)]
  (assert-false "an unanswerable ancestry check refuses" (:allowed? v))
  (assert= "as its own reason, not as 'not on main'" :expedite-ancestry-undeterminable (:reason v)))

;; Invariant 2, every shape.
(doseq [detail ["the store is obstructed by a file"
                "the store is unreadable"
                "a record line has no commit field"
                "a record line has no approval field"]]
  (let [v (verdict :store {:kind :problem :detail detail})]
    (assert-false (str "an unusable store refuses: " detail) (:allowed? v))
    (assert= (str "and says it is a store problem: " detail) :expedite-store-problem (:reason v))
    (assert-true (str "naming the problem: " detail) (str/includes? (str (:detail v)) detail))))

;; Invariant 2's other half: absence is never approval, and never a store
;; problem either - it is simply no expedite path, so the mailbox answer stands.
(let [v (verdict :store {:kind :absent})]
  (assert-false "an absent store is not an approval" (:allowed? v))
  (assert= "and it reports the missing QA approval, not a store problem"
           :missing-qa-approval (:reason v)))

(let [v (verdict :store {:kind :no-match})]
  (assert-false "a readable store with no matching record is not an approval" (:allowed? v))
  (assert= "and that too is a missing QA approval" :missing-qa-approval (:reason v)))

;; Invariant 3, checked where the matching happens.
(let [line {:ticket "BL-9001" :stage "QA" :approval true :commit "c370d1e28a"}]
  (assert-true "a QA record with approval true matches its own ticket"
               (ticket-close-guard-lib/expedite-record-approves? line "BL-9001"))
  (assert-false "one ticket's record never closes another's"
                (ticket-close-guard-lib/expedite-record-approves? line "BL-9002"))
  (assert-false "a record from another stage never closes a ticket"
                (ticket-close-guard-lib/expedite-record-approves? (assoc line :stage "coder") "BL-9001"))
  (assert-false "and approval false never closes one"
                (ticket-close-guard-lib/expedite-record-approves? (assoc line :approval false) "BL-9001"))
  (assert-false "a record with no ticket field matches nothing"
                (ticket-close-guard-lib/expedite-record-approves? (dissoc line :ticket) "BL-9001")))

;; ── the store reader ─────────────────────────────────────────────────────

(let [root (mk-root)]
  (assert= "no store at all is :absent"
           :absent (:kind (ticket-close-guard-lib/expedite-approval root "BL-9001"))))

(let [root (mk-root)]
  (fs/create-dirs (fs/path root ".swarmforge"))
  (spit (str (fs/path root ".swarmforge" "expedite-approvals")) "not a directory
")
  (let [v (ticket-close-guard-lib/expedite-approval root "BL-9001")]
    (assert= "a store obstructed by a file is a problem" :problem (:kind v))
    (assert-true "and the problem names the obstruction" (str/includes? (:detail v) "not a directory"))))

(defn- write-store! [root filename lines]
  (let [dir (fs/path root ".swarmforge" "expedite-approvals")]
    (fs/create-dirs dir)
    (spit (str (fs/path dir filename)) (str (str/join "
" lines) "
"))
    (str (fs/path dir filename))))

(let [root (mk-root)]
  (write-store! root "2026-09.jsonl"
                ["{\"at\":\"x\",\"ticket\":\"BL-9001\",\"stage\":\"QA\",\"approval\":true,\"verdict\":\"pass\",\"commit\":\"c370d1e28a\"}"])
  (let [v (ticket-close-guard-lib/expedite-approval root "BL-9001")]
    (assert= "a matching record is :approved" :approved (:kind v))
    (assert= "and carries the commit it approved" "c370d1e28a" (:commit v))
    (assert-true "and the file it came from" (str/includes? (str (:store-file v)) "2026-09.jsonl"))))

(let [root (mk-root)]
  (write-store! root "2026-09.jsonl"
                ["{\"ticket\":\"BL-9002\",\"stage\":\"QA\",\"approval\":true,\"commit\":\"c370d1e28a\"}"])
  (assert= "a store naming only other tickets is :no-match"
           :no-match (:kind (ticket-close-guard-lib/expedite-approval root "BL-9001"))))

(let [root (mk-root)]
  (write-store! root "2026-09.jsonl" ["{\"ticket\":\"BL-9001\",\"stage\":\"QA\",\"approval\":true}"])
  (let [v (ticket-close-guard-lib/expedite-approval root "BL-9001")]
    (assert= "a line with no commit field makes the store untrusted" :problem (:kind v))
    (assert-true "and says which field" (str/includes? (:detail v) "commit"))))

(let [root (mk-root)]
  (write-store! root "2026-09.jsonl" ["{\"ticket\":\"BL-9001\",\"stage\":\"QA\",\"commit\":\"c370d1e28a\"}"])
  (let [v (ticket-close-guard-lib/expedite-approval root "BL-9001")]
    (assert= "a line with no approval field makes the store untrusted" :problem (:kind v))
    (assert-true "and says which field" (str/includes? (:detail v) "approval"))))

(let [root (mk-root)]
  (write-store! root "2026-09.jsonl" ["this is not json"])
  (assert= "an unparseable line makes the store untrusted"
           :problem (:kind (ticket-close-guard-lib/expedite-approval root "BL-9001"))))

;; A corrupt line ANYWHERE poisons the store, even beside a record that would
;; have matched: a store that cannot be trusted either way must not hand out
;; the half of itself that happens to parse.
(let [root (mk-root)]
  (write-store! root "2026-09.jsonl"
                ["{\"ticket\":\"BL-9001\",\"stage\":\"QA\",\"approval\":true,\"commit\":\"c370d1e28a\"}"
                 "half a line"])
  (assert= "a matching record beside a corrupt one is still a problem"
           :problem (:kind (ticket-close-guard-lib/expedite-approval root "BL-9001"))))

;; Blank lines are not corruption - a jsonl file ends in a newline.
(let [root (mk-root)]
  (write-store! root "2026-09.jsonl"
                ["{\"ticket\":\"BL-9001\",\"stage\":\"QA\",\"approval\":true,\"commit\":\"c370d1e28a\"}"
                 ""])
  (assert= "a trailing blank line is not corruption"
           :approved (:kind (ticket-close-guard-lib/expedite-approval root "BL-9001"))))

;; ── validate-close-allowed ───────────────────────────────────────────────;; ── validate-close-allowed ───────────────────────────────────────────────

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

;; BL-869 fault A: qa-approved-ticket? used to compare against
;; ticket-id-from-headers' single first-match extraction, so a note
;; approving "BL-857,BL-849,BL-840" credited only BL-857 - closing BL-849
;; or BL-840 was refused with "no QA git_handoff or note ... referencing
;; this ticket" against a note that plainly named them (Article 2.6).
(let [root (mk-root)]
  (write-ticket! root "active" "BL-857")
  (write-ticket! root "active" "BL-849")
  (write-coordinator-handoff! root :new "00_qa.handoff"
                              (str "id: x\nfrom: QA\nto: coordinator\npriority: 00\ntype: note\n"
                                   "message: QA approved BL-857,BL-849,BL-840 @ 0bae185f9b, landed on main. Bookkeep all 3.\n\nbody\n"))
  (let [result (ticket-close-guard-lib/validate-close-allowed
                root ["backlog/active/BL-857-a.yaml" "backlog/done/BL-857-a.yaml"
                      "backlog/active/BL-849-b.yaml" "backlog/done/BL-849-b.yaml"])]
    (assert-true "a multi-ticket QA note authorizes closing every ticket it names, not just the first"
                 (:allowed result))
    (assert= "the close reports every ticket-id it closed"
             ["BL-857" "BL-849"]
             (:ticket-ids result))))

;; BL-869 fault B: parse-close-move used to collapse an N-ticket close to
;; ONE {:ticket-id ...} map (`(first (filter active))` / `(first (filter
;; done))`), so tickets 2..N were committed with NO approval check at all -
;; the guard's entire purpose silently bypassed. One ticket approved, one
;; not: the close must block, naming only the one that failed.
(let [root (mk-root)]
  (write-ticket! root "active" "BL-857")
  (write-ticket! root "active" "BL-849")
  (write-coordinator-handoff! root :new "00_qa.handoff"
                              (str "id: x\nfrom: QA\nto: coordinator\npriority: 00\ntype: git_handoff\n"
                                   "task: BL-857-a\ncommit: a1b2c3d4e5\n\nbody\n"))
  (let [result (ticket-close-guard-lib/validate-close-allowed
                root ["backlog/active/BL-857-a.yaml" "backlog/done/BL-857-a.yaml"
                      "backlog/active/BL-849-b.yaml" "backlog/done/BL-849-b.yaml"])]
    (assert-false "one unapproved ticket blocks the whole multi-ticket close"
                  (:allowed result))
    (assert= "the block names only the ticket that failed approval, not the approved one"
             ["BL-849"]
             (:blocked-ticket-ids result))
    (assert= "the block still reports every ticket the commit tried to close"
             ["BL-857" "BL-849"]
             (:ticket-ids result))))

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
