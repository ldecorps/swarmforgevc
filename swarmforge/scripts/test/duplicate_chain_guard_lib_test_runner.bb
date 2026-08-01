#!/usr/bin/env bb
;; TDD runner for duplicate_chain_guard_lib.bb (BL-760) — the send-time guard
;; that refuses a git_handoff when the same ticket already has a live parcel
;; in another role's mailbox.

(ns duplicate-chain-guard-lib-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "duplicate_chain_guard_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-nil [msg actual] (assert= msg nil actual))

(defn assert-includes [msg haystack needle]
  (when-not (str/includes? haystack needle)
    (swap! failures conj (str "FAIL: " msg "\n  expected to include: " (pr-str needle) "\n  actual: " (pr-str haystack)))))

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                  (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn mk-root []
  (let [d (str (fs/create-temp-dir {:prefix "dup-chain-guard-test-"}))]
    (swap! created-temp-dirs conj d)
    d))

(defn write-roles! [root]
  (fs/create-dirs (fs/path root ".swarmforge"))
  (spit (str (fs/path root ".swarmforge" "roles.tsv"))
        (str "coder\tcoder-wt\t" root "/coder\tswarmforge-coder\tCoder\tclaude\ttask\n"
             "cleaner\tcleaner-wt\t" root "/cleaner\tswarmforge-cleaner\tCleaner\tclaude\tbatch\n"
             "architect\tarchitect-wt\t" root "/architect\tswarmforge-architect\tArchitect\tclaude\ttask\n"
             "documenter\tdocumenter-wt\t" root "/documenter\tswarmforge-documenter\tDocumenter\tclaude\ttask\n"
             "QA\tQA-wt\t" root "/QA\tswarmforge-QA\tQa\tclaude\ttask\n"
             "coordinator\tmaster\t" root "\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n")))

(defn mailbox-dir-for [root role state]
  (let [role-info (handoff-lib/load-role-info role root)]
    (handoff-lib/mailbox-dir role-info state)))

(defn write-handoff! [root role state filename {:keys [type task message from to]
                                                 :or {type "git_handoff" from "specifier" to role}}]
  (let [dir (mailbox-dir-for root role state)]
    (fs/create-dirs dir)
    (spit (str (fs/path dir filename))
          (str "id: x\nfrom: " from "\nto: " to "\npriority: 20\ntype: " type "\n"
               (when (= type "git_handoff") (str "task: " task "\ncommit: a1b2c3d4e5\n"))
               (when (= type "note") (str "message: " message "\n"))
               "\nbody\n"))))

;; ── blocking-parcel: no ticket id skips silently ────────────────────────

(let [root (mk-root)]
  (write-roles! root)
  (assert-nil "no ticket id extractable from task name skips the guard"
              (duplicate-chain-guard-lib/blocking-parcel root "tracer-bullet-carrying-no-ticket-id" "coder")))

;; ── blocking-parcel: no other role holds a live parcel ──────────────────

(let [root (mk-root)]
  (write-roles! root)
  (assert-nil "unblocked when no other role holds a live parcel for the ticket"
              (duplicate-chain-guard-lib/blocking-parcel root "BL-901" "coder")))

;; ── blocking-parcel: a live git_handoff in another role's new/ blocks ────

(let [root (mk-root)]
  (write-roles! root)
  (write-handoff! root "documenter" :new "20_blocker.handoff" {:task "BL-901"})
  (let [block (duplicate-chain-guard-lib/blocking-parcel root "BL-901" "coder")]
    (assert= "blocked with the ticket id" "BL-901" (:ticket-id block))
    (assert= "blocked naming the documenter as the blocking role" "documenter" (:role block))
    (assert= "blocked naming the blocking file" "20_blocker.handoff" (some-> (:file block) fs/file-name))))

;; ── blocking-parcel: a live git_handoff in another role's in_process/ blocks ──

(let [root (mk-root)]
  (write-roles! root)
  (write-handoff! root "documenter" :in_process "10_blocker.handoff" {:task "BL-901-pilot-missed-unwired-acceptance"})
  (let [block (duplicate-chain-guard-lib/blocking-parcel root "BL-901" "coder")]
    (assert= "in_process parcel blocks too, resolved to the same ticket id"
             "BL-901" (:ticket-id block))
    (assert= "in_process blocker names its role" "documenter" (:role block))))

;; ── blocking-parcel: the sender's own mailbox never blocks ──────────────

(let [root (mk-root)]
  (write-roles! root)
  (write-handoff! root "coder" :in_process "00_own.handoff" {:task "BL-901"})
  (assert-nil "the sender's own in_process parcel is excluded, not a blocker"
              (duplicate-chain-guard-lib/blocking-parcel root "BL-901" "coder")))

;; ── blocking-parcel: ticket-id equality, never prefix/substring match ───

(let [root (mk-root)]
  (write-roles! root)
  (write-handoff! root "documenter" :new "20_other_ticket.handoff" {:task "BL-90"})
  (assert-nil "BL-90 in another mailbox never blocks a BL-901 send (equality, not prefix)"
              (duplicate-chain-guard-lib/blocking-parcel root "BL-901" "coder")))

;; ── blocking-parcel: completed/ mailbox is not live, never blocks ───────

(let [root (mk-root)]
  (write-roles! root)
  (write-handoff! root "documenter" :completed "20_done.handoff" {:task "BL-901"})
  (assert-nil "a completed parcel is not live and never blocks"
              (duplicate-chain-guard-lib/blocking-parcel root "BL-901" "coder")))

;; ── blocking-parcel: a note about the ticket never blocks (no task header) ──

(let [root (mk-root)]
  (write-roles! root)
  (write-handoff! root "documenter" :new "20_note.handoff" {:type "note" :message "BL-901 checking in"})
  (assert-nil "a note (no task header) never counts as a blocking git_handoff"
              (duplicate-chain-guard-lib/blocking-parcel root "BL-901" "coder")))

;; ── refusal-message ──────────────────────────────────────────────────────

(let [root (mk-root)]
  (write-roles! root)
  (write-handoff! root "documenter" :new "20_blocker.handoff" {:task "BL-901"})
  (let [block (duplicate-chain-guard-lib/blocking-parcel root "BL-901" "coder")
        msg (duplicate-chain-guard-lib/refusal-message block)]
    (assert-includes "refusal names the ticket" msg "BL-901")
    (assert-includes "refusal names the blocking role" msg "documenter")
    (assert-includes "refusal names the blocking filename" msg "20_blocker.handoff")
    (assert-includes "refusal names the abandon command" msg "redo_from.sh")))

(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: duplicate_chain_guard_lib.bb"))
