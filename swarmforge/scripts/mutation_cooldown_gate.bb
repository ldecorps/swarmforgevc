#!/usr/bin/env bb
;; BL-149: CLI wrapper for the mutation-testing eligibility gate. The
;; hardener runs this before spending a mutation pass on a changed file;
;; decide-mutation-gate (mutation_cooldown_lib.bb) makes the actual call,
;; this file only wires it to real git history, the real host load average,
;; and swarmforge.conf.
;;
;; Usage: mutation_cooldown_gate.bb <project-root> <file-path>
;;
;; Prints DECISION: skip-cooldown | skip-busy | run, plus the inputs that
;; drove it, then exits 0 (skip-*) or 0 (run) — this is an advisory report,
;; not a pass/fail gate, so the hardener's own shell decides what to do with
;; the printed decision.
;;
;; Test-only overrides (never read outside a test fixture):
;;   SWARMFORGE_MUTATION_GATE_FORCE_LOAD_AVG, SWARMFORGE_MUTATION_GATE_FORCE_CORES
;;   short-circuit the real uptime/nproc reads so host business is
;;   deterministic in tests instead of depending on the actual test
;;   machine's ambient load (engineering.prompt: never let a test depend on
;;   real, unpredictable host state).

(ns mutation-cooldown-gate
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "mutation_cooldown_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: mutation_cooldown_gate.bb <project-root> <file-path>"))
  (System/exit 1))

(def project-root (or (nth *command-line-args* 0 nil) (usage)))
(def target-file (or (nth *command-line-args* 1 nil) (usage)))

(defn read-conf []
  (let [conf-file (fs/path project-root "swarmforge" "swarmforge.conf")]
    (mutation-cooldown-lib/parse-conf (try (slurp (str conf-file)) (catch Exception _ "")))))

(defn last-committed-ms
  "The file's last COMMITTED touch, ignoring the change at hand: `git log`
   only ever sees committed history, so any uncommitted/in-flight diff is
   already excluded by construction. A file with no commit history yet
   (brand new, still churning) has no meaningful cooldown clock - treat it
   as freshly modified right now, which always fails the cooldown check."
  [now-ms]
  (let [{:keys [exit out]} (process/sh "git" "-C" project-root "log" "-1" "--format=%at" "--" target-file)]
    (if (and (zero? exit) (not (str/blank? out)))
      (* 1000 (parse-long (str/trim out)))
      now-ms)))

(defn real-load-avg []
  (if-let [forced (System/getenv "SWARMFORGE_MUTATION_GATE_FORCE_LOAD_AVG")]
    (parse-double forced)
    (let [{:keys [exit out]} (process/sh "uptime")]
      (if (zero? exit)
        ;; Matches both "load average: 1.20, 1.35, 1.40" (Linux/WSL) and
        ;; "load averages: 1.20 1.35 1.40" (macOS/BSD) - first number after
        ;; the "load average" label is the 1-minute figure.
        (if-let [[_ n] (re-find #"load averages?:\s*([0-9.]+)" out)]
          (parse-double n)
          0.0)
        0.0))))

(defn real-core-count []
  (if-let [forced (System/getenv "SWARMFORGE_MUTATION_GATE_FORCE_CORES")]
    (parse-long forced)
    (let [nproc (process/sh "nproc")]
      (if (zero? (:exit nproc))
        (parse-long (str/trim (:out nproc)))
        (let [sysctl (process/sh "sysctl" "-n" "hw.ncpu")]
          (if (zero? (:exit sysctl))
            (parse-long (str/trim (:out sysctl)))
            4)))))) ; last-resort default; never crash the gate over a probe failure

(defn -main []
  (let [now-ms (System/currentTimeMillis)
        conf (read-conf)
        days (mutation-cooldown-lib/cooldown-days conf)
        multiplier (mutation-cooldown-lib/busy-load-multiplier conf)
        last-modified-ms (last-committed-ms now-ms)
        load-avg (real-load-avg)
        cores (real-core-count)
        busy (mutation-cooldown-lib/host-busy? load-avg cores multiplier)
        decision (mutation-cooldown-lib/decide-mutation-gate last-modified-ms now-ms days busy)
        age-days (/ (- now-ms last-modified-ms) (* 24 60 60 1000.0))]
    (println (str "DECISION: " (name decision)))
    (println (format "file_age_days: %.2f (cooldown: %d days)" age-days days))
    (println (format "load_avg: %.2f cores: %d busy_threshold: %.2fx (%s)"
                      (double load-avg) cores (double multiplier) (if busy "busy" "quiet")))))

(-main)
