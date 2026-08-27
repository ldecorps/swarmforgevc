#!/usr/bin/env bb
;; Acceptance runner for BL-960: takes one JSON arg {"mode": ...} and drives
;; the REAL tool_miss_heal_lib.bb / tool_miss_heal_hook.bb / swarmforge.sh
;; write_claude_settings_file - never a JS reimplementation - same
;; JSON-bridge pattern as tool_miss_heal_acceptance_runner.bb (BL-913).
;;
;; Modes:
;;   {"mode":"roundtrip","command":C}  - build the wrapper for C, bash -n it,
;;       run C wrapped and unwrapped (with `exec 2>&1` merging the streams
;;       OUTSIDE the whole command - the invariant's own baseline) against
;;       twin fixture dirs; report parse + byte-identity of exit/output/files.
;;   {"mode":"failopen","command":C}   - feed the REAL hook C over stdin JSON
;;       exactly as Claude Code would; report its stdout response and stderr.
;;   {"mode":"real-failure"}           - a counter fixture failing with
;;       output matching no miss class; report invocations + byte-identity.
;;   {"mode":"misdirect"}              - the live defect-2 shape (usage-error
;;       CLI, then an unrelated echo); report whether the root was appended
;;       anywhere and what actually ran.
;;   {"mode":"settings"}               - write real launch settings via
;;       swarmforge.sh write_role_launch_script against a fixture root;
;;       report the settings file content.
(ns bl960-heal-wrapper-acceptance-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "tool_miss_heal_lib.bb")))

(def payload (json/parse-string (first *command-line-args*) true))
(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(def hook-path (str (fs/path script-dir ".." "tool_miss_heal_hook.bb")))

(def created (atom []))
(defn- mk-tmp []
  (let [d (str (fs/create-temp-dir {:prefix "bl960-acc-"}))]
    (swap! created conj d)
    d))
;; swarmforge.sh derives a unix-socket path from its root at source time;
;; macOS $TMPDIR-based roots overflow the 100-char socket-path limit, so the
;; settings fixture needs a SHORT root.
(defn- mk-short-tmp []
  (let [d (str/trim (:out (process/sh ["mktemp" "-d" "/tmp/sfh960acc.XXXXXX"])))]
    (swap! created conj d)
    d))

(defn- dir-file-bytes [d]
  (into {} (map (fn [f] [(str (fs/relativize d f)) (slurp (str f))])
                (filter fs/regular-file? (fs/glob d "**")))))

(defn- run-roundtrip [command]
  (let [dir-a (mk-tmp) dir-b (mk-tmp)
        wrapper (tool-miss-heal-lib/build-healing-wrapper-command command "/sfh-pin-never-used")
        unwrapped (process/sh ["bash" "-c" (str "exec 2>&1\n" command)] {:dir dir-a})
        wrapped (process/sh ["bash" "-c" wrapper] {:dir dir-b})]
    {:parses (tool-miss-heal-lib/wrapper-parses? wrapper)
     :exitIdentical (= (:exit unwrapped) (:exit wrapped))
     :outputIdentical (= (:out unwrapped) (:out wrapped))
     :filesIdentical (= (dir-file-bytes dir-a) (dir-file-bytes dir-b))
     :unwrappedOut (:out unwrapped) :wrappedOut (:out wrapped)
     :unwrappedExit (:exit unwrapped) :wrappedExit (:exit wrapped)}))

(defn- run-failopen [command]
  (let [{:keys [out err]} (process/sh ["bb" hook-path]
                                      {:in (json/generate-string
                                            {:tool_name "Bash"
                                             :tool_input {:command command}})
                                       :extra-env {"SWARMFORGE_ROLE_WORKTREE" "/tmp/whatever"}})]
    {:response (str/trim out) :stderr err}))

(defn- run-real-failure []
  (let [mk (fn []
             (let [d (mk-tmp) script (str d "/fixture.sh")]
               (spit script (str "#!/usr/bin/env bash\n"
                                 "echo x >> " d "/calls\n"
                                 "echo '1 test failed: expected 2, got 3' >&2\n"
                                 "exit 7\n"))
               [d script]))
        [dir-a script-a] (mk)
        [dir-b script-b] (mk)
        wrapper (tool-miss-heal-lib/build-healing-wrapper-command (str "bash " script-a) dir-a)
        wrapped (process/sh ["bash" "-c" wrapper])
        unwrapped (process/sh ["bash" "-c" (str "exec 2>&1\nbash " script-b)])]
    {:invocations (count (str/split-lines (str/trim (slurp (str dir-a "/calls")))))
     :outputIdentical (= (:out wrapped) (:out unwrapped))
     :exitIdentical (= (:exit wrapped) (:exit unwrapped))
     :out (:out wrapped) :exit (:exit wrapped)}))

(defn- run-misdirect []
  (let [tmp (mk-tmp)
        cli (str tmp "/cli.sh")]
    (spit cli (str "#!/usr/bin/env bash\n"
                   "echo x >> " tmp "/calls\n"
                   "echo 'Usage: node cli.js <project-root>' >&2\n"
                   "exit 1\n"))
    (let [original (str "bash " cli " && echo \"---done---\"")
          wrapper (tool-miss-heal-lib/build-healing-wrapper-command original tmp)
          {:keys [out exit]} (process/sh ["bash" "-c" wrapper])]
      ;; BL-985 co-change: any-reference-to-$__sfh_root was the old proxy
      ;; for "the append heal exists", but the proactive anchor now
      ;; legitimately references "$__sfh_root" in EVERY wrapper (its cd) -
      ;; the forbidden shape is precisely the ORIGINAL with the root
      ;; spliced on as a trailing argument, so that exact composition is
      ;; what the check looks for.
      {:rootAppendedInSource (str/includes? wrapper (str original " \"$__sfh_root\""))
       :doneRan (str/includes? out "---done---")
       :usageReturned (str/includes? out "Usage: node cli.js <project-root>")
       :invocations (count (str/split-lines (str/trim (slurp (str tmp "/calls")))))
       :out out :exit exit})))

(defn- run-settings []
  (let [root (mk-short-tmp)]
    (fs/create-dirs (fs/path root "swarmforge" "roles"))
    (fs/create-dirs (fs/path root ".swarmforge" "launch"))
    (fs/create-dirs (fs/path root ".swarmforge" "prompts"))
    (spit (str (fs/path root "swarmforge" "constitution.prompt")) "")
    (spit (str (fs/path root "swarmforge" "roles" "coder.prompt")) "role prompt\n")
    (spit (str (fs/path root "swarmforge" "swarmforge.conf"))
          "config active_backlog_max_depth -1\nwindow coder claude coder --model sonnet\n")
    (let [sw (str (fs/path script-dir ".." "swarmforge.sh"))
          {:keys [exit]} (process/sh ["zsh" "-c" (str "source '" sw "' '" root "'\n"
                                                      "parse_config\n"
                                                      "write_role_launch_script 1 >/dev/null")])
          settings-file (str (fs/path root ".swarmforge" "launch" "coder.claude-settings.json"))]
      {:sourceExit exit
       :settings (if (fs/exists? settings-file) (slurp settings-file) "")})))

(try
  (println
   (json/generate-string
    (case (:mode payload)
      "roundtrip" (run-roundtrip (:command payload))
      "failopen" (run-failopen (:command payload))
      "real-failure" (run-real-failure)
      "misdirect" (run-misdirect)
      "settings" (run-settings))))
  (finally
    (doseq [d @created] (try (fs/delete-tree d) (catch Exception _ nil)))))
