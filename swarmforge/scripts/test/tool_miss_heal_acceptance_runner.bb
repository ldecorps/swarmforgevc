#!/usr/bin/env bb
;; Acceptance runner for BL-913: takes one JSON arg
;; {"miss": "wrong-cwd"|"wrong-surface"|"missing-root-argv"|"real-failure"|"succeeds",
;;  "healOutcome": "succeeds"|"fails-again"|null}
;; and drives the REAL build-healing-wrapper-command against a scripted
;; fixture, over real bash, exactly like disk_space_decision_acceptance_runner.bb
;; drives disk-space-lib's own pure decision - so the Node acceptance step
;; handlers exercise the real product, never a JS reimplementation of it.
;; Prints {"invocationCount": N, "reRun": bool, "healedFromRoleWorktree": bool,
;;         "healedFromExtensionDir": bool, "gotProjectRootArg": bool,
;;         "finalOutput": "...", "finalExit": N}.
(ns tool-miss-heal-acceptance-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "tool_miss_heal_lib.bb")))

(def scenario (json/parse-string (first *command-line-args*) true))
(def miss (keyword (:miss scenario)))
(def heal-outcome (some-> (:healOutcome scenario) keyword))

(def CLASS-TRIGGER-TEXT
  {:wrong-cwd "fatal: not a git repository (or any of the parent directories): .git"
   :wrong-surface "npm error code ENOENT"
   :missing-root-argv "Usage: node cli.js <project-root>"
   :real-failure "1 test failed: expected 2, got 3"})

(def role-worktree (str (fs/create-temp-dir {:prefix "tool-miss-heal-acceptance-"})))
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (try (fs/delete-tree role-worktree) (catch Exception _ nil)))))

(try
  (fs/create-dir (fs/path role-worktree "extension"))

  (def counter (str role-worktree "/n"))
  (def script (str role-worktree "/fixture.sh"))

  ;; The fixture reports, on each invocation, its OWN pwd and argv - so the
  ;; test can confirm not just call COUNT but the healed environment/args
  ;; were genuinely correct (never inferred from the miss class alone).
  (spit script
        (str "#!/usr/bin/env bash\n"
             "n=$(( $(cat " counter " 2>/dev/null || echo 0) + 1 ))\n"
             "echo $n > " counter "\n"
             "if [ \"$n\" = 1 ]; then\n"
             (if (= miss :succeeds)
               "  printf 'FIRST-OK|pwd=%s|argv=%s' \"$(pwd)\" \"$*\"; exit 0\n"
               (str "  echo " (tool-miss-heal-lib/shell-quote (get CLASS-TRIGGER-TEXT miss)) " >&2\n"
                    "  exit 7\n"))
             "else\n"
             (if (= heal-outcome :succeeds)
               "  printf 'HEALED-OK|pwd=%s|argv=%s' \"$(pwd)\" \"$*\"; exit 0\n"
               (str "  echo " (tool-miss-heal-lib/shell-quote (or (get CLASS-TRIGGER-TEXT miss) "unreachable")) " >&2\n"
                    "  exit 7\n"))
             "fi\n"))
  (.setExecutable (fs/file script) true)

  (def wrapper (tool-miss-heal-lib/build-healing-wrapper-command (str "bash " script) role-worktree))
  (def result (process/sh ["bash" "-c" wrapper]))
  (def invocation-count
    (try (Long/parseLong (str/trim (slurp counter))) (catch Exception _ 0)))

  (println
   (json/generate-string
    {:invocationCount invocation-count
     :reRun (> invocation-count 1)
     :healedFromRoleWorktree (str/includes? (:out result) (str "pwd=" role-worktree "|"))
     :healedFromExtensionDir (str/includes? (:out result) (str "pwd=" role-worktree "/extension"))
     :gotProjectRootArg (str/includes? (:out result) (str "argv=" role-worktree))
     :finalOutput (:out result)
     :finalExit (:exit result)}))

  (finally
    (fs/delete-tree role-worktree)))
