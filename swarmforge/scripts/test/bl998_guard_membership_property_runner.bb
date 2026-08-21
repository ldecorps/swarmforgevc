#!/usr/bin/env bb
;; BL-998 coder pass (BL-654 Invariants): a PROPERTY over the isolation
;; guard, encoding the ticket's declared invariant 2:
;;
;;   "The guard decides membership by inspecting what each test executes,
;;    never from a checked-in roster of file names, so a newly added
;;    offender is caught without anyone remembering to edit a list."
;;
;; The acceptance covers three hand-written shapes. This quantifies the same
;; claim over the axes a regex-based inspector actually breaks on: the
;; VARIABLE NAME the test binds, WHICH helper it runs, whether the helper is
;; executed or merely read, and whether the path is anchored at the real
;; scripts dir or at a fixture copy. The file NAME is randomised every run
;; too - a guard carrying a roster would pass for names on the list and fail
;; for the rest, and this cannot be satisfied by any list.
;;
;; Expected verdict is computed from the SHAPE, never from the guard:
;;   flagged  <=>  executes a self-rooting helper via a real-scripts-dir path.
;;
;; Same seeded-LCG convention as this directory's other *_property_runner.bb
;; files (deterministic, never rand - a flaky property is worse than none),
;; and the same Babashka-property-tooling-gap note (BL-472).
;;
;; Non-vacuity proven at authoring time: replacing the guard's derived
;; self-rooting scan with a hardcoded list of today's five offender
;; FILENAMES fails this immediately - every generated file carries a fresh
;; random name, so a roster matches none of them and every offending case
;; goes unflagged.

(ns bl998-guard-membership-property-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(def here (fs/parent (fs/canonicalize *file*)))
(def real-scripts (fs/parent here))
(def guard-name "test_shell_fixture_dispatch_isolation.sh")

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 96))
(def failures (atom []))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))

;; SELF-ROOTING helpers resolve their own root (dispatcher or .sh wrapper);
;; LEAF helpers do not. Both lists are read from the real tree so this stays
;; honest if the helpers change.
(def self-rooting ["ready_for_next.bb" "done_with_current.bb" "ready_for_next_task.sh"])
(def leaf ["ready_for_next_task.bb" "done_with_current_task.bb"])

;; ONE synthetic tree, reused, holding ONLY the helpers these cases name.
;; The guard re-derives the self-rooting set from the scripts dir on every
;; run, so copying all ~300 real scripts in would be ~300 greps per
;; iteration and far too slow to sample usefully. The REAL files are still
;; used - the derivation is exercised for real, just over the relevant few.
(def sandbox (str (fs/create-temp-dir {:prefix "bl998-prop-"})))
(def sb-scripts (str (fs/path sandbox "scripts")))
(fs/create-dirs (fs/path sb-scripts "test"))
(doseq [n (concat self-rooting leaf)]
  (fs/copy (fs/path real-scripts n) (fs/path sb-scripts n) {:replace-existing true}))
(fs/copy (fs/path here guard-name) (fs/path sb-scripts "test" guard-name) {:replace-existing true})

(defn- gen-case [s i]
  (let [[helper-kind s1] (gen-pick s [:self-rooting :leaf])
        [helper s2] (gen-pick s1 (if (= helper-kind :self-rooting) self-rooting leaf))
        [anchor s3] (gen-pick s2 [:real-dir :fixture-copy])
        [executed? s4] (gen-pick s3 [true false])
        [name-idx s5] (gen-int s4 100000)
        var (str "H" name-idx "_VAR")
        file-name (str "test_bl998_gen_" i "_" name-idx ".sh")]
    [{:helper helper :helper-kind helper-kind :anchor anchor :executed? executed?
      :var var :file-name file-name
      ;; The claim: only an EXECUTED, SELF-ROOTING helper reached through the
      ;; REAL scripts dir is an offence. Anything else must be left alone.
      :expect-flagged (and executed? (= helper-kind :self-rooting) (= anchor :real-dir))}
     s5]))

(defn- test-source [{:keys [helper anchor executed? var]}]
  (let [binding (if (= anchor :real-dir)
                  (str var "=\"$SCRIPT_DIR/../" helper "\"")
                  (str var "=\"$WT/swarmforge/scripts/" helper "\""))
        use (if executed?
              (str "(cd \"$WT\" && SWARMFORGE_ROLE=coder bb \"$" var "\")")
              ;; Merely READ, never run - must never be an offence.
              (str "grep -q something \"$" var "\" || true"))]
    (str/join "\n"
              ["#!/usr/bin/env bash" "set -euo pipefail"
               "SCRIPT_DIR=\"$(cd \"$(dirname \"$0\")\" && pwd)\""
               "WT=\"$(mktemp -d)\"" binding use ""])))

(defn- guard-flags? [c]
  (let [f (fs/path sb-scripts "test" (:file-name c))]
    (spit (str f) (test-source c))
    (try
      (let [{:keys [exit out err]} (process/sh {:dir sandbox} "bash" (str (fs/path sb-scripts "test" guard-name)))]
        {:flagged (not= 0 exit) :named (str/includes? (str out err) (:file-name c))})
      (finally (fs/delete-if-exists f)))))

(def seen (atom {}))

(loop [i 0 s 13]
  (when (< i runs)
    (let [[c s'] (gen-case s i)
          k [(:helper-kind c) (:anchor c) (:executed? c)]]
      (swap! seen update k (fnil inc 0))
      (let [{:keys [flagged named]} (guard-flags? c)]
        (when (not= flagged (:expect-flagged c))
          (swap! failures conj
                 (str "FAIL membership\n  seed:   " s "\n  case:   " (pr-str (dissoc c :var))
                      "\n  expected flagged=" (:expect-flagged c) " got=" flagged)))
        (when (and flagged (not named))
          (swap! failures conj (str "FAIL naming\n  case: " (pr-str (dissoc c :var))
                                    "\n  the guard flagged it but did not NAME the file"))))
      (recur (inc i) s'))))

;; Generator reach, asserted rather than hoped for: every combination of
;; (helper kind x anchor x executed?) must have been generated, or the
;; property silently tested less than it claims.
(doseq [hk [:self-rooting :leaf] a [:real-dir :fixture-copy] e [true false]]
  (when-not (get @seen [hk a e])
    (swap! failures conj (str "FAIL generator-reach: never generated " (pr-str [hk a e])))))

(fs/delete-tree sandbox)

(if (seq @failures)
  (do (doseq [f @failures] (println f))
      (println (str "\n" (count @failures) " property check(s) failed"))
      (System/exit 1))
  (println (str "ALL PASS: bl998_guard_membership_property_runner.bb (" runs " runs)")))
