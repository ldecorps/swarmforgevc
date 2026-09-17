#!/usr/bin/env bb
;; BL-1618 (coder.prompt's Invariants section - first authorship rests with
;; the coder): PROPERTY tests encoding both declared invariants.
;;
;;   invariant 1 - "The lane set of a role lives in one table in one
;;      script; the plan the script prints for a role is byte-for-byte the
;;      sequence it runs...": for a spread of role/changed-path fixtures,
;;      the REAL --plan output is compared against the REAL recorded
;;      sequence of fake-npm/fake-run_acceptance.sh invocations from an
;;      actual (non --plan) run of the SAME fixture - a true cross-check
;;      between two independent observations of the same script, never one
;;      restating the other.
;;
;;   invariant 2 - "The property lane appears in no plan for cleaner,
;;      architect, documenter or hardender unless that role's own commits
;;      changed a *.property.test.js file; it appears in QA's plan always,
;;      and in the coder's plan per the ruling.": an EXHAUSTIVE sweep of
;;      all 6 roles x {a *.property.test.js changed, no property test
;;      changed} - 12 states, small enough to enumerate completely - each
;;      checked against an independently-expressed oracle (not the
;;      script's own case statement, restated in a different shape).
;;
;; Non-vacuous by hand before committing: reverting the coder/QA rows to
;; drop "properties" from the printed list fails invariant 2 immediately;
;; swapping the RUN mode's lane->command dispatch so "properties" instead
;; invokes plain "npm test" fails invariant 1 (the recorded sequence no
;; longer matches the plan's own "properties" entry); reverted before
;; landing.

(ns bl1618-verify-lanes-property-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as p]
            [clojure.string :as str]))

(def script-dir (fs/parent (fs/canonicalize *file*)))
(def repo-root (fs/parent (fs/parent (fs/parent script-dir))))
(def real-scripts-dir (fs/path repo-root "swarmforge" "scripts"))

(def failures (atom []))
(defn- fail! [msg] (swap! failures conj msg))

(defn- sh! [dir env & args]
  (let [{:keys [exit out err]} (apply p/sh {:dir (str dir) :continue true :extra-env env} args)]
    {:exit exit :out (str/trim (or out "")) :err (str/trim (or err ""))}))

(defn- prove-fixture-isolated! [root]
  (let [{:keys [exit out]} (sh! root {} "git" "rev-parse" "--git-common-dir")
        common-dir (str (fs/canonicalize (fs/path root out)))]
    (when-not (and (zero? exit) (str/starts-with? common-dir (str (fs/canonicalize root))))
      (throw (ex-info "fixture git-common-dir does not resolve inside the fixture root" {:root root :out out})))))

(defn- install-scripts! [dest]
  (fs/create-dirs dest)
  (doseq [f (fs/list-dir real-scripts-dir)]
    (when (and (fs/regular-file? f)
               (or (str/ends-with? (str f) ".bb") (str/ends-with? (str f) ".sh")))
      (fs/copy f (fs/path dest (fs/file-name f)) {:replace-existing true})
      (fs/set-posix-file-permissions (fs/path dest (fs/file-name f)) "rwxr-xr-x"))))

(defn- mk-fixture! []
  (let [root (str (fs/create-temp-dir {:prefix "bl1618-property-"}))]
    (sh! root {} "git" "init" "-q" "-b" "main" ".")
    (prove-fixture-isolated! root)
    (sh! root {} "git" "config" "user.email" "t@t")
    (sh! root {} "git" "config" "user.name" "t")
    (sh! root {} "git" "config" "commit.gpgsign" "false")
    (spit (str (fs/path root "seed.txt")) "seed\n")
    (sh! root {} "git" "add" "-A")
    (sh! root {} "git" "commit" "-q" "-m" "seed")
    (install-scripts! (fs/path root "swarmforge" "scripts"))
    (fs/create-dirs (fs/path root ".swarmforge"))
    (spit (str (fs/path root ".swarmforge" "roles.tsv"))
          (str/join "\n"
                    (map (fn [r] (str r "\t" r "\t" root "\tswarmforge-" r "\t" r "\tclaude\ttask"))
                         ["coder" "cleaner" "architect" "hardender" "documenter" "QA"])))
    (fs/create-dirs (fs/path root "backlog" "active"))
    (spit (str (fs/path root "backlog" "active" "BL-9003-fixture.yaml"))
          "id: BL-9003\ntitle: \"fixture\"\nstatus: todo\nassigned_to: coder\nacceptance: specs/features/BL-9003-fixture.feature\n")
    ;; verify_lanes.sh's compile/unit/properties/mutation lanes all `cd` into
    ;; extension/ unconditionally (every real checkout has one) - a fixture
    ;; that never creates it would fail on the `cd` itself, never reaching
    ;; the fake npm this property is actually testing.
    (fs/create-dirs (fs/path root "extension"))
    (sh! root {} "git" "add" "-A")
    (sh! root {} "git" "commit" "-q" "-m" "scripts+roles+ticket")
    (sh! root {} "git" "update-ref" "refs/remotes/origin/main"
         (:out (sh! root {} "git" "rev-parse" "HEAD")))
    root))

(defn- fake-bin! [root]
  (let [bin (fs/path root "fake-bin")
        npm-log (fs/path root "npm.log")
        ra-log (fs/path root "run_acceptance.log")]
    (fs/create-dirs bin)
    (spit (str npm-log) "")
    (spit (str (fs/path bin "npm"))
          (str "#!/usr/bin/env bash\necho \"$*\" >> \"" npm-log "\"\nexit 0\n"))
    (fs/set-posix-file-permissions (fs/path bin "npm") "rwxr-xr-x")
    (spit (str (fs/path bin "run_acceptance.sh"))
          (str "#!/usr/bin/env bash\necho \"$*\" >> \"" ra-log "\"\nexit 0\n"))
    (fs/set-posix-file-permissions (fs/path bin "run_acceptance.sh") "rwxr-xr-x")
    {:bin (str bin) :npm-log (str npm-log) :ra-log (str ra-log)}))

(defn- touch-property-test! [root]
  (fs/create-dirs (fs/path root "extension" "test"))
  (spit (str (fs/path root "extension" "test" "bl9003.property.test.js")) "test('p', () => {});\n")
  (sh! root {} "git" "add" "-A")
  (sh! root {} "git" "commit" "-q" "-m" "touch a property test"))

(defn- touch-extension-src! [root]
  (fs/create-dirs (fs/path root "extension" "src"))
  (spit (str (fs/path root "extension" "src" "foo.ts")) "export const x = 1;\n")
  (sh! root {} "git" "add" "-A")
  (sh! root {} "git" "commit" "-q" "-m" "touch extension/src"))

;; verify_lanes.sh's acceptance-own lane resolves the ticket (and so its
;; acceptance: feature) from the role's OWN currently-held in_process
;; parcel - without one, CURRENT_TASK is empty and acceptance-own silently
;; skips (a real, intentional fail-open for "nothing is in flight", never
;; a failure). Every fixture role therefore needs a plausible held parcel
;; naming the fixture's own ticket for this half of invariant 1 to have
;; anything to observe. baseline-sha MUST be a real commit already in the
;; fixture (the tip at fixture-build time, before any later property/src
;; touches) - a placeholder hash would make received-commit-for-task's
;; DIFF_BASE unresolvable, and verify_lanes.sh's own `|| true` fallback
;; would then silently blank CHANGED_PATHS, breaking every
;; touch-property?/touch-extension? signal this property depends on.
(defn- seed-in-process-parcel! [root role baseline-sha]
  (let [dir (fs/path root ".swarmforge" "handoffs" "inbox" "in_process")]
    (fs/create-dirs dir)
    (spit (str (fs/path dir "50_a.handoff"))
          (str "id: x\nfrom: coordinator\nto: " role "\npriority: 50\ntype: git_handoff\n"
               "role: coordinator\ntask: BL-9003-fixture\ncommit: " baseline-sha "\n\n"
               "merge_and_process coordinator " baseline-sha "\n"))))

(defn- plan-for! [root bin role]
  (let [{:keys [exit out]} (sh! root {"PATH" (str bin ":" (System/getenv "PATH"))
                                       "SWARMFORGE_ROLE" role
                                       "HOME" (System/getenv "HOME")}
                                 "bash" (str (fs/path root "swarmforge" "scripts" "verify_lanes.sh")) "--plan")]
    (when-not (zero? exit) (throw (ex-info "verify_lanes --plan failed" {:role role :out out})))
    (remove str/blank? (str/split-lines out))))

;; ── invariant 1: plan == the run's own recorded sequence ────────────────

(def lane->recorded
  {"compile" ["npm" "run compile"]
   "unit" ["npm" "test"]
   "properties" ["npm" "run test:properties"]
   "mutation" ["npm" "run mutation"]})

(doseq [role ["coder" "cleaner" "documenter" "hardender" "QA"]
        touch-property? [false true]]
  (let [root (mk-fixture!)]
    (try
      (let [{:keys [bin npm-log ra-log]} (fake-bin! root)
            baseline-sha (:out (sh! root {} "git" "rev-parse" "--short=10" "HEAD"))
            _ (seed-in-process-parcel! root role baseline-sha)
            _ (when touch-property? (touch-property-test! root))
            plan (plan-for! root bin role)
            run-result (sh! root {"PATH" (str bin ":" (System/getenv "PATH"))
                                   "SWARMFORGE_ROLE" role
                                   "HOME" (System/getenv "HOME")}
                             "bash" (str (fs/path root "swarmforge" "scripts" "verify_lanes.sh")))]
        (when-not (zero? (:exit run-result))
          (fail! (str "invariant 1: role=" role " touch-property?=" touch-property?
                      " expected the run to succeed, got: " (:out run-result) (:err run-result))))
        (let [npm-invocations (if (fs/exists? npm-log)
                                 (remove str/blank? (str/split-lines (slurp npm-log)))
                                 [])
              ran-acceptance? (fs/exists? ra-log)
              expected-npm (keep (fn [lane] (second (get lane->recorded lane))) plan)
              plan-has-acceptance-own? (some #{"acceptance-own"} plan)]
          (when (not= (vec expected-npm) (vec npm-invocations))
            (fail! (str "invariant 1: role=" role " touch-property?=" touch-property?
                        " plan " (pr-str plan) " implies npm invocations " (pr-str expected-npm)
                        " but the run recorded " (pr-str npm-invocations))))
          (when (not= (boolean plan-has-acceptance-own?) (boolean ran-acceptance?))
            (fail! (str "invariant 1: role=" role " touch-property?=" touch-property?
                        " plan acceptance-own present=" plan-has-acceptance-own?
                        " but run_acceptance.sh invoked=" ran-acceptance?)))))
      (finally (fs/delete-tree root)))))

;; ── invariant 2: exhaustive role x property-test-touched sweep ──────────

(defn- oracle-has-properties? [role touch-property?]
  (case role
    "coder" true
    "QA" true
    "hardender" false
    ("cleaner" "architect" "documenter") (boolean touch-property?)))

(doseq [role ["coder" "cleaner" "architect" "hardender" "documenter" "QA"]
        touch-property? [false true]]
  (let [root (mk-fixture!)]
    (try
      (let [{:keys [bin]} (fake-bin! root)
            _ (when touch-property? (touch-property-test! root))
            plan (plan-for! root bin role)
            has-properties? (boolean (some #{"properties"} plan))
            expected (oracle-has-properties? role touch-property?)]
        (when (not= expected has-properties?)
          (fail! (str "invariant 2: role=" role " touch-property?=" touch-property?
                      " expected properties-in-plan=" expected " got " has-properties?
                      " (plan=" (pr-str plan) ")"))))
      (finally (fs/delete-tree root)))))

(println "bl1618_verify_lanes property: 10 plan-vs-run cross-checks (invariant 1) + 12-state exhaustive sweep (invariant 2)")
(if (seq @failures)
  (do (doseq [f @failures] (binding [*out* *err*] (println f)))
      (println (str (count @failures) " PROPERTY FAILURE(S)"))
      (System/exit 1))
  (println "ALL PROPERTIES HOLD"))
