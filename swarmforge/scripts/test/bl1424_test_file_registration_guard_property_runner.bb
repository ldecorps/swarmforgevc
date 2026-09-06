#!/usr/bin/env bb
;; BL-1424 coder pass (BL-654 invariants): PROPERTY tests over the REAL
;; check_test_file_registration.sh (which execs the REAL
;; check_test_file_registration_cli.bb, which load-files the REAL
;; unregistered_test_gate_lib.bb's findings-for-staged-commit) - never a
;; reimplementation of the decision. Seeded (not wall-clock)
;; java.util.Random so failures reproduce.
;;
;;   P1 (invariant 1, the load-bearing property): commit-scoped, not
;;      tree-scoped. Each generated case's own construction decides its
;;      OWN expected outcome (never calling the guard as an oracle, the
;;      tautology BL-654 must avoid): a staged addition with no row
;;      refuses REGARDLESS of how much pre-existing, already-committed
;;      drift the tree carries; drift alone, with every staged addition
;;      registered, never refuses.
;;   P2 (invariant 3): fail-open on an unreadable staged manifest (WARNS,
;;      exit 0), and blindness to unstaged/untracked working-tree state -
;;      a file present on disk but never `git add`-ed is invisible even
;;      when it would otherwise be a finding.
;;   P3 (invariant 2): the guard's own notion of "does this path need a
;;      row" (unregistered-test-gate-lib/parcel-test-file, the SAME
;;      function findings-for-git-handoff already uses) agrees, on every
;;      generated filename shape, with an independent re-derivation from
;;      suite-inventory-lib/test-file? plus the non-recursive-nesting rule
;;      - never a second, independently-maintained notion of "registered".
;;
;; Non-vacuity, checked by hand before landing (see
;; backlog/evidence/BL-1424-coder-pass-20260906.md for the exact breaks and
;; the failures each produced, then restored and re-verified green).

(ns bl1424-test-file-registration-guard-property-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(def SCRIPT-DIR (str (fs/parent (fs/canonicalize *file*))))
(def SCRIPTS-DIR (str (fs/path SCRIPT-DIR "..")))
(def GUARD-SH (str (fs/path SCRIPTS-DIR "check_test_file_registration.sh")))
(def TEST-DIR "swarmforge/scripts/test")
(def MANIFEST (str TEST-DIR "/suite-manifest.tsv"))

(load-file (str (fs/path SCRIPTS-DIR "unregistered_test_gate_lib.bb")))

(def failures (atom []))
(defn- report-fail [prop n input msg]
  (swap! failures conj (str "FAIL " prop " case " n "\n  input: " (pr-str input) "\n  " msg)))

(def ^:private rng (java.util.Random. 1424))
(defn- rint [bound] (.nextInt rng (int bound)))
(defn- rbool [] (.nextBoolean rng))
(def ^:private WORDS ["alpha" "bravo" "charlie" "delta" "echo" "foxtrot" "golf" "hotel"])
(defn- rword [] (nth WORDS (rint (count WORDS))))

(defn- git! [root & args]
  (apply process/sh (into ["git" "-C" (str root)] args)))

(defn- write! [p content]
  (fs/create-dirs (fs/parent p))
  (spit (str p) content))

(defn- append! [p content]
  (spit (str p) content :append true))

(defn- mk-repo! [prefix]
  (let [root (str (fs/create-temp-dir {:prefix prefix}))]
    (git! root "init" "-q" "-b" "main")
    (git! root "config" "user.email" "t@t")
    (git! root "config" "user.name" "t")
    (write! (fs/path root MANIFEST) "existing_test_runner.bb\tstanding\t\t\n")
    (write! (fs/path root "seed.txt") "seed\n")
    (git! root "add" "-A")
    (git! root "commit" "-q" "-m" "seed")
    root))

(defn- run-guard! [root]
  (let [res (process/sh {:dir (str root)} "bash" GUARD-SH)]
    {:exit (:exit res) :out (str (:out res) (:err res))}))

;; ── P1: invariant 1 - commit-scoped, not tree-scoped ─────────────────────
(def P1-RUNS 24)
(dotimes [n P1-RUNS]
  (let [root (mk-repo! "bl1424-p1-")]
    (try
      (let [n-drift (rint 3)
            n-staged (inc (rint 3))
            drift-files (vec (for [i (range n-drift)] (str "test_drift_" (rword) "_" i ".sh")))
            staged-specs (vec (for [i (range n-staged)]
                                 {:file (if (even? i)
                                          (str "test_new_" (rword) "_" i ".sh")
                                          (str (rword) "_" i "_test_runner.bb"))
                                  :registered? (rbool)}))]
        (doseq [f drift-files]
          (write! (fs/path root TEST-DIR f) "#!/usr/bin/env bash\necho drift\n"))
        (when (seq drift-files)
          (git! root "add" "-A")
          (git! root "commit" "-q" "-m" "pre-existing drift, already on HEAD"))
        (doseq [{:keys [file registered?]} staged-specs]
          (write! (fs/path root TEST-DIR file) "#!/usr/bin/env bash\necho new\n")
          (when registered?
            (append! (fs/path root MANIFEST) (str file "\tstanding\t\t\n"))))
        (git! root "add" "-A")
        (let [{:keys [exit out]} (run-guard! root)
              unregistered (remove :registered? staged-specs)
              expect-refuse? (boolean (seq unregistered))
              input {:n-drift n-drift :staged staged-specs}]
          (if expect-refuse?
            (do
              (when-not (= exit 1)
                (report-fail "P1" n input (str "expected refuse (exit 1) - a staged addition lacks a row - got exit " exit ": " out)))
              (doseq [{:keys [file]} unregistered]
                (when-not (str/includes? out file)
                  (report-fail "P1" n input (str "the refusal did not name " file ": " out)))))
            (when-not (= exit 0)
              (report-fail "P1" n input (str "expected exit 0 (every staged addition is registered, whatever the drift) - got exit " exit ": " out))))))
      (finally (fs/delete-tree root)))))

;; ── P2: invariant 3 - fail-open, and blind to unstaged state ─────────────
(def P2-RUNS 8)
(dotimes [n P2-RUNS]
  (let [root (mk-repo! "bl1424-p2-")
        kind (if (even? n) :manifest-missing :untracked-only)]
    (try
      (case kind
        :manifest-missing
        (do
          (git! root "rm" "-q" MANIFEST)
          (git! root "commit" "-q" "-m" "remove the manifest entirely")
          (fs/create-dirs (fs/path root TEST-DIR))
          (write! (fs/path root TEST-DIR (str "test_orphan_" (rword) ".sh")) "#!/usr/bin/env bash\necho orphan\n")
          (git! root "add" "-A"))

        :untracked-only
        (do
          (write! (fs/path root TEST-DIR (str "test_untracked_" (rword) ".sh")) "#!/usr/bin/env bash\necho untracked\n")
          (write! (fs/path root "README-unrelated.md") "unrelated\n")
          (git! root "add" "--" "README-unrelated.md")))
      (let [{:keys [exit out]} (run-guard! root)]
        (case kind
          :manifest-missing
          (do
            (when-not (= exit 0)
              (report-fail "P2" n kind (str "expected fail-open exit 0 for an unreadable staged manifest, got " exit ": " out)))
            (when-not (str/includes? (str/lower-case out) "warning")
              (report-fail "P2" n kind (str "expected a WARNING on an unreadable staged manifest, got: " out))))

          :untracked-only
          (when-not (= exit 0)
            (report-fail "P2" n kind (str "expected exit 0 - the unstaged file is invisible - got exit " exit ": " out)))))
      (finally (fs/delete-tree root)))))

;; ── P3: invariant 2 - one notion of "needs a row", never a second ────────
(def P3-RUNS 24)
(def shape-generators
  [#(str "test_" (rword) ".sh")
   #(str (rword) "_test_runner.bb")
   #(str (rword) "_property_runner.bb")
   #(str "helper_" (rword) ".sh")
   #(str (rword) ".md")
   #(str "lib/test_" (rword) ".sh")
   #(str "lib/" (rword) "_test_runner.bb")])

(dotimes [n P3-RUNS]
  (let [gen (nth shape-generators (rint (count shape-generators)))
        rel (gen)
        full-path (str TEST-DIR "/" rel)
        via-lib (unregistered-test-gate-lib/parcel-test-file full-path)
        basename (str (fs/file-name rel))
        nested? (str/includes? rel "/")
        via-inventory (when (and (not nested?) (suite-inventory-lib/test-file? basename)) basename)]
    (when-not (= via-lib via-inventory)
      (report-fail "P3" n rel
                    (str "the guard's own notion of \"needs a row\" disagreed with an independent "
                         "re-derivation from suite-inventory-lib/test-file?: lib=" (pr-str via-lib)
                         " inventory-derived=" (pr-str via-inventory))))))

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println (str "ALL PASS: bl1424_test_file_registration_guard_property_runner.bb ("
                (+ P1-RUNS P2-RUNS P3-RUNS) " cases)")))
