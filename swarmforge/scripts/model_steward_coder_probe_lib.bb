#!/usr/bin/env bb
;; BL-1700: the model steward's coder probe - runs the REAL BL-1697 driver
;; against a REAL aider seat on a named local model, over five committed
;; coder fixture tickets, in a throwaway repository per run. On demand
;; only (never in the standing suite), never touching the live repository,
;; mailboxes or router.
;;
;; Ported from the overnight lab's own harness
;; (backlog/evidence/aider-seat-lab-20260924/lab.py: tmux + aider +
;; scripted-relay probes) but calling local_parcel_driver_lib.bb's
;; drive-to-end! IN-PROCESS instead of relaying `!` lines by hand - the
;; driver-era job the lab proved a 7B model cannot run itself.
;;
;; Loaded via load-file, referred to as model-steward-coder-probe-lib/foo.
(ns model-steward-coder-probe-lib
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def ^:private lib-dir (fs/parent (fs/canonicalize *file*)))
(load-file (str (fs/path lib-dir "local_parcel_driver_lib.bb")))

(def fixtures-dir (fs/path lib-dir "model_steward_probe_fixtures"))

;; BL-1700 QA D1 (2026-09-26): probe!'s evidence-dir had no default, so
;; the how-to's own "probe <model>" invocation (no --evidence-dir) wrote
;; no summary at all - the JSON on stdout was the only trace. Same
;; repo-root-from-this-file idiom model_steward_store.bb's own
;; `repo-root` uses (two fs/parent calls up from this file's own
;; directory, since lib-dir above is already the containing directory).
(def ^:private probe-repo-root (fs/parent (fs/parent lib-dir)))
(def ^:private default-evidence-dir (str (fs/path probe-repo-root "backlog" "evidence")))

;; ── Fixtures (BL-1700 "What is wanted", item 3) ──────────────────────────
;; Five coder fixture tickets of rising difficulty, each a directory under
;; fixtures-dir/<id>/ with: ticket.yaml (the fixture ticket text), files/
;; (the starting, broken source tree), accept.test.js (the acceptance
;; test - RED on files/, GREEN on solution/), solution/ (the known-good
;; tree, used only by selftest! - never by a real or stand-in run).
(def fixture-ids
  ["01-one-line-fix" "02-two-line-two-functions" "03-new-function"
   "04-two-files" "05-keep-existing-test-green"])

(defn- fixture-path [id & more]
  (apply fs/path fixtures-dir id more))

(defn- copy-tree! [from to]
  (fs/create-dirs to)
  (doseq [f (fs/glob from "**") :when (fs/regular-file? f)]
    (let [rel (str (fs/relativize from f))
          dest (fs/path to rel)]
      (fs/create-dirs (fs/parent dest))
      (fs/copy f dest {:replace-existing true}))))

(defn- sh! [& args]
  (apply process/sh args))

;; ── Endpoint check (BL-1700 item 1: "Endpoint first") ────────────────────

(defn endpoint-answers?
  "A bare, dependency-free HTTP GET (no model call) against an
   OpenAI-compat /v1/models path - true only on a 2xx. Never used to
   target anything, only to decide whether to start at all."
  [endpoint-url]
  (try
    (let [{:keys [exit out]} (sh! "curl" "-sS" "-m" "5" "-o" "/dev/null" "-w" "%{http_code}"
                                   (str (str/replace endpoint-url #"/$" "") "/models"))]
      (and (zero? exit) (str/starts-with? (str/trim out) "2")))
    (catch Exception _ false)))

;; BL-1700 D1: the single place caps default (never `:or` on a map a caller
;; may pass with the key PRESENT but nil - probe! forwards
;; :max-ticks/:wall-clock-seconds explicitly even when the CLI omitted the
;; flag, so `:or` never fires and run-fixture! NPE'd on the arithmetic
;; below). run-fixture! itself is the one place that coalesces.
(def default-max-ticks 400)
(def default-wall-clock-seconds 900)

(defn resolve-model-id
  "GETs <endpoint>/models and returns the id that matches requested-model:
   byte-identical, or requested-model with a ':latest' tag appended (a
   bare model name typed with no tag - ollama's own /v1/models always
   answers with the tag included). Falls back to requested-model unchanged
   when the list cannot be read or names no match - never blocks a run
   that endpoint-answers? already proved reachable; the scorecard then
   just reports what was actually asked for (BL-1700 D3)."
  [endpoint-url requested-model]
  (try
    (let [{:keys [exit out]} (sh! "curl" "-sS" "-m" "5"
                                   (str (str/replace endpoint-url #"/$" "") "/models"))
          ids (when (zero? exit)
                (some->> (json/parse-string out true) :data (map :id) set))]
      (cond
        (nil? ids) requested-model
        (contains? ids requested-model) requested-model
        (contains? ids (str requested-model ":latest")) (str requested-model ":latest")
        :else requested-model))
    (catch Exception _ requested-model)))

;; ── Selftest (no model): every fixture is red on files/, green on
;; solution/ - the harness's own proof it is testing something real. ─────

(defn- run-node-test [dir]
  (let [{:keys [exit out err]} (sh! {:dir (str dir)} "node" "accept.test.js")]
    {:pass (zero? exit) :out (str out err)}))

(defn selftest!
  "Runs each fixture's accept.test.js against files/ (must fail) and
   against solution/ overlaid on files/ (must pass). Never spawns a
   model. Returns a vector of per-fixture maps; throws on the first
   fixture that is not red/green as expected (non-vacuity - see
   fixture-lib_test)."
  []
  (mapv
   (fn [id]
     (let [base (fixture-path id)
           red-dir (fs/create-temp-dir {:prefix "bl1700-red-"})
           green-dir (fs/create-temp-dir {:prefix "bl1700-green-"})]
       (try
         (copy-tree! (fs/path base "files") red-dir)
         (fs/copy (fs/path base "accept.test.js") (fs/path red-dir "accept.test.js") {:replace-existing true})
         (copy-tree! (fs/path base "files") green-dir)
         (copy-tree! (fs/path base "solution") green-dir)
         (fs/copy (fs/path base "accept.test.js") (fs/path green-dir "accept.test.js") {:replace-existing true})
         (let [red (run-node-test red-dir)
               green (run-node-test green-dir)]
           (when (:pass red)
             (throw (ex-info (str id ": accept.test.js passes on the BROKEN fixture - not red") {:id id :red red})))
           (when-not (:pass green)
             (throw (ex-info (str id ": accept.test.js fails on the KNOWN-GOOD solution - not green") {:id id :green green})))
           {:id id :red-ok true :green-ok true})
         (finally
           (fs/delete-tree red-dir)
           (fs/delete-tree green-dir)))))
   fixture-ids))

;; ── Throwaway repo per run ────────────────────────────────────────────────

(def ^:private ready-for-next-stub
  "#!/usr/bin/env bash\nset -u\ndir=\"$(git rev-parse --show-toplevel)\"\nnew_dir=\"$dir/.swarmforge/handoffs/inbox/new\"\nproc_dir=\"$dir/.swarmforge/handoffs/inbox/in_process\"\nmkdir -p \"$proc_dir\"\nfirst=\"$(ls \"$new_dir\" 2>/dev/null | grep '\\.handoff$' | sort | head -1 || true)\"\nif [ -n \"$first\" ]; then\n  mv \"$new_dir/$first\" \"$proc_dir/$first\"\nfi\nexit 0\n")

(def ^:private done-with-current-stub
  "#!/usr/bin/env bash\nset -u\ndir=\"$(git rev-parse --show-toplevel)\"\nproc_dir=\"$dir/.swarmforge/handoffs/inbox/in_process\"\ndone_dir=\"$dir/.swarmforge/handoffs/inbox/completed\"\nmkdir -p \"$done_dir\"\nfor f in \"$proc_dir\"/*.handoff; do\n  [ -e \"$f\" ] || continue\n  mv \"$f\" \"$done_dir/\"\ndone\nexit 0\n")

(def ^:private swarm-handoff-stub
  "#!/usr/bin/env bash\ndraft=\"${1:-}\"\ndir=\"$(git rev-parse --show-toplevel)\"\nmkdir -p \"$dir/.swarmforge/handoffs/outbox\"\ncp \"$draft\" \"$dir/.swarmforge/handoffs/outbox/$(date -u +%Y%m%dT%H%M%SZ)-$$.handoff\" 2>/dev/null || true\necho \"HANDOFF DELIVERED: $draft\"\nexit 0\n")

(def ^:private role-ask-stub
  "#!/usr/bin/env bb\n(let [args (vec *command-line-args*)]\n  (spit \".swarmforge/role-ask.log\" (str (apply str (map #(str % \"\\u001f\") args)) \"\\n\") :append true))\n")

(def ^:private seat-test-config-files
  ["backlog_depth_conf_path_cli.bb" "backlog_depth_lib.bb" "swarm_identity_lib.bb" "daemon_cycle_guard_lib.bb"])

(defn- write-executable! [path content]
  (spit (str path) content)
  (fs/set-posix-file-permissions path "rwxr-xr-x"))

(defn setup-run-repo!
  "One throwaway repo per run (BL-1700 item 2): a fresh mkdtemp root,
   git init, stub pipeline scripts + the REAL `seat` script + the config
   libs seat test resolution needs, one fixture ticket promoted on a
   side branch with its RED acceptance test, then an in_process
   git_handoff parcel naming that commit - the SAME shape lab.py's own
   _setup_9101 and BL-1697's own test fixture (localParcelDriverFixture.js)
   both use."
  [fixture-id]
  (let [root (fs/create-temp-dir {:prefix (str "bl1700-probe-" fixture-id "-")})
        scripts-dir (fs/path root "swarmforge" "scripts")
        real-scripts-dir lib-dir]
    (fs/create-dirs scripts-dir)
    (fs/create-dirs (fs/path root ".swarmforge" "handoffs" "inbox" "new"))
    (fs/create-dirs (fs/path root "backlog" "active"))
    (spit (str (fs/path root ".swarmforge" "roles.tsv"))
          (str "coder\tcoder\t" root "\tprobe-coder\tCoder\taider\ttask\n"
               "specifier\tmaster\t" root "\tprobe-specifier\tSpecifier\tclaude\ttask\n"
               "cleaner\tcleaner\t" root "\tprobe-cleaner\tCleaner\tclaude\tbatch\n"))
    (write-executable! (fs/path scripts-dir "ready_for_next.sh") ready-for-next-stub)
    (write-executable! (fs/path scripts-dir "done_with_current.sh") done-with-current-stub)
    (write-executable! (fs/path scripts-dir "swarm_handoff.sh") swarm-handoff-stub)
    (write-executable! (fs/path scripts-dir "role_ask.bb") role-ask-stub)
    (write-executable! (fs/path scripts-dir "seat") (slurp (str (fs/path real-scripts-dir "seat"))))
    (doseq [f seat-test-config-files]
      (fs/copy (fs/path real-scripts-dir f) (fs/path scripts-dir f) {:replace-existing true}))
    (fs/copy (fs/path real-scripts-dir "local_parcel_driver_cli.bb") (fs/path scripts-dir "local_parcel_driver_cli.bb") {:replace-existing true})
    (fs/copy (fs/path real-scripts-dir "local_parcel_driver_lib.bb") (fs/path scripts-dir "local_parcel_driver_lib.bb") {:replace-existing true})
    (fs/copy (fs/path real-scripts-dir "agent_runtime_inject.bb") (fs/path scripts-dir "agent_runtime_inject.bb") {:replace-existing true})
    (fs/copy (fs/path real-scripts-dir "agent_runtime_lib.bb") (fs/path scripts-dir "agent_runtime_lib.bb") {:replace-existing true})
    (fs/copy (fs/path real-scripts-dir "required_stages_lib.bb") (fs/path scripts-dir "required_stages_lib.bb") {:replace-existing true})
    (let [env {"GIT_AUTHOR_NAME" "bl1700-probe" "GIT_AUTHOR_EMAIL" "bl1700-probe@local"
               "GIT_COMMITTER_NAME" "bl1700-probe" "GIT_COMMITTER_EMAIL" "bl1700-probe@local"}]
      (spit (str (fs/path root "swarmforge" "swarmforge.conf")) "config seat_test_command node accept.test.js\n")
      ;; One shell, not eight separate subprocess spawns - init through the
      ;; base commit, in a single `bash -c` (host CPU contention makes each
      ;; spawn's own cost add up; this run is timing-bounded, scenario 03).
      (sh! {:dir (str root) :extra-env env}
           "bash" "-c"
           (str "git init -q -b main && git config user.email bl1700-probe@local"
                " && git config user.name bl1700-probe && git add -A"
                " && git commit -q -m 'bl1700 probe fixture base'"))
      ;; The promoted parcel: fixture files + a fresh RED accept.test.js,
      ;; committed on a "specifier" side branch, then merge_and_process'd
      ;; the way an in_process git_handoff always names.
      (copy-tree! (fixture-path fixture-id "files") root)
      (fs/copy (fixture-path fixture-id "accept.test.js") (fs/path root "accept.test.js") {:replace-existing true})
      (fs/copy (fixture-path fixture-id "ticket.yaml") (fs/path root "backlog" "active" "BL-90001.yaml") {:replace-existing true})
      (sh! {:dir (str root) :extra-env env}
           "bash" "-c"
           (str "git checkout -q -b specifier && git add -A"
                " && git commit -q -m 'Promote BL-90001 (" fixture-id ")'"))
      (let [{:keys [out]} (sh! {:dir (str root) :extra-env env} "git" "rev-parse" "--short=10" "HEAD")
            sha (str/trim out)]
        (sh! {:dir (str root) :extra-env env} "git" "checkout" "-q" "main")
        ;; Left untracked, never `git add`ed - the stand-in's own reference
        ;; copy of the known-good solution, read only by the acceptance
        ;; suite's scripted "solve" mode (never the real launch path).
        (copy-tree! (fixture-path fixture-id "solution") (fs/path root ".stand-in-solution"))
        (spit (str (fs/path root ".swarmforge" "handoffs" "inbox" "new" "00_20260101T000000Z_000001_from_specifier_to_coder_for_coder.handoff"))
              (str "type: git_handoff\nfrom: specifier\nto: coder\nrecipient: coder\npriority: 00\ntask: BL-90001\ncommit: " sha "\n\n"
                   "merge_and_process specifier " sha "\n\nThis role's current tree is the structure. Replay the inbound work onto that shape.\n"))
        {:root root :sha sha}))))

;; ── Real aider launch (BL-1699 shape, minimal port) ──────────────────────

(defn- ollama-base-from-openai-compat-url
  "http://host:port/v1 -> http://host:port (OLLAMA_API_BASE has no /v1)."
  [endpoint-url]
  (str/replace endpoint-url #"/v1/?$" ""))

(defn- aider-launch-args [model endpoint-url llm-history-path]
  ;; litellm's "openai/<model>" provider validates against REAL OpenAI
  ;; model ids even with --openai-api-base pointed elsewhere (a live
  ;; ollama model this host serves came back
  ;; "litellm.NotFoundError: Model does not exist" through that path,
  ;; verified while building this ticket's own evidence run). aider's
  ;; native "ollama_chat/<model>" provider talks to OLLAMA_API_BASE
  ;; directly, no OpenAI validation layer - verified working against the
  ;; same live endpoint.
  (let [model (if (str/includes? model "/") model (str "ollama_chat/" model))]
    ["aider" "--model" model
     "--yes-always" "--no-detect-urls" "--no-show-model-warnings" "--no-check-update" "--no-gitignore"
     "--test-cmd" "swarmforge/scripts/seat test" "--auto-test"
     ;; BL-1700 D3: an ABSOLUTE path outside the throwaway root - the root
     ;; is deleted in run-fixture!'s finally, and the relative
     ;; ".probe-llm.log" this used to be died with it, so no run's model
     ;; transcript ever survived to be read.
     "--llm-history-file" llm-history-path "--chat-history-file" ".probe-chat.md"]))

(defn launch-aider-seat!
  "Starts a real aider seat in a fresh tmux session (its own socket, one
   per run), same launch-line shape as swarmforge.sh's aider branch
   (BL-1699): --yes-always, no repo path in the bootstrap, coder-only
   --test-cmd/--auto-test, an OpenAI-compat endpoint. llm-history-path is
   an absolute path OUTSIDE root so it outlives the throwaway repo
   (BL-1700 D3). Returns {:socket :session}."
  [root model endpoint-url llm-history-path]
  (let [socket (str (fs/path root ".probe.tmux.sock"))
        session "probe"
        cmd (aider-launch-args model endpoint-url llm-history-path)
        shell-line (str "cd " (str root)
                         " && export OPENAI_API_KEY=ollama BROWSER=/usr/bin/true"
                         " OLLAMA_API_BASE=" (ollama-base-from-openai-compat-url endpoint-url)
                         " && "
                         (str/join " " (map #(str "'" (str/replace % "'" "'\\''") "'") cmd))
                         "; sleep 300")]
    (sh! {:out "/dev/null" :err "/dev/null"}
         "tmux" "-S" socket "new-session" "-d" "-s" session "-x" "200" "-y" "50" shell-line)
    {:socket socket :session session}))

(defn- kill-session! [socket session]
  ;; kill-server (never just kill-session): each run gets its OWN socket,
  ;; so this always tears down exactly this run's server, never another
  ;; live one - guarantees no lingering tmux server process even if the
  ;; session already died on its own (a "hang" run's session, or one the
  ;; wall-clock cap timed out on).
  (sh! "tmux" "-S" socket "kill-session" "-t" session)
  (sh! "tmux" "-S" socket "kill-server"))

;; ── Stand-in aider (BL-1700 acceptance only) ─────────────────────────────
;; A scripted process in place of a real model, for the acceptance suite
;; ONLY (never used by a real `probe` invocation). Reads one instruction
;; line at a time from the pane (exactly what a real aider chat receives)
;; and reacts per `mode`:
;;   solve      - copies the fixture's own known-good solution/ tree in,
;;                commits, and prints a fresh prompt (handed off).
;;   edit-spec  - "fixes" the ticket by editing accept.test.js itself
;;                (the FIRM violation scenario 02 checks for).
;;   never      - commits nothing, ever (exhausts the fix-turns bound).
;;   hang       - never prints a prompt again (the wall-clock-cap
;;                scenario) - reads nothing more, sleeps.
(def ^:private stand-in-script
  "#!/usr/bin/env bash\nset -u\nmode=\"$1\"; solution_dir=\"${2:-}\"\nprintf '> \\n'\nif [ \"$mode\" = \"hang\" ]; then exec sleep 86400; fi\nwhile IFS= read -r line; do\n  case \"$mode\" in\n    solve)\n      files=$(cd \"$solution_dir\" && find . -type f)\n      for f in $files; do cp \"$solution_dir/$f\" \"$f\"; git add \"$f\" >/dev/null 2>&1; done\n      git -c user.email=standin@local -c user.name=standin commit -q -m 'stand-in fix' >/dev/null 2>&1\n      ;;\n    edit-spec)\n      printf \"console.log('ok');\\n\" > accept.test.js\n      git add accept.test.js >/dev/null 2>&1\n      git -c user.email=standin@local -c user.name=standin commit -q -m 'stand-in edits spec' >/dev/null 2>&1\n      ;;\n    never) : ;;\n  esac\n  printf '\\n> \\n'\ndone\n")

(defn launch-stand-in-seat!
  "Starts the scripted stand-in above in a fresh tmux session (the
   acceptance suite's substitute for launch-aider-seat!). Returns
   {:socket :session}."
  [root mode]
  (let [socket (str (fs/path root ".probe.tmux.sock"))
        session "probe"
        script-path (fs/path root ".stand-in.sh")
        solution-dir (fs/path root ".stand-in-solution")]
    (spit (str script-path) stand-in-script)
    (fs/set-posix-file-permissions script-path "rwxr-xr-x")
    (sh! {:out "/dev/null" :err "/dev/null"}
         "tmux" "-S" socket "new-session" "-d" "-s" session "-x" "200" "-y" "50"
         (str "cd " (str root) " && bash " (str script-path) " " mode " " (str solution-dir)))
    {:socket socket :session session}))

;; ── One run: setup, drive to end (bounded), score, clean up ──────────────

(defn- outcome-of
  "Classifies a run that reached a terminal or self-exhausted state
   WITHOUT the outer wall-clock deref timing out (run-fixture! decides
   that case itself, before this is ever called). BL-1700 D2: 'turn cap'
   now means what the ticket asks - the real driver took max-ticks model
   turns (fixTurnsUsed, never drive-to-end!'s own raw poll-tick count)
   without reaching a terminal state. Anything else that is neither a
   handoff nor an escalation is drive-until-capped!'s own generous
   internal safety ceiling expiring at roughly the same moment the wall
   clock would have, so it is reported as 'wall-clock cap' too."
  [final-state parcel-root max-ticks]
  (let [completed-dir (fs/path parcel-root ".swarmforge" "handoffs" "inbox" "completed")
        handed-off? (and (nil? final-state)
                          (fs/exists? completed-dir)
                          (seq (fs/list-dir completed-dir)))
        turns-used (or (:fixTurnsUsed final-state) 0)]
    (cond
      handed-off? {:outcome "handed off" :handed-off? true}
      (and final-state (:escalated final-state)) {:outcome (:reason final-state) :handed-off? false}
      (>= turns-used max-ticks) {:outcome "turn cap" :handed-off? false}
      :else {:outcome "wall-clock cap" :handed-off? false})))

(defn- drive-until-capped!
  "run-fixture!'s own outer loop over BL-1697's real, unmodified per-cycle
   primitive drive-tick! - never drive-to-end!, whose own max-ticks counts
   raw POLL ITERATIONS (BL-1700 D2), not model turns. Stops the moment
   fixTurnsUsed reaches max-ticks (a REAL turn cap), or the driver reaches
   a terminal state (mirrors drive-to-end!'s own BL-1698 prev-escalated?
   grace tick), or safety-ticks is exhausted. safety-ticks is sized
   generously against wall-clock-seconds (never against max-ticks) purely
   so an abandoned background future cannot run forever; it is never what
   actually stops a genuinely slow (rather than turn-exhausted) run - the
   caller's own deref timeout, racing the SAME wall-clock-seconds budget,
   fires at essentially the same moment and reports 'wall-clock cap'."
  [ctx max-ticks poll-interval-ms safety-ticks]
  (loop [n 0
         prev-escalated? false]
    (let [state (local-parcel-driver-lib/read-driver-state (:project-root ctx) (:seat-id ctx))
          turns-used (or (:fixTurnsUsed state) 0)]
      (if (or (>= n safety-ticks)
              (>= turns-used max-ticks)
              (and (:escalated state) prev-escalated?)
              (and (nil? state) (pos? n)))
        state
        (do (local-parcel-driver-lib/drive-tick! ctx)
            (Thread/sleep (long poll-interval-ms))
            (recur (inc n) (boolean (:escalated state))))))))

(defn run-fixture!
  "Drives ONE fixture ticket through the real driver against a real aider
   seat, or (acceptance suite only) the scripted stand-in above. opts:
     :model, :endpoint-url    - the real seat (ignored when :stand-in-mode)
     :stand-in-mode           - \"solve\" | \"edit-spec\" | \"never\" | \"hang\"
                                 - never used by a real probe invocation
     :fix-turns-limit, :max-ticks, :wall-clock-seconds - each nil/absent
       defaults to local-parcel-driver-lib/default-fix-turns,
       default-max-ticks, default-wall-clock-seconds respectively
       (BL-1700 D1: coalesced HERE, the one place, with `or` rather than a
       destructuring `:or` - a caller that passes the key explicitly nil,
       as probe! always does, never triggers `:or`).
   Always kills the tmux session it started and removes the throwaway
   repo before returning, whatever the outcome - invariant 2."
  [{:keys [fixture-id model endpoint-url stand-in-mode
           fix-turns-limit max-ticks wall-clock-seconds]}]
  (let [fix-turns-limit (or fix-turns-limit local-parcel-driver-lib/default-fix-turns)
        max-ticks (or max-ticks default-max-ticks)
        wall-clock-seconds (or wall-clock-seconds default-wall-clock-seconds)
        t0 (System/currentTimeMillis)
        {:keys [root sha]} (setup-run-repo! fixture-id)
        ;; BL-1700 D3: an absolute path OUTSIDE root, computed before
        ;; launch so aider writes there directly - root (and everything
        ;; under it, including the OLD relative ".probe-llm.log") is
        ;; deleted in the finally below. nil for a stand-in run: no real
        ;; aider, so no real transcript to preserve.
        llm-history-path (when-not stand-in-mode
                            (str (fs/path (fs/parent root) (str "bl1700-llm-history-" fixture-id "-" t0 ".log"))))
        {:keys [socket session]} (if stand-in-mode
                                    (launch-stand-in-seat! root stand-in-mode)
                                    (launch-aider-seat! root model endpoint-url llm-history-path))
        agent (if stand-in-mode "stand-in" "aider")
        ;; The driver assumes an ALREADY-idle seat (true in production - a
        ;; seat boots once, long before any parcel reaches it); this
        ;; harness launches the seat and starts driving it in the same
        ;; breath, so a real aider's own multi-second boot (repo scan,
        ;; model handshake) can otherwise swallow the driver's first
        ;; instruction before aider is even reading its input. Wait for
        ;; the seat's own prompt once, up to 60s, before driving at all -
        ;; a real polling wait, never a fixed sleep.
        _ (loop [waited-ms 0]
            (when (and (< waited-ms 60000)
                       (not (local-parcel-driver-lib/turn-idle?
                             (agent-runtime-inject/capture-pane-text socket session))))
              (Thread/sleep 200)
              (recur (+ waited-ms 200))))
        ctx {:project-root (str root) :checkout (str root) :role "coder"
             :seat-id "probe" :agent agent :socket socket :session session
             :fix-turns-limit fix-turns-limit}]
    (try
      (let [poll-interval-ms 50
            ;; The background future is NOT cancelled when deref below
            ;; times out - it keeps polling until drive-until-capped!'s OWN
            ;; safety-ticks bound (Clojure futures are cooperative, never
            ;; preemptible). safety-ticks is sized against wall-clock-seconds
            ;; ONLY (BL-1700 D2 - never against max-ticks, which used to
            ;; shrink it to as little as 400 ticks = 20s regardless of a
            ;; 900s wall-clock-seconds), so it is never what actually stops
            ;; a genuinely slow run; the deref timeout below, racing the
            ;; SAME budget, fires at essentially the same moment.
            safety-ticks (long (+ 5 (/ (* wall-clock-seconds 1000) poll-interval-ms)))
            fut (future (drive-until-capped! ctx max-ticks poll-interval-ms safety-ticks))
            timeout-ms (* 1000 wall-clock-seconds)
            final-state (deref fut timeout-ms ::timeout)
            timed-out? (= final-state ::timeout)
            final-state (if timed-out?
                          (local-parcel-driver-lib/read-driver-state (str root) "probe")
                          final-state)
            {:keys [outcome handed-off?]} (if timed-out?
                                             {:outcome "wall-clock cap" :handed-off? false}
                                             (outcome-of final-state root max-ticks))
            turns-used (or (:fixTurnsUsed final-state) 0)
            wall-s (/ (- (System/currentTimeMillis) t0) 1000.0)]
        {:fixtureId fixture-id :outcome outcome :handedOff handed-off?
         :wallSeconds wall-s :commit sha :turns turns-used :llmHistoryPath llm-history-path})
      (finally
        (kill-session! socket session)
        (fs/delete-tree root {:force true})))))

;; ── The summary (BL-1700 item 4) ──────────────────────────────────────────

(def pass-bar 4)

(defn summarize [scorecards]
  (let [handed-off (count (filter :handedOff scorecards))]
    {:handedOff handed-off :of (count scorecards)
     :verdict (if (>= handed-off pass-bar) "pass" "fail")}))

(defn probe!
  "The whole probe (BL-1700 items 1-4). fixture-ids-to-run defaults to
   every fixture. Returns {:endpointOk? :scorecards :summary}, or
   {:endpointOk? false} with no scorecards/summary written when the
   endpoint never answers (item 1 - write nothing). :stand-in-mode
   (acceptance suite only) skips the endpoint check AND model-id
   resolution entirely - no real model or endpoint is ever involved on
   that path. Every scorecard and the summary/evidence file report the
   RESOLVED model id (BL-1700 D3), not the raw argument."
  [{:keys [model endpoint-url fixture-ids-to-run stand-in-mode
           fix-turns-limit max-ticks wall-clock-seconds evidence-dir]
    :or {fixture-ids-to-run fixture-ids
         endpoint-url "http://127.0.0.1:11434/v1"}}]
  (if-not (or stand-in-mode (endpoint-answers? endpoint-url))
    {:endpointOk? false :endpointUrl endpoint-url}
    (let [;; BL-1700 QA D1 (2026-09-26): the SAME present-but-nil map key
          ;; shape D1's own comment above already names - the CLI forwards
          ;; :evidence-dir explicitly even when --evidence-dir was never
          ;; passed, so a `:or` default on the destructure above would
          ;; never fire. Coalesced here, the one place, like max-ticks/
          ;; wall-clock-seconds above.
          evidence-dir (or evidence-dir default-evidence-dir)
          resolved-model (if stand-in-mode model (resolve-model-id endpoint-url model))
          scorecards (mapv (fn [id]
                              (run-fixture! {:fixture-id id :model resolved-model :endpoint-url endpoint-url
                                             :stand-in-mode stand-in-mode
                                             :fix-turns-limit fix-turns-limit :max-ticks max-ticks
                                             :wall-clock-seconds wall-clock-seconds}))
                            fixture-ids-to-run)
          summary (summarize scorecards)]
      (when evidence-dir
        (fs/create-dirs evidence-dir)
        (let [stamp (str/replace (str (java.time.Instant/now)) #"[:]" "-")
              safe-model (str/replace resolved-model #"[:/]" "-")
              path (fs/path evidence-dir (str "local-coder-probe-" safe-model "-" stamp ".md"))]
          (spit (str path)
                (str "# local coder probe: " resolved-model "\n\n"
                     "handed off " (:handedOff summary) " of " (:of summary)
                     " - verdict " (:verdict summary) "\n\n"
                     (str/join "\n" (map #(str "- " (:fixtureId %) ": " (:outcome %) " (" (:wallSeconds %)
                                                "s, " (:turns %) " turn(s)) - llm history: " (:llmHistoryPath %))
                                          scorecards))
                     "\n"))))
      {:endpointOk? true :model resolved-model :scorecards scorecards :summary summary})))
