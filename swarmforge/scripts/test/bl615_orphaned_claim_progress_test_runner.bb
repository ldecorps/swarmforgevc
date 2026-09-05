#!/usr/bin/env bb
(ns bl615-orphaned-claim-progress-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir ".." "chase_sweep_lib.bb")))
(load-file (str (fs/path script-dir ".." "salvage_lib.bb")))

(def failures (atom []))
(defn fail! [m] (swap! failures conj m))

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

;; Pure: orphan detection includes claim-progress
(let [names ["a.handoff" "a.handoff.claim-progress.json" "b.handoff.claim-progress.json"]
      orphans (chase-sweep-lib/orphaned-sidecar-filenames names)]
  (when-not (= ["b.handoff.claim-progress.json"] orphans)
    (fail! (str "orphan detect: " orphans))))

;; Impure reap on in_process fixture
(let [dir (str (fs/create-temp-dir {:prefix "bl615-reap-"}))
      _ (swap! created-temp-dirs conj dir)
      _ (spit (str (fs/path dir "orphan.handoff.claim-progress.json")) "{}")
      _ (spit (str (fs/path dir "keep.handoff")) "id: keep\n")
      _ (spit (str (fs/path dir "keep.handoff.claim-progress.json")) "{}")
      reaped (chase-sweep-lib/reap-orphaned-sidecars! dir)]
  (when-not (= ["orphan.handoff.claim-progress.json"] reaped)
    (fail! (str "reap list: " reaped)))
  (when (fs/exists? (fs/path dir "orphan.handoff.claim-progress.json"))
    (fail! "orphan not deleted"))
  (when-not (fs/exists? (fs/path dir "keep.handoff.claim-progress.json"))
    (fail! "live sidecar deleted")))

;; abandon-stale! removes sidecars (mini roles.tsv fixture)
(let [root (str (fs/create-temp-dir {:prefix "bl615-abandon-"}))
      _ (swap! created-temp-dirs conj root)
      wt (str (fs/path root ".worktrees" "coder"))
      ip (str (fs/path wt ".swarmforge" "handoffs" "inbox" "in_process"))
      _ (fs/create-dirs ip)
      _ (fs/create-dirs (fs/path wt ".swarmforge" "handoffs" "inbox" "abandoned"))
      _ (fs/create-dirs (fs/path root ".swarmforge"))
      _ (spit (str (fs/path root ".swarmforge" "roles.tsv"))
              (str "coder\tcoder\t" wt "\tswarmforge-coder\tCoder\tclaude\ttask\n"))
      handoff (str (fs/path ip "50_x_from_a_to_coder.handoff"))
      _ (spit handoff "id: x\nfrom: a\nto: coder\ntask: BL-615-test\npriority: 50\ntype: note\nmessage: hi\n\nhi\n")
      sidecar (str handoff ".claim-progress.json")
      _ (spit sidecar "{}")
      _ (salvage-lib/abandon-stale! root "BL-615-test")]
  (when (fs/exists? sidecar)
    (fail! "abandon left claim-progress sidecar"))
  (when-not (seq (fs/list-dir (fs/path wt ".swarmforge" "handoffs" "inbox" "abandoned")))
    (fail! "handoff not abandoned")))

(if (seq @failures)
  (do (println "bl615: FAILURES") (doseq [f @failures] (println f)) (System/exit 1))
  (println "bl615_orphaned_claim_progress: ALL TESTS PASSED"))
