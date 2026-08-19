#!/usr/bin/env bb
;; TDD runner for tool_miss_heal_lib.bb (BL-913) - no real subprocess, no
;; real hook JSON. Mirrors master_main_reconcile_lib_test_runner.bb's own
;; assert-battery shape.

(ns tool-miss-heal-lib-test-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "tool_miss_heal_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg actual] (assert= msg true (boolean actual)))

;; ── classify-miss ─────────────────────────────────────────────────────────

(assert= "classify-miss: a git-outside-repo failure classifies wrong-cwd"
         :wrong-cwd (tool-miss-heal-lib/classify-miss "fatal: not a git repository (or any of the parent directories): .git"))
(assert= "classify-miss: matches case-insensitively"
         :wrong-cwd (tool-miss-heal-lib/classify-miss "FATAL: NOT A GIT REPOSITORY"))
(assert= "classify-miss: an npm ENOENT at the wrong surface classifies wrong-surface"
         :wrong-surface (tool-miss-heal-lib/classify-miss "npm error code ENOENT\nnpm error path /repo/package.json"))
(assert= "classify-miss: a missing-package.json read failure classifies wrong-surface"
         :wrong-surface (tool-miss-heal-lib/classify-miss "npm error enoent Could not read package.json"))
(assert= "classify-miss: a usage line naming <project-root> classifies missing-root-argv"
         :missing-root-argv (tool-miss-heal-lib/classify-miss "Usage: node cli.js <project-root>"))
(assert= "classify-miss: a generic missing-required-argument message classifies missing-root-argv"
         :missing-root-argv (tool-miss-heal-lib/classify-miss "Error: missing required argument"))
(assert= "classify-miss: a red test failure classifies real-failure (conservative default)"
         :real-failure (tool-miss-heal-lib/classify-miss "1 test failed\n  expected 2, got 3"))
(assert= "classify-miss: a merge conflict classifies real-failure"
         :real-failure (tool-miss-heal-lib/classify-miss "CONFLICT (content): Merge conflict in foo.txt"))
(assert= "classify-miss: a permission-denied failure classifies real-failure"
         :real-failure (tool-miss-heal-lib/classify-miss "Permission denied (publickey)"))
(assert= "classify-miss: blank/nil output classifies real-failure, never throws"
         :real-failure (tool-miss-heal-lib/classify-miss nil))
(assert= "classify-miss: first-match-wins when output happens to mention more than one pattern"
         :wrong-cwd (tool-miss-heal-lib/classify-miss "fatal: not a git repository\nnpm error code ENOENT"))

;; ── healed-command ────────────────────────────────────────────────────────

(assert= "healed-command: wrong-cwd cd's into the pinned worktree"
         "cd '/w' && git status"
         (tool-miss-heal-lib/healed-command :wrong-cwd "git status" "/w"))
(assert= "healed-command: wrong-surface cd's into the pinned worktree's extension/ subdirectory"
         "cd '/w/extension' && npm test"
         (tool-miss-heal-lib/healed-command :wrong-surface "npm test" "/w"))
(assert= "healed-command: missing-root-argv references the pinned worktree via $__sfh_root, never as a literal path (BL-934)"
         "node cli.js \"$__sfh_root\""
         (tool-miss-heal-lib/healed-command :missing-root-argv "node cli.js" "/w"))
(assert= "healed-command: real-failure has no healed command at all"
         nil (tool-miss-heal-lib/healed-command :real-failure "anything" "/w"))
(assert= "healed-command: a worktree path containing a single quote is safely escaped"
         "cd '/it'\\''s/w' && git status"
         (tool-miss-heal-lib/healed-command :wrong-cwd "git status" "/it's/w"))

;; ── BL-934: the missing-root-argv false positive ─────────────────────────
;; Claude Code's own dangerous-rm classifier reads a literal
;; `rm ... 'pinned-worktree'` in the wrapper's STATIC source as rm of the
;; worktree, even inside a dead elif branch that never executes for a real
;; `rm -f` of temp files (rm's own failures never match this class). The
;; exact live incident: rm -f of two temp files under the pinned worktree.

(let [worktree "/Users/ldecorps/projects/swarmforgevc"
      original "rm -f tmp/bl933-ir.json tmp/bl933-dry.json"
      wrapper (tool-miss-heal-lib/build-healing-wrapper-command original worktree)]
  (assert-true "BL-934 invariant 1: the wrapper source never concatenates the original command with the pinned worktree as a trailing arg"
               (not (str/includes? wrapper (str original " " (tool-miss-heal-lib/shell-quote worktree)))))
  (assert-true "BL-934: the original rm command still appears, visibly, as a command in the wrapper"
               (str/includes? wrapper original))
  (assert-true "BL-934: the pinned worktree is referenced via $__sfh_root, not spliced as a literal path next to the rm invocation"
               (str/includes? wrapper (str original " \"$__sfh_root\""))))

;; Invariant 2: a genuine rm OF the worktree (the original command itself,
;; not the synthetic heal) must remain visible - the fix must not hide a
;; real rm of the worktree from the classifier.
(let [worktree "/Users/ldecorps/projects/swarmforgevc"
      dangerous-original (str "rm -rf " worktree)
      wrapper (tool-miss-heal-lib/build-healing-wrapper-command dangerous-original worktree)]
  (assert-true "BL-934 invariant 2: a genuine rm of the pinned worktree in the ORIGINAL command stays fully visible in the wrapper source"
               (str/includes? wrapper dangerous-original)))

;; ── build-healing-wrapper-command: structural shape ──────────────────────

(let [wrapper (tool-miss-heal-lib/build-healing-wrapper-command "git status" "/w")]
  (assert-true "build-healing-wrapper-command: embeds the original command"
               (str/includes? wrapper "git status"))
  (assert-true "build-healing-wrapper-command: embeds an if/elif chain, never independent if statements"
               (str/includes? wrapper "elif"))
  (assert= "build-healing-wrapper-command: exactly one if/elif chain (one 'if [' guard for the outer exit check, one classify 'if')"
           2 (count (re-seq #"(?m)^\s*if " wrapper)))
  (assert-true "build-healing-wrapper-command: prints the final captured output"
               (str/includes? wrapper "printf '%s' \"$__sfh_out\"\n"))
  (assert-true "build-healing-wrapper-command: exits with the final captured exit code"
               (str/includes? wrapper "exit $__sfh_ec")))

;; ── build-healing-wrapper-command: actually executed, end to end ─────────
;; No fake adapters here - a self-contained bash snippet is the whole
;; product, so its own correctness IS whether real bash actually behaves
;; this way. Every fixture below is a tiny throwaway script, never a real
;; git/npm/node invocation.

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn mk-tmp []
  (let [d (str (fs/create-temp-dir))]
    (swap! created-temp-dirs conj d)
    d))

(defn run-wrapper
  "Runs the generated wrapper as bash would - :session-dir simulates the
   drifted cwd the model's persistent shell session happens to be in when
   the tool call is made (the wrapper's own subshell inherits it, exactly
   as a real Bash tool invocation would), never baked into the original
   command's own text."
  ([original-command pinned-worktree] (run-wrapper original-command pinned-worktree nil))
  ([original-command pinned-worktree session-dir]
   (let [wrapper (tool-miss-heal-lib/build-healing-wrapper-command original-command pinned-worktree)
         opts (if session-dir {:dir session-dir} {})
         {:keys [out exit]} (process/sh ["bash" "-c" wrapper] opts)]
     {:out out :exit exit})))

(let [tmp (mk-tmp)
      script (str tmp "/always-ok.sh")]
  (spit script "#!/usr/bin/env bash\nprintf 'ok'\nexit 0\n")
  (.setExecutable (fs/file script) true)
  (let [{:keys [out exit]} (run-wrapper (str "bash " script) tmp)]
    (assert= "end to end: a command that succeeds as issued is returned untouched, exit 0" 0 exit)
    (assert= "end to end: a command that succeeds as issued returns its own output untouched" "ok" out)))

(let [tmp (mk-tmp)
      counter (str tmp "/calls")
      script (str tmp "/fail-outside-repo.sh")]
  ;; Simulates a relative-path git command run from a drifted cwd: fails
  ;; wrong-cwd UNLESS cwd is exactly `tmp` (the "pinned worktree" here),
  ;; counting invocations so the test can assert exactly one retry.
  (spit script
        (str "#!/usr/bin/env bash\n"
             "echo x >> " counter "\n"
             "if [ \"$(pwd)\" = " (tool-miss-heal-lib/shell-quote tmp) " ]; then\n"
             "  printf 'healed-ok'; exit 0\n"
             "else\n"
             "  echo 'fatal: not a git repository (or any of the parent directories): .git' >&2\n"
             "  exit 128\n"
             "fi\n"))
  (.setExecutable (fs/file script) true)
  (let [outside (mk-tmp)
        {:keys [out exit]} (run-wrapper (str "bash " script) tmp outside)]
    (assert= "end to end wrong-cwd: the healed re-run (from the pinned worktree) succeeds" 0 exit)
    (assert= "end to end wrong-cwd: the model receives ONLY the healed result" "healed-ok" out)
    (assert= "end to end wrong-cwd: exactly one retry (two invocations total: the miss + the one heal)"
             2 (count (str/split-lines (str/trim (slurp counter)))))))

;; BL-934: the $__sfh_root indirection must not just LOOK safe - the real
;; scenario 03 neighbour (a non-rm CLI missing its <project-root> arg)
;; must still functionally heal, receiving the pinned worktree as its
;; trailing argv, exactly as before this fix.
(let [tmp (mk-tmp)
      counter (str tmp "/calls")
      script (str tmp "/missing-root-argv.sh")]
  (spit script
        (str "#!/usr/bin/env bash\n"
             "echo x >> " counter "\n"
             "if [ \"$#\" -ge 1 ] && [ \"$1\" = " (tool-miss-heal-lib/shell-quote tmp) " ]; then\n"
             "  printf 'healed-ok'; exit 0\n"
             "else\n"
             "  echo 'Usage: node cli.js <project-root>' >&2\n"
             "  exit 1\n"
             "fi\n"))
  (.setExecutable (fs/file script) true)
  (let [{:keys [out exit]} (run-wrapper (str "bash " script) tmp)]
    (assert= "end to end missing-root-argv: the healed re-run (with the project root appended) succeeds" 0 exit)
    (assert= "end to end missing-root-argv: the model receives ONLY the healed result" "healed-ok" out)
    (assert= "end to end missing-root-argv: exactly one retry (two invocations total: the miss + the one heal)"
             2 (count (str/split-lines (str/trim (slurp counter)))))))

(let [tmp (mk-tmp)
      counter (str tmp "/calls")
      script (str tmp "/always-fails-wrong-cwd.sh")]
  ;; One-retry-then-stop (scenario 03): the healed re-run misses the SAME
  ;; way again - confirm no third attempt and the SECOND failure is what
  ;; comes back.
  (spit script
        (str "#!/usr/bin/env bash\n"
             "echo x >> " counter "\n"
             "echo 'fatal: not a git repository (or any of the parent directories): .git' >&2\n"
             "exit 128\n"))
  (.setExecutable (fs/file script) true)
  (let [{:keys [out exit]} (run-wrapper (str "bash " script) tmp)]
    (assert= "end to end one-retry-then-stop: the healed re-run's own failing exit code is what comes back" 128 exit)
    (assert-true "end to end one-retry-then-stop: the model receives the healed re-run's own failure text"
                 (str/includes? out "fatal: not a git repository"))
    (assert= "end to end one-retry-then-stop: exactly two invocations total, never a third"
             2 (count (str/split-lines (str/trim (slurp counter)))))))

(let [tmp (mk-tmp)
      counter (str tmp "/calls")
      script (str tmp "/real-failure.sh")]
  ;; A genuine failure (red test) outside the recoverable classes: never
  ;; re-run at all.
  (spit script
        (str "#!/usr/bin/env bash\n"
             "echo x >> " counter "\n"
             "echo '1 test failed: expected 2, got 3' >&2\n"
             "exit 1\n"))
  (.setExecutable (fs/file script) true)
  (let [{:keys [out exit]} (run-wrapper (str "bash " script) tmp)]
    (assert= "end to end real-failure: the original failure's own exit code comes back untouched" 1 exit)
    (assert-true "end to end real-failure: the model receives the real failure's own text"
                 (str/includes? out "1 test failed"))
    (assert= "end to end real-failure: never re-run at all - exactly one invocation"
             1 (count (str/split-lines (str/trim (slurp counter)))))))

;; ── report ───────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "ALL TESTS PASS")
  (do (println (str (count @failures) " FAILURE(S):"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
