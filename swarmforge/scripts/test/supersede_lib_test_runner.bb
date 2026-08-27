#!/usr/bin/env bb
;; Unit tests for supersede_lib.bb (BL-1084). Invariant encoding also in
;; bl1084_supersede_property_runner.bb (coder-authored, BL-654).

(require '[babashka.fs :as fs]
         '[clojure.string :as str])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "supersede_lib.bb")))

(def failures (atom []))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))
(defn assert-true [msg actual] (assert= msg true (boolean actual)))

(assert= "task from task: header"
         "BL-1052-qwen-code-seat"
         (supersede-lib/task-name-from-content
          "from: a\nto: b\npriority: 00\ntype: note\ntask: BL-1052-qwen-code-seat\n\nbody\n"))

(assert= "task from Work message line"
         "BL-1084-a-superseded-task-stops-at-every-stage"
         (supersede-lib/task-name-from-content
          "from: a\nto: b\npriority: 10\ntype: note\nmessage: Work BL-1084-a-superseded-task-stops-at-every-stage: read file\n\nbody\n"))

(assert= "absent store always passes"
         :ok
         (supersede-lib/turn-verdict {:status :absent} ["BL-1052-qwen-code-seat"]))

(assert= "unreadable store refuses even with no candidates"
         :refused
         (:status (supersede-lib/turn-verdict {:status :unreadable :detail "x"} [])))

(assert= "unreadable kind"
         :store-unreadable
         (:kind (supersede-lib/turn-verdict {:status :unreadable :detail "x"} ["BL-1099-unrelated"])))

(let [v (supersede-lib/turn-verdict
         {:status :ok :entries {"BL-1052-qwen-code-seat" "reframed to local-model"}}
         ["BL-1052-qwen-code-seat"])]
  (assert= "superseded task refused" :refused (:status v))
  (assert= "kind superseded" :superseded (:kind v))
  (assert= "names task" "BL-1052-qwen-code-seat" (:task v))
  (assert= "names reason" "reframed to local-model" (:reason v))
  (assert-true "message names task" (str/includes? (:message v) "BL-1052-qwen-code-seat"))
  (assert-true "message names reason" (str/includes? (:message v) "reframed to local-model")))

(assert= "unrelated task passes"
         :ok
         (supersede-lib/turn-verdict
          {:status :ok :entries {"BL-1052-qwen-code-seat" "reframed to local-model"}}
          ["BL-1099-unrelated"]))

(assert= "empty candidates with ok store pass"
         :ok
         (supersede-lib/turn-verdict
          {:status :ok :entries {"BL-1052-qwen-code-seat" "x"}}
          []))

(assert= "unknown store status fails closed"
         :refused
         (:status (supersede-lib/turn-verdict {:status :weird} [])))

(assert= "entries-from-files ok"
         {:status :ok :entries {"BL-1052-qwen-code-seat" "reframed to local-model"}}
         (supersede-lib/entries-from-files
          [{:name "BL-1052-qwen-code-seat" :readable? true :body "reframed to local-model\n"}]))

(assert= "unreadable file fails the store closed"
         :unreadable
         (:status (supersede-lib/entries-from-files
                   [{:name "BL-1052-qwen-code-seat" :readable? false :body nil}])))

(when (seq @failures)
  (doseq [f @failures] (println f))
  (println (str (count @failures) " FAILURE(S)"))
  (System/exit 1))
(println "ALL PASS: supersede_lib.bb")
