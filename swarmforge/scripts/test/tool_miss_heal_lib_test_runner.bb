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

(assert= "healed-command: wrong-cwd cd's into the pinned worktree, re-anchoring the WHOLE original via a subshell group (BL-960: well-defined for multi-command shapes too)"
         "cd '/w' && (\ngit status\n)"
         (tool-miss-heal-lib/healed-command :wrong-cwd "git status" "/w"))
(assert= "healed-command: wrong-surface cd's into the pinned worktree's extension/ subdirectory, grouping the whole original"
         "cd '/w/extension' && (\nnpm test\n)"
         (tool-miss-heal-lib/healed-command :wrong-surface "npm test" "/w"))
(assert= "healed-command: missing-root-argv references the pinned worktree via $__sfh_root, never as a literal path (BL-934)"
         "node cli.js \"$__sfh_root\""
         (tool-miss-heal-lib/healed-command :missing-root-argv "node cli.js" "/w"))
(assert= "healed-command: real-failure has no healed command at all"
         nil (tool-miss-heal-lib/healed-command :real-failure "anything" "/w"))
(assert= "healed-command: a worktree path containing a single quote is safely escaped"
         "cd '/it'\\''s/w' && (\ngit status\n)"
         (tool-miss-heal-lib/healed-command :wrong-cwd "git status" "/it's/w"))

;; ── BL-960 defect 2: the missing-root-argv heal is gated to a single
;;    simple command - anywhere the append target is ambiguous (pipeline,
;;    ;-sequence, &&/||, grouping, redirection, substitution, multi-line),
;;    the heal DECLINES (nil) and the failure returns as-is. A false
;;    negative merely declines a heal (safe, per the ticket's approved
;;    conservative posture); a false positive misdirects the appended root
;;    onto the wrong segment - the exact live defect. ─────────────────────

(assert-true "single-simple-command?: a plain CLI invocation is simple"
             (tool-miss-heal-lib/single-simple-command? "node cli.js --flag value"))
(assert-true "single-simple-command?: a bare rm of relative paths is simple"
             (tool-miss-heal-lib/single-simple-command? "rm -f tmp/a.json tmp/b.json"))
(assert= "single-simple-command?: a pipeline is not simple"
         false (tool-miss-heal-lib/single-simple-command? "node cli.js | tee log"))
(assert= "single-simple-command?: a ;-sequence is not simple"
         false (tool-miss-heal-lib/single-simple-command? "node cli.js; echo \"---done---\""))
(assert= "single-simple-command?: an &&-chain is not simple"
         false (tool-miss-heal-lib/single-simple-command? "node cli.js && echo done"))
(assert= "single-simple-command?: a multi-line command is not simple"
         false (tool-miss-heal-lib/single-simple-command? "node cli.js\necho done"))
(assert= "single-simple-command?: a trailing comment is not simple - an appended argument would land INSIDE the comment, inert (BL-960 bounce D1)"
         false (tool-miss-heal-lib/single-simple-command? "node tool.js # BL-960 note"))
(assert= "single-simple-command?: any # declines, quoted or not (conservative: a false negative merely declines a heal)"
         false (tool-miss-heal-lib/single-simple-command? "node tool.js \"a#b\""))
(assert= "healed-command: missing-root-argv DECLINES (nil) for a command with a trailing comment (BL-960 bounce D1)"
         nil (tool-miss-heal-lib/healed-command :missing-root-argv "node tool.js # BL-960 note" "/w"))
(assert= "single-simple-command?: a heredoc is not simple"
         false (tool-miss-heal-lib/single-simple-command? "cat <<EOF\nhi\nEOF"))
(assert= "single-simple-command?: a command substitution is not simple"
         false (tool-miss-heal-lib/single-simple-command? "echo $(date)"))
(assert= "single-simple-command?: a redirection is not simple (conservative decline)"
         false (tool-miss-heal-lib/single-simple-command? "node cli.js > out.txt"))
(assert= "single-simple-command?: blank is not simple"
         false (tool-miss-heal-lib/single-simple-command? "   "))
(assert= "single-simple-command?: nil is not simple, never throws"
         false (tool-miss-heal-lib/single-simple-command? nil))

(assert= "healed-command: missing-root-argv DECLINES (nil) for a pipeline - a misdirected append is a defect, not a heal (BL-960 invariant 3)"
         nil (tool-miss-heal-lib/healed-command :missing-root-argv "node cli.js | tee log" "/w"))
(assert= "healed-command: missing-root-argv DECLINES (nil) for a ;-sequence"
         nil (tool-miss-heal-lib/healed-command :missing-root-argv "node cli.js; echo \"---done---\"" "/w"))

(let [wrapper (tool-miss-heal-lib/build-healing-wrapper-command "node cli.js && echo \"---done---\"" "/w")]
  (assert-true "build: a multi-command original's wrapper carries NO missing-root append anywhere (the clause is omitted, not misdirected)"
               (not (str/includes? wrapper "\"$__sfh_root\"")))
  (assert-true "build: the multi-command original still gets the cd-based heals (clause chain still present)"
               (str/includes? wrapper "elif")))

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
  (assert-true "build-healing-wrapper-command: captures to a temp file and replays it with cat, never a $()-stripped variable (BL-960: byte-exact output, trailing bytes included)"
               (str/includes? wrapper "cat \"$__sfh_out_file\"\n"))
  (assert-true "build-healing-wrapper-command: removes its temp file before exiting"
               (str/includes? wrapper "rm -f \"$__sfh_out_file\"\n"))
  (assert-true "build-healing-wrapper-command: exits with the final captured exit code"
               (str/includes? wrapper "exit $__sfh_ec")))

;; ── BL-960 defect 1: the composition parses as bash for the whole hostile
;;    corpus, and anything that cannot compose fail-opens to the untouched
;;    original. wrapper-parses? is the real bash -n gate; safe-wrapper-command
;;    is what the hook calls, with parses? injectable as the test seam. ────

(assert-true "wrapper-parses?: a plain command's composed wrapper parses"
             (tool-miss-heal-lib/wrapper-parses?
              (tool-miss-heal-lib/build-healing-wrapper-command "echo hi" "/w")))
(assert= "wrapper-parses?: raw unparseable text is rejected"
         false (tool-miss-heal-lib/wrapper-parses? "echo ("))

(def HOSTILE-CORPUS
  {"quoted-heredoc" "cat <<'SFH960'\nline with 'quotes' and a ) paren\nSFH960"
   "literal-close-paren" "printf '%s\\n' \"a)b\" \")\" \"(c\""
   "nested-quotes" "printf '%s\\n' \"outer 'inner' \\\"deep\\\"\" 'single \"double\" done'"
   "pipeline" "printf 'b\\na\\n' | sort"
   "semicolon-sequence" "printf 'one\\n'; printf 'two\\n' >&2; printf 'three\\n'"})

(doseq [[shape original] HOSTILE-CORPUS]
  (assert-true (str "BL-960 parse safety: the composed wrapper for a " shape " command parses as bash")
               (tool-miss-heal-lib/wrapper-parses?
                (tool-miss-heal-lib/build-healing-wrapper-command original "/w"))))

;; An UNTERMINATED heredoc is valid bash on its own (bash warns and treats
;; end-of-file as the terminator) but swallows the wrapper's own scaffolding
;; when embedded - the composition genuinely does not parse, so the gate
;; must fail-open. This is the parse-check's load-bearing case, not a
;; synthetic one.
(assert= "BL-960 fail-open: an unterminated-heredoc original's composition does not parse, so safe-wrapper-command returns nil (hook hands back the untouched original)"
         nil (tool-miss-heal-lib/safe-wrapper-command "cat <<SFH960\nstill open" "/w"))
(assert-true "BL-960: a plain command's safe-wrapper-command returns the wrapper itself"
             (some? (tool-miss-heal-lib/safe-wrapper-command "echo hi" "/w")))
(assert= "BL-960 fail-open seam: an injected always-false parse gate forces nil"
         nil (tool-miss-heal-lib/safe-wrapper-command "echo hi" "/w" (constantly false)))
(assert= "BL-960 fail-open seam: a THROWING parse gate fail-opens to nil, never propagates"
         nil (tool-miss-heal-lib/safe-wrapper-command "echo hi" "/w" (fn [_] (throw (Exception. "boom")))))
(assert-true "BL-960 fail-open seam: an injected always-true parse gate returns the composed wrapper"
             (str/includes? (tool-miss-heal-lib/safe-wrapper-command "echo hi" "/w" (constantly true)) "echo hi"))

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

;; ── BL-960 invariant 2, end to end: when no heal fires, wrapping is
;;    observationally invisible - exit code, combined output (compared
;;    against the unwrapped command run with 2>&1, trailing bytes included),
;;    and file side effects are byte-identical, for the hostile corpus.
;;    `exec 2>&1` merges the streams OUTSIDE the whole command, exactly the
;;    invariant's own comparison baseline. ─────────────────────────────────

(defn run-unwrapped-combined
  [original-command session-dir]
  (let [{:keys [out exit]} (process/sh ["bash" "-c" (str "exec 2>&1\n" original-command)]
                                       (if session-dir {:dir session-dir} {}))]
    {:out out :exit exit}))

(defn- dir-file-bytes [d]
  (into {} (map (fn [f] [(str (fs/relativize d f)) (slurp (str f))])
                (filter fs/regular-file? (fs/glob d "**")))))

(defn assert-invisible-roundtrip [label original-command]
  (let [dir-a (mk-tmp) dir-b (mk-tmp)
        unwrapped (run-unwrapped-combined original-command dir-a)
        wrapped (run-wrapper original-command "/sfh-pin-never-used" dir-b)]
    (assert= (str label ": exit code identical") (:exit unwrapped) (:exit wrapped))
    (assert= (str label ": combined output byte-identical, trailing bytes included")
             (:out unwrapped) (:out wrapped))
    (assert= (str label ": file side effects byte-identical")
             (dir-file-bytes dir-a) (dir-file-bytes dir-b))))

(assert-invisible-roundtrip "BL-960 round-trip trailing-newline" "echo hi")
(assert-invisible-roundtrip "BL-960 round-trip no-trailing-newline" "printf 'no-newline'")
(assert-invisible-roundtrip "BL-960 round-trip quoted-heredoc file write"
                            (str "cat <<'SFH960' > out.txt\n"
                                 "line one with 'quotes' and a ) paren\n"
                                 "line (two \"doubles\"\n"
                                 "SFH960\n"
                                 "printf 'bytes:'\n"
                                 "wc -c < out.txt"))
(assert-invisible-roundtrip "BL-960 round-trip literal-close-paren" "printf '%s\\n' \"a)b\" \")\"")
(assert-invisible-roundtrip "BL-960 round-trip pipeline" "printf 'b\\na\\n' | sort")
(assert-invisible-roundtrip "BL-960 round-trip semicolon+stderr merge"
                            "printf 'one\\n'; printf 'two\\n' >&2; printf 'three\\n'")
(assert-invisible-roundtrip "BL-960 round-trip real-failure passthrough with trailing newline"
                            "echo 'nope this failed'; exit 3")

;; ── BL-960 defect 2, end to end: the live misdirection shape (a failing
;;    CLI with a usage error, then an unrelated echo). The heal must
;;    DECLINE - never re-run with the root landed on the echo. ─────────────

(let [tmp (mk-tmp)
      counter (str tmp "/calls")
      cli (str tmp "/cli.sh")]
  (spit cli (str "#!/usr/bin/env bash\n"
                 "echo x >> " counter "\n"
                 "echo 'Usage: node cli.js <project-root>' >&2\n"
                 "exit 1\n"))
  (.setExecutable (fs/file cli) true)
  (let [original (str "bash " cli " && echo \"---done---\"")
        wrapper (tool-miss-heal-lib/build-healing-wrapper-command original tmp)
        {:keys [out exit]} (run-wrapper original tmp)]
    (assert-true "BL-960 misdirection guard: the wrapper source never appends the root to a multi-command original"
                 (not (str/includes? wrapper "\"$__sfh_root\"")))
    (assert= "BL-960 misdirection guard: the failure returns as-is (exit unchanged)" 1 exit)
    (assert-true "BL-960 misdirection guard: the usage failure's own text is what comes back"
                 (str/includes? out "Usage: node cli.js <project-root>"))
    (assert-true "BL-960 misdirection guard: the unrelated final segment never ran with the root appended"
                 (not (str/includes? out "---done---")))
    (assert= "BL-960 misdirection guard: the failing segment ran exactly once - declined, not healed"
             1 (count (str/split-lines (str/trim (slurp counter)))))))

;; ── BL-960: the capture file is cleaned up, not leaked ───────────────────
;; The wrapper now creates a temp file on EVERY Bash call the swarm makes,
;; so a leak is per-call, not per-incident. The source-shape assertion above
;; (`rm -f "$__sfh_out_file"` present) cannot show it actually runs on the
;; paths that matter, so drive real bash with TMPDIR pointed at a fresh dir
;; and look at what is left behind.

(defn- sfh-leftovers [tmpdir]
  (map (comp str fs/file-name) (fs/glob tmpdir "sfh.*")))

(defn assert-no-capture-leak [label original-command pinned-worktree session-dir]
  (let [tmpdir (mk-tmp)
        wrapper (tool-miss-heal-lib/build-healing-wrapper-command original-command pinned-worktree)]
    (process/sh ["bash" "-c" wrapper]
                (cond-> {:extra-env {"TMPDIR" tmpdir}}
                  session-dir (assoc :dir session-dir)))
    (assert= (str label ": no capture file left behind in TMPDIR") [] (vec (sfh-leftovers tmpdir)))))

(let [tmp (mk-tmp)
      ok (str tmp "/ok.sh")
      heals (str tmp "/heals.sh")
      red (str tmp "/red.sh")]
  (spit ok "#!/usr/bin/env bash\nprintf 'ok'\n")
  (spit heals (str "#!/usr/bin/env bash\n"
                   "if [ \"$(pwd)\" = " (tool-miss-heal-lib/shell-quote tmp) " ]; then\n"
                   "  printf 'healed-ok'; exit 0\n"
                   "else\n"
                   "  echo 'fatal: not a git repository (or any of the parent directories): .git' >&2\n"
                   "  exit 128\n"
                   "fi\n"))
  (spit red "#!/usr/bin/env bash\necho '1 test failed: expected 2, got 3' >&2\nexit 1\n")
  (doseq [f [ok heals red]] (.setExecutable (fs/file f) true))
  (assert-no-capture-leak "BL-960 cleanup, no-heal success path" (str "bash " ok) tmp nil)
  (assert-no-capture-leak "BL-960 cleanup, healed re-run path" (str "bash " heals) tmp (mk-tmp))
  (assert-no-capture-leak "BL-960 cleanup, real-failure passthrough path" (str "bash " red) tmp nil))

;; ── report ───────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "ALL TESTS PASS")
  (do (println (str (count @failures) " FAILURE(S):"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
