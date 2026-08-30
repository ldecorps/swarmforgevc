#!/usr/bin/env bb
;; TDD runner for review_forward_evidence_gate_lib.bb (BL-806) — the send-time
;; gate that refuses a review role's forward-direction git_handoff naming
;; exactly the commit it received for the same task.

(ns review-forward-evidence-gate-lib-test-runner
  (:require [babashka.fs :as fs]
            [babashka.process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "review_forward_evidence_gate_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual] (assert= msg true actual))
(defn assert-false [msg actual] (assert= msg false actual))
(defn assert-nil [msg actual] (assert= msg nil actual))

(defn assert-includes [msg haystack needle]
  (when-not (str/includes? haystack needle)
    (swap! failures conj (str "FAIL: " msg "\n  expected to include: " (pr-str needle) "\n  actual: " (pr-str haystack)))))

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                  (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn mk-root []
  (let [d (str (fs/create-temp-dir {:prefix "review-forward-gate-test-"}))]
    (swap! created-temp-dirs conj d)
    d))

(defn write-roles! [root]
  (fs/create-dirs (fs/path root ".swarmforge"))
  (spit (str (fs/path root ".swarmforge" "roles.tsv"))
        (str "coder\tcoder-wt\t" root "/coder\tswarmforge-coder\tCoder\tclaude\ttask\n"
             "cleaner\tcleaner-wt\t" root "/cleaner\tswarmforge-cleaner\tCleaner\tclaude\tbatch\n"
             "architect\tarchitect-wt\t" root "/architect\tswarmforge-architect\tArchitect\tclaude\ttask\n"
             "hardender\thardender-wt\t" root "/hardender\tswarmforge-hardender\tHardener\tclaude\tbatch\n"
             "documenter\tdocumenter-wt\t" root "/documenter\tswarmforge-documenter\tDocumenter\tclaude\ttask\n"
             "QA\tQA-wt\t" root "/QA\tswarmforge-QA\tQa\tclaude\ttask\n"
             "coordinator\tmaster\t" root "\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n")))

(defn write-in-process! [root role filename {:keys [type task commit]
                                             :or {type "git_handoff"}}]
  (let [role-info (handoff-lib/load-role-info role root)
        dir (handoff-lib/mailbox-dir role-info :in_process)]
    (fs/create-dirs dir)
    (spit (str (fs/path dir filename))
          (str "id: x\nfrom: coder\nto: " role "\npriority: 50\ntype: " type "\n"
               (when (= type "git_handoff") (str "task: " task "\ncommit: " commit "\n"))
               "\nbody\n"))))

;; ── received-commit-for-task ─────────────────────────────────────────────

(let [root (mk-root)]
  (write-roles! root)
  (assert-nil "no mailbox contents -> nil (fail open)"
              (review-forward-evidence-gate-lib/received-commit-for-task root "architect" "BL-T")))

(let [root (mk-root)]
  (write-roles! root)
  (assert-nil "unknown sender role -> nil (fail open)"
              (review-forward-evidence-gate-lib/received-commit-for-task root "nonexistent-role" "BL-T")))

(let [root (mk-root)]
  (write-roles! root)
  (write-in-process! root "architect" "00_received.handoff" {:task "BL-T" :commit "aaaaaaaaaa"})
  (assert= "the matching in_process git_handoff's commit is returned"
           "aaaaaaaaaa"
           (review-forward-evidence-gate-lib/received-commit-for-task root "architect" "BL-T")))

(let [root (mk-root)]
  (write-roles! root)
  (write-in-process! root "architect" "00_other_task.handoff" {:task "BL-OTHER" :commit "aaaaaaaaaa"})
  (assert-nil "a different task's parcel never matches (task field equality, not any parcel present)"
              (review-forward-evidence-gate-lib/received-commit-for-task root "architect" "BL-T")))

(let [root (mk-root)]
  (write-roles! root)
  (write-in-process! root "architect" "00_note.handoff" {:type "note"})
  (assert-nil "a note (no task/commit header) is never a matching git_handoff"
              (review-forward-evidence-gate-lib/received-commit-for-task root "architect" "BL-T")))

(let [root (mk-root)]
  (write-roles! root)
  ;; batch role, two in-process tasks: filename order picks the newest.
  (write-in-process! root "cleaner" "10_first.handoff" {:task "BL-T" :commit "1111111111"})
  (write-in-process! root "cleaner" "20_second.handoff" {:task "BL-T" :commit "2222222222"})
  (assert= "the newest (highest-sorting filename) match wins among several"
           "2222222222"
           (review-forward-evidence-gate-lib/received-commit-for-task root "cleaner" "BL-T")))

;; ── blocked?: the core truth table (BL-654 invariants 1 and 2) ──────────

(defn base-args []
  {:type "git_handoff" :sender "architect" :recipients ["hardender"]
   :task-name "BL-T" :commit "bbbbbbbbbb" :reroute-reason nil
   :received-commit "bbbbbbbbbb"})

(assert-true "review role, forward direction, same commit, no reroute -> blocked"
             (review-forward-evidence-gate-lib/blocked? (base-args)))

(assert-false "descendant (different) commit -> not blocked"
              (review-forward-evidence-gate-lib/blocked?
               (assoc (base-args) :commit "cccccccccc")))

(assert-false "reroute_reason present -> not blocked (marked detour)"
              (review-forward-evidence-gate-lib/blocked?
               (assoc (base-args) :reroute-reason "cannot act, routing onward")))

(assert-false "backward bounce (architect -> cleaner) -> not blocked"
              (review-forward-evidence-gate-lib/blocked?
               (assoc (base-args) :recipients ["cleaner"])))

(assert-false "non-review sender (coder) -> not blocked"
              (review-forward-evidence-gate-lib/blocked?
               (assoc (base-args) :sender "coder" :recipients ["cleaner"])))

;; ── BL-950: QA's approval hop is now inside the gate ────────────────────
;; (replaces BL-806's "QA sender -> not blocked (excluded this slice)" row -
;; the exclusion was that slice's approved scope, taken back for the
;; approval hop only by BL-950's own human approval)

(assert-true "BL-950: QA -> coordinator approval naming the received commit -> blocked"
             (review-forward-evidence-gate-lib/blocked?
              (assoc (base-args) :sender "QA" :recipients ["coordinator"])))

(assert-false "BL-950: QA -> coordinator approval naming a DIFFERENT commit -> not blocked"
              (review-forward-evidence-gate-lib/blocked?
               (assoc (base-args) :sender "QA" :recipients ["coordinator"] :commit "cccccccccc")))

(assert-false "BL-950: QA -> coordinator same commit WITH reroute_reason -> not blocked (marked detour)"
              (review-forward-evidence-gate-lib/blocked?
               (assoc (base-args) :sender "QA" :recipients ["coordinator"]
                      :reroute-reason "deliberate detour")))

(assert-false "BL-950: QA -> coder bounce naming the same commit -> not blocked (bounce direction ungated)"
              (review-forward-evidence-gate-lib/blocked?
               (assoc (base-args) :sender "QA" :recipients ["coder"])))

(assert-false "BL-950: QA note to coordinator -> not blocked (type gate unchanged)"
              (review-forward-evidence-gate-lib/blocked?
               (assoc (base-args) :sender "QA" :recipients ["coordinator"] :type "note")))

(assert-false "BL-950: QA -> coordinator with no received-commit -> not blocked (fail open, invariant 2)"
              (review-forward-evidence-gate-lib/blocked?
               (assoc (base-args) :sender "QA" :recipients ["coordinator"] :received-commit nil)))

(assert-false "BL-950: a review role -> coordinator is NOT the approval hop (only QA gets it)"
              (review-forward-evidence-gate-lib/blocked?
               (assoc (base-args) :sender "architect" :recipients ["coordinator"])))

(assert-false "BL-950: QA -> QA-and-coordinator multi-recipient -> not blocked (single-recipient gate unchanged)"
              (review-forward-evidence-gate-lib/blocked?
               (assoc (base-args) :sender "QA" :recipients ["coordinator" "coder"])))

(assert-false "no received-commit on file -> not blocked (fail open)"
              (review-forward-evidence-gate-lib/blocked?
               (assoc (base-args) :received-commit nil)))

(assert-false "note type -> not blocked"
              (review-forward-evidence-gate-lib/blocked?
               (assoc (base-args) :type "note")))

(assert-false "rule_proposal type -> not blocked"
              (review-forward-evidence-gate-lib/blocked?
               (assoc (base-args) :type "rule_proposal")))

(assert-false "multi-recipient send -> not blocked (no single forward stage to check)"
              (review-forward-evidence-gate-lib/blocked?
               (assoc (base-args) :recipients ["hardender" "documenter"])))

(assert-false "blank task-name -> not blocked"
              (review-forward-evidence-gate-lib/blocked?
               (assoc (base-args) :task-name "")))

(assert-false "blank commit -> not blocked"
              (review-forward-evidence-gate-lib/blocked?
               (assoc (base-args) :commit "")))

;; ── refusal-message ──────────────────────────────────────────────────────

(let [msg (review-forward-evidence-gate-lib/refusal-message
           {:sender "architect" :task-name "BL-T" :commit "bbbbbbbbbb"})]
  (assert-includes "refusal names the ticket/task" msg "BL-T")
  (assert-includes "refusal names the commit" msg "bbbbbbbbbb")
  (assert-includes "refusal names the sender role" msg "architect")
  (assert-includes "refusal names Article 4.4" msg "4.4")
  (assert-includes "refusal names the reroute_reason exemption" msg "reroute_reason"))

;; ── BL-1293: judged by what the commit CONTRIBUTED, not by its id ────────
;; BL-806 compared commit identity, so a bare "Merge <received> into
;; <role-branch>" - the commit shape this swarm produces most often - passed
;; the gate while the role authored nothing. The architect forwarded BL-1224
;; that way and only a human-authored QA bounce caught it.

(assert-true "a merge introducing nothing of its own -> blocked, though its id differs"
             (review-forward-evidence-gate-lib/blocked?
              (assoc (base-args) :commit "cccccccccc" :introduces-nothing-own? true)))

(assert-false "a merge that DOES introduce its own content -> not blocked"
              (review-forward-evidence-gate-lib/blocked?
               (assoc (base-args) :commit "cccccccccc" :introduces-nothing-own? false)))

(assert-false "unknown contribution (git could not tell) -> not blocked (fail open)"
              (review-forward-evidence-gate-lib/blocked?
               (assoc (base-args) :commit "cccccccccc" :introduces-nothing-own? nil)))

(assert-false "non-review sender forwarding an empty merge -> not blocked (surface unchanged)"
              (review-forward-evidence-gate-lib/blocked?
               (assoc (base-args) :sender "coder" :recipients ["cleaner"]
                      :commit "cccccccccc" :introduces-nothing-own? true)))

(assert-false "empty merge WITH reroute_reason -> not blocked (marked detour still exempt)"
              (review-forward-evidence-gate-lib/blocked?
               (assoc (base-args) :commit "cccccccccc" :introduces-nothing-own? true
                      :reroute-reason "cannot act, routing onward")))

(assert-false "empty merge on a BACKWARD bounce -> not blocked (direction gate unchanged)"
              (review-forward-evidence-gate-lib/blocked?
               (assoc (base-args) :recipients ["cleaner"]
                      :commit "cccccccccc" :introduces-nothing-own? true)))

(assert-false "empty merge as a note -> not blocked (type gate unchanged)"
              (review-forward-evidence-gate-lib/blocked?
               (assoc (base-args) :type "note" :commit "cccccccccc" :introduces-nothing-own? true)))

(assert-true "BL-950 hop: QA -> coordinator approval that is an empty merge -> blocked"
             (review-forward-evidence-gate-lib/blocked?
              (assoc (base-args) :sender "QA" :recipients ["coordinator"]
                     :commit "cccccccccc" :introduces-nothing-own? true)))

(assert-false "blank commit with introduces-nothing-own? true -> not blocked"
              (review-forward-evidence-gate-lib/blocked?
               (assoc (base-args) :commit "" :introduces-nothing-own? true)))

(assert-true "BL-806 unchanged: same commit still blocks with no contribution fact at all"
             (review-forward-evidence-gate-lib/blocked? (base-args)))

;; ── BL-1293: forward-introduces-nothing-own? over a real repository ──────
;; The fs/git half, kept out of `blocked?` the same way received-commit-for-task
;; is, so the pure decision stays fixture-free.

(defn- git-env []
  ;; BL-1233: an ambient GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE retargets these
  ;; fixture commands at the REAL repository - `-C` does not save you.
  (dissoc (into {} (System/getenv)) "GIT_DIR" "GIT_WORK_TREE" "GIT_INDEX_FILE"))

(defn- git! [root & args]
  (let [res (apply babashka.process/sh {:dir root :env (git-env)} "git" args)]
    (when-not (zero? (:exit res))
      (throw (ex-info (str "fixture git failed: " (pr-str args) "\n" (:err res)) {})))
    (str/trim (:out res))))

(defn- mk-git-repo []
  (let [root (mk-root)]
    (git! root "init" "-q" "-b" "main")
    (git! root "config" "user.email" "fixture@example.com")
    (git! root "config" "user.name" "fixture")
    (spit (str (fs/path root "base.txt")) "base\n")
    (git! root "add" "-A")
    (git! root "commit" "-qm" "base")
    root))

;; A bare merge of a received commit into a role branch that carries unrelated
;; prior content: two parents, a tree that matches NEITHER parent, and nothing
;; the role authored. This is the exact BL-1224 shape.
(let [root (mk-git-repo)
      base (git! root "rev-parse" "HEAD")]
  (git! root "checkout" "-q" "-b" "swarmforge-architect")
  (spit (str (fs/path root "architect-prior.txt")) "unrelated prior content\n")
  (git! root "add" "-A")
  (git! root "commit" "-qm" "prior architect content")
  (git! root "checkout" "-q" "main")
  (spit (str (fs/path root "incoming.txt")) "the parcel\n")
  (git! root "add" "-A")
  (git! root "commit" "-qm" "cleaner parcel")
  (let [received (git! root "rev-parse" "HEAD")]
    (git! root "checkout" "-q" "swarmforge-architect")
    (git! root "merge" "--no-ff" "-q" "-m" (str "Merge commit '" received "' into swarmforge-architect") received)
    (let [merge-sha (git! root "rev-parse" "HEAD")]
      (assert-true "a bare merge introducing nothing of its own is detected"
                   (review-forward-evidence-gate-lib/forward-introduces-nothing-own? root merge-sha))
      (assert= "sanity: the merge really is a distinct commit from what was received"
               false (= merge-sha received))
      ;; the role then commits its own evidence and forwards THAT
      (spit (str (fs/path root "evidence.md")) "architect pass: NONE\n")
      (git! root "add" "-A")
      (git! root "commit" "-qm" "architect evidence")
      (assert-false "a commit carrying the role's own evidence is not 'nothing of its own'"
                    (review-forward-evidence-gate-lib/forward-introduces-nothing-own? root (git! root "rev-parse" "HEAD")))
      (assert-false "a plain non-merge commit is never 'nothing of its own'"
                    (review-forward-evidence-gate-lib/forward-introduces-nothing-own? root received))
      ;; The shape that broke BL-806's own acceptance suite when this gate
      ;; first called the primitive without the merge guard: an EMPTY root
      ;; commit has no parents and an empty diff-tree, which reads as
      ;; "introduced nothing" for an entirely unrelated reason.
      (assert-false "an empty root commit (no parents) fails open, not 'nothing of its own'"
                    (review-forward-evidence-gate-lib/forward-introduces-nothing-own?
                     root (git! root "rev-list" "--max-parents=0" "HEAD")))
      (assert-false "an unreadable commit fails open (never blocks)"
                    (review-forward-evidence-gate-lib/forward-introduces-nothing-own? root "0000000000"))
      (assert-false "a blank commit fails open"
                    (review-forward-evidence-gate-lib/forward-introduces-nothing-own? root ""))))
  base)

;; ── BL-1293: the refusal has to say what to commit ───────────────────────

(let [msg (review-forward-evidence-gate-lib/refusal-message
           {:sender "architect" :task-name "BL-1224-x" :commit "bbbbbbbbbb"
            :introduces-nothing-own? true})]
  (assert-includes "nothing-own refusal names the role" msg "architect")
  (assert-includes "nothing-own refusal names the task" msg "BL-1224-x")
  (assert-includes "nothing-own refusal names the commit" msg "bbbbbbbbbb")
  (assert-includes "nothing-own refusal names the evidence directory to commit into" msg "backlog/evidence/")
  (assert-includes "nothing-own refusal says an explicit NONE is a legitimate pass" msg "NONE")
  (assert-includes "nothing-own refusal names Article 4.4" msg "4.4")
  (assert-includes "nothing-own refusal names the reroute_reason exemption" msg "reroute_reason")
  (assert-includes "nothing-own refusal says what was wrong with the commit" msg "merge"))



;; ── BL-1307: judged by the evidence the ROLE committed for THIS task ─────
;; BL-806 reads the commit id and BL-1293 reads what the commit contributed.
;; Neither asks whether the role produced anything: the architect's BL-1224
;; forward (b7d22b9ee3) resolved a real conflict in specs/pipeline/steps/
;; index.js, so it contributes content of its own and passes both, while
;; carrying no BL-1224 review output at all. Article 4.4 names the artifact -
;; one evidence file per review pass, an explicit committed NONE for a clean
;; sweep - so the fact this reads is whether the range received..forwarded
;; ADDED that file for the task being forwarded.

(assert-true "no evidence for this task in the range -> blocked, though the commit contributes"
             (review-forward-evidence-gate-lib/blocked?
              (assoc (base-args) :commit "cccccccccc"
                     :introduces-nothing-own? false :carries-own-evidence? false)))

(assert-false "the role's evidence for this task is in the range -> not blocked"
              (review-forward-evidence-gate-lib/blocked?
               (assoc (base-args) :commit "cccccccccc"
                      :introduces-nothing-own? false :carries-own-evidence? true)))

(assert-false "unknown evidence fact (git could not tell) -> not blocked (fail open)"
              (review-forward-evidence-gate-lib/blocked?
               (assoc (base-args) :commit "cccccccccc"
                      :introduces-nothing-own? false :carries-own-evidence? nil)))

(assert-false "missing evidence WITH reroute_reason -> not blocked (marked detour still exempt)"
              (review-forward-evidence-gate-lib/blocked?
               (assoc (base-args) :commit "cccccccccc" :carries-own-evidence? false
                      :reroute-reason "cannot act, routing onward")))

(assert-false "missing evidence on a BACKWARD bounce -> not blocked (direction gate unchanged)"
              (review-forward-evidence-gate-lib/blocked?
               (assoc (base-args) :recipients ["cleaner"]
                      :commit "cccccccccc" :carries-own-evidence? false)))

(assert-false "missing evidence from a non-review sender -> not blocked (surface unchanged)"
              (review-forward-evidence-gate-lib/blocked?
               (assoc (base-args) :sender "coder" :recipients ["cleaner"]
                      :commit "cccccccccc" :carries-own-evidence? false)))

(assert-false "missing evidence as a note -> not blocked (type gate unchanged)"
              (review-forward-evidence-gate-lib/blocked?
               (assoc (base-args) :type "note" :commit "cccccccccc" :carries-own-evidence? false)))

(assert-false "missing evidence with a blank task-name -> not blocked"
              (review-forward-evidence-gate-lib/blocked?
               (assoc (base-args) :task-name "" :commit "cccccccccc" :carries-own-evidence? false)))

(assert-false "missing evidence with a blank commit -> not blocked"
              (review-forward-evidence-gate-lib/blocked?
               (assoc (base-args) :commit "" :carries-own-evidence? false)))

(assert-true "BL-950 hop: a QA approval adding no evidence for the task -> blocked"
             (review-forward-evidence-gate-lib/blocked?
              (assoc (base-args) :sender "QA" :recipients ["coordinator"]
                     :commit "cccccccccc" :carries-own-evidence? false)))

(assert-true "BL-806 and BL-1293 unchanged: each still blocks on its own fact alone"
             (and (review-forward-evidence-gate-lib/blocked?
                   (assoc (base-args) :carries-own-evidence? true))
                  (review-forward-evidence-gate-lib/blocked?
                   (assoc (base-args) :commit "cccccccccc"
                          :introduces-nothing-own? true :carries-own-evidence? true))))

;; ── BL-1307: forward-carries-own-evidence? over a real repository ────────
;; The third fs-touching function in this file; `blocked?` stays pure and
;; takes the answer, exactly as it takes the other two.

(defn- add-file! [root rel content message]
  (fs/create-dirs (fs/parent (fs/path root rel)))
  (spit (str (fs/path root rel)) content)
  (git! root "add" "-A")
  (git! root "commit" "-qm" message)
  (git! root "rev-parse" "HEAD"))

;; A role branch carrying unrelated prior content, and a received parcel on
;; main - the BL-1224 shape, so a merge here resolves nothing by accident.
(defn- mk-review-fixture []
  (let [root (mk-git-repo)]
    (git! root "checkout" "-q" "-b" "swarmforge-architect")
    (add-file! root "architect-prior.txt" "unrelated prior content\n" "prior architect content")
    (git! root "checkout" "-q" "main")
    (let [received (add-file! root "parcel.txt" "the parcel\n" "cleaner parcel")]
      (git! root "checkout" "-q" "swarmforge-architect")
      (git! root "merge" "--no-ff" "-q" "-m" (str "Merge " received) received)
      {:root root :received received})))

(let [{:keys [root received]} (mk-review-fixture)
      forwarded (add-file! root "backlog/evidence/BL-1224-architect-20260830.md"
                           "D1: none. Clean sweep.\n" "architect evidence")]
  (assert-true "an evidence file naming the task, added in the range -> true"
               (review-forward-evidence-gate-lib/forward-carries-own-evidence?
                root received forwarded "BL-1224-a-parcel-that-passed-through")))

(let [{:keys [root received]} (mk-review-fixture)
      forwarded (add-file! root "backlog/evidence/BL-1224-architect-pass-20260830.md"
                           "NONE\n" "architect NONE")]
  (assert-true "an explicit committed NONE for the task is a pass (Article 4.4)"
               (review-forward-evidence-gate-lib/forward-carries-own-evidence?
                root received forwarded "BL-1224-a-parcel-that-passed-through")))

(let [{:keys [root received]} (mk-review-fixture)
      ;; the exact b7d22b9ee3 shape: real content of its own, no evidence.
      forwarded (add-file! root "specs/pipeline/steps/index.js"
                           "// conflict resolved\n" "resolve conflict")]
  (assert-false "a conflict resolution with no evidence for the task -> false"
                (review-forward-evidence-gate-lib/forward-carries-own-evidence?
                 root received forwarded "BL-1224-a-parcel-that-passed-through")))

(let [{:keys [root received]} (mk-review-fixture)
      forwarded (add-file! root "backlog/evidence/BL-9999-architect-20260830.md"
                           "D1: none.\n" "evidence for another task")]
  (assert-false "evidence naming a DIFFERENT task never satisfies this one (batch role)"
                (review-forward-evidence-gate-lib/forward-carries-own-evidence?
                 root received forwarded "BL-1224-a-parcel-that-passed-through")))

(let [{:keys [root received]} (mk-review-fixture)]
  ;; evidence committed first, THEN a merge of newer upstream work: the
  ;; evidence commit is inside the range, so the range - not the tip commit -
  ;; is what the gate reads.
  (add-file! root "backlog/evidence/BL-1224-architect-20260830.md" "D1: none.\n" "architect evidence")
  (git! root "checkout" "-q" "main")
  (let [newer (add-file! root "unrelated-upstream.txt" "newer main work\n" "newer main work")]
    (git! root "checkout" "-q" "swarmforge-architect")
    (git! root "merge" "--no-ff" "-q" "-m" (str "Merge " newer) newer)
    (assert-true "evidence in an earlier commit of the range, then a merge -> true"
                 (review-forward-evidence-gate-lib/forward-carries-own-evidence?
                  root received (git! root "rev-parse" "HEAD")
                  "BL-1224-a-parcel-that-passed-through"))))

(let [{:keys [root received]} (mk-review-fixture)]
  ;; The predecessor's evidence for the same task is already in the received
  ;; commit - the forwarding role added nothing of its own.
  (git! root "checkout" "-q" "main")
  (let [received2 (add-file! root "backlog/evidence/BL-1224-cleaner-20260829.md"
                             "D1: none.\n" "cleaner evidence")]
    (git! root "checkout" "-q" "swarmforge-architect")
    (git! root "merge" "--no-ff" "-q" "-m" (str "Merge " received2) received2)
    (assert-false "the PREDECESSOR's evidence, already in the received commit, is not this role's"
                  (review-forward-evidence-gate-lib/forward-carries-own-evidence?
                   root received2 (git! root "rev-parse" "HEAD")
                   "BL-1224-a-parcel-that-passed-through")))
  received)

;; ── BL-1307 fail-open shapes (invariant 2) ──────────────────────────────

(let [{:keys [root received]} (mk-review-fixture)]
  (assert-nil "forwarding exactly the received commit -> nil (an empty range; BL-806 owns that shape)"
              (review-forward-evidence-gate-lib/forward-carries-own-evidence?
               root received received "BL-1224-x"))
  (assert-nil "an unreadable forwarded commit -> nil (fail open)"
              (review-forward-evidence-gate-lib/forward-carries-own-evidence?
               root received "0000000000" "BL-1224-x"))
  (assert-nil "an unreadable received commit -> nil (fail open)"
              (review-forward-evidence-gate-lib/forward-carries-own-evidence?
               root "0000000000" received "BL-1224-x"))
  (assert-nil "a blank received commit -> nil (fail open)"
              (review-forward-evidence-gate-lib/forward-carries-own-evidence?
               root nil received "BL-1224-x"))
  (assert-nil "a blank forwarded commit -> nil (fail open)"
              (review-forward-evidence-gate-lib/forward-carries-own-evidence?
               root received "" "BL-1224-x"))
  (assert-nil "a task name carrying no ticket id -> nil (nothing to match on)"
              (review-forward-evidence-gate-lib/forward-carries-own-evidence?
               root received (git! root "rev-parse" "HEAD") "no-ticket-id-here"))
  (assert-nil "a missing project root -> nil (fail open)"
              (review-forward-evidence-gate-lib/forward-carries-own-evidence?
               nil received (git! root "rev-parse" "HEAD") "BL-1224-x")))

;; ── BL-1307: the refusal has to name what to write and where ────────────

(let [msg (review-forward-evidence-gate-lib/refusal-message
           {:sender "architect" :task-name "BL-1224-x" :commit "cccccccccc"
            :introduces-nothing-own? false :carries-own-evidence? false})]
  (assert-includes "missing-evidence refusal names the role" msg "architect")
  (assert-includes "missing-evidence refusal names the task" msg "BL-1224-x")
  (assert-includes "missing-evidence refusal names the commit" msg "cccccccccc")
  (assert-includes "missing-evidence refusal names the evidence directory" msg "backlog/evidence/")
  (assert-includes "missing-evidence refusal names the ticket id the filename must carry" msg "BL-1224")
  (assert-includes "missing-evidence refusal says an explicit NONE is a legitimate pass" msg "NONE")
  (assert-includes "missing-evidence refusal names Article 4.4" msg "4.4")
  (assert-includes "missing-evidence refusal names the reroute_reason exemption" msg "reroute_reason"))

(let [msg (review-forward-evidence-gate-lib/refusal-message
           {:sender "architect" :task-name "BL-1224-x" :commit "bbbbbbbbbb"
            :introduces-nothing-own? true :carries-own-evidence? false})]
  (assert-includes "a bare merge still gets BL-1293's own wording, not this one" msg "merge"))
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: review_forward_evidence_gate_lib.bb"))
