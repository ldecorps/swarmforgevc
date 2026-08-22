#!/usr/bin/env bb
;; BL-1033 property test (coder-authored, one DECLARED invariant) over
;; bl1025_expedite_approval_property_runner.bb's cleanup.
;;
;;   Invariant: "A fixture temp root is removed on EVERY EXIT PATH - assertion
;;   failure, thrown helper, or kill - never only when the runner reaches its
;;   last line."
;;
;; The invariant quantifies over EXIT PATHS, so the generator produces exit
;; paths rather than data. The runner makes 57 git calls in a normal run, and
;; its `g` helper throws ex-info on any non-zero git exit - so failing the Nth
;; call yields 57 distinct points at which the run can die, each leaving the
;; process at a different depth with different state on disk. A `git` shim on
;; PATH that fails only its Nth invocation is what turns "every exit path"
;; into something a generator can actually draw from.
;;
;; REACH, asserted rather than hoped for (BL-654's generator-reach clause).
;; Two things would make this pass while testing almost nothing:
;;
;;   - Clustering at low N. Failing call #1 dies during fixture setup, before
;;     the run has written anything interesting; that one path passing says
;;     nothing about a throw 50 calls deep, which is where the run holds the
;;     most state. Early and late throw points are floored SEPARATELY, and the
;;     count of DISTINCT throw points is floored too - one N drawn thirty
;;     times is one exit path, not thirty.
;;   - Only ever drawing the throw shape. A cleanup that deleted the root
;;     unconditionally at startup would satisfy every throw case while
;;     destroying the happy path, so the normal and broken-sweep shapes are
;;     injected at fixed rates with their own floors, and P3 asserts the
;;     happy path still passes AND still reports its 32-case sweep.
;;
;; SIGKILL is deliberately not modelled: nothing traps it, and asserting it
;; would be asserting a guarantee that does not exist. SIGTERM is covered by
;; the sibling shell test, which can settle around the one window a shutdown
;; hook genuinely cannot close (creating the directory and registering the
;; hook that reclaims it are not one atomic step).
;;
;; Non-vacuity PROVEN at authoring time (2026-08-22), each break restored:
;;   - remove the shutdown hook (the defect itself) ............ P1, every throw shape
;;   - move the happy-path delete-tree above the assertions .... P3
;;   - swallow the throw so the runner exits 0 ................. P2

(ns bl1033-temp-root-cleanup-property-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as p]
            [clojure.string :as str]))

(def test-dir (fs/parent (fs/canonicalize *file*)))
(def scripts-dir (fs/parent test-dir))
(def runner (str (fs/path test-dir "bl1025_expedite_approval_property_runner.bb")))
(def tmp-base (System/getProperty "java.io.tmpdir"))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 30))
;; Measured on this host: a normal run makes 57 git calls. Drawing past that
;; simply never fires the shim, which is the `normal` shape by another name -
;; harmless, and the floors below keep the shapes honest either way.
(def git-calls 57)

;; BISECTED against the runner with its fix removed, and this is the number
;; that makes the difference between a real property and a decorative one:
;; failing git calls 1-17 - the fixture setup - throws OUT of the run and
;; leaks the root; from call 18 the failure is recorded as an ordinary
;; property failure and the run walks to its own delete-tree, leaking nothing
;; whether the shutdown hook is there or not. A generator drawing fail-at
;; uniformly from 1..57 lands in the leak-capable window under a third of the
;; time, so most of its draws assert nothing about the defect. Both halves are
;; drawn deliberately and floored separately below.
(def last-throwing-git-call 17)

(def failures (atom []))
(def coverage (atom {:throw 0 :normal 0 :broken-sweep 0 :leaky-window 0 :post-setup 0 :shim-never-fired 0}))
(def throw-points (atom #{}))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) (max 1 n)) (step s)])

(defn- roots []
  ;; list-dir + a name filter, NOT fs/glob: fs/glob does not match
  ;; DIRECTORIES, so a glob-based detector returns the empty set no matter how
  ;; many roots leaked and every P1 assertion below passes vacuously. Caught by
  ;; the non-vacuity break - removing the shutdown hook left P1 green, which is
  ;; the only reason this was found rather than shipped as fake coverage.
  (set (map str (filter #(str/starts-with? (fs/file-name %) "bl1025-prop-")
                        (fs/list-dir tmp-base)))))

;; This runner creates scratch dirs of its own, so it obeys the very rule it
;; is testing: a shutdown hook for the abnormal paths, alongside the
;; try/finally below for the normal one.
(def scratch (fs/create-temp-dir {:prefix "bl1033-prop-"}))
(-> (Runtime/getRuntime)
    (.addShutdownHook (Thread. #(when (fs/exists? scratch) (fs/delete-tree scratch)))))

(try
  ;; A git shim that passes through to the real git except on its Nth call.
  ;; Counting in a file, not a variable: each invocation is a separate process.
  (let [shim-dir (fs/path scratch "bin")
        counter (str (fs/path scratch "git-calls"))
        real-git (str/trim (:out (p/shell {:out :string :continue true} "sh" "-c" "command -v git")))]
    (fs/create-dirs shim-dir)
    (spit (str (fs/path shim-dir "git"))
          (str "#!/usr/bin/env bash\n"
               "n=$(( $(cat \"$BL1033_COUNTER\" 2>/dev/null || echo 0) + 1 ))\n"
               "printf '%s' \"$n\" > \"$BL1033_COUNTER\"\n"
               "if [ \"$n\" = \"$BL1033_FAIL_AT\" ]; then\n"
               "  echo 'bl1033: forced git failure' >&2\n"
               "  exit \"${BL1033_FAIL_CODE:-1}\"\n"
               "fi\n"
               "exec " real-git " \"$@\"\n"))
    (fs/set-posix-file-permissions (fs/path shim-dir "git") "rwxr-xr-x")

    ;; The broken-sweep copy lives OUTSIDE the repo, in the layout the runner's
    ;; own relative load-file resolution needs, so no scratch .bb is ever left
    ;; inside swarmforge/scripts for a tree-wide guard to scan.
    (let [copy-scripts (fs/path scratch "copy" "scripts")
          copy-test (fs/path copy-scripts "test")]
      (fs/create-dirs copy-test)
      (fs/copy (fs/path scripts-dir "expedite_lib.bb") (fs/path copy-scripts "expedite_lib.bb"))
      (fs/copy (fs/path scripts-dir "is_qa_ancestor.sh") (fs/path copy-scripts "is_qa_ancestor.sh"))
      (spit (str (fs/path copy-test "runner.bb"))
            (str/replace (slurp runner) "(not= 32 @swept)" "(not= 999 @swept)"))

      (loop [i 0 s 1033]
        (when (< i runs)
          (let [[shape-i s1] (gen-int s 10)
                [window s2] (gen-int s1 2)
                [n s2b] (gen-int s2 (if (zero? window)
                                      last-throwing-git-call
                                      (- git-calls last-throwing-git-call)))
                [code-i s3] (gen-int s2b 3)
                shape (case shape-i 0 :normal, 1 :broken-sweep, :throw)
                ;; Half the throws land in the leak-capable setup window and
                ;; half past it, by construction rather than by luck.
                fail-at (if (zero? window) (inc n) (+ last-throwing-git-call 1 n))
                code (case code-i 0 128, 1 127, 1)
                counter-file (str (fs/path scratch (str "counter-" i)))
                before (roots)
                env (cond-> {"BL1033_COUNTER" counter-file
                             "PATH" (str shim-dir ":" (System/getenv "PATH"))}
                      (= :throw shape) (assoc "BL1033_FAIL_AT" (str fail-at)
                                              "BL1033_FAIL_CODE" (str code)))
                target (if (= :broken-sweep shape) (str (fs/path copy-test "runner.bb")) runner)
                {:keys [exit out err]} (p/shell {:out :string :err :string :continue true
                                                 :extra-env env}
                                                "bb" target)
                after (roots)
                leaked (clojure.set/difference after before)
                ;; What the run ACTUALLY did, not what was drawn. A run makes a
                ;; variable number of git calls, so a fail-at past the end of a
                ;; particular run never fires the shim and that run is a normal
                ;; one however it was labelled. Asserting "a throw shape must
                ;; exit non-zero" against a draw that produced no throw is
                ;; asserting about the label, not the behaviour.
                calls-made (or (some-> (when (fs/exists? counter-file) (slurp counter-file))
                                       str/trim parse-long)
                               0)
                fired? (and (= :throw shape) (>= calls-made fail-at))
                effective (if (and (= :throw shape) (not fired?)) :normal shape)
                input {:shape shape :effective effective :fail-at (when (= :throw shape) fail-at)
                       :calls-made calls-made :exit-code code}]

            (swap! coverage update effective inc)
            (when (and (= :throw shape) (not fired?))
              (swap! coverage update :shim-never-fired inc))
            (when fired?
              (swap! throw-points conj fail-at)
              (swap! coverage update
                     (if (<= fail-at last-throwing-git-call) :leaky-window :post-setup) inc))

            ;; ── P1 (the invariant): no exit path leaves a fixture root.
            (when (seq leaked)
              (report! "P1 (invariant: the fixture temp root is removed on every exit path)" s input
                       (str "leaked " (pr-str leaked))))
            ;; Leaked or not, never accumulate across runs.
            (doseq [d leaked] (fs/delete-tree d))

            ;; ── P2: cleanup never swallows the failure. A hook that also
            ;; made the run exit 0 would satisfy P1 and destroy the runner.
            ;;
            ;; Scoped to the throws that genuinely propagate, and the reason is
            ;; a property of the runner rather than a weakening of this test.
            ;; Not every git call the runner makes is one whose failure is an
            ;; error: some back is_qa_ancestor.sh, a PREDICATE where a non-zero
            ;; exit is a legitimate "no". Failing one of those changes an
            ;; answer, the runner's properties still hold, and the run
            ;; correctly exits 0. Asserting "any fired shim must fail the run"
            ;; would be asserting that a predicate cannot return false.
            (when (and (zero? exit)
                       (or (= :broken-sweep effective)
                           (and fired? (<= fail-at last-throwing-git-call))))
              (report! "P2 (a run that threw out still fails loudly)" s input
                       (str "exit=0; stdout=" (pr-str out) " stderr=" (pr-str err))))

            ;; ── P3: the happy path is untouched - still passes, still
            ;; reports the exhaustive sweep the ticket says must not be
            ;; weakened to make the run stop throwing.
            (when (= :normal effective)
              (when-not (zero? exit)
                (report! "P3 (the happy path still passes)" s input
                         (str "exit=" exit " stderr=" (pr-str err))))
              (when-not (str/includes? (str out) "32 cases, exhaustive")
                (report! "P3 (the happy path still reports its 32-case exhaustive sweep)" s input
                         (pr-str out))))
            (recur (inc i) s3))))))

  ;; :leaky-window is the floor that matters - it counts the draws that can
  ;; actually observe the defect. :post-setup is floored too, because the
  ;; "recorded, not thrown" path must also leave nothing behind.
  (doseq [[k floor] {:throw 14 :normal 2 :broken-sweep 2 :leaky-window 8 :post-setup 5}]
    (when (< (get @coverage k 0) floor)
      (swap! failures conj (str "FAIL coverage: the generator reached " k " only "
                                (get @coverage k 0) " time(s), floor " floor))))
  ;; One N drawn many times is ONE exit path, however many runs it consumed.
  (when (< (count @throw-points) 10)
    (swap! failures conj (str "FAIL coverage: only " (count @throw-points)
                              " DISTINCT throw point(s) were reached, floor 10 - "
                              "the property is covering one exit path, not many")))
  (finally
    (fs/delete-tree scratch)))

(if (seq @failures)
  (do (doseq [f @failures] (binding [*out* *err*] (println f)))
      (println (str "\n" (count @failures) " failure(s)"))
      (System/exit 1))
  (println (str "bl1033 temp-root-cleanup properties: " runs " runs, "
                (count @throw-points) " distinct throw points, coverage " (pr-str @coverage)
                "\nALL PROPERTIES HOLD")))
