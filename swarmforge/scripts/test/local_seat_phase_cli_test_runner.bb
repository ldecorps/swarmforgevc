#!/usr/bin/env bb
;; BL-2037 D2 (QA bounce, backlog/evidence/BL-2037-QA-20261006.md): no suite
;; ran local_seat_phase_cli.bb's refusal dispatch itself - the property test
;; drives local_seat_phase_lib.bb's pure functions directly via load-file and
;; never touches the CLI, so a refuse! that exited 0, dropped its reason, or
;; wrote the record before checking :ok would have stayed green everywhere.
;; This runner spawns the REAL `bb local_seat_phase_cli.bb` against a mkdtemp
;; worktree for every refused move named in the bounce (D1's missing/absent
;; --notes plus a representative illegal `end`/`pass`/`fail`), and asserts
;; three things together: exit status, stderr naming the move or the missing
;; flag, and the record file byte-identical before and after (the only way to
;; show a refusal is provably untouched is to read the bytes, not re-derive
;; them from the CLI's own output).

(ns local-seat-phase-cli-test-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(def cli (str (fs/path script-dir ".." "local_seat_phase_cli.bb")))

(def failures (atom []))
(defn- fail! [m] (swap! failures conj m))

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn- mk-root []
  (let [d (str (fs/create-temp-dir {:prefix "bl2037-cli-refusal-"}))]
    (swap! created-temp-dirs conj d)
    d))

(defn- record-path [root ticket]
  (str (fs/path root ".swarmforge" "phase" (str ticket ".md"))))

(defn- seed-record! [root ticket phase failed notes]
  (let [p (record-path root ticket)]
    (fs/create-dirs (fs/parent p))
    (spit p (str "phase: " phase "\n"
                 "failed: " failed "\n"
                 (apply str (for [n notes] (str "===\n" n "\n")))))))

(defn- record-bytes [root ticket]
  (let [p (record-path root ticket)]
    (when (fs/exists? p) (slurp p))))

(defn- run-cli [root & args]
  (apply process/sh {:dir root :continue true} "bb" cli args))

(defn- assert-refused!
  "Runs the CLI, then checks the three things a refusal must get right at
   once: exit 1, stderr naming `name-fragment`, and the record file
   byte-identical to `before` (nil if no record existed yet)."
  [{:keys [label root ticket args name-fragment]}]
  (let [before (record-bytes root ticket)
        result (apply run-cli root args)
        after (record-bytes root ticket)]
    (when-not (= 1 (:exit result))
      (fail! (str "FAIL (" label "): expected exit 1, got " (:exit result)
                  "\n  stdout: " (:out result) "\n  stderr: " (:err result))))
    (when-not (str/includes? (:err result) name-fragment)
      (fail! (str "FAIL (" label "): stderr does not name \"" name-fragment "\": " (:err result))))
    (when-not (= before after)
      (fail! (str "FAIL (" label "): record changed on refusal\n  before: " (pr-str before)
                  "\n  after:  " (pr-str after))))))

;; ── illegal `end` moves ──────────────────────────────────────────────────

(let [root (mk-root) ticket "BL-9001"]
  (seed-record! root ticket "act" 0 ["seed"])
  (let [notes (str (fs/path root "n.txt"))]
    (spit notes "should not be appended")
    (assert-refused! {:label "end act->act (end never stays in act)"
                       :root root :ticket ticket
                       :args ["end" ticket "--to" "act" "--notes" notes]
                       :name-fragment "act"})))

(let [root (mk-root) ticket "BL-9001"]
  (seed-record! root ticket "assert" 1 ["seed"])
  (let [notes (str (fs/path root "n.txt"))]
    (spit notes "should not be appended")
    (assert-refused! {:label "end assert->act (end never moves out of assert)"
                       :root root :ticket ticket
                       :args ["end" ticket "--to" "act" "--notes" notes]
                       :name-fragment "assert"})))

;; ── illegal `pass`/`fail` moves ──────────────────────────────────────────

(let [root (mk-root) ticket "BL-9001"]
  (seed-record! root ticket "arrange" 0 ["seed"])
  (assert-refused! {:label "pass from arrange (pass only leaves assert)"
                     :root root :ticket ticket
                     :args ["pass" ticket]
                     :name-fragment "arrange"}))

(let [root (mk-root) ticket "BL-9001"]
  (seed-record! root ticket "done" 0 ["seed"])
  (let [notes (str (fs/path root "n.txt"))]
    (spit notes "should not be appended")
    (assert-refused! {:label "fail from done (fail only leaves assert)"
                       :root root :ticket ticket
                       :args ["fail" ticket "--notes" notes]
                       :name-fragment "done"})))

;; ── D1: end/fail refuse a missing or absent --notes file ─────────────────

(let [root (mk-root) ticket "BL-9001"]
  (seed-record! root ticket "arrange" 0 ["seed"])
  (assert-refused! {:label "end with --notes omitted entirely"
                     :root root :ticket ticket
                     :args ["end" ticket "--to" "act"]
                     :name-fragment "--notes"}))

(let [root (mk-root) ticket "BL-9001"]
  (seed-record! root ticket "arrange" 0 ["seed"])
  (assert-refused! {:label "end with --notes naming a file that does not exist"
                     :root root :ticket ticket
                     :args ["end" ticket "--to" "act" "--notes"
                            (str (fs/path root "does-not-exist.txt"))]
                     :name-fragment "does-not-exist.txt"}))

(let [root (mk-root) ticket "BL-9001"]
  (seed-record! root ticket "assert" 0 ["seed"])
  (assert-refused! {:label "fail with --notes omitted entirely (QA's exact D1 repro)"
                     :root root :ticket ticket
                     :args ["fail" ticket]
                     :name-fragment "--notes"}))

(let [root (mk-root) ticket "BL-9001"]
  (seed-record! root ticket "assert" 0 ["seed"])
  (assert-refused! {:label "fail with --notes naming a file that does not exist"
                     :root root :ticket ticket
                     :args ["fail" ticket "--notes"
                            (str (fs/path root "does-not-exist.txt"))]
                     :name-fragment "does-not-exist.txt"}))

;; ── control: the same moves succeed with a real --notes file, so the
;;    refusals above are the notes-problem/legality check, not a CLI that
;;    refuses everything ──────────────────────────────────────────────────

(let [root (mk-root) ticket "BL-9001"]
  (seed-record! root ticket "arrange" 0 [])
  (let [notes (str (fs/path root "n.txt"))
        _ (spit notes "control note")
        result (run-cli root "end" ticket "--to" "act" "--notes" notes)]
    (when-not (zero? (:exit result))
      (fail! (str "FAIL (control: end arrange->act succeeds): exit " (:exit result) " stderr: " (:err result))))
    (let [after (record-bytes root ticket)]
      (when-not (and after (str/includes? after "phase: act") (str/includes? after "control note"))
        (fail! (str "FAIL (control: end arrange->act succeeds): record not moved/appended: " (pr-str after)))))))

(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: local_seat_phase_cli.bb refusal dispatch (BL-2037 D2)"))
