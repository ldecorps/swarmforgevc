#!/usr/bin/env bb
;; TDD runner for sampled_reach_floor_guard_lib.bb (BL-1584) - the send-time
;; gate that refuses a git_handoff whose own parcel ADDS a property test file
;; with a sampled-low reach-floor shape (low literal budget, asserts every
;; arm was reached).

(ns sampled-reach-floor-guard-lib-test-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "sampled_reach_floor_guard_lib.bb")))

(def failures (atom []))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))
(defn assert-true [msg actual] (assert= msg true actual))
(defn assert-false [msg actual] (assert= msg false actual))
(defn assert-includes [msg haystack needle]
  (when-not (str/includes? (str haystack) needle)
    (swap! failures conj (str "FAIL: " msg "\n  expected to include: " (pr-str needle) "\n  actual: " (pr-str haystack)))))

;; ── reach-floor? ─────────────────────────────────────────────────────────

(assert-true "assertReachFloor( alone is a match, whatever else the file says"
             (sampled-reach-floor-guard-lib/reach-floor? "assertReachFloor(counts, CELLS, N, 'cell');"))

(assert-true "a phrase inside an assert.ok( call's own argument text matches"
             (sampled-reach-floor-guard-lib/reach-floor?
              "assert.ok(reach.short > 0, 'never exercised a partial streak');"))

(assert-true "matching is case-insensitive"
             (sampled-reach-floor-guard-lib/reach-floor?
              "assert.ok(x, 'NEVER EXERCISED the thing');"))

(assert-false "a comment-only mention never matches - only assert-call argument text counts"
              (sampled-reach-floor-guard-lib/reach-floor?
               "// a reach floor below asserts the arm is actually common\nassert.equal(1, 1);"))

(assert-false "a custom assertXxx( helper (no dot, not a bare call) is never treated as assert("
              (sampled-reach-floor-guard-lib/reach-floor?
               "assertRunWritesNoDecision(HOTFIX, () => { fc.assert(() => {}, { numRuns: 20 }); });"))

(assert-false "an assert call with no known phrase never matches"
              (sampled-reach-floor-guard-lib/reach-floor?
               "assert.equal(res.status, 0, `fixture build failed`);"))

(assert-false "no assert calls at all never matches"
              (sampled-reach-floor-guard-lib/reach-floor? "const x = 1;"))

;; ── constructed? ─────────────────────────────────────────────────────────

(assert-true "runsPerCell( anywhere marks the file constructed"
             (sampled-reach-floor-guard-lib/constructed? "const N = runsPerCell(TOTAL, 3);"))
(assert-false "no runsPerCell( is not constructed"
              (sampled-reach-floor-guard-lib/constructed? "const N = 12;"))

;; ── budget ───────────────────────────────────────────────────────────────

(assert= "a single literal numRuns is the budget"
         20 (sampled-reach-floor-guard-lib/budget "fc.assert(() => {}, { numRuns: 20 });"))

(assert= "the smallest literal numRuns among several draw sites wins"
         2 (sampled-reach-floor-guard-lib/budget
            "fc.assert(a, { numRuns: 4 }); fc.assert(b, { numRuns: 2 }); fc.assert(c, { numRuns: 3 });"))

(assert= "a non-literal numRuns (an identifier) is unresolved"
         :unresolved (sampled-reach-floor-guard-lib/budget "fc.assert(() => {}, { numRuns: RUNS });"))

(assert= "one unresolved draw site makes the whole file unresolved even with a literal one present"
         :unresolved
         (sampled-reach-floor-guard-lib/budget
          "fc.assert(a, { numRuns: 5 }); fc.assert(b, { numRuns: SOME_CONST });"))

(assert= "no fast-check draw site at all is :none"
         :none (sampled-reach-floor-guard-lib/budget "const x = randBool();"))

(assert= "an fc.assert with no numRuns option counts as fast-check's default 100"
         100 (sampled-reach-floor-guard-lib/budget "fc.assert(fc.property(fc.integer(), () => true));"))

(assert= "an fc.check with no numRuns option also defaults to 100"
         100 (sampled-reach-floor-guard-lib/budget "fc.check(fc.property(fc.integer(), () => true));"))

(assert= "fc.sample's bare positional integer count is a literal draw site"
         1 (sampled-reach-floor-guard-lib/budget
            "const sample = fc.sample(fc.array(ARB, { minLength: 1, maxLength: 6 }), 1)[0];"))

(assert= "fc.sample's { numRuns: N } options form is read by the general scan, never double-counted"
         5 (sampled-reach-floor-guard-lib/budget
            "for (const x of fc.sample(arb(), { numRuns: 5, seed: 1 })) {}"))

(assert= "fc.sample's { numRuns: <identifier> } options form is unresolved, not silently skipped"
         :unresolved
         (sampled-reach-floor-guard-lib/budget
          "for (const x of fc.sample(arb(), { numRuns: CELL_RUNS, seed: 1 })) {}"))

;; ── classify: the one entry point ───────────────────────────────────────

(assert= "no reach-floor phrase at all is no-floor, regardless of budget"
         :no-floor (:verdict (sampled-reach-floor-guard-lib/classify "fc.assert(a, { numRuns: 3 });")))

(assert= "a floor plus runsPerCell( is constructed, regardless of budget"
         :constructed
         (:verdict (sampled-reach-floor-guard-lib/classify
                    "const N = runsPerCell(T, 3); assert.ok(x, 'never exercised the thing');")))

(assert= "a floor with no fast-check draw site at all is no-draw"
         :no-draw
         (:verdict (sampled-reach-floor-guard-lib/classify "assert.ok(x, 'never exercised the thing');")))

(assert= "a floor, no runsPerCell, literal budget under 100 is sampled-low"
         :sampled-low
         (:verdict (sampled-reach-floor-guard-lib/classify
                    "fc.assert(a, { numRuns: 3 }); assert.ok(x, 'never exercised the thing');")))

(assert= "a floor, no runsPerCell, unresolved budget is sampled-low"
         :sampled-low
         (:verdict (sampled-reach-floor-guard-lib/classify
                    "fc.assert(a, { numRuns: RUNS }); assert.ok(x, 'too rare to test');")))

(assert= "a floor, no runsPerCell, literal budget 100 or more is sampled-high"
         :sampled-high
         (:verdict (sampled-reach-floor-guard-lib/classify
                    "fc.assert(a, { numRuns: 400 }); assert.ok(x, 'reachability floor never produced it');")))

(assert= "a literal budget of exactly 100 is sampled-high, not sampled-low"
         :sampled-high
         (:verdict (sampled-reach-floor-guard-lib/classify
                    "fc.assert(a, { numRuns: 100 }); assert.ok(x, 'reach floor');")))

;; ── strip-comments: a comment never matches ANY check, not only phrases ──
;;
;; The scenario that caught this (BL-1584's own acceptance step handler,
;; scenario 04): a comment explaining a file does NOT construct its floor
;; ("no runsPerCell( added") textually CONTAINS "runsPerCell(" - constructed?
;; is a bare substring search with no call-scoping like reach-floor?'s own,
;; so without stripping first, a comment about the remedy flips the verdict
;; away from sampled-low and the warning vanishes silently.

(assert= "a line comment mentioning runsPerCell( never marks the file constructed"
         :sampled-low
         (:verdict (sampled-reach-floor-guard-lib/classify
                    "fc.assert(a, { numRuns: 3 });\n// no runsPerCell( added here\nassert.ok(x, 'never exercised the thing');")))

(assert= "a block comment mentioning runsPerCell( never marks the file constructed"
         :sampled-low
         (:verdict (sampled-reach-floor-guard-lib/classify
                    "fc.assert(a, { numRuns: 3 }); /* runsPerCell( belongs elsewhere */ assert.ok(x, 'never exercised the thing');")))

(assert= "a line comment naming assertReachFloor( never marks the file reach-floor on its own"
         :no-floor
         (:verdict (sampled-reach-floor-guard-lib/classify
                    "// assertReachFloor( is the remedy, not used here\nfc.assert(a, { numRuns: 3 }); assert.equal(1, 1);")))

(assert= "a comment inside an assert call's own argument text never carries a phrase match"
         :no-floor
         (:verdict (sampled-reach-floor-guard-lib/classify
                    "fc.assert(a, { numRuns: 3 }); assert.ok(x, /* never exercised, but only in a comment */ 'ok');")))

(assert= "strip-comments leaves string/template content untouched (a // or /* inside a string is not a comment)"
         :sampled-low
         (:verdict (sampled-reach-floor-guard-lib/classify
                    "fc.assert(a, { numRuns: 3 }); assert.ok(x, 'never exercised // not a comment /* still not */');")))

;; ── property-test-path? ─────────────────────────────────────────────────

(assert-true "a flat file under extension/test/*.property.test.js is governed"
             (sampled-reach-floor-guard-lib/property-test-path? "extension/test/bl999Foo.property.test.js"))
(assert-false "a nested path is never governed - the glob is flat"
              (sampled-reach-floor-guard-lib/property-test-path? "extension/test/helpers/reachFloors.js"))
(assert-false "a non-property test file is not governed"
              (sampled-reach-floor-guard-lib/property-test-path? "extension/test/bl999Foo.test.js"))
(assert-false "a file outside the tree is another lane's business"
              (sampled-reach-floor-guard-lib/property-test-path? "swarmforge/scripts/foo.property.test.js"))

;; ── change-kind ──────────────────────────────────────────────────────────

(assert= "absent at received, present at forwarded is added"
         :added (sampled-reach-floor-guard-lib/change-kind {:was-present? false :is-present? true}))
(assert= "present at both is modified"
         :modified (sampled-reach-floor-guard-lib/change-kind {:was-present? true :is-present? true}))
(assert= "present at received, absent at forwarded (deleted) is other"
         :other (sampled-reach-floor-guard-lib/change-kind {:was-present? true :is-present? false}))
(assert= "absent at both is other"
         :other (sampled-reach-floor-guard-lib/change-kind {:was-present? false :is-present? false}))

;; ── decide-for-path: the added-vs-modified x verdict decision table ──────

(assert= "added + sampled-low refuses"
         :refuse (:action (sampled-reach-floor-guard-lib/decide-for-path
                            {:path "x" :kind :added :verdict :sampled-low :matched "m" :budget 3})))
(assert= "added + sampled-high warns"
         :warn (:action (sampled-reach-floor-guard-lib/decide-for-path
                          {:path "x" :kind :added :verdict :sampled-high :matched "m" :budget 400})))
(assert= "added + no-draw warns"
         :warn (:action (sampled-reach-floor-guard-lib/decide-for-path
                          {:path "x" :kind :added :verdict :no-draw :matched "m" :budget :none})))
(assert= "added + constructed is clean - nil"
         nil (sampled-reach-floor-guard-lib/decide-for-path
              {:path "x" :kind :added :verdict :constructed :matched "m" :budget :unresolved}))
(assert= "added + no-floor is clean - nil"
         nil (sampled-reach-floor-guard-lib/decide-for-path
              {:path "x" :kind :added :verdict :no-floor :matched nil :budget 3}))
(assert= "modified + sampled-low NEVER refuses - only warns (invariant 1)"
         :warn (:action (sampled-reach-floor-guard-lib/decide-for-path
                          {:path "x" :kind :modified :verdict :sampled-low :matched "m" :budget 3})))
(assert= "modified + sampled-high warns"
         :warn (:action (sampled-reach-floor-guard-lib/decide-for-path
                          {:path "x" :kind :modified :verdict :sampled-high :matched "m" :budget 400})))
(assert= "modified + no-draw warns"
         :warn (:action (sampled-reach-floor-guard-lib/decide-for-path
                          {:path "x" :kind :modified :verdict :no-draw :matched "m" :budget :none})))
(assert= "modified + constructed is clean - nil"
         nil (sampled-reach-floor-guard-lib/decide-for-path
              {:path "x" :kind :modified :verdict :constructed :matched "m" :budget :unresolved}))
(assert= "modified + no-floor is clean - nil"
         nil (sampled-reach-floor-guard-lib/decide-for-path
              {:path "x" :kind :modified :verdict :no-floor :matched nil :budget 3}))

;; ── blocked? / refusal-message ───────────────────────────────────────────

(assert-false "an empty finding set never blocks" (sampled-reach-floor-guard-lib/blocked? {:findings []}))
(assert-true "a finding blocks"
             (sampled-reach-floor-guard-lib/blocked?
              {:findings [{:path "extension/test/x.property.test.js" :verdict :sampled-low :matched "m" :budget 3}]}))

(let [msg (sampled-reach-floor-guard-lib/refusal-message
           {:task-name "BL-1584-something"
            :findings [{:path "extension/test/bl999Foo.property.test.js" :verdict :sampled-low
                        :matched "never exercised the thing, over and over and over and over and over and over again past eighty chars"
                        :budget 3}]})]
  (assert-includes "the refusal names the task" msg "BL-1584-something")
  (assert-includes "the refusal names the file" msg "extension/test/bl999Foo.property.test.js")
  (assert-includes "the refusal names the budget" msg "3")
  (assert-includes "the refusal names the remedy: runsPerCell" msg "runsPerCell")
  (assert-includes "the refusal names the remedy: assertReachFloor" msg "assertReachFloor")
  (assert-true "the quoted assertion text is truncated to 80 chars"
               (<= (count (re-find #"\"[^\"]*\"" msg)) 82)))

;; ── findings-for-git-handoff: fail-open is absolute ──────────────────────

(assert= "a task name with no ticket id gives up quietly rather than refusing"
         {:findings [] :warnings []}
         (sampled-reach-floor-guard-lib/findings-for-git-handoff
          {:root "/nonexistent" :sender "coder" :task-name "no-ticket-here" :commit "aaaaaaaaaa"}))

(let [result (sampled-reach-floor-guard-lib/findings-for-git-handoff
              {:root "/nonexistent-root-for-bl1584" :sender "coder" :task-name "BL-1584-x" :commit "aaaaaaaaaa"})]
  (assert-true "an unreadable commit range warns rather than blocking" (boolean (seq (:warnings result))))
  (assert= "...and reports no findings" [] (:findings result))
  (assert-false "...so the send is allowed" (sampled-reach-floor-guard-lib/blocked? result)))

;; ── findings-for-git-handoff: real git fixture ────────────────────────────
;;
;; Mirrors task_scope_gate_lib_test_runner.bb's own with-fixture shape. One
;; role ("coder") whose worktree-path IS the fixture root, non-master (so no
;; extra role subdirectory) - matches handoff_lib.bb's mailbox-base-dir
;; convention exactly.

(defn- sh! [dir & args]
  (let [{:keys [exit out err]} (apply process/sh {:dir (str dir) :continue true} args)]
    {:exit exit :out (str/trim (or out "")) :err (str/trim (or err ""))}))

(defmacro with-fixture [[root-sym] & body]
  `(let [~root-sym (str (fs/create-temp-dir {:prefix "bl1584-fixture-"}))]
     (try
       (sh! ~root-sym "git" "init" "-q" "-b" "main" ".")
       (sh! ~root-sym "git" "config" "user.email" "t@t")
       (sh! ~root-sym "git" "config" "user.name" "t")
       (sh! ~root-sym "git" "config" "commit.gpgsign" "false")
       (sh! ~root-sym "git" "commit" "-q" "--allow-empty" "-m" "seed")
       ~@body
       (finally (fs/delete-tree ~root-sym)))))

(defn- write-file! [root path content]
  (fs/create-dirs (fs/parent (fs/path root path)))
  (spit (str (fs/path root path)) content))

(defn- commit! [root path content message]
  (write-file! root path content)
  (sh! root "git" "add" "-A")
  (sh! root "git" "commit" "-q" "-m" message))

(defn- head [root] (:out (sh! root "git" "rev-parse" "HEAD")))

(def role-row "coder\tcoder-wt\t%s\tsession\tCoder\tclaude\ttask")

(defn- write-roles! [root]
  (fs/create-dirs (fs/path root ".swarmforge"))
  (spit (str (fs/path root ".swarmforge" "roles.tsv")) (str (format role-row (str root)) "\n")))

(defn- seed-received-parcel! [root task-name commit]
  (let [dir (fs/path root ".swarmforge" "handoffs" "inbox" "in_process")]
    (fs/create-dirs dir)
    (spit (str (fs/path dir "00_received.handoff"))
          (str "type: git_handoff\nto: cleaner\npriority: 50\ntask: " task-name
               "\ncommit: " commit "\nfrom: coder\nrole: coder\n\nbody\n"))))

(def TASK "BL-1584-fixture")

(def sampled-low-text "fc.assert(a, { numRuns: 3 }); assert.ok(x, 'never exercised the thing');")
(def sampled-high-text "fc.assert(a, { numRuns: 400 }); assert.ok(x, 'reachability floor never produced it');")
(def no-draw-text "assert.ok(x, 'never exercised the thing');")
(def constructed-text "const N = runsPerCell(T, 3); assert.ok(x, 'never exercised the thing');")
(def no-floor-text "fc.assert(a, { numRuns: 3 }); assert.equal(1,1);")

;; scenario: an ADDED sampled-low property test file is refused.
(with-fixture [root]
  (write-roles! root)
  (commit! root "backlog/active/BL-1584-fixture-x.yaml" "id: BL-1584\n" "BL-1584-fixture: own ticket seed")
  (let [received (head root)]
    (seed-received-parcel! root TASK received)
    (commit! root "extension/test/bl9001Foo.property.test.js" sampled-low-text
             "BL-1584-fixture: adds a sampled-low property test")
    (let [forwarded (head root)
          result (sampled-reach-floor-guard-lib/findings-for-git-handoff
                  {:root root :sender "coder" :task-name TASK :commit forwarded})]
      (assert-true "an added sampled-low file blocks the send"
                   (sampled-reach-floor-guard-lib/blocked? result))
      (assert= "exactly one finding, naming the added file"
               ["extension/test/bl9001Foo.property.test.js"] (mapv :path (:findings result)))
      (let [msg (sampled-reach-floor-guard-lib/refusal-message
                 {:task-name TASK :findings (:findings result)})]
        (assert-includes "refusal names the file" msg "extension/test/bl9001Foo.property.test.js")
        (assert-includes "refusal names the budget" msg "3")))))

;; scenario: an ADDED sampled-high file warns but does not block.
(with-fixture [root]
  (write-roles! root)
  (commit! root "backlog/active/BL-1584-fixture-x.yaml" "id: BL-1584\n" "BL-1584-fixture: own ticket seed")
  (let [received (head root)]
    (seed-received-parcel! root TASK received)
    (commit! root "extension/test/bl9002Foo.property.test.js" sampled-high-text
             "BL-1584-fixture: adds a sampled-high property test")
    (let [forwarded (head root)
          result (sampled-reach-floor-guard-lib/findings-for-git-handoff
                  {:root root :sender "coder" :task-name TASK :commit forwarded})]
      (assert-false "an added sampled-high file never blocks" (sampled-reach-floor-guard-lib/blocked? result))
      (assert-true "...but does warn, naming the file"
                   (boolean (some #(str/includes? % "extension/test/bl9002Foo.property.test.js") (:warnings result)))))))

;; scenario: an ADDED no-draw file warns but does not block.
(with-fixture [root]
  (write-roles! root)
  (commit! root "backlog/active/BL-1584-fixture-x.yaml" "id: BL-1584\n" "BL-1584-fixture: own ticket seed")
  (let [received (head root)]
    (seed-received-parcel! root TASK received)
    (commit! root "extension/test/bl9003Foo.property.test.js" no-draw-text
             "BL-1584-fixture: adds a no-draw property test")
    (let [forwarded (head root)
          result (sampled-reach-floor-guard-lib/findings-for-git-handoff
                  {:root root :sender "coder" :task-name TASK :commit forwarded})]
      (assert-false "an added no-draw file never blocks" (sampled-reach-floor-guard-lib/blocked? result))
      (assert-true "...but does warn, naming the file"
                   (boolean (some #(str/includes? % "extension/test/bl9003Foo.property.test.js") (:warnings result)))))))

;; scenario: an ADDED constructed file is entirely clean - no finding, no warning.
(with-fixture [root]
  (write-roles! root)
  (commit! root "backlog/active/BL-1584-fixture-x.yaml" "id: BL-1584\n" "BL-1584-fixture: own ticket seed")
  (let [received (head root)]
    (seed-received-parcel! root TASK received)
    (commit! root "extension/test/bl9004Foo.property.test.js" constructed-text
             "BL-1584-fixture: adds a constructed property test")
    (let [forwarded (head root)
          result (sampled-reach-floor-guard-lib/findings-for-git-handoff
                  {:root root :sender "coder" :task-name TASK :commit forwarded})]
      (assert-false "an added constructed file never blocks" (sampled-reach-floor-guard-lib/blocked? result))
      (assert= "...and never warns" [] (:warnings result)))))

;; scenario: an ADDED no-floor file is entirely clean - no finding, no warning.
(with-fixture [root]
  (write-roles! root)
  (commit! root "backlog/active/BL-1584-fixture-x.yaml" "id: BL-1584\n" "BL-1584-fixture: own ticket seed")
  (let [received (head root)]
    (seed-received-parcel! root TASK received)
    (commit! root "extension/test/bl9005Foo.property.test.js" no-floor-text
             "BL-1584-fixture: adds a no-floor property test")
    (let [forwarded (head root)
          result (sampled-reach-floor-guard-lib/findings-for-git-handoff
                  {:root root :sender "coder" :task-name TASK :commit forwarded})]
      (assert-false "an added no-floor file never blocks" (sampled-reach-floor-guard-lib/blocked? result))
      (assert= "...and never warns" [] (:warnings result)))))

;; scenario 03 (the load-bearing one, invariant 1): a PRE-EXISTING file the
;; parcel only MODIFIES is never refused, whatever its shape - at most a
;; warning.
(with-fixture [root]
  (write-roles! root)
  (commit! root "extension/test/bl9006Foo.property.test.js" sampled-low-text
           "pre-existing: sampled-low property test, already on main")
  (let [received (head root)]
    (seed-received-parcel! root TASK received)
    (commit! root "extension/test/bl9006Foo.property.test.js" (str sampled-low-text "\n// touched")
             "BL-1584-fixture: touches the pre-existing sampled-low file")
    (let [forwarded (head root)
          result (sampled-reach-floor-guard-lib/findings-for-git-handoff
                  {:root root :sender "coder" :task-name TASK :commit forwarded})]
      (assert-false "a MODIFIED pre-existing sampled-low file is never refused"
                    (sampled-reach-floor-guard-lib/blocked? result))
      (assert-true "...but is still warned about"
                   (boolean (some #(str/includes? % "extension/test/bl9006Foo.property.test.js") (:warnings result)))))))

;; scenario: no recorded received commit at all (first hop) - silent, the
;; gate does not run rather than guessing at added-vs-modified.
(with-fixture [root]
  (write-roles! root)
  (commit! root "extension/test/bl9007Foo.property.test.js" sampled-low-text
           "BL-1584-fixture: first hop, nothing received yet")
  (let [forwarded (head root)
        result (sampled-reach-floor-guard-lib/findings-for-git-handoff
                {:root root :sender "coder" :task-name TASK :commit forwarded})]
    (assert= "no recorded received commit: findings []" [] (:findings result))
    (assert= "no recorded received commit: warnings [] (silent, not even a warning)" [] (:warnings result))))

;; scenario: the recorded received commit itself cannot be read - warns and
;; sends, never refuses on the gate's own blindness.
(with-fixture [root]
  (write-roles! root)
  (commit! root "backlog/active/BL-1584-fixture-x.yaml" "id: BL-1584\n" "BL-1584-fixture: own ticket seed")
  (seed-received-parcel! root TASK "deadbeef00")
  (commit! root "extension/test/bl9008Foo.property.test.js" sampled-low-text
           "BL-1584-fixture: adds a sampled-low property test")
  (let [forwarded (head root)
        result (sampled-reach-floor-guard-lib/findings-for-git-handoff
                {:root root :sender "coder" :task-name TASK :commit forwarded})]
    (assert-false "an unreadable received commit never blocks" (sampled-reach-floor-guard-lib/blocked? result))
    (assert= "...and no findings" [] (:findings result))))

;; scenario: a foreign file (not under extension/test/) is never considered,
;; however it is shaped.
(with-fixture [root]
  (write-roles! root)
  (commit! root "backlog/active/BL-1584-fixture-x.yaml" "id: BL-1584\n" "BL-1584-fixture: own ticket seed")
  (let [received (head root)]
    (seed-received-parcel! root TASK received)
    (commit! root "extension/src/bl9009Foo.ts" sampled-low-text
             "BL-1584-fixture: unrelated functional file, sampled-low-shaped text but wrong tree")
    (let [forwarded (head root)
          result (sampled-reach-floor-guard-lib/findings-for-git-handoff
                  {:root root :sender "coder" :task-name TASK :commit forwarded})]
      (assert-false "a file outside extension/test/ is never a finding"
                    (sampled-reach-floor-guard-lib/blocked? result))
      (assert= "...and never a warning either" [] (:warnings result)))))

(if (empty? @failures)
  (println "ALL PASS: sampled_reach_floor_guard_lib.bb")
  (do (doseq [f @failures] (println f))
      (println (count @failures) "FAILURES")
      (System/exit 1)))
