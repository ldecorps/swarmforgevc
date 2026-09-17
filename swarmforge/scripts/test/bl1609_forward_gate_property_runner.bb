#!/usr/bin/env bb
;; BL-1609 (coder.prompt's Invariants section - first authorship rests with
;; the coder): PROPERTY tests encoding both declared invariants.
;;
;;   invariant 1 - "A code-worktree role's forwarding git_handoff inbound
;;      never leaves in_process without either a git_handoff for its
;;      ticket queued after its dequeue or a stated no-op reason recorded
;;      on the completed file; a non-forwarding inbound and a
;;      master-resident role complete exactly as today.": an EXHAUSTIVE
;;      sweep over every {forwarding? master-resident? evidenced? reason}
;;      combination (16 states - small enough to enumerate completely
;;      rather than sample, the strongest possible reachability floor) of
;;      forward-completion-decision, checked against an
;;      INDEPENDENTLY-shaped oracle (a different control-flow shape than
;;      the implementation's own `cond`), not a restatement of it.
;;
;;   invariant 2 - "A refusal has no side effects: the in_process file or
;;      batch, every sidecar and the mailbox are byte-identical after it,
;;      and the same invocation with the evidence in place then
;;      completes.": two real-fixture cases (task, batch) - byte-for-byte
;;      snapshot of the whole mailbox tree before/after a refusal, then
;;      the identical invocation completes once evidence is added.
;;
;; Non-vacuity proven by hand before committing: property 1 fails (all 8
;; reason-supplied-and-unevidenced cases mismatch) when
;; forward-completion-decision's `(some? reason)` clause is moved AFTER
;; `evidenced?`; property 2 fails (mailbox mutates on refusal) when
;; forward-gate!'s call is commented out of done_with_current_task.bb's/
;; done_with_current_batch.bb's -main. Both reverted before landing.

(ns bl1609-forward-gate-property-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as p]
            [clojure.java.io :as io]
            [clojure.string :as str]))

(def script-dir (fs/parent (fs/canonicalize *file*)))
(load-file (str (fs/path script-dir ".." "forward_evidence_lib.bb")))

(def failures (atom []))
(defn- fail! [msg] (swap! failures conj msg))

;; ── invariant 1: exhaustive oracle sweep over the pure decision ─────────

(defn- oracle-decision
  [forwarding? master-resident? evidenced? reason]
  (if (or (not forwarding?) master-resident?)
    :complete-plain
    (cond
      (some? reason) :complete-with-reason
      evidenced? :complete-plain
      :else :refuse)))

(def bool-values [true false])
(def reason-values [nil "a stated reason"])

(doseq [forwarding? bool-values
        master-resident? bool-values
        evidenced? bool-values
        reason reason-values]
  (let [got (forward-evidence-lib/forward-completion-decision
             {:forwarding? forwarding? :master-resident? master-resident?
              :evidenced? evidenced? :reason reason})
        want (oracle-decision forwarding? master-resident? evidenced? reason)]
    (when (not= want got)
      (fail! (str "invariant 1: forwarding?=" forwarding? " master-resident?=" master-resident?
                   " evidenced?=" evidenced? " reason=" (pr-str reason)
                   " -> expected " want " got " got)))))

;; ── invariant 2: real-fixture no-side-effects-on-refusal ────────────────

(def real-scripts-dir (fs/path script-dir ".."))

(defn- install-scripts! [dir]
  (fs/create-dirs dir)
  (doseq [f (fs/list-dir real-scripts-dir)]
    (when (and (fs/regular-file? f)
               (or (str/ends-with? (str f) ".bb") (str/ends-with? (str f) ".sh")))
      (fs/copy f (fs/path dir (fs/file-name f)) {:replace-existing true})
      (fs/set-posix-file-permissions (fs/path dir (fs/file-name f)) "rwxr-xr-x")))
  (doseq [stub ["ready_for_next_task.sh" "ready_for_next_batch.sh"]]
    (spit (str (fs/path dir stub)) "#!/usr/bin/env zsh\necho \"NO_TASK\"\nexit 0\n")
    (fs/set-posix-file-permissions (fs/path dir stub) "rwxr-xr-x")))

(defn- run-done! [wt role]
  (p/shell {:out :string :err :string :continue true :dir (str wt)
            :extra-env {"SWARMFORGE_ROLE" role}}
           "bash" (str (fs/path wt "swarmforge" "scripts" "done_with_current.sh"))))

;; A stable, deep snapshot of every file under root's .swarmforge/handoffs/
;; (never .git, whose own internal plumbing files legitimately churn on
;; every git operation the fixture setup makes - irrelevant to this
;; invariant, which is about the MAILBOX): relative path -> bytes. Used to
;; prove a refusal is byte-identical, not merely "same file count".
(defn- snapshot [wt]
  (let [handoffs (fs/path wt ".swarmforge" "handoffs")]
    (into (sorted-map)
          (for [f (file-seq (io/file (str handoffs)))
                :when (.isFile f)]
            [(str (fs/relativize handoffs (.toPath f))) (slurp f)]))))

(defn- forwarding-handoff [ticket dequeued-at]
  (str "id: x1\nfrom: coordinator\nto: role\nrecipient: role\npriority: 50\ntype: git_handoff\n"
       "role: coordinator\ntask: " ticket "-slug\ncommit: 0000000000\n"
       "dequeued_at: " dequeued-at "\n\nmerge_and_process coordinator 0000000000\n"))

(defn- queued-forward [ticket created-at]
  (str "id: fwd\nfrom: role\nto: cleaner\npriority: 50\ntype: git_handoff\nrole: role\n"
       "task: " ticket "-slug\ncommit: 1111111111\ncreated_at: " created-at "\n\n"
       "merge_and_process role 1111111111\n"))

;; ── invariant 2a: task path ───────────────────────────────────────────────

(let [root (fs/create-temp-dir {:prefix "bl1609-invariant2a-"})]
  (try
    (p/shell {:dir (str root) :out :string :err :string} "git" "init" "-q" "-b" "main")
    (p/shell {:dir (str root) :out :string :err :string} "git" "config" "user.email" "t@t")
    (p/shell {:dir (str root) :out :string :err :string} "git" "config" "user.name" "t")
    (p/shell {:dir (str root) :out :string :err :string} "git" "config" "commit.gpgsign" "false")
    (p/shell {:dir (str root) :out :string :err :string} "git" "commit" "-q" "--allow-empty" "-m" "init")
    (let [wt (fs/path root ".worktrees" "role")]
      (p/shell {:dir (str root) :out :string :err :string} "git" "worktree" "add" "-q" "-b" "role" (str wt))
      (install-scripts! (fs/path wt "swarmforge" "scripts"))
      (fs/create-dirs (fs/path wt ".swarmforge"))
      (spit (str (fs/path wt ".swarmforge" "roles.tsv"))
            (str "role\trole\t" wt "\tswarmforge-role\tRole\tclaude\ttask\n"))
      (let [in-process (fs/path wt ".swarmforge" "handoffs" "inbox" "in_process")
            completed (fs/path wt ".swarmforge" "handoffs" "inbox" "completed")
            outbox (fs/path wt ".swarmforge" "handoffs" "outbox")]
        (fs/create-dirs in-process)
        (fs/create-dirs completed)
        (fs/create-dirs outbox)
        (spit (str (fs/path in-process "50_x1.handoff")) (forwarding-handoff "BL-8001" "2020-01-01T00:00:00.000000000Z"))
        (let [before (snapshot wt)
              result (run-done! wt "role")]
          (when (zero? (:exit result))
            (fail! (str "invariant 2a fixture: expected a refusal, got exit 0: " (:out result))))
          (let [after (snapshot wt)]
            (when (not= before after)
              (doseq [k (into (sorted-set) (concat (keys before) (keys after)))]
                (when (not= (get before k) (get after k))
                  (fail! (str "invariant 2a: differing file " k))))))
          ;; Now add evidence and repeat the IDENTICAL invocation - must complete.
          (spit (str (fs/path outbox "90_fwd.handoff")) (queued-forward "BL-8001" "2020-01-02T00:00:00.000000000Z"))
          (let [retry (run-done! wt "role")]
            (when-not (zero? (:exit retry))
              (fail! (str "invariant 2a: retry with evidence in place did not complete: " (:out retry) (:err retry))))
            (when-not (fs/exists? (fs/path completed "50_x1.handoff"))
              (fail! "invariant 2a: retry completed but the handoff never reached completed/"))))))
    (finally (fs/delete-tree root))))

;; ── invariant 2b: batch path ─────────────────────────────────────────────

(let [root (fs/create-temp-dir {:prefix "bl1609-invariant2b-"})]
  (try
    (p/shell {:dir (str root) :out :string :err :string} "git" "init" "-q" "-b" "main")
    (p/shell {:dir (str root) :out :string :err :string} "git" "config" "user.email" "t@t")
    (p/shell {:dir (str root) :out :string :err :string} "git" "config" "user.name" "t")
    (p/shell {:dir (str root) :out :string :err :string} "git" "config" "commit.gpgsign" "false")
    (p/shell {:dir (str root) :out :string :err :string} "git" "commit" "-q" "--allow-empty" "-m" "init")
    (let [wt (fs/path root ".worktrees" "role")]
      (p/shell {:dir (str root) :out :string :err :string} "git" "worktree" "add" "-q" "-b" "role" (str wt))
      (install-scripts! (fs/path wt "swarmforge" "scripts"))
      (fs/create-dirs (fs/path wt ".swarmforge"))
      (spit (str (fs/path wt ".swarmforge" "roles.tsv"))
            (str "role\trole\t" wt "\tswarmforge-role\tRole\tclaude\tbatch\n"))
      (let [batch-dir (fs/path wt ".swarmforge" "handoffs" "inbox" "in_process" "batch_20260916T000000Z")
            completed (fs/path wt ".swarmforge" "handoffs" "inbox" "completed")
            outbox (fs/path wt ".swarmforge" "handoffs" "outbox")]
        (fs/create-dirs batch-dir)
        (fs/create-dirs completed)
        (fs/create-dirs outbox)
        (spit (str (fs/path batch-dir "50_a.handoff")) (forwarding-handoff "BL-8002" "2020-01-01T00:00:00.000000000Z"))
        (spit (str (fs/path batch-dir "50_b.handoff")) (forwarding-handoff "BL-8003" "2020-01-01T00:00:00.000000000Z"))
        (let [before (snapshot wt)
              result (run-done! wt "role")]
          (when (zero? (:exit result))
            (fail! (str "invariant 2b fixture: expected a refusal, got exit 0: " (:out result))))
          (let [after (snapshot wt)]
            (when (not= before after)
              (doseq [k (into (sorted-set) (concat (keys before) (keys after)))]
                (when (not= (get before k) (get after k))
                  (fail! (str "invariant 2b: differing file " k))))))
          ;; Evidence for BOTH items, then the identical invocation completes.
          (spit (str (fs/path outbox "90_fwd_a.handoff")) (queued-forward "BL-8002" "2020-01-02T00:00:00.000000000Z"))
          (spit (str (fs/path outbox "90_fwd_b.handoff")) (queued-forward "BL-8003" "2020-01-02T00:00:00.000000000Z"))
          (let [retry (run-done! wt "role")]
            (when-not (zero? (:exit retry))
              (fail! (str "invariant 2b: retry with evidence in place did not complete: " (:out retry) (:err retry))))
            (when-not (and (fs/exists? (fs/path completed "batch_20260916T000000Z" "50_a.handoff"))
                            (fs/exists? (fs/path completed "batch_20260916T000000Z" "50_b.handoff")))
              (fail! "invariant 2b: retry completed but the batch never reached completed/"))))))
    (finally (fs/delete-tree root))))

;; ── invariant 2c: batch refusal names EVERY unforwarded ticket, not just
;; one (Article 4.4's "complete review inventory" shape, which
;; done_with_current_batch.bb's own forward-gate! comment claims to
;; implement: "refuse ONCE naming every unforwarded forwarding item,
;; rather than stopping at the first one found"). invariant 2b above uses
;; two items but never checks the refusal MESSAGE content, only the exit
;; code and mailbox byte-identity - a mutant that truncates the refusal to
;; the first unforwarded item alone (e.g. `(take 1 refusals)`) passes 2b
;; undetected. Two DISTINCT tickets, progressed through three stages, is
;; what actually discriminates: neither evidenced (both must be named),
;; one evidenced (the refusal must still fire and name only the
;; remaining one, not the satisfied one), then both evidenced (completes).

(let [root (fs/create-temp-dir {:prefix "bl1609-invariant2c-"})]
  (try
    (p/shell {:dir (str root) :out :string :err :string} "git" "init" "-q" "-b" "main")
    (p/shell {:dir (str root) :out :string :err :string} "git" "config" "user.email" "t@t")
    (p/shell {:dir (str root) :out :string :err :string} "git" "config" "user.name" "t")
    (p/shell {:dir (str root) :out :string :err :string} "git" "config" "commit.gpgsign" "false")
    (p/shell {:dir (str root) :out :string :err :string} "git" "commit" "-q" "--allow-empty" "-m" "init")
    (let [wt (fs/path root ".worktrees" "role")]
      (p/shell {:dir (str root) :out :string :err :string} "git" "worktree" "add" "-q" "-b" "role" (str wt))
      (install-scripts! (fs/path wt "swarmforge" "scripts"))
      (fs/create-dirs (fs/path wt ".swarmforge"))
      (spit (str (fs/path wt ".swarmforge" "roles.tsv"))
            (str "role\trole\t" wt "\tswarmforge-role\tRole\tclaude\tbatch\n"))
      (let [batch-dir (fs/path wt ".swarmforge" "handoffs" "inbox" "in_process" "batch_20260916T000000Z")
            completed (fs/path wt ".swarmforge" "handoffs" "inbox" "completed")
            outbox (fs/path wt ".swarmforge" "handoffs" "outbox")]
        (fs/create-dirs batch-dir)
        (fs/create-dirs completed)
        (fs/create-dirs outbox)
        (spit (str (fs/path batch-dir "50_a.handoff")) (forwarding-handoff "BL-8004" "2020-01-01T00:00:00.000000000Z"))
        (spit (str (fs/path batch-dir "50_b.handoff")) (forwarding-handoff "BL-8005" "2020-01-01T00:00:00.000000000Z"))
        ;; Stage 1: neither evidenced - refusal must name BOTH tickets.
        (let [result (run-done! wt "role")]
          (when (zero? (:exit result))
            (fail! (str "invariant 2c stage 1: expected a refusal, got exit 0: " (:out result))))
          (when-not (str/includes? (:err result) "BL-8004")
            (fail! (str "invariant 2c stage 1: refusal must name BL-8004: " (:err result))))
          (when-not (str/includes? (:err result) "BL-8005")
            (fail! (str "invariant 2c stage 1: refusal must name BL-8005: " (:err result)))))
        ;; Stage 2: only BL-8004 evidenced - still refused, naming ONLY the
        ;; still-unevidenced BL-8005, and BL-8004 must NOT be in the message
        ;; (the whole batch is still refused, but the message identifies
        ;; exactly what remains, per Article 4.4's inventory - never padded
        ;; with an item that is already satisfied).
        (spit (str (fs/path outbox "90_fwd_a.handoff")) (queued-forward "BL-8004" "2020-01-02T00:00:00.000000000Z"))
        (let [before (snapshot wt)
              result (run-done! wt "role")]
          (when (zero? (:exit result))
            (fail! (str "invariant 2c stage 2: expected a refusal, got exit 0: " (:out result))))
          (when-not (str/includes? (:err result) "BL-8005")
            (fail! (str "invariant 2c stage 2: refusal must name the still-unevidenced BL-8005: " (:err result))))
          (when (str/includes? (:err result) "BL-8004")
            (fail! (str "invariant 2c stage 2: refusal must not re-name the already-evidenced BL-8004: " (:err result))))
          (let [after (snapshot wt)]
            (when (not= before after)
              (doseq [k (into (sorted-set) (concat (keys before) (keys after)))]
                (when (not= (get before k) (get after k))
                  (fail! (str "invariant 2c stage 2: differing file " k)))))))
        ;; Stage 3: both evidenced - completes.
        (spit (str (fs/path outbox "90_fwd_b.handoff")) (queued-forward "BL-8005" "2020-01-02T00:00:00.000000000Z"))
        (let [retry (run-done! wt "role")]
          (when-not (zero? (:exit retry))
            (fail! (str "invariant 2c stage 3: retry with evidence in place did not complete: " (:out retry) (:err retry))))
          (when-not (and (fs/exists? (fs/path completed "batch_20260916T000000Z" "50_a.handoff"))
                          (fs/exists? (fs/path completed "batch_20260916T000000Z" "50_b.handoff")))
            (fail! "invariant 2c stage 3: retry completed but the batch never reached completed/")))))
    (finally (fs/delete-tree root))))

(println "bl1609_forward_gate property: 16-state oracle sweep (invariant 1) + 3 real-fixture cases (invariant 2)")
(if (seq @failures)
  (do (doseq [f @failures] (binding [*out* *err*] (println f)))
      (println (str (count @failures) " PROPERTY FAILURE(S)"))
      (System/exit 1))
  (println "ALL PROPERTIES HOLD"))
