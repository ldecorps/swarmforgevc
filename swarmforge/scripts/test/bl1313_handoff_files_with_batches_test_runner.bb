#!/usr/bin/env bb
;; BL-1313 TDD runner for handoff_lib.bb's batch-aware readers
;; (handoff-files-with-batches, my-handoff-files-with-batches).

(ns bl1313-handoff-files-with-batches-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "handoff_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual] (assert= msg true (boolean actual)))
(defn assert-false [msg actual] (assert= msg false (boolean actual)))

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                  (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn mk-tmp-dir []
  (let [d (str (fs/create-temp-dir {:prefix "sfvc-bl1313-"}))]
    (swap! created-temp-dirs conj d)
    d))

(defn write-handoff! [dir filename content]
  (fs/create-dirs dir)
  (spit (str (fs/path dir filename)) content))

(def handoff-content
  (str "id: x\nfrom: coder\nto: cleaner\npriority: 50\ntype: git_handoff\n"
       "task: BL-901\ncommit: abcdef0123\nrecipient: cleaner\n\nbody\n"))

;; ── handoff-files-with-batches: non-existent dir returns empty ────────────

(assert= "non-existent dir returns empty vec"
         [] (handoff-lib/handoff-files-with-batches "/no/such/dir-xyz"))

;; ── handoff-files-with-batches: flat files only (no batch dirs) ──────────

(let [dir (mk-tmp-dir)]
  (write-handoff! dir "10_a.handoff" handoff-content)
  (write-handoff! dir "20_b.handoff" handoff-content)
  (let [result (handoff-lib/handoff-files-with-batches dir)]
    (assert= "flat files listed when no batch dirs exist"
             2 (count result))
    (assert-true "sorted by filename"
                 (str/ends-with? (str (first result)) "10_a.handoff"))))

;; ── handoff-files-with-batches: files inside batch_* subdir ──────────────

(let [dir (mk-tmp-dir)
      batch-dir (fs/path dir "batch_20260901T000000Z_000001")]
  (write-handoff! batch-dir "30_inside.handoff" handoff-content)
  (let [result (handoff-lib/handoff-files-with-batches dir)]
    (assert= "batch-held file is visible"
             1 (count result))
    (assert-true "filename matches"
                 (str/ends-with? (str (first result)) "30_inside.handoff"))))

;; ── handoff-files-with-batches: mixed flat + batch ───────────────────────

(let [dir (mk-tmp-dir)
      batch-dir (fs/path dir "batch_20260901T000000Z_000001")]
  (write-handoff! dir "10_flat.handoff" handoff-content)
  (write-handoff! batch-dir "20_nested.handoff" handoff-content)
  (let [result (handoff-lib/handoff-files-with-batches dir)]
    (assert= "flat + batch-held files both listed"
             2 (count result))
    (assert-true "sorted across depths"
                 (str/ends-with? (str (first result)) "10_flat.handoff"))))

;; ── handoff-files-with-batches: empty batch dir contributes nothing ──────

(let [dir (mk-tmp-dir)
      empty-batch (fs/path dir "batch_20260901T000000Z_000001")]
  (fs/create-dirs empty-batch)
  (let [result (handoff-lib/handoff-files-with-batches dir)]
    (assert= "empty batch dir contributes no files"
             [] result)))

;; ── handoff-files-with-batches: non-batch subdirs are ignored ────────────

(let [dir (mk-tmp-dir)
      other-dir (fs/path dir "other_subdir")]
  (write-handoff! other-dir "hidden.handoff" handoff-content)
  (let [result (handoff-lib/handoff-files-with-batches dir)]
    (assert= "non-batch_* subdirs are not descended"
             [] result)))

;; ── handoff-files-with-batches: multiple batch dirs ──────────────────────

(let [dir (mk-tmp-dir)
      batch1 (fs/path dir "batch_20260901T000000Z_000001")
      batch2 (fs/path dir "batch_20260901T000001Z_000002")]
  (write-handoff! batch1 "10_first.handoff" handoff-content)
  (write-handoff! batch2 "20_second.handoff" handoff-content)
  (let [result (handoff-lib/handoff-files-with-batches dir)]
    (assert= "files from both batch dirs are listed"
             2 (count result))))

;; ── Report ────────────────────────────────────────────────────────────────

(if (empty? @failures)
  (println "bl1313 handoff-files-with-batches: ALL TESTS PASSED")
  (do (println (str "bl1313 handoff-files-with-batches: " (count @failures) " FAILURE(S):"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
