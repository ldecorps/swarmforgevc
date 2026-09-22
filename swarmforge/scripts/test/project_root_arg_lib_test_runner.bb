#!/usr/bin/env bb
;; project_root_arg_lib_test_runner.bb — BL-1517 check-root/refusal-line tests.

(require '[babashka.fs :as fs]
         '[babashka.process :as process]
         '[clojure.string :as str])
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "project_root_arg_lib.bb")))

(def assert= (fn [msg a b]
               (when (not= a b)
                 (throw (ex-info msg {:expected b :actual a})))))
(def assert-true (fn [msg v] (assert= msg (boolean v) true)))

;; ── blank / flag-shaped / missing directory - no git IO needed ─────────────

(assert= "nil arg refuses :blank"
         :blank (:reason (project-root-arg-lib/check-root nil)))

(assert= "empty-string arg refuses :blank"
         :blank (:reason (project-root-arg-lib/check-root "")))

(assert= "whitespace-only arg refuses :blank"
         :blank (:reason (project-root-arg-lib/check-root "   ")))

(assert= "a flag-shaped arg refuses :flag-shaped"
         :flag-shaped (:reason (project-root-arg-lib/check-root "--help")))

(assert= "a bare-dash arg refuses :flag-shaped"
         :flag-shaped (:reason (project-root-arg-lib/check-root "-x")))

(let [missing (str (fs/path (fs/temp-dir) (str "bl1517-missing-" (System/nanoTime))))]
  (assert= "a nonexistent path refuses :not-a-directory"
           :not-a-directory (:reason (project-root-arg-lib/check-root missing))))

;; :arg is always the raw verbatim string, unchanged by the reason.
(assert= "refusal :arg is verbatim"
         "--tick-once" (:arg (project-root-arg-lib/check-root "--tick-once")))

;; ── :directory strictness - a plain (non-git) existing dir passes ──────────

(let [dir (str (fs/create-temp-dir {:prefix "bl1517-plain-"}))]
  (try
    (assert-true "a plain existing directory passes :directory strictness"
                 (:ok (project-root-arg-lib/check-root dir :strictness :directory)))
    (assert= "a plain existing directory refuses :repository strictness"
             :not-a-repository (:reason (project-root-arg-lib/check-root dir :strictness :repository)))
    (finally
      (fs/delete-tree dir))))

;; ── :repository strictness - a real git checkout passes, its parent doesn't ─

(let [root (str (fs/create-temp-dir {:prefix "bl1517-repo-"}))]
  (try
    (process/sh {:dir root} "git" "init" "-q")
    (process/sh {:dir root} "git" "config" "user.email" "t@t")
    (process/sh {:dir root} "git" "config" "user.name" "t")
    (process/sh {:dir root} "git" "commit" "-q" "--allow-empty" "-m" "init")
    (let [check (project-root-arg-lib/check-root root :strictness :repository)]
      (assert-true "a real git checkout passes :repository strictness" (:ok check))
      (assert= "the passing check's :root is the canonicalised path"
               (str (fs/canonicalize root)) (:root check)))
    (assert-true "a git checkout also passes the looser :directory strictness"
                 (:ok (project-root-arg-lib/check-root root :strictness :directory)))
    (finally
      (fs/delete-tree root))))

;; ── refusal-line formatting ─────────────────────────────────────────────────

(assert= "refusal-line names the reason for a blank arg"
         "REFUSED project-root : no project-root argument given"
         (project-root-arg-lib/refusal-line {:arg "" :reason :blank}))

(assert= "refusal-line names the verbatim arg and its flag-shaped reason"
         "REFUSED project-root --help: looks like a flag, not a path"
         (project-root-arg-lib/refusal-line {:arg "--help" :reason :flag-shaped}))

(assert= "refusal-line names a not-a-directory reason"
         "REFUSED project-root tmp/x: not an existing directory"
         (project-root-arg-lib/refusal-line {:arg "tmp/x" :reason :not-a-directory}))

;; ── the durable check: enumeration + behavioral probe ──────────────────────

(let [dir (str (fs/create-temp-dir {:prefix "bl1517-check-"}))]
  (try
    (spit (str (fs/path dir "guardedSteps.bb"))
          (str "#!/usr/bin/env bb\n"
               "(require '[babashka.fs :as fs])\n"
               "(load-file \"" (str (fs/canonicalize "swarmforge/scripts/project_root_arg_lib.bb")) "\")\n"
               "(def project-root (let [c (project-root-arg-lib/check-root (first *command-line-args*))]"
               " (if (:ok c) (:root c) (project-root-arg-lib/refuse-and-exit! \"usage\" c))))\n"
               "(println project-root)\n"))
    (spit (str (fs/path dir "unguardedSteps.bb"))
          "#!/usr/bin/env bb\n(def project-root (first *command-line-args*))\n(println project-root)\n")
    (spit (str (fs/path dir "notAHarness.bb"))
          "#!/usr/bin/env bb\n(println \"no command-line-args read here\")\n")

    (assert= "harness-root-binding-files finds exactly the two that read *command-line-args*"
             #{"guardedSteps.bb" "unguardedSteps.bb"}
             (set (map #(str (fs/file-name %)) (project-root-arg-lib/harness-root-binding-files dir))))

    (assert-true "missing-fixture-root? is true for the unguarded fixture"
                 (project-root-arg-lib/missing-fixture-root? (str (fs/path dir "unguardedSteps.bb"))))
    (assert= "missing-fixture-root? is false for the guarded fixture"
             false
             (project-root-arg-lib/missing-fixture-root? (str (fs/path dir "guardedSteps.bb"))))

    (let [result (project-root-arg-lib/missing-fixture-root-check dir)]
      (assert= "the check examines both root-binding files, never the non-binding one"
               2 (count (:examined result)))
      (assert= "the check's offenders names exactly the unguarded one"
               1 (count (:offenders result)))
      (assert-true "the offender is unguardedSteps.bb"
                   (some #(str/ends-with? % "unguardedSteps.bb") (:offenders result))))
    (finally
      (fs/delete-tree dir))))

(println "project_root_arg_lib_test_runner: ok")
