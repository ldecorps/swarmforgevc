#!/usr/bin/env bb
;; BL-691: D1 sync deliver hold + D3 engage CLI refuse (fixture IO).
(ns bl691-ambulance-gaps-test-runner
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.java.shell :as sh]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir ".." "ambulance_lib.bb")))
(load-file (str (fs/path script-dir ".." "handoff_inject_lib.bb")))

(def failures (atom []))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(def created (atom []))
(.addShutdownHook (Runtime/getRuntime)
                  (Thread. (fn [] (doseq [d @created] (try (fs/delete-tree d) (catch Exception _ nil))))))
(defn mk-tmp []
  (let [d (str (fs/create-temp-dir {:prefix "bl691-"}))]
    (swap! created conj d)
    d))

(defn write-roles! [root]
  (let [coder-wt (str (fs/path root ".worktrees" "coder"))]
    (fs/create-dirs (fs/path root ".swarmforge" "handoffs" "coordinator" "outbox"))
    (fs/create-dirs (fs/path coder-wt ".swarmforge" "handoffs" "inbox" "new"))
    (fs/create-dirs (fs/path root ".swarmforge"))
    (spit (str (fs/path root ".swarmforge" "tmux-socket")) (str (fs/path root "fake.sock")))
    (spit (str (fs/path root "fake.sock")) "")
    (spit (str (fs/path root ".swarmforge" "roles.tsv"))
          (str "coordinator\tmaster\t" root "\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n"
               "coder\tcoder\t" coder-wt "\tswarmforge-coder\tCoder\tclaude\ttask\n"))))

(defn write-parcel! [path task]
  (spit (str path)
        (str "id: t1\nfrom: coordinator\nto: coder\npriority: 50\ntype: note\n"
             "task: " task "\ncreated_at: 2026-08-25T00:00:00Z\n\nbody\n")))

;; D1: held parcel stays in outbox
(let [root (mk-tmp)]
  (write-roles! root)
  (fs/create-dirs (fs/path root "backlog" "active"))
  (spit (str (fs/path root "backlog" "active" "BL-688-demo.yaml")) "id: BL-688\ntitle: p\nstatus: active\n")
  (ambulance-lib/engage! root "BL-688" "test")
  (let [outbox (fs/path root ".swarmforge" "handoffs" "coordinator" "outbox" "held.handoff")
        before (do (write-parcel! outbox "BL-590") (slurp (str outbox)))
        result (handoff-inject-lib/deliver-parcel! root outbox "coordinator"
                                                   :log-fn (fn [& _]))
        coder-new (fs/path root ".worktrees" "coder" ".swarmforge" "handoffs" "inbox" "new")]
    (assert= "D1 result :held" :held result)
    (assert= "D1 outbox still present" true (fs/exists? outbox))
    (assert= "D1 outbox byte-identical" before (slurp (str outbox)))
    (assert= "D1 inbox empty" true (empty? (fs/list-dir coder-new)))))

;; D1: after release, parcel-held? is false (daemon/sync may deliver next)
(let [root (mk-tmp)]
  (write-roles! root)
  (fs/create-dirs (fs/path root "backlog" "active"))
  (spit (str (fs/path root "backlog" "active" "BL-688-demo.yaml")) "id: BL-688\ntitle: p\nstatus: active\n")
  (ambulance-lib/engage! root "BL-688" "test")
  (let [outbox (fs/path root ".swarmforge" "handoffs" "coordinator" "outbox" "held2.handoff")
        env {:headers {"task" "BL-590"} :body ""}]
    (write-parcel! outbox "BL-590")
    (assert= "pre-release held?" true
             (ambulance-lib/parcel-held? (ambulance-lib/read-ambulance-state root) env))
    (ambulance-lib/release! root)
    (assert= "post-release not held?" false
             (ambulance-lib/parcel-held? (ambulance-lib/read-ambulance-state root) env))
    (assert= "outbox still waiting for next deliver" true (fs/exists? outbox))))

;; D3 CLI refuse paused
(let [root (mk-tmp)
      _ (fs/create-dirs (fs/path root "backlog" "paused"))
      _ (spit (str (fs/path root "backlog" "paused" "BL-688-demo.yaml")) "id: BL-688\ntitle: p\n")
      cli (str (fs/path script-dir ".." "ambulance_cli.bb"))
      r (sh/sh "bb" cli root "engage" "BL-688")]
  (assert= "D3 CLI exit 1 for paused" 1 (:exit r))
  (assert= "D3 CLI names paused" true (str/includes? (str (:err r) (:out r)) "paused"))
  (assert= "D3 marker stays off"
           {:active false}
           (ambulance-lib/read-ambulance-state root)))

(if (seq @failures)
  (do (doseq [f @failures] (println f)) (System/exit 1))
  (println "bl691_ambulance_gaps: ALL TESTS PASSED"))
