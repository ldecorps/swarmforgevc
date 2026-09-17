#!/usr/bin/env bb
;; BL-1612 (coder.prompt's Invariants section - first authorship rests with
;; the coder): PROPERTY test encoding the ticket's one declared invariant:
;;
;;   "For both readers, the received commit resolved for a task is the
;;   commit header of the newest git_handoff naming that task anywhere
;;   under the sender's in_process box, at the top level or inside a batch
;;   directory, and nil otherwise - independent of the sender's receive
;;   mode."
;;
;; A randomized generator over the file-layout shape both readers actually
;; consume (handoff-lib/handoff-files-with-batches: every top-level
;; *.handoff file AND every one inside a batch_* subdirectory, sorted by
;; FILENAME ALONE - directory nesting never enters the sort), checked
;; against an INDEPENDENTLY-computed oracle (a plain (apply max-key) over
;; generated candidate maps, never the reader's own file-scan code) - a
;; real cross-check against the invariant's own wording, not the
;; implementation restating itself. Each trial runs the identical file
;; layout under BOTH a task-mode and a batch-mode roles.tsv row for the
;; SAME role name, to reach the invariant's own "independent of receive
;; mode" clause - the readers never consult receive-mode at all, only
;; today's mailbox layout, which is exactly what this holds constant while
;; varying the one and only input they DO read.
;;
;; Generator reach: every trial places at least one matching candidate at
;; the top level AND (independently, by coin flip) inside 0-3 distinct
;; batch directories, with randomized priority/timestamp prefixes so
;; filename-sort ties are exercised, not just the trivially-ordered case -
;; the reachability floor this invariant's own domain (a filename total
;; order over a small alphabet) can be swept close to exhaustively at 300
;; trials without a hand-picked fixture per shape.
;;
;; Non-vacuous by hand before committing: reverting either reader's
;; handoff-files-with-batches back to handoff-files fails this property
;; (any trial whose newest match sits inside a batch directory resolves to
;; the wrong, or no, commit); reverted before landing.

(ns bl1612-send-gates-batch-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def script-dir (fs/parent (fs/canonicalize *file*)))
(def repo-root (fs/parent (fs/parent (fs/parent script-dir))))

(load-file (str (fs/path repo-root "swarmforge" "scripts" "review_forward_evidence_gate_lib.bb")))
(load-file (str (fs/path repo-root "swarmforge" "scripts" "parcel_rollback_guard_lib.bb")))

(def failures (atom []))
(defn- fail! [msg] (swap! failures conj msg))

(def rng (java.util.Random. 1612))
(defn- rand-int* [n] (.nextInt rng n))
(defn- rand-hex10 []
  (apply str (repeatedly 10 #(nth "0123456789abcdef" (rand-int* 16)))))
(defn- rand-priority [] (format "%02d" (rand-int* 100)))
(defn- rand-suffix [] (apply str (repeatedly 4 #(char (+ (int \a) (rand-int* 26))))))

(defn- mk-root []
  (str (fs/create-temp-dir {:prefix "bl1612-property-"})))

(defn- write-roles! [root receive-mode]
  (fs/create-dirs (fs/path root ".swarmforge"))
  (spit (str (fs/path root ".swarmforge" "roles.tsv"))
        (str "role\trole-wt\t" root "\tswarmforge-role\tRole\tclaude\t" receive-mode "\n")))

(defn- write-candidate! [root {:keys [location filename task commit]}]
  (let [dir (if (= location :top) (fs/path root ".swarmforge" "handoffs" "inbox" "in_process")
                (fs/path root ".swarmforge" "handoffs" "inbox" "in_process" location))]
    (fs/create-dirs dir)
    (spit (str (fs/path dir filename))
          (str "id: x\nfrom: coder\nto: role\npriority: 50\ntype: git_handoff\n"
               "task: " task "\ncommit: " commit "\n\nbody\n"))))

(defn- write-distractor! [root {:keys [location filename]}]
  (let [dir (if (= location :top) (fs/path root ".swarmforge" "handoffs" "inbox" "in_process")
                (fs/path root ".swarmforge" "handoffs" "inbox" "in_process" location))]
    (fs/create-dirs dir)
    (spit (str (fs/path dir filename))
          "id: x\nfrom: coder\nto: role\npriority: 50\ntype: note\nmessage: irrelevant\n\nbody\n")))

(defn- gen-trial []
  (let [task "BL-9999-property"
        n-batches (rand-int* 4)
        batch-names (vec (repeatedly n-batches #(str "batch_2026" (format "%08d" (rand-int* 99999999)))))
        locations (into [:top] batch-names)
        n-candidates (+ 1 (rand-int* 5))
        candidates (vec (for [_ (range n-candidates)]
                          {:location (rand-nth locations)
                           :filename (str (rand-priority) "_" (rand-suffix) ".handoff")
                           :task task
                           :commit (rand-hex10)}))
        n-distractors (rand-int* 3)
        distractors (vec (for [_ (range n-distractors)]
                            {:location (rand-nth locations)
                             :filename (str (rand-priority) "_" (rand-suffix) "_note.handoff")}))]
    {:task task :candidates candidates :distractors distractors}))

(defn- oracle-commit [candidates]
  (when (seq candidates)
    (:commit (last (sort-by :filename candidates)))))

(dotimes [i 300]
  (let [{:keys [task candidates distractors]} (gen-trial)
        expected (oracle-commit candidates)]
    (doseq [receive-mode ["task" "batch"]]
      (let [root (mk-root)]
        (try
          (write-roles! root receive-mode)
          (doseq [c candidates] (write-candidate! root c))
          (doseq [d distractors] (write-distractor! root d))
          (let [review-got (review-forward-evidence-gate-lib/received-commit-for-task root "role" task)
                rollback-got (@#'parcel-rollback-guard-lib/received-parcel-commit-for-task root "role" task)]
            (when (not= expected review-got)
              (fail! (str "trial " i " (" receive-mode "): review-forward reader expected " (pr-str expected)
                          " got " (pr-str review-got) " candidates=" (pr-str candidates))))
            (when (not= expected rollback-got)
              (fail! (str "trial " i " (" receive-mode "): rollback reader expected " (pr-str expected)
                          " got " (pr-str rollback-got) " candidates=" (pr-str candidates)))))
          (finally (fs/delete-tree root)))))))

;; "and nil otherwise": a task with no matching candidate at all.
(dotimes [i 20]
  (doseq [receive-mode ["task" "batch"]]
    (let [root (mk-root)
          {:keys [distractors]} (gen-trial)]
      (try
        (write-roles! root receive-mode)
        (doseq [d distractors] (write-distractor! root d))
        (when-not (nil? (review-forward-evidence-gate-lib/received-commit-for-task root "role" "BL-NOMATCH"))
          (fail! (str "nil-otherwise trial " i " (" receive-mode "): review-forward reader was not nil")))
        (when-not (nil? (@#'parcel-rollback-guard-lib/received-parcel-commit-for-task root "role" "BL-NOMATCH"))
          (fail! (str "nil-otherwise trial " i " (" receive-mode "): rollback reader was not nil")))
        (finally (fs/delete-tree root))))))

(println "bl1612_send_gates_batch property: 300 layout trials x 2 receive modes x 2 readers + 20 nil-otherwise trials")
(if (seq @failures)
  (do (doseq [f @failures] (binding [*out* *err*] (println f)))
      (println (str (count @failures) " PROPERTY FAILURE(S)"))
      (System/exit 1))
  (println "ALL PROPERTIES HOLD"))
