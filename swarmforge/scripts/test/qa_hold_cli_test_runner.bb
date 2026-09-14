#!/usr/bin/env bb
;; Direct subprocess test of qa_hold_cli.bb (BL-1566) - the CLI's own
;; dispatch, IO and exit-code CONTRACT (open writes the store, status is
;; read-only, close is the one path that deletes an open record) plus its
;; refusal branches, none of which the pure qa_hold_lib_test_runner.bb (no
;; filesystem) or the acceptance feature's happy-path scenarios exercise:
;; close on a task with no open hold, and missing-argument usage errors for
;; each subcommand. Complements, does not duplicate: no release-decision
;; assertions here, those live in the lib runner and the feature file.

(ns qa-hold-cli-test-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as p]
            [clojure.string :as str]
            [cheshire.core :as json]))

(def cli (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "qa_hold_cli.bb")))

(def failures (atom []))

(defn run [& args]
  (let [r (apply p/shell {:out :string :err :string :continue true} "bb" cli args)]
    {:out (str/trim-newline (:out r)) :err (str/trim-newline (:err r)) :exit (:exit r)}))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual]
  (when-not actual
    (swap! failures conj (str "FAIL: " msg "\n  actual: " (pr-str actual)))))

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                  (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn mk-root []
  (let [d (str (fs/create-temp-dir {:prefix "qa-hold-cli-test-"}))]
    (swap! created-temp-dirs conj d)
    d))

;; ── open ──────────────────────────────────────────────────────────────────

(let [root (mk-root)
      {:keys [out exit]} (run root "open" "--task" "BL-9000" "--commit" "abc1234567"
                               "--red" "a.js,b.js" "--evidence" "ev1")
      f (fs/path root ".swarmforge" "qa-holds" "BL-9000.json")]
  (assert= "open exits 0" 0 exit)
  (assert= "open prints OPENED <task> <commit>" "OPENED BL-9000 abc1234567" out)
  (assert-true "open writes the record under .swarmforge/qa-holds/<task>.json" (fs/exists? f))
  (let [record (json/parse-string (slurp (str f)) true)]
    (assert= "the written record's reds are split on comma" ["a.js" "b.js"] (:reds record))
    (assert= "the written record carries the commit" "abc1234567" (:commit record))
    (assert= "the written record carries the evidence" "ev1" (:evidence record))))

;; ── open: --red may repeat instead of comma-joining ─────────────────────

(let [root (mk-root)
      {:keys [exit]} (run root "open" "--task" "BL-9001" "--commit" "def1234567"
                           "--red" "a.js" "--red" "b.js")
      f (fs/path root ".swarmforge" "qa-holds" "BL-9001.json")]
  (assert= "open with repeated --red exits 0" 0 exit)
  (assert= "a repeated --red flag accumulates both reds"
           ["a.js" "b.js"]
           (:reds (json/parse-string (slurp (str f)) true))))

;; ── status: read-only, empty store prints nothing ───────────────────────

(let [root (mk-root)
      {:keys [out exit]} (run root "status")]
  (assert= "status on an empty store exits 0" 0 exit)
  (assert= "status on an empty store prints nothing" "" out))

;; ── close: the only path that deletes an open record ────────────────────

(let [root (mk-root)
      _ (run root "open" "--task" "BL-9002" "--commit" "aaa1111111" "--red" "a.js")
      {:keys [out exit]} (run root "close" "--task" "BL-9002" "--outcome" "approved")
      open-f (fs/path root ".swarmforge" "qa-holds" "BL-9002.json")
      closed-f (fs/path root ".swarmforge" "qa-holds" "closed" "BL-9002.json")]
  (assert= "close exits 0" 0 exit)
  (assert= "close prints CLOSED <task> <outcome>" "CLOSED BL-9002 approved" out)
  (assert-true "close removes the open record" (not (fs/exists? open-f)))
  (assert-true "close writes the closed record" (fs/exists? closed-f))
  (let [record (json/parse-string (slurp (str closed-f)) true)]
    (assert= "the closed record carries the outcome" "approved" (:outcome record))
    (assert-true "the closed record carries a closed-at timestamp" (some? (:closed-at record)))
    (assert= "the closed record still carries the original commit" "aaa1111111" (:commit record))))

;; ── close: refuses when no open hold exists for the task ────────────────
;; This is the ONE branch neither the acceptance feature (every close
;; scenario closes a hold it just opened) nor the pure lib runner (no
;; filesystem) reaches: cmd-close!'s own `refuse!` when hold-file is absent.

(let [root (mk-root)
      {:keys [out err exit]} (run root "close" "--task" "BL-9999-never-opened" "--outcome" "approved")]
  (assert-true "close on a task with no open hold exits non-zero" (not (zero? exit)))
  (assert-true "the refusal is cmd-close!'s own explicit message, not a downstream exception"
               (str/includes? (str out err) "no open hold for task BL-9999-never-opened"))
  (assert-true "nothing is written under closed/ for a task that was never open"
               (not (fs/exists? (fs/path root ".swarmforge" "qa-holds" "closed" "BL-9999-never-opened.json")))))

;; ── usage errors: missing required flags refuse rather than crash ───────

(let [root (mk-root)
      {:keys [exit]} (run root "open" "--task" "BL-9003")]
  (assert-true "open with no --commit/--red exits non-zero" (not (zero? exit))))

(let [root (mk-root)
      {:keys [exit]} (run root "close" "--task" "BL-9004")]
  (assert-true "close with no --outcome exits non-zero" (not (zero? exit))))

(let [{:keys [exit]} (run "no-root-arg")]
  (assert-true "invoking with only one arg (no subcommand) exits non-zero" (not (zero? exit))))

(let [root (mk-root)
      {:keys [exit]} (run root "bogus-subcommand")]
  (assert-true "an unrecognized subcommand exits non-zero" (not (zero? exit))))

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: qa_hold_cli.bb"))
