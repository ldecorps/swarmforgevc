#!/usr/bin/env bb
;; BL-1407 property test (coder-authored, three DECLARED invariants) over the
;; REAL check_property_suite_drift.sh - run as a subprocess against a real
;; generated git repository for each draw, never a reimplementation of the
;; guard's own shell/subprocess logic. The defect this ticket fixes lives in
;; which decision the guard's own shell makes from a re-run's exit code and
;; timing, so only the real script and a real repo can answer these.
;;
;;   Invariant 1: "A deterministic red is always refused: a non-allowlisted
;;   file that fails again when re-run alone refuses the commit exactly as
;;   today, naming the file - the re-run can never turn a real regression
;;   into a pass."
;;
;;   Invariant 2: "A flake never passes silently: every red the re-run
;;   cleared is recorded durably (file, commit, whether the commit touched
;;   that file, and where the full-run output is retained) so the flake
;;   rate is measurable."
;;
;;   Invariant 3: "The re-run is bounded: each red file is re-run at most
;;   once, alone, under a wall-clock ceiling; a re-run that cannot complete
;;   counts as a failure, never as a pass."
;;
;; REACH, asserted rather than hoped for (BL-654's generator-reach clause):
;; all three kinds (deterministic-red, flaky, hang) and, for the flaky kind,
;; both touched-by-commit booleans must each be hit at least once.

(ns bl1407-property-gate-rerun-isolation-property-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 45))
(def failures (atom []))
(def coverage (atom {:det-red 0 :flaky-touched 0 :flaky-untouched 0 :hang 0}))

(def guard (str (fs/path (fs/parent (fs/parent (fs/canonicalize *file*))) "check_property_suite_drift.sh")))

(when-not (fs/exists? guard)
  (binding [*out* *err*] (println (str "FATAL: not found: " guard)))
  (System/exit 2))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) (max 1 n)) (step s)])

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- sh! [root & args]
  (let [{:keys [exit out err]} (apply process/sh {:dir root :continue true} args)]
    {:exit exit :out out :err err}))

(defn- git! [root & args]
  (apply sh! root "git" args))

(defn- build-repo! [root]
  (git! root "init" "-q" "-b" "main")
  (git! root "config" "user.email" "test@test")
  (git! root "config" "user.name" "test")
  (git! root "config" "commit.gpgsign" "false")
  (git! root "commit" "-q" "--allow-empty" "-m" "seed")
  (fs/create-dirs (fs/path root "extension" "src"))
  (spit (str (fs/path root "extension" "src" "pipelineBoard.ts")) "v1\n")
  (git! root "add" "extension/src/pipelineBoard.ts"))

(def fake-file "test/bl1407PropRed.property.test.js")

(defn- fake-suite-script [kind]
  (case kind
    :det-red
    (str "printf '%s\\n' ' FAIL  " fake-file " > x' >&2; exit 1")
    :flaky
    (str "if [ \"$#\" -eq 0 ]; then printf '%s\\n' ' FAIL  " fake-file " > x' >&2; exit 1; else exit 0; fi")
    :hang
    (str "if [ \"$#\" -eq 0 ]; then printf '%s\\n' ' FAIL  " fake-file " > x' >&2; exit 1; else sleep 30; exit 0; fi")))

(defn- run-guard! [root kind ceiling-seconds]
  (let [opts (cond-> {:dir root :continue true}
               ceiling-seconds (assoc :extra-env {"SWARMFORGE_PROPERTY_RERUN_CEILING_SECONDS" (str ceiling-seconds)}))
        {:keys [exit out err]} (process/sh opts "bash" guard "bash" "-c" (fake-suite-script kind))]
    {:allowed (zero? exit) :output (str out err)}))

(defn- flake-log-path [root]
  (let [ym (.format (java.time.format.DateTimeFormatter/ofPattern "yyyy-MM")
                     (java.time.ZonedDateTime/now java.time.ZoneOffset/UTC))]
    (str (fs/path root ".swarmforge" "property-flakes" (str ym ".jsonl")))))

(defn- read-flake-records [root]
  (let [p (flake-log-path root)]
    (if (fs/exists? p)
      (->> (str/split-lines (slurp p)) (remove str/blank?) (map #(re-seq #"\"([a-z_]+)\":(\"[^\"]*\"|true|false)" %)))
      [])))

(defn- field [record k]
  (some (fn [[_ key v]] (when (= key k) v)) record))

(loop [i 0 s 1407]
  (when (< i runs)
    (let [[kind-n s1] (gen-int s 3)
          kind (nth [:det-red :flaky :hang] kind-n)
          [tn s2] (gen-int s1 2)
          touches? (zero? tn)
          root (str (fs/create-temp-dir {:prefix "bl1407-prop-"}))]
      (try
        (build-repo! root)
        (when (and (= kind :flaky) touches?)
          (fs/create-dirs (fs/path root "test"))
          (spit (str (fs/path root fake-file)) "content\n")
          (git! root "add" fake-file))
        (case kind
          :det-red
          (do
            (swap! coverage update :det-red inc)
            (let [{:keys [allowed output]} (run-guard! root :det-red nil)]
              (when allowed
                (report! "P1 (invariant 1: a deterministic red is always refused)" s {:kind kind} output))
              (when-not (str/includes? output fake-file)
                (report! "P1 (invariant 1: the refusal must name the file)" s {:kind kind} output))
              (when (fs/exists? (flake-log-path root))
                (report! "P2 (invariant 2: a deterministic red must never be recorded as a flake)" s {:kind kind} output))))

          :flaky
          (do
            (swap! coverage update (if touches? :flaky-touched :flaky-untouched) inc)
            (let [{:keys [allowed output]} (run-guard! root :flaky nil)
                  head (:out (git! root "rev-parse" "HEAD"))
                  head (str/trim head)
                  records (read-flake-records root)
                  rec (first (filter #(= (field % "file") (str "\"" fake-file "\"")) records))]
              (when-not allowed
                (report! "P1/P2 (invariant 1: a flake that passes alone must be allowed, not refused)" s {:kind kind :touches touches?} output))
              (when-not rec
                (report! "P2 (invariant 2: every cleared flake must be recorded durably)" s {:kind kind :touches touches?} output))
              (when rec
                (let [commit-val (field rec "commit")
                      touched-val (field rec "touched_by_commit")]
                  (when (or (nil? commit-val) (= commit-val "\"\""))
                    (report! "P2 (invariant 2: the flake record must name a commit)" s {:kind kind :touches touches?} rec))
                  (when-not (= commit-val (str "\"" head "\""))
                    (report! "P2 (invariant 2: the flake record's commit must match HEAD at decision time)" s {:kind kind :touches touches? :head head} rec))
                  (when-not (= touched-val (str touches?))
                    (report! "P2 (invariant 2: touched_by_commit must reflect whether THIS commit staged the file)" s {:kind kind :touches touches?} rec))))))

          :hang
          (do
            (swap! coverage update :hang inc)
            (let [start (System/currentTimeMillis)
                  {:keys [allowed output]} (run-guard! root :hang "1")
                  elapsed-s (/ (- (System/currentTimeMillis) start) 1000.0)]
              (when allowed
                (report! "P3 (invariant 3: a re-run past its ceiling must never pass)" s {:kind kind} output))
              (when-not (str/includes? output fake-file)
                (report! "P3 (invariant 3: the refusal must name the hung file)" s {:kind kind} output))
              (when (> elapsed-s 15)
                (report! "P3 (invariant 3: the ceiling must actually bound wall-clock time, not just the verdict)" s {:kind kind} (str "took " elapsed-s "s"))))))
        (finally
          (fs/delete-tree root)))
      (recur (inc i) s2))))

(doseq [[k floor] {:det-red 5 :flaky-touched 2 :flaky-untouched 2 :hang 5}]
  (when (< (get @coverage k 0) floor)
    (swap! failures conj (str "FAIL coverage: the generator reached " k " only "
                              (get @coverage k 0) " time(s), floor " floor))))

(if (seq @failures)
  (do (doseq [f @failures] (binding [*out* *err*] (println f)))
      (println (str "\n" (count @failures) " failure(s)"))
      (System/exit 1))
  (println (str "bl1407 property-gate-rerun-isolation properties: " runs " runs, coverage " (pr-str @coverage)
                "\nALL PROPERTIES HOLD")))
