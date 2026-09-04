#!/usr/bin/env bb
;; Unit tests for BL-1359: a merge is charged with exactly what it introduced
;; over its FIRST parent.
;;
;; `commit-touched-paths` asked `git diff-tree -m --first-parent ... -r <sha>`
;; for a merge. `--first-parent` is a revision-TRAVERSAL option, so on a single
;; named commit it does nothing and `-m` alone decides the output: one diff
;; section per parent, i.e. the union of the diffs against EVERY parent. The
;; file's own comment claimed the opposite, and everything downstream was
;; reasoned from the comment.
;;
;; Driven against REAL git fixtures, because the whole defect is which commits
;; a git command draws its diff from - a stubbed git layer could not exhibit it.

(require '[babashka.fs :as fs]
         '[babashka.process :as process]
         '[clojure.string :as str])

(def failures (atom []))
(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))
(defn assert-true [msg actual] (assert= msg true (boolean actual)))

(def check-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "babysitter_check.bb")))
(def fixture-prefix "bl1359-fixture-")

;; A killed run traps no `finally`, so a leftover fixture from a previous run is
;; removed by PREFIX before this one starts as well (BL-971).
(doseq [d (fs/list-dir (fs/temp-dir))
        :when (str/starts-with? (fs/file-name d) fixture-prefix)]
  (fs/delete-tree d))

(defn- sh! [dir & args]
  (apply process/sh {:dir (str dir) :continue true} args))

(defn- commit! [root path content message]
  (fs/create-dirs (fs/parent (fs/path root path)))
  (spit (str (fs/path root path)) content)
  (sh! root "git" "add" "-A")
  (sh! root "git" "commit" "-q" "-m" message))

(defn- head [root] (str/trim (:out (sh! root "git" "rev-parse" "HEAD"))))

;; babysitter_check.bb resolves project-root from *command-line-args* at load
;; time, so the fixture root is bound before the load rather than after.
(defn with-checked-root [root f]
  (binding [*command-line-args* [(str root)]]
    (load-file check-file)
    (f (resolve 'babysitter-check/commit-touched-paths)
       (resolve 'babysitter-check/commit-first-parent))))

(let [work (str (fs/create-temp-dir {:prefix fixture-prefix}))]
  (try
    (let [root (str (fs/path work "repo"))]
      (fs/create-dirs root)
      (sh! root "git" "init" "-q" "-b" "main" ".")
      (sh! root "git" "config" "user.email" "t@t")
      (sh! root "git" "config" "user.name" "t")
      (sh! root "git" "config" "commit.gpgsign" "false")
      (commit! root "shared.txt" "base\n" "seed")
      (let [base (head root)]
        ;; The side branch edits a file the first parent never sees, plus the
        ;; shared registry - the shape of a role-branch merge-up.
        (sh! root "git" "checkout" "-q" "-b" "side")
        (commit! root "side-only.txt" "side\n" "side work")
        (commit! root "shared.txt" "base\nside\n" "side edits the shared file")
        (sh! root "git" "checkout" "-q" "main")
        ;; The first parent moves on independently.
        (commit! root "main-only.txt" "main\n" "main work")
        (let [first-parent (head root)]
          ;; A merge that takes the branch's version of shared.txt, so the
          ;; merge RESULT differs from its first parent for that path and for
          ;; side-only.txt - and for nothing else.
          (sh! root "git" "merge" "-q" "--no-ff" "-m" "Merge side into main" "side")
          (let [merge-sha (head root)]
            (with-checked-root
              root
              (fn [touched-paths first-parent-of]
                (assert= "commit-first-parent resolves a merge's first parent"
                         first-parent (first-parent-of merge-sha))

                ;; The defect, stated as the two commands' own outputs.
                (let [union (set (remove str/blank?
                                         (str/split-lines
                                          (:out (sh! root "git" "diff-tree" "-m" "--first-parent"
                                                     "--no-commit-id" "--name-only" "-r" merge-sha)))))
                      no-flag (set (remove str/blank?
                                           (str/split-lines
                                            (:out (sh! root "git" "diff-tree" "-m"
                                                       "--no-commit-id" "--name-only" "-r" merge-sha)))))]
                  (assert= "--first-parent is a NO-OP on diff-tree: both forms agree, which is the whole defect"
                           union no-flag)
                  (assert-true "and that union is wider than the first-parent diff"
                               (> (count union) 2)))

                ;; What the fix returns: exactly what the merge introduced over
                ;; its first parent.
                (assert= "a merge is charged with exactly its first-parent delta"
                         #{"side-only.txt" "shared.txt"}
                         (set (touched-paths merge-sha)))
                (assert-true "and never with a path the merge did not carry in"
                             (not (contains? (set (touched-paths merge-sha)) "main-only.txt")))

                ;; BL-590's bug must not come back from the other side: a plain
                ;; diff-tree reports NOTHING for a merge, so the fix would be a
                ;; regression if it returned that.
                (let [plain (remove str/blank?
                                    (str/split-lines
                                     (:out (sh! root "git" "diff-tree" "--no-commit-id"
                                                "--name-only" "-r" merge-sha))))]
                  (assert= "a plain diff-tree still reports zero files for a merge (BL-590's bug)"
                           [] (vec plain))
                  (assert-true "so the merge's own content stays visible, which BL-590 exists to guarantee"
                               (seq (touched-paths merge-sha))))

                ;; Non-merge commits are untouched (invariant 3).
                (assert= "a non-merge commit is charged exactly as before"
                         #{"main-only.txt"}
                         (set (touched-paths first-parent)))

                ;; Fail closed (invariant 2): an unresolvable commit answers nil,
                ;; never [] - a narrowed charge set must never become a silent clean.
                (assert= "an unreadable commit yields nil, not an empty charge set"
                         nil (touched-paths "0123456789abcdef0123456789abcdef01234567"))
                (assert= "and its first parent does not resolve either"
                         nil (first-parent-of "0123456789abcdef0123456789abcdef01234567"))))))))
    (finally (fs/delete-tree work))))

;; ── invariant 2 reaches offender-row, not just the read ──────────────────
;; commit-touched-paths answers nil when a git call could not run, and
;; offender-row used to fold that into `(or touched [])` - i.e. into CLEAN.
;; A read that failed and a commit that touched nothing are the two answers a
;; safety gate must never conflate, and narrowing the merge charge adds one
;; more call that can fail.
(binding [*command-line-args* ["/nonexistent-bl1359-root"]]
  (load-file check-file))

(with-redefs [babysitter-check/commit-touched-paths (fn [_] nil)]
  (assert= "a failed touched-path read fails the sweep closed, never reads as clean"
           :babysitter-check/adjudication-failed
           (#'babysitter-check/offender-row "deadbeef" ["extension/src/"])))

(with-redefs [babysitter-check/commit-touched-paths (fn [_] [])]
  (assert= "a commit that genuinely touched nothing is still clean"
           nil
           (#'babysitter-check/offender-row "deadbeef" ["extension/src/"])))

(assert-true "and a failed row withholds the WHOLE sweep, valid offenders included"
             (:ancestry-unavailable?
              (babysitter-check/assemble-offending-commits
               [{:sha "a" :subject "s" :paths ["extension/src/x.ts"]}
                :babysitter-check/adjudication-failed])))
(assert= "so no offending commit is reported alongside it"
         []
         (:offending-commits
          (babysitter-check/assemble-offending-commits
           [{:sha "a" :subject "s" :paths ["extension/src/x.ts"]}
            :babysitter-check/adjudication-failed])))

(if (empty? @failures)
  (println "ALL PASS: bl1359 a merge is charged only with what it introduced")
  (do (doseq [f @failures] (println f))
      (System/exit 1)))
