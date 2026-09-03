#!/usr/bin/env bb
;; babysitter_check.bb — thin I/O gatherer + CLI for babysitterd (BL-611).
;;
;; Ports the deterministic prototype (.swarmforge/operator/babysitter_check.sh,
;; untracked) into the repo: this file does ALL the tmux/ps/find/meminfo/file
;; gathering, builds a snapshot, hands it to babysitterd_sweep_lib/assemble-
;; findings (pure, unit-tested separately), prints the findings, and — with
;; --nudge — sends eligible findings to the coordinator via
;; babysitter_nudge_lib/nudge-resident! (never raw tmux send-keys).
;;
;; Usage:
;;   bb babysitter_check.bb <project-root> [--nudge]
;;
;; Invoked as `babysitter_check.sh <project-root> [--nudge]` (the pinned CLI
;; name — see swarmforge/scripts/babysitter_check.sh, a one-line exec shim).
;;
;; State (BL-611: distinct from the retired hawk's .swarmforge/babysitter/, so
;; stale hawk state is never mistaken for daemon state):
;;   .swarmforge/babysitterd/pane-hash-<role>   last 3 stable content hashes
;;   .swarmforge/babysitterd/streak             swarm-starved idle-sweep streak
;;   .swarmforge/babysitterd/nudge-dedup.json    {finding-key -> last-nudged-ms}
;;
;; Exit 0 always — a monitor, never a gate.

(ns babysitter-check
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.java.io :as io]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir "babysitterd_sweep_lib.bb")))
;; BL-1018: the ONE definition of what a single-role repair may resolve to.
(load-file (str (fs/path script-dir "single_role_repair_lib.bb")))
(load-file (str (fs/path script-dir "babysitter_assess_lib.bb")))
;; BL-1081: the deterministic layer's view of an ACP-hosted seat.
(load-file (str (fs/path script-dir "acp_session_lib.bb")))
(load-file (str (fs/path script-dir "babysitter_nudge_lib.bb")))
(load-file (str (fs/path script-dir "operator_lib.bb")))
(load-file (str (fs/path script-dir "mono_router_lib.bb")))
;; BL-958: shared control-plane classify / response-policy — babysitterd is
;; the owning daemon for :recover via ./swarm ensure.
(load-file (str (fs/path script-dir "control_plane_lib.bb")))
;; BL-1017: the SAME provider env-passthrough swarm_ensure.bb/respawn-role!
;; and handoffd.bb's auth-observe respawn use, via BL-536's extraction — so a
;; session repair never strips alternate-runtime auth from the relaunched
;; pane. Deliberately this lib and NOT swarm_ensure.bb itself, which runs a
;; full ensure sweep + System/exit as a side effect of being load-file'd.
(load-file (str (fs/path script-dir "provider_respawn_env_lib.bb")))
;; BL-1108: shared token→argv needles (also loaded by swarm_ensure.bb).
(load-file (str (fs/path script-dir "agent_process_marker_lib.bb")))
;; BL-1103: one shared wall-clock-bounded runner (was a hand-copy of expedite's).
(load-file (str (fs/path script-dir "bounded_run_lib.bb")))
(load-file (str (fs/path script-dir "master_main_reconcile_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: babysitter_check.bb <project-root> [--nudge]"))
  (System/exit 1))

(def args (vec *command-line-args*))
(def project-root
  (or (first (remove #(str/starts-with? % "-") args)) (usage)))
(def nudge? (boolean (some #{"--nudge"} args)))

(def state-dir (fs/path project-root ".swarmforge"))
(def babysitterd-dir (fs/path state-dir "babysitterd"))
(def streak-file (fs/path babysitterd-dir "streak"))
(def dedup-file (fs/path babysitterd-dir "nudge-dedup.json"))
(def escalation-dedup-file (fs/path babysitterd-dir "escalation-dedup.json"))
;; BL-1017: {role -> {"attempts" n "last-ms" ms}} — what bounds session
;; repair across sweeps. Without persistence the cooldown would reset on
;; every sweep and invariant 2 ("no respawn storm") would be unenforceable,
;; since each sweep is its own process.
(def repair-file (fs/path babysitterd-dir "session-repairs.json"))
;; BL-958: bound for ./swarm ensure when the whole control plane is gone —
;; same shape as session-repairs.json (attempts + last-ms), one key only.
(def control-plane-ensure-file (fs/path babysitterd-dir "control-plane-ensure.json"))

(def stuck-min 30)
(def heartbeat-max-secs 300)
(def mem-floor-mb 1500)
(def nudge-cooldown-ms (* 30 60 1000))
(def rotate-grace-min 10)
(def pending-max-age-min 120)

(defn now-ms [] (System/currentTimeMillis))
(defn now-iso [] (str (java.time.Instant/now)))

(defn sh! [& args]
  ;; {:continue true} only softens a non-zero exit. A binary that cannot be
  ;; spawned at all (ENOENT / EACCES — the live WSL shape for macOS-only
  ;; `vm_stat`) throws IOException from ProcessBuilder before any exit code
  ;; exists. Catching here keeps every gather soft-failed instead of aborting
  ;; the whole babysitter sweep (which previously permanently disabled
  ;; BL-1017 session auto-heal on Linux/WSL whenever /proc/meminfo also
  ;; failed to read via slurp — see read-meminfo-text).
  (try
    (apply process/sh {:continue true} args)
    (catch Exception e
      ;; BL-1071 review goal 3: 127 is a REAL exit code, so a synthesised one
      ;; is otherwise indistinguishable from a genuine "command not found"
      ;; out of a process that did start. No caller branches on 127 today
      ;; (checked across this file and babysitterd_sweep_lib.bb), so the
      ;; marker is additive rather than a behaviour change - it just means a
      ;; caller that ever needs the difference can have it.
      {:exit 127 :out "" :err (or (.getMessage e) "exec-failed") :spawn-failed? true})))

;; ── tmux socket + roles ──────────────────────────────────────────────────

(defn read-tmux-socket []
  (let [f (fs/path state-dir "tmux-socket")]
    (when (fs/exists? f)
      (let [s (str/trim (slurp (str f)))]
        (when (fs/exists? s) s)))))

(defn parse-roles-tsv []
  (let [f (fs/path state-dir "roles.tsv")]
    (if (fs/exists? f)
      (->> (str/split-lines (slurp (str f)))
           (remove str/blank?)
           (map (fn [line]
                  (let [cols (str/split line #"\t" -1)]
                    ;; col0 role, col3 session, col5 agent token (claude/cursor/…).
                    ;; Absent agent column defaults to claude — pre-agent-column
                    ;; fixtures and classic packs stay unchanged.
                    {:role (get cols 0)
                     :session (get cols 3)
                     :agent (let [a (get cols 5)]
                              (if (str/blank? a) "claude" a))})))
           (remove #(str/blank? (:session %)))
           vec)
      [])))

;; ── BL-804: mono-router topology awareness ──────────────────────────────
;; Same resolution as handoffd.bb's rotation-router-mode? (~line 1353):
;; swarm-identity rotation key, else the identity-recorded active pack conf,
;; else the tracked default swarmforge/swarmforge.conf — via mono_router_lib
;; (rotation-router-from-identity?, conf-rotation-router?), never a second
;; parser of identity/conf text (invariant 2). script-dir is this file's OWN
;; location (mirrors handoffd.bb's conf-file), not project-root — a launch-
;; time --pack/SWARMFORGE_CONFIG override is still honored via the identity-
;; recorded conf path, same as handoffd.

(def default-conf-file (str (fs/path script-dir ".." "swarmforge.conf")))

(defn rotation-router-mode? []
  (let [identity-path (fs/path state-dir "swarm-identity")
        identity-text (when (fs/exists? identity-path) (slurp (str identity-path)))
        conf-path (or (get (mono-router-lib/parse-identity-map (or identity-text ""))
                           "active_backlog_max_depth_conf_path")
                      default-conf-file)
        conf-text (when (and conf-path (fs/exists? conf-path))
                    (slurp conf-path))]
    (boolean
     (or (mono-router-lib/rotation-router-from-identity? identity-text)
         (mono-router-lib/conf-rotation-router? conf-text)))))

(defn should-stand-role?
  "Whether `role` (a roles.tsv role name) is expected to have a standing tmux
   session. Under rotation router, derived purely from topology
   (mono-router-lib/should-have-standing-session? — resident + coordinator
   only, invariant 1: never a hardcoded per-role list). Outside router mode
   every role is expected to stand, unchanged from pre-BL-804 behavior
   (scenario 05)."
  [rotation-router? ordered-roles role]
  (if rotation-router?
    (mono-router-lib/should-have-standing-session? ordered-roles role)
    true))

(defn pane-exists? [socket session]
  (and socket (zero? (:exit (sh! "tmux" "-S" socket "has-session" "-t" session)))))

(defn pane-pid [socket session]
  (when (and socket (pane-exists? socket session))
    (let [r (sh! "tmux" "-S" socket "list-panes" "-t" (str session ":0.0") "-F" "#{pane_pid}")]
      (when (zero? (:exit r))
        (parse-long (str/trim (first (str/split-lines (:out r)))))))))

;; BL-802: `ps --ppid` is GNU-only. Snapshot still shells via sh! (bounded);
;; child-of-pane argv parse lives in agent_process_marker_lib (BL-1019 ONE
;; with ./swarm status).
(def ps-line-pattern agent-process-marker-lib/ps-line-pattern)

(defn ps-snapshot []
  (let [r (sh! "ps" "-eo" "pid=,ppid=,args=")]
    (when (zero? (:exit r)) (:out r))))

;; Re-export shared map/lookup so existing callers
;; (babysitter-check/agent-process-markers, acceptance runners) keep working.
(def agent-process-markers agent-process-marker-lib/agent-process-markers)

(defn agent-process-marker
  "Substring to look for in a child process argv for this agent token.
   Unknown tokens fall back to the token itself (still better than always
   looking for claude)."
  [agent]
  (agent-process-marker-lib/agent-process-marker agent))

(defn agent-process-line
  "First process under pane-pid (any generation) whose args match the expected
   agent marker, or nil. Formerly claude-only (`claude `); Cursor seats run
   `cursor-agent` and were false half-launch CRITs under the old needle.
   BL-1070: walks descendants, not only direct children."
  [pane-pid ps-output agent]
  (agent-process-marker-lib/agent-process-line pane-pid ps-output agent))

;; Back-compat alias — older callers/tests still name the claude helper.
(defn claude-process-line [pane-pid ps-output]
  (agent-process-line pane-pid ps-output "claude"))

(defn capture-pane [socket session]
  (when (and socket (pane-exists? socket session))
    (:out (sh! "tmux" "-S" socket "capture-pane" "-p" "-S" "-40" "-t" (str session ":0.0")))))

(def menu-pattern #"Do you want|Do you trust|❯ 1\.|\(y/n\)|Enter to confirm|to select")

(defn strip-spinner [text]
  (->> (str/split-lines (str text))
       (remove #(re-find #"✻|✽|✶|✳|·|tokens|for [0-9]+m?[0-9]*s" %))
       (str/join "\n")))

(defn sha1-hex [s]
  (let [d (java.security.MessageDigest/getInstance "SHA-1")]
    (->> (.digest d (.getBytes (str s) "UTF-8"))
         (map #(format "%02x" %))
         (apply str))))

(defn read-hash-history [role]
  (let [f (fs/path babysitterd-dir (str "pane-hash-" role))]
    (if (fs/exists? f)
      (vec (remove str/blank? (str/split-lines (slurp (str f)))))
      [])))

(defn append-hash-history! [role stable-hash]
  (fs/create-dirs babysitterd-dir)
  (let [f (fs/path babysitterd-dir (str "pane-hash-" role))
        history (conj (read-hash-history role) stable-hash)
        trimmed (vec (take-last 3 history))]
    (spit (str f) (str (str/join "\n" trimmed) "\n"))
    trimmed))

(defn gather-role [socket ps-output {:keys [role session agent]}]
  (let [exists? (pane-exists? socket session)
        pid (when exists? (pane-pid socket session))
        ;; A pane whose pid we need but whose ps snapshot failed to gather at
        ;; all is a tooling failure, not evidence the agent process is gone.
        gather-failed? (boolean (and pid (nil? ps-output)))
        agent-token (or agent "claude")
        agent-line (agent-process-line pid ps-output agent-token)
        has-agent? (boolean agent-line)
        ;; Claude /rc only applies to Claude seats. Cursor (and other
        ;; non-Claude agents) have no --remote-control flag by design — do
        ;; not WARN "RC degraded" when their agent is correctly alive.
        rc-applicable? (= agent-token "claude")
        has-rc? (boolean (and rc-applicable? agent-line
                              (str/includes? agent-line "--remote-control")))
        pane-text (or (capture-pane socket session) "")
        menu? (boolean (re-find menu-pattern pane-text))
        busy? (babysitterd-sweep-lib/classify-pane-busy? pane-text)
        stable-hash (sha1-hex (strip-spinner pane-text))
        history (append-hash-history! role stable-hash)
        ;; BL-1081 (architect bounce D1). THIS is where a seat's idle, stuck
        ;; and menu-blocked state is actually decided in the running swarm -
        ;; gather-role has real callers, and every one of the three facts
        ;; above it is inferred from `pane-text`. A truncated tail, a ghost
        ;; suggestion and a lying pane_current_command each defeat that
        ;; inference differently.
        ;;
        ;; For a seat behind the ACP host the same facts are on disk. The
        ;; pane capture stays exactly as it was regardless - the host renders
        ;; the transcript into it, so the pane checks and a human keep
        ;; working from it (invariant 2). A seat with no host reads back nil
        ;; here and nothing about the old path moves.
        acp-snapshot (acp-session-lib/read-snapshot project-root role)
        stop-reason (acp-session-lib/stop-reason acp-snapshot)
        ;; The interactive-menu CRIT exists because a permission moment is
        ;; only visible as pane text. For an ACP seat it is a structured
        ;; message instead, so the pattern match must not decide - and
        ;; check-acp-seat raises the routable finding in its place.
        menu-blocked? (and menu? (acp-session-lib/menu-check-applies? acp-snapshot))]
    (acp-session-lib/apply-acp-facts
     ;; Key kept as has-claude-process? for sweep-lib API compat; value is
     ;; "expected agent process present" (claude OR cursor-agent OR …).
     {:role role :pane-exists? exists?
      :has-claude-process? has-agent?
      :expected-agent agent-token
      :expected-process (agent-process-marker agent-token)
      :process-gather-failed? gather-failed?
      :rc-applicable? rc-applicable?
      :has-remote-control? has-rc? :menu-blocked? menu-blocked? :busy? busy?
      :hash-history history :pane-text pane-text}
     acp-snapshot
     stop-reason)))

;; ── pipeline-code-on-main gathering (BL-631) ─────────────────────────────
;; The QA-exclusive path set is read from BL-632's own single source at
;; runtime (invariant 2) - never restated, never hand-copied. Ancestry uses
;; is_qa_ancestor.sh, the ONE shared "is this sha QA-approved" predicate
;; (BL-925 invariant 2) - the same shape handoffd.bb's own private
;; qa-ancestor? already established, mirrored here rather than shared
;; (it is defn- in handoffd.bb's own namespace); never a second git
;; merge-base invocation. `git rev-list swarmforge-QA..<ref>` enumerates
;; CANDIDATES efficiently (the same reachability primitive merge-base
;; --is-ancestor uses internally, batch-applied), and is_qa_ancestor.sh
;; then CONFIRMS each one individually before it is ever treated as
;; offending - belt and suspenders, and the literal reuse the ticket asks
;; for. Both refs that name main are swept (main and origin/main diverge
;; routinely under the current worktree layout, BL-891) - sweeping only one
;; leaves a hole the declared invariant forbids. Any failure anywhere in
;; this resolution chain (the path-set read, either ref's rev-list, or any
;; single sha's ancestor confirmation) fails the WHOLE sweep closed to
;; :ancestry-unavailable? true (invariant 3) - never a partial result that
;; could read as "nothing else was wrong".

;; BABYSITTER_QA_EXCLUSIVE_PATHS_SCRIPT overrides which --list-paths script
;; is consulted - the same hermetic-test-seam shape BABYSITTER_MEMINFO_PATH
;; already uses below, and exactly what scenario 07 needs to prove
;; classification follows BL-632's own reported set rather than a hand-
;; copied literal (invariant 2): point the sweep at a stub emitting a path
;; set it has never seen and confirm it fires on that set instead.
(defn check-pipeline-sh []
  (or (System/getenv "BABYSITTER_QA_EXCLUSIVE_PATHS_SCRIPT")
      (str (fs/path script-dir "check_pipeline_code_on_main.sh"))))

;; BABYSITTER_QA_ANCESTOR_SCRIPT is the same hermetic-test-seam shape as
;; BABYSITTER_QA_EXCLUSIVE_PATHS_SCRIPT above (BL-962: scenario 05 needs an
;; ancestry predicate that fails selectively during merge adjudication).
;; is_qa_ancestor.sh stays the ONE approval predicate (invariant 2) - the
;; seam substitutes the whole predicate in tests, never adds a second one.
(defn qa-ancestor-sh []
  (or (System/getenv "BABYSITTER_QA_ANCESTOR_SCRIPT")
      (str (fs/path script-dir "is_qa_ancestor.sh"))))

(defn qa-exclusive-paths []
  (let [r (sh! "bash" (check-pipeline-sh) "--list-paths")]
    (when (zero? (:exit r))
      (vec (remove str/blank? (str/split-lines (:out r)))))))

;; is_qa_ancestor.sh operates on the CALLER's cwd, never its own location
;; (its own header) - :dir must be set explicitly to project-root, the
;; exact shape handoffd.bb's own qa-ancestor? already uses. sh!'s own
;; variadic wrapper hardcodes a leading {:continue true} with no room for
;; :dir, so this calls process/sh directly rather than widening that
;; shared helper's contract for one caller.
;; Both exit-code predicates in this file answer over the SAME convention -
;; 0 yes, 1 no, anything else "could not answer" (is_qa_ancestor.sh's contract
;; and `git diff --quiet`'s happen to agree). Decoded once, so the fail-closed
;; rule that matters - a non-0/1 exit is never read as a plain "no" - has a
;; single definition rather than one copy per predicate (BL-962 added the
;; second copy).
(defn- exit->answer [r answer-key]
  (case (:exit r)
    0 {:ok? true answer-key true}
    1 {:ok? true answer-key false}
    {:ok? false answer-key false}))

(defn qa-ancestor? [sha]
  (exit->answer
   (process/sh {:continue true :dir (str project-root)} "bash" (qa-ancestor-sh) sha)
   :ancestor?))

;; ── batched-qa-ancestry (BL-1086) ────────────────────────────────────────
;; The gather asked qa-ancestor? once per SHA, one bash process each, and each
;; of those re-scanned the whole bounce store and grepped the entire backlog
;; tree. On a `main` ~23 commits ahead that overran babysitterd's 600s
;; freshness threshold - and since the daemon writes its heartbeat only AFTER
;; the check returns, a slow gather is indistinguishable from a dead one, so it
;; got RESTARTED mid-sweep (age_secs=1146, 2026-08-22).
;;
;; This is the SAME predicate answering for many SHAs in one process, which is
;; the only shape BL-925 invariant 2 allows: is_qa_ancestor.sh remains the one
;; place that decides approval, and this never computes ancestry for itself.
;; The seam (BABYSITTER_QA_ANCESTOR_SCRIPT) still substitutes the whole
;; predicate, so a test stub controls batch and single alike.
;;
;; Returns {sha {:ok? :ancestor?}} for every requested sha, or nil when the
;; batch itself could not be run - the caller fails the WHOLE sweep closed on
;; nil, never a partial map (invariant 3).
(defn batched-qa-ancestry
  [shas]
  (if (empty? shas)
    {}
    (let [r (apply process/sh {:continue true :dir (str project-root)}
                   "bash" (qa-ancestor-sh) "--batch" shas)]
      (when (zero? (:exit r))
        (let [rows (->> (str/split-lines (str (:out r)))
                        (remove str/blank?)
                        (map #(str/split (str/trim %) #"\s+")))
              answered (into {} (keep (fn [[sha code]]
                                        (when (and sha code)
                                          [sha (case code
                                                 "0" {:ok? true :ancestor? true}
                                                 "1" {:ok? true :ancestor? false}
                                                 {:ok? false :ancestor? false})]))
                                      rows))]
          ;; A sha the batch did not answer for is not a "no" - it is an
          ;; unanswered question, and reading it as anything else would be the
          ;; partial result invariant 3 forbids.
          (when (every? #(contains? answered %) shas)
            answered))))))

;; ── pipeline-code-on-main-cache (BL-1086) ────────────────────────────────
;; The gather re-derived the same answer every 300s tick with nothing keyed on
;; the refs it depends on. Keyed on all three tips - main, origin/main where it
;; exists, and swarmforge-QA - because any of them moving changes the answer.
;;
;; ON DISK, not in memory - and that is a deliberate departure from the
;; ticket's "How (direction, not mandate)", which suggested an in-memory cache
;; for the daemon's lifetime. It cannot work here: babysitterd.sh's tick shells
;; `babysitter_check.sh`, which `exec bb`s this file, so EVERY tick is a fresh
;; process and an atom would never survive one. An in-memory cache would have
;; been a cache that never hits, passing review and saving nothing.
;;
;; The ticket's own acceptance settles it the same way: scenario 02 runs two
;; checks and requires the second to invoke no predicate, and the QA procedure
;; spells that out as two `babysitter_check.sh` runs. Both are statements about
;; separate processes.
;;
;; Keyed on all three tips, so any of them moving invalidates. A gather that
;; returned :ancestry-unavailable? true is NEVER written. A fail-closed hole
;; frozen as clean is strictly worse than the cost this removes, and it is the
;; one way a cache here could do real harm.
(def pipeline-code-on-main-cache
  (fs/path state-dir "babysitter" "pipeline-code-on-main-cache.json"))

(defn read-pipeline-code-on-main-cache
  "The cached {:tips :result}, or nil when absent or unreadable. Unreadable is
   treated as absent on purpose: a corrupt cache must cost a re-gather, never a
   sweep."
  []
  (try
    (when (fs/exists? pipeline-code-on-main-cache)
      (let [m (json/parse-string (slurp (str pipeline-code-on-main-cache)) true)]
        (when (map? m) m)))
    (catch Exception _ nil)))

(defn write-pipeline-code-on-main-cache!
  "Written through a temp file and an atomic move: the daemon can be restarted
   mid-write (that is the very failure this ticket is about), and a half-written
   cache read back as a hit would be worse than no cache."
  [entry]
  (try
    (fs/create-dirs (fs/parent pipeline-code-on-main-cache))
    (let [tmp (fs/path (fs/parent pipeline-code-on-main-cache)
                       (str "." (fs/file-name pipeline-code-on-main-cache) ".tmp"))]
      (spit (str tmp) (json/generate-string entry))
      (fs/move tmp pipeline-code-on-main-cache {:replace-existing true :atomic-move true}))
    (catch Exception _ nil)))

(defn- ref-tip [ref]
  (let [r (sh! "git" "-C" project-root "rev-parse" "-q" "--verify" ref)]
    (when (zero? (:exit r)) (str/trim (:out r)))))

(defn pipeline-code-on-main-tips
  "The three tips the answer depends on. An absent origin/main is a legitimate
   state (no configured remote), recorded as nil rather than treated as a
   failure - the same posture the gather itself takes."
  []
  {:main (ref-tip "main")
   :origin-main (ref-tip "origin/main")
   :qa (ref-tip "swarmforge-QA")})

(defn ref-resolves? [ref]
  (zero? (:exit (sh! "git" "-C" project-root "rev-parse" "-q" "--verify" ref))))

(defn shas-ahead-of-qa [ref]
  (let [r (sh! "git" "-C" project-root "rev-list" (str "swarmforge-QA.." ref))]
    (when (zero? (:exit r))
      (vec (remove str/blank? (str/split-lines (:out r)))))))

(defn commit-is-merge? [sha]
  (zero? (:exit (sh! "git" "-C" project-root "rev-parse" "-q" "--verify" (str sha "^2")))))

;; A merge commit's own content is invisible to a plain `git show`/
;; `diff-tree` (no --first-parent) - BL-590's own f8dc07963 reports zero
;; files that way, 13 via -m --first-parent. `-m` shows the diff against
;; each parent for a merge; --first-parent restricts that to the ONE
;; comparison that matters here (what this merge introduced relative to
;; what was already on the branch), matching a non-merge commit's own
;; single-parent diff exactly.
(defn commit-touched-paths [sha]
  (let [r (if (commit-is-merge? sha)
            (sh! "git" "-C" project-root "diff-tree" "-m" "--first-parent" "--no-commit-id" "--name-only" "-r" sha)
            (sh! "git" "-C" project-root "diff-tree" "--no-commit-id" "--name-only" "-r" sha))]
    (when (zero? (:exit r))
      (vec (remove str/blank? (str/split-lines (:out r)))))))

(defn commit-subject [sha]
  (let [r (sh! "git" "-C" project-root "log" "-1" "--format=%s" sha)]
    (if (zero? (:exit r)) (str/trim (:out r)) sha)))

(defn- offending-paths [paths qa-paths]
  (filterv (fn [p] (some #(str/starts-with? p %) qa-paths)) paths))

;; ── merge adjudication against QA-approved parents (BL-962) ───────────────
;; -m --first-parent above charges a reconciliation merge with everything
;; its QA-side parent brought in, so every operator merge of QA-landed work
;; raised a false CRIT (da6031c60 / b3ba48bfc, evidence
;; backlog/evidence/babysitter-on-main-false-positive-20260820.md). The
;; exemption rule is BL-925's commit-time rule applied to the history sweep:
;; a merge's path clears ONLY when some QA-approved parent holds
;; byte-identical content for it. Only ancestry + content identity may
;; clear a path - commit subjects are spoofable and are never consulted.

(defn merge-non-first-parents
  "The non-first parents of a merge commit (['^2' onward] - octopus merges
   fall out of --parents naturally). nil on git failure (fail closed)."
  [sha]
  (let [r (sh! "git" "-C" project-root "rev-list" "--parents" "-n" "1" sha)]
    (when (zero? (:exit r))
      (vec (drop 2 (str/split (str/trim (:out r)) #"\s+"))))))

(defn path-identical-to-parent?
  "Is the merge RESULT's content for path byte-identical to parent's
   version? git diff --quiet: exit 0 identical, 1 different, else error
   ({:ok? false} - the caller fails the whole sweep closed, invariant 3)."
  [parent sha path]
  (exit->answer (sh! "git" "-C" project-root "diff" "--quiet" parent sha "--" path)
                :identical?))

(defn merge-parent-facts
  "Impure: per non-first parent of merge sha - QA approval (qa-ancestor?,
   backed by the one shared ancestry script) plus which of the offending paths
   the merge result holds byte-identical to that parent. ANY failure in the
   ancestry call or a content diff yields {:ok? false} (invariant 3):
   the caller must fail the WHOLE sweep closed, never adjudicate on
   partial facts."
  [sha offending]
  (let [parents (merge-non-first-parents sha)]
    (if (nil? parents)
      {:ok? false}
      (reduce
       (fn [acc parent]
         (let [{:keys [ok? ancestor?]} (qa-ancestor? parent)]
           (if-not ok?
             (reduced {:ok? false})
             (let [checks (mapv #(vector % (path-identical-to-parent? parent sha %)) offending)]
               (if (some (fn [[_ c]] (not (:ok? c))) checks)
                 (reduced {:ok? false})
                 (update acc :parents conj
                         {:parent parent
                          :qa-approved? ancestor?
                          :identical-paths (into #{} (keep (fn [[p c]] (when (:identical? c) p)) checks))}))))))
       {:ok? true :parents []}
       parents))))

(defn adjudicate-merge-paths
  "Pure (invariant 1): the offending paths that must STILL be reported for
   a merge. A path is exempt only when some parent is BOTH QA-approved AND
   holds byte-identical content for it; identity to a non-approved parent
   never clears (a writer must not ride fresh pipeline edits through on a
   legitimate merge's coat-tails - BL-925's posture). parents rows:
   {:parent sha :qa-approved? bool :identical-paths #{path ...}}."
  [offending parents]
  (filterv (fn [path]
             (not-any? (fn [{:keys [qa-approved? identical-paths]}]
                         (and qa-approved? (contains? identical-paths path)))
                       parents))
           offending))

(defn assemble-offending-commits
  "Pure (invariant 3): per-commit rows -> the sweep's offending half. A row
   is an offender map, nil (clean), or ::adjudication-failed. ANY failed
   row fails the WHOLE sweep closed - valid offenders beside it are
   withheld, never a partial result that could read as clean."
  [rows]
  (if (some #(= ::adjudication-failed %) rows)
    {:offending-commits [] :ancestry-unavailable? true}
    {:offending-commits (vec (remove nil? rows)) :ancestry-unavailable? false}))

(defn- offender-row
  "One swept non-ancestor sha -> offender map / nil / ::adjudication-failed.
   Non-merge commits are untouched by BL-962: offending paths report as
   before. A merge's offending paths go through parent adjudication first."
  [sha qa-paths]
  (let [touched (commit-touched-paths sha)
        offending (offending-paths (or touched []) qa-paths)]
    (cond
      (empty? offending) nil

      (not (commit-is-merge? sha))
      {:sha sha :subject (commit-subject sha) :paths offending}

      :else
      (let [{:keys [ok? parents]} (merge-parent-facts sha offending)]
        (if-not ok?
          ::adjudication-failed
          (let [report (adjudicate-merge-paths offending parents)]
            (when (seq report)
              {:sha sha :subject (commit-subject sha) :paths report})))))))

(defn gather-pipeline-code-on-main []
  (let [qa-paths (qa-exclusive-paths)]
    (cond
      (nil? qa-paths)
      {:offending-commits [] :ancestry-unavailable? true}

      ;; The one ref invariant 3 actually names: swarmforge-QA MUST resolve,
      ;; fail closed otherwise. main/origin/main are checked separately,
      ;; below, and a legitimately-absent origin/main (no configured
      ;; remote, e.g. this very fixture-driven sweep) is never treated as
      ;; an ancestry failure - only swept as "nothing to report from there".
      (not (ref-resolves? "swarmforge-QA"))
      {:offending-commits [] :ancestry-unavailable? true}

      :else
      (let [existing-refs (filter ref-resolves? ["main" "origin/main"])
            per-ref (map shas-ahead-of-qa existing-refs)]
        (if (some nil? per-ref)
          {:offending-commits [] :ancestry-unavailable? true}
          (let [all-shas (vec (distinct (apply concat per-ref)))
                ;; BL-1086: one process for the whole candidate set. nil means
                ;; the batch could not answer for every sha, which fails the
                ;; WHOLE sweep closed exactly as a single unanswerable sha did
                ;; before (invariant 3) - never a partial result.
                answers (batched-qa-ancestry all-shas)]
            (if (or (nil? answers)
                    (some (fn [sha] (not (:ok? (get answers sha)))) all-shas))
              {:offending-commits [] :ancestry-unavailable? true}
              (let [non-ancestor-shas (remove #(:ancestor? (get answers %)) all-shas)
                    rows (mapv #(offender-row % qa-paths) non-ancestor-shas)]
                (assemble-offending-commits rows)))))))))

(defn gather-pipeline-code-on-main-cached
  "BL-1086: gather-pipeline-code-on-main, memoised on the three tips.

   The live path goes through HERE - a cache that exists while the gather still
   walks unconditionally would be this ticket's own failure mode repeated."
  []
  (let [tips (pipeline-code-on-main-tips)
        cached (read-pipeline-code-on-main-cache)]
    (if (and cached (= tips (:tips cached)) (some? (:result cached)))
      ;; The cached result is reconstructed rather than trusted as-is: JSON
      ;; round-trips :offending-commits' keys as keywords but loses nothing
      ;; else, and stating the two fields explicitly means a cache written by
      ;; an older shape can never widen what a caller sees.
      {:offending-commits (vec (get-in cached [:result :offending-commits]))
       :ancestry-unavailable? (boolean (get-in cached [:result :ancestry-unavailable?]))}
      (let [result (gather-pipeline-code-on-main)]
        ;; Only a SUCCESSFUL gather is cached. An :ancestry-unavailable? result
        ;; is a hole, and a hole cached as clean would outlive the condition
        ;; that caused it.
        (when-not (:ancestry-unavailable? result)
          (write-pipeline-code-on-main-cache! {:tips tips :result result}))
        result))))

;; ── handoffd / dead-letters / stuck parcels ──────────────────────────────

(defn proc-alive? [pattern]
  (zero? (:exit (sh! "pgrep" "-f" pattern))))

(defn file-age-secs [path]
  (when (fs/exists? path)
    (let [mtime-ms (fs/file-time->millis (fs/last-modified-time path))]
      (quot (- (now-ms) mtime-ms) 1000))))

(defn file-age-min [path]
  (when-let [secs (file-age-secs path)] (quot secs 60)))

(defn count-failed-box []
  (let [d (fs/path state-dir "handoffs" "failed")]
    (if (fs/directory? d) (count (fs/list-dir d)) 0)))

(defn worktree-mailbox-dirs []
  (let [wt (fs/path project-root ".worktrees")]
    (if (fs/directory? wt)
      (->> (fs/list-dir wt)
           (map #(fs/path % ".swarmforge" "handoffs"))
           (filter fs/directory?)
           vec)
      [])))

(defn all-mailbox-dirs []
  (into [(fs/path state-dir "handoffs")] (worktree-mailbox-dirs)))

(defn glob-handoffs [rel-glob]
  (mapcat (fn [mailbox]
            (try (map str (fs/glob mailbox rel-glob)) (catch Exception _ [])))
          (all-mailbox-dirs)))

;; ── owning-role resolution, both mailbox shapes (BL-807 R4/R5) ───────────
;; Worktree roles are flat (<worktree>/.swarmforge/handoffs/inbox/...);
;; master-resident roles nest a role segment
;; (.swarmforge/handoffs/<role>/inbox/...) since they share one physical
;; checkout (handoff_lib.bb/mailbox-base-dir). The master pattern requires
;; a literal "/inbox/" after the captured segment, so it never matches the
;; flat legacy .swarmforge/handoffs/inbox/... path (no role segment there)
;; or a worktree path (no extra segment between "handoffs" and "inbox").

(def ^:private worktree-owner-pattern #"\.worktrees/([^/]+)/\.swarmforge/handoffs")
(def ^:private master-owner-pattern #"\.swarmforge/handoffs/([^/]+)/inbox/")

(defn owning-role-for-path [path]
  (let [s (str path)]
    (or (second (re-find worktree-owner-pattern s))
        (second (re-find master-owner-pattern s)))))

;; BL-807 R4 / BL-1109: match in_process at any depth beneath a mailbox root
;; — "{,**/}" covers flat worktree and nested master shapes. The
;; `{*.handoff,*/*.handoff}` alternation also sees batch_* subdirectory
;; parcels (stuck and starved must gather the same set).
(def stuck-in-process-glob "{,**/}inbox/in_process/{*.handoff,*/*.handoff}")

(defn stuck-parcels [busy-by-role]
  (->> (glob-handoffs stuck-in-process-glob)
       (keep (fn [p]
               (when-let [age-min (file-age-min p)]
                 (when (> age-min stuck-min)
                   (let [role (owning-role-for-path p)]
                     {:name (fs/file-name p) :age-min age-min
                      :owner-busy? (boolean (get busy-by-role role false))})))))
       vec))

(defn pending-claims []
  (->> (glob-handoffs "inbox/new/*.handoff")
       (keep (fn [p]
               (when-let [age-min (file-age-min p)]
                 {:abandoned? false :age-min age-min})))
       vec))

;; ── in-process claims for check 10 (BL-1109: same glob as stuck-in-process) ─

(defn in-process-claims [busy-by-role]
  (->> (glob-handoffs stuck-in-process-glob)
       (keep (fn [p]
               (when-let [age-min (file-age-min p)]
                 (let [role (owning-role-for-path p)]
                   ;; :name mirrors stuck-parcels so starved gather assertions
                   ;; can name the claim without a second glob (BL-1109 harden).
                   {:name (fs/file-name p)
                    :age-min age-min
                    :abandoned? false
                    :owner-busy? (boolean (get busy-by-role role false))}))))
       vec))

;; ── memory floor ──────────────────────────────────────────────────────────
;; BL-802: /proc/meminfo is Linux-only. Try it first (BABYSITTER_MEMINFO_PATH
;; overrides it — the existing hermetic test seam, unchanged), then fall back
;; to macOS's vm_stat. nil only when neither facility yields a reading —
;; available-mem-mb's nil-means-truly-unavailable contract is unchanged.
;;
;; WSL/Linux note: babashka/`slurp` (and java.io.Reader paths that seek) fail
;; on /proc/meminfo with "Invalid argument" even when the file is perfectly
;; readable via FileInputStream or `cat`. That used to make every Linux sweep
;; fall through to `vm_stat`, which then threw ENOENT and aborted -main
;; before any BL-1017 repair ran — permanent auto-heal blackout. Always read
;; meminfo via a non-seeking FileInputStream.

(defn meminfo-path []
  (or (System/getenv "BABYSITTER_MEMINFO_PATH") "/proc/meminfo"))

(defn read-meminfo-text
  "Read a meminfo-style file without seeking. Returns nil on any I/O failure
   (missing path, /proc Invalid argument from a seeking reader, etc.)."
  [path]
  (try
    (with-open [in (java.io.FileInputStream. (str path))]
      (String. (.readAllBytes in) java.nio.charset.StandardCharsets/US_ASCII))
    (catch Exception _ nil)))

(defn read-proc-meminfo-mb []
  (when-let [meminfo (read-meminfo-text (meminfo-path))]
    (when-let [m (re-find #"MemAvailable:\s+(\d+)" meminfo)]
      (quot (parse-long (second m)) 1024))))

(def ^:private vm-stat-page-size-pattern #"page size of (\d+) bytes")

(defn- vm-stat-count [text label]
  (some-> (re-find (re-pattern (str (java.util.regex.Pattern/quote label) ":\\s+(\\d+)\\.")) text)
          second parse-long))

(defn parse-vm-stat-available-mb [text]
  (when-let [page-size (some-> (re-find vm-stat-page-size-pattern text) second parse-long)]
    (let [free (vm-stat-count text "Pages free")
          inactive (vm-stat-count text "Pages inactive")
          speculative (vm-stat-count text "Pages speculative")]
      (when (and free inactive speculative)
        (quot (* page-size (+ free inactive speculative)) (* 1024 1024))))))

(defn read-vm-stat-mb []
  (let [r (sh! "vm_stat")]
    (when (zero? (:exit r)) (parse-vm-stat-available-mb (:out r)))))

(defn available-mem-mb []
  (or (read-proc-meminfo-mb) (read-vm-stat-mb)))

(defn gather-main-sync-deadlock []
  "BL-1187: read active deadlock marker; prefer persisted overlapping_paths,
   else recompute with git -C (sh! does not accept :dir — that path used to
   spawn '{:dir' and fall open to an empty inspect-git-status hint)."
  (let [daemon-dir (fs/path state-dir "daemon")
        deadlock (master-main-reconcile-lib/read-deadlock (str daemon-dir))]
    (if (master-main-reconcile-lib/deadlock-active? deadlock)
      (let [ahead (or (:ahead deadlock) 0)
            behind (or (:behind deadlock) 0)
            reason (or (:reason deadlock) "diverged")
            marked (master-main-reconcile-lib/normalize-overlapping-paths
                    (or (:overlapping_paths deadlock) (:overlapping-paths deadlock)))
            overlapping-paths
            (if (seq marked)
              marked
              (when (= "dirty" (str reason))
                (try
                  (let [{:keys [exit out]} (sh! "git" "-C" (str project-root) "status" "--porcelain")
                        dirty (if (zero? exit)
                                (master-main-reconcile-lib/porcelain-lines->paths out)
                                #{master-main-reconcile-lib/unknown-dirty-marker})
                        merge-changed
                        (if (pos? behind)
                          (let [{:keys [exit out]} (sh! "git" "-C" (str project-root)
                                                         "merge-base" "HEAD" "origin/main")]
                            (if (zero? exit)
                              (let [base (str/trim out)
                                    {:keys [exit out]} (sh! "git" "-C" (str project-root)
                                                             "diff" "--name-only" base "origin/main")]
                                (if (zero? exit)
                                  (into #{} (remove str/blank?) (str/split-lines out))
                                  #{master-main-reconcile-lib/unknown-dirty-marker}))
                              #{master-main-reconcile-lib/unknown-dirty-marker}))
                          #{})]
                    (vec (master-main-reconcile-lib/overlapping-paths dirty merge-changed)))
                  (catch Exception _ []))))]
        {:deadlock-active? true :ahead ahead :behind behind :reason reason
         :overlapping-paths (or overlapping-paths [])})
      {:deadlock-active? false})))
;; ── pause + rotate-note gathering ─────────────────────────────────────────

(defn read-pause []
  (let [f (fs/path state-dir "operator" "control-pause.json")]
    (if (fs/exists? f)
      (let [obj (try (json/parse-string (slurp (str f)) true) (catch Exception _ nil))]
        {:active? (boolean (:active obj)) :until-ms (:untilMs obj)})
      {:active? false :until-ms nil})))

(defn active-role-marker-mtime-ms []
  (let [f (fs/path state-dir "mono-router-active-role")]
    (when (fs/exists? f) (fs/file-time->millis (fs/last-modified-time f)))))

(defn active-role-marker []
  (let [f (fs/path state-dir "mono-router-active-role")]
    (when (fs/exists? f) (str/trim (slurp (str f))))))

(def rotate-pattern #"rotate_to_role\.sh ([A-Za-z]+)|[Rr]otate to ([A-Za-z]+)")

(defn newest-rotate-note []
  (let [now (now-ms)
        four-hours-ms (* 4 60 60 1000)
        candidates (concat (glob-handoffs "inbox/completed/*.handoff")
                           (glob-handoffs "inbox/done/*.handoff"))]
    (->> candidates
         (keep (fn [p]
                 (let [mtime-ms (fs/file-time->millis (fs/last-modified-time p))]
                   (when (<= (- now mtime-ms) four-hours-ms)
                     (let [content (try (slurp p) (catch Exception _ ""))
                           m (re-find rotate-pattern content)]
                       (when m
                         {:path p :mtime-ms mtime-ms
                          :target (or (nth m 1 nil) (nth m 2 nil))}))))))
         (sort-by :mtime-ms >)
         first)))

(defn gather-rotate-note []
  (when-let [{:keys [path mtime-ms target]} (newest-rotate-note)]
    (let [active-role-file-mtime (active-role-marker-mtime-ms)]
      {:note-name (fs/file-name path)
       :note-target target
       :note-age-min (quot (- (now-ms) mtime-ms) 60000)
       :grace-min rotate-grace-min
       :note-mtime-ms mtime-ms
       :active-role-file-mtime-ms (or active-role-file-mtime 0)
       :active-role (or (active-role-marker) "")})))

;; ── BL-685: resident-stranded gathering (Class B - no rotate note) ────────
;; Every read here is observable from OUTSIDE the resident's own turn
;; (invariant 1): the marker file + its mtime, mailbox contents on disk,
;; and a pending dispatch note. Nothing depends on the stranded resident
;; having run anything - that absence IS the defect being detected.

(defn resident-home-role
  "The mono-router resident's home identity: the first non-coordinator role
   in roles.tsv order - the same derivation mono_router_lib/classify-role
   uses for :resident, extracted from the rows this sweep already parsed
   (never a second roles.tsv read)."
  [ordered-roles]
  (first (remove #(= "coordinator" %) ordered-roles)))

(defn resident-mailbox-empty?
  "Whether the ACTIVE role's inbox (new + in_process) holds nothing - the
   role the resident is currently stuck AS, resolved over both mailbox
   shapes via the same owning-role machinery the stuck-parcel gather uses
   (worktree roles flat, master-resident roles nested)."
  [active-role]
  (when active-role
    (not-any? #(= active-role (owning-role-for-path %))
              (concat (glob-handoffs "{,**/}inbox/new/*.handoff")
                      (glob-handoffs "{,**/}inbox/in_process/*.handoff")))))

(defn dispatch-note-pending?
  "Whether a `type: note` FROM the active role is sitting unresolved in the
   coordinator's inbox (new or in_process) - the mono-router idle protocol's
   own 'ask the coordinator to promote+route, then idle for a wake'. A
   resident that already asked is waiting, not stranded."
  [active-role]
  (when active-role
    (boolean
     (some (fn [p]
             (when (= "coordinator" (owning-role-for-path p))
               (let [content (try (slurp p) (catch Exception _ ""))]
                 (and (re-find #"(?m)^type: note$" content)
                      (re-find (re-pattern (str "(?m)^from: " active-role "$")) content)))))
           (concat (glob-handoffs "{,**/}inbox/new/*.handoff")
                   (glob-handoffs "{,**/}inbox/in_process/*.handoff"))))))

;; ── nudge-dedup persisted state ───────────────────────────────────────────

;; BL-631: NEVER keywordize (no `true` third arg) - write-dedup-state!
;; persists a finding-:key-keyed map whose keys are plain STRINGS (every
;; check-* fn builds :key via (str ...), never a keyword), and
;; decide-nudges's own due? looks values up by that same string. Parsing
;; back with keywordize-keys silently turns "pipeline-code-on-main-<sha>"
;; into the keyword :pipeline-code-on-main-<sha>, which a string lookup can
;; never match - confirmed directly: write-dedup-state!'s own
;; json/generate-string output, round-tripped through the old `true` flag,
;; makes (get reloaded "any-real-key") return nil unconditionally. That
;; silently broke EVERY check's nudge dedup, not just this ticket's own
;; (BL-631's own scenario 05/06 require it to actually work) - pre-existing
;; since BL-611, found and fixed here because this ticket's acceptance
;; criteria cannot pass against a dedup layer that never dedupes.
(defn read-dedup-state []
  (if (fs/exists? dedup-file)
    (try (json/parse-string (slurp (str dedup-file))) (catch Exception _ {}))
    {}))

(defn write-dedup-state! [m]
  (fs/create-dirs babysitterd-dir)
  (spit (str dedup-file) (json/generate-string m)))

(defn read-escalation-dedup-state []
  (if (fs/exists? escalation-dedup-file)
    (try (json/parse-string (slurp (str escalation-dedup-file))) (catch Exception _ {}))
    {}))

(defn write-escalation-dedup-state! [m]
  (fs/create-dirs babysitterd-dir)
  (spit (str escalation-dedup-file) (json/generate-string m)))

(defn enqueue-operator-escalation! [finding]
  (let [event (operator-lib/babysitter-escalation-event finding)
        script (fs/path script-dir "operator_enqueue_event.bb")]
    (process/shell {:dir (str project-root) :extra-env {"OPERATOR_EVENTS_LOCK_MAX_WAIT_MS" "5000"}}
                     "bb" (str script) (str project-root) (json/generate-string event))))

;; ── BL-1017: bounded session-repair state + execution ─────────────────────

;; BL-631's warning applies here verbatim: NEVER keywordize on the way back
;; in. This map is keyed by roles.tsv role NAMES (plain strings), and the
;; sweep looks them up with (get state role) using that same string. Parsing
;; with keywordize-keys would turn "specifier" into :specifier, every lookup
;; would miss, every role would read as never-repaired, and the cooldown that
;; invariant 2 rests on would silently never engage.
(defn read-repair-state []
  (if (fs/exists? repair-file)
    (try (json/parse-string (slurp (str repair-file))) (catch Exception _ {}))
    {}))

(defn write-repair-state! [m]
  (fs/create-dirs babysitterd-dir)
  (spit (str repair-file) (json/generate-string m)))

(defn read-control-plane-ensure-state []
  (if (fs/exists? control-plane-ensure-file)
    (try (json/parse-string (slurp (str control-plane-ensure-file)))
         (catch Exception _ {}))
    {}))

(defn write-control-plane-ensure-state! [m]
  (fs/create-dirs babysitterd-dir)
  (spit (str control-plane-ensure-file) (json/generate-string m)))

(def control-plane-ensure-timeout-ms
  "BL-1071 invariant 2: `./swarm ensure` is bounded in WALL CLOCK, not only in
   attempts. The attempt budget (session-repair-allowed?) stops a recovery
   being retried forever; it says nothing about one that never returns, and an
   ensure that hangs holds the sweep open so the next tick never happens. A
   babysitter that is stuck is indistinguishable from one that is not running,
   which is the incident's own shape.

   The env seam is the one engineering.prompt sanctions (daemon wiring tests
   override hardcoded timeouts via env seams). It moves a deadline; it cannot
   disable the recovery."
  (or (some-> (System/getenv "BABYSITTER_ENSURE_TIMEOUT_MS") str/trim parse-long)
      (* 5 60 1000)))

;; BL-1103: local name kept at the ensure call site; body lives in
;; bounded_run_lib.bb (the hand-copy of expedite's runner is gone).
(defn run-bounded! [& args]
  (apply bounded-run-lib/run-bounded! args))

(defn- ensure-output-tail
  "The last few lines the ensure wrote, for the REPAIR line. Reads the files
   run-bounded! redirected to; missing or unreadable reads as empty rather
   than throwing, because a tail is never worth failing a sweep over."
  [out-file err-file]
  (let [read-one (fn [f] (or (try (when (fs/exists? f) (slurp (str f))) (catch Exception _ nil)) ""))
        combined (str (read-one out-file)
                      (let [e (read-one err-file)] (when (seq e) (str "\n" e))))]
    (str/join "\n" (take-last 12 (str/split-lines combined)))))

(defn run-control-plane-ensure!
  "BL-958 response-policy :recover — babysitterd owns `./swarm ensure`.
   Never load-file swarm_ensure.bb (it System/exit's).

   BL-1071 review goal 1: this used to check BABYSITTER_FAKE_ENSURE_RESULT
   FIRST and, when set, fabricate a result instead of recovering. That is the
   `*_FORCE_RESULT` env bypass engineering.prompt names, sitting in production
   code on the recovery path - anything setting it in a real environment
   silently disabled the auto-heal this whole ticket exists to deliver, which
   is the same class of silent blackout as the incident. It is gone. The
   wiring test now puts a fixture `./swarm` in its own project root instead,
   so the real spawn, the real bound and the real exit handling all run and
   only the target script is a stand-in."
  []
  (fs/create-dirs babysitterd-dir)
  (let [out-file (fs/path babysitterd-dir "control-plane-ensure.out")
        err-file (fs/path babysitterd-dir "control-plane-ensure.err")
        {:keys [exit timed-out?]} (run-bounded! {:dir (str project-root)}
                                                control-plane-ensure-timeout-ms
                                                out-file err-file
                                                "bash" "./swarm" "ensure")]
    (if timed-out?
      {:exit nil :timed-out? true :timeout-ms control-plane-ensure-timeout-ms
       :tail (str "no result within " control-plane-ensure-timeout-ms "ms — the recovery was"
                  " left unfinished and its process group killed; the plane is NOT known repaired")}
      {:exit (long (or exit 1)) :timed-out? false :tail (ensure-output-tail out-file err-file)})))

;; The daemon's existing single-role launch path, mirroring
;; swarm_ensure.bb/ensure-standing-role!: create the session if it is missing,
;; then respawn the role's canonical launch script into it. Always the
;; project-root .swarmforge/launch/<role>.sh - never a worktree-local copy,
;; which can drift and which once left one session running another role's
;; script after a bad repair (handoffd.bb/do-respawn! carries the same note).
;;
;; Scope: this recreates ONE session. It is deliberately not start-swarm.sh,
;; whose eight-session sweep is the disproportionate action this ticket exists
;; to avoid.
;; BL-1018: WHAT to run is resolved by single-role-repair-lib (pure, one
;; definition, shared with swarm_ensure.bb) and only RUN here. The old shape -
;; bare create, sleep, then respawn-pane into it - is the exact sequence that
;; took the whole pack tmux server down on 2026-08-21; a missing session is now
;; created WITH its command and never respawned into.
(defn ensure-role-session! [socket role session]
  (let [launch-script (fs/path state-dir "launch" (str role ".sh"))
        {:keys [status commands]}
        (single-role-repair-lib/resolve-single-role-repair
         {:socket socket
          :role role
          :session session
          ;; An absent launch script is a refusal, not a repair against a
          ;; script that is not there - checked here because existence is I/O.
          :launch-script (when (fs/exists? launch-script) (str launch-script))
          :env-args (provider-respawn-env-lib/provider-respawn-env-args (str state-dir) role)
          :session-present? (pane-exists? socket session)})]
    (if (not= :ok status)
      (if (= :no-launch-script status)
        {:status status :detail (str launch-script)}
        {:status status})
      (let [r (reduce (fn [_ cmd] (apply sh! cmd)) nil commands)]
        (if (zero? (:exit r))
          {:status :repaired}
          {:status :failed :detail (str/trim (str (:err r)))})))))

(defn read-streak []
  (if (fs/exists? streak-file)
    (or (parse-long (str/trim (slurp (str streak-file)))) 0)
    0))

(defn write-streak! [n]
  (fs/create-dirs babysitterd-dir)
  (spit (str streak-file) (str n "\n")))

;; ── main ──────────────────────────────────────────────────────────────────

(defn -main []
  (let [socket (read-tmux-socket)
        role-rows (parse-roles-tsv)
        ps-output (ps-snapshot)
        roles (mapv (partial gather-role socket ps-output) role-rows)
        busy-by-role (into {} (map (juxt :role :busy?) roles))
        any-pane-busy? (boolean (some :busy? roles))
        pause (read-pause)
        claim-risks (try (babysitter-assess-lib/scan-claim-risks project-root)
                          (catch Exception _ []))
        ;; BL-631: an unexpected exception anywhere in the resolution chain
        ;; (e.g. bash/git genuinely missing) fails closed to unavailable,
        ;; same posture as every explicit git-failure branch inside the
        ;; gatherer itself - never a silent [] that would read as clean.
        ;; BL-1086: the CACHED gather - the required_wiring anchor's own
        ;; warning is that a cache which exists while this line still calls the
        ;; uncached walk is the defect repeated with extra code.
        pipeline-code-on-main (try (gather-pipeline-code-on-main-cached)
                                    (catch Exception _ {:offending-commits [] :ancestry-unavailable? true}))
        main-sync-deadlock (try (gather-main-sync-deadlock)
                                (catch Exception _ {:deadlock-active? false}))
        ;; BL-804: resolve topology ONCE per sweep, then stamp each role's
        ;; :should-stand? — the sweep lib's check-live-session only ever sees
        ;; the resolved boolean, never a role name, so suppression can never
        ;; be hardcoded per role (invariant 1).
        rotation-router? (rotation-router-mode?)
        ordered-roles (mapv :role role-rows)
        resident-home (resident-home-role ordered-roles)
        ;; BL-1345: the marker is a ROTATION-ROUTER cache, and this was the
        ;; third consumer that never got BL-1020's rule - it read the file
        ;; unconditionally, so on a standing pack the sweep reasoned about a
        ;; resident that does not exist, named by a file nobody clears. It
        ;; goes through the same shared decision the RC-repair hotfix uses
        ;; (195de28861), rather than a fourth copy of the mode check.
        resident-decision (mono-router-lib/resolve-resident-role
                           {:rotation-router? rotation-router?
                            :recorded-role (active-role-marker)
                            :home-role resident-home})
        ;; nil, not the home role, when the marker must not be honoured: every
        ;; consumer below asks "which role is the resident RIGHT NOW", and on a
        ;; standing pack the answer is none. Handing them home-role here would
        ;; swap one fiction for another.
        ;; Invariant 3: an absent, unreadable or UNKNOWN-role marker reaches
        ;; the same conclusions as no marker at all. resolve-resident-role
        ;; honours any non-blank value on a router pack (it is a cache of a
        ;; role this swarm rotates through), so "is this actually one of our
        ;; roles" is asked here, against the pack's own roles - never against
        ;; a hardcoded list (BL-804 invariant 1).
        resident-active-role (let [candidate (when (:honour-marker? resident-decision)
                                               (:role resident-decision))]
                               (when (some #(= candidate %) ordered-roles) candidate))
        ;; BL-1017: the same per-role stamping pass carries the persisted
        ;; repair budget in, so check-live-session decides the bound purely
        ;; (no clock read, no fs, inside the testability boundary) while this
        ;; gatherer owns reading it. now-ms is resolved ONCE for the sweep so
        ;; every role is bounded against the same instant.
        repair-state (read-repair-state)
        sweep-now-ms (now-ms)
        roles (mapv #(let [prior (get repair-state (:role %))]
                       (assoc % :should-stand?
                                (should-stand-role? rotation-router? ordered-roles (:role %))
                                :now-ms sweep-now-ms
                                :last-repair-ms (get prior "last-ms")
                                :repair-attempts (get prior "attempts" 0)))
                    roles)
        session-by-role (into {} (map (juxt :role :session) role-rows))
        ;; BL-958: observe the control plane through the SAME lib status/ensure
        ;; use, so babysitterd can own the prescribed ./swarm ensure recovery.
        ;; BL-1071 invariant 1: a throwing observer must not abort the sweep.
        ;; BL-1071 invariant 3: nor may it vanish. `classify` returns only
        ;; :up / :control-plane-missing / :down, so :unavailable is
        ;; unambiguous - it means the observation could not be made - and
        ;; check-control-plane reports it. The old :unknown produced no
        ;; finding at all, so the sweep printed "OK all checks green" while
        ;; knowing nothing about the plane.
        cp-observe (try (control-plane-lib/observe! (str state-dir) socket)
                        (catch Exception e
                          {:classification :unavailable
                           :error (or (.getMessage e) (str (class e)))}))
        cp-ensure-state (read-control-plane-ensure-state)
        cp-prior (get cp-ensure-state "control-plane")
        cp-repair-allowed? (babysitterd-sweep-lib/session-repair-allowed?
                            {:now-ms sweep-now-ms
                             :last-repair-ms (get cp-prior "last-ms")
                             :repair-attempts (get cp-prior "attempts" 0)})
        snapshot
        {:now-ms (now-ms)
         :roles (mapv #(dissoc % :pane-text) roles)
         :handoffd-alive? (proc-alive? "handoffd\\.bb")
         :handoffd-supervisor-alive? (proc-alive? "handoffd_supervisor\\.bb")
         :handoffd-log-age-secs (file-age-secs (fs/path state-dir "daemon" "handoffd.log"))
         :handoffd-max-age-secs heartbeat-max-secs
         :failed-count (count-failed-box)
         :stuck-parcels (stuck-parcels busy-by-role)
         ;; BL-802: nil (truly unavailable) flows through unmasked — no
         ;; fabricated default that would silently suppress a real low-memory
         ;; finding. check-memory-floor reports UNAVAILABLE on nil.
         :available-mb (available-mem-mb)
         :mem-floor-mb mem-floor-mb
         :claim-risks claim-risks
         :control-plane-classification (:classification cp-observe)
         :control-plane-error (:error cp-observe)
         :launch-scripts-present? (boolean
                                   (try (control-plane-lib/launch-scripts-present? (str state-dir))
                                        (catch Exception _ false)))
         :control-plane-repair-allowed? cp-repair-allowed?
         :socket-path socket
         :rotate-note (gather-rotate-note)
         :pause pause
         :active-ticket-count (count (fs/glob (fs/path project-root "backlog" "active") "*.yaml"))
         :any-pane-busy? any-pane-busy?
         :prev-streak (read-streak)
         :pending-claims (pending-claims)
         :in-process-claims (in-process-claims busy-by-role)
         :pending-max-age-min pending-max-age-min
         :offending-commits (:offending-commits pipeline-code-on-main)
         :ancestry-unavailable? (:ancestry-unavailable? pipeline-code-on-main)
         ;; BL-685 required_wiring: :resident-active-role is a TOP-LEVEL
         ;; snapshot key read straight off the marker file - NEVER via
         ;; gather-rotate-note, whose map is nil in exactly the Class B
         ;; case (no rotate note exists) this check exists to detect.
         :rotation-router? rotation-router?
         :rotation-home resident-home
         :resident-active-role resident-active-role
         :resident-active-role-mtime-ms (active-role-marker-mtime-ms)
         :resident-pane-busy? (boolean (get busy-by-role resident-home))
         :resident-mailbox-empty? (resident-mailbox-empty? resident-active-role)
         :dispatch-note-pending? (dispatch-note-pending? resident-active-role)
         :deadlock-active? (:deadlock-active? main-sync-deadlock)
         :ahead (:ahead main-sync-deadlock)
         :behind (:behind main-sync-deadlock)
         :reason (:reason main-sync-deadlock)
         :overlapping-paths (:overlapping-paths main-sync-deadlock)}
        {:keys [findings new-streak repairs]} (babysitterd-sweep-lib/assemble-findings snapshot)
        ts (now-iso)]
    (write-streak! new-streak)
    ;; BL-1017 required_wiring: the repair decision is ACTED ON here, in the
    ;; live sweep, not merely returned by the lib. A decision nobody consumes
    ;; is the BL-419 shape this ticket's own required_wiring names.
    ;;
    ;; The CRIT for each repaired role is still printed below, unconditionally
    ;; - a repair never swallows its alert, because a session that keeps
    ;; vanishing is the signal worth keeping (qa_e2e_procedure step 2).
    (when (seq repairs)
      (let [cp-repairs (filter #(= :ensure-control-plane (:action %)) repairs)
            role-repairs (filter #(= :ensure-session (:action %)) repairs)]
        ;; BL-958: whole-plane recovery first (./swarm ensure). Per-role
        ;; ensure-session repairs are already suppressed in assemble-findings
        ;; when this fires; the filter keeps the executor honest if that
        ;; suppression ever regresses.
        (doseq [_ cp-repairs]
          (let [result (run-control-plane-ensure!)
                ;; BL-1071 invariant 2: THREE outcomes, not two. A recovery
                ;; that never returned is not a failure (nothing said no) and
                ;; emphatically not a repair - reporting it as either would
                ;; claim knowledge the sweep does not have. "unfinished" is
                ;; the honest third answer, and it is what scenario 03 gates.
                status (cond
                         (:timed-out? result) "unfinished"
                         (zero? (long (or (:exit result) 1))) "repaired"
                         :else "failed")]
            (println (str ts " REPAIR [" status
                          "] control-plane — ./swarm ensure"
                          (when-let [t (:tail result)]
                            (when (seq (str/trim t)) (str "\n" t)))))
            (write-control-plane-ensure-state!
             (babysitterd-sweep-lib/note-repair-attempt
              cp-ensure-state "control-plane" sweep-now-ms
              babysitterd-sweep-lib/default-repair-cooldown-ms))))
        (when (seq role-repairs)
          (let [new-repair-state
                (reduce (fn [st {:keys [role]}]
                          (let [session (get session-by-role role)
                                result (ensure-role-session! socket role session)]
                            (println (str ts " REPAIR [" (name (:status result)) "] swarmforge-" role
                                          (when-let [d (:detail result)] (str " — " d))))
                            (babysitterd-sweep-lib/note-repair-attempt st role sweep-now-ms
                                                 babysitterd-sweep-lib/default-repair-cooldown-ms)))
                        repair-state
                        role-repairs)]
            (write-repair-state! new-repair-state)))))
    (if (empty? findings)
      (println (str ts " " (babysitterd-sweep-lib/format-all-clear-line
                            {:pause-active? (:active? pause)
                             :pause-until-ms (:until-ms pause)})))
      (doseq [f findings]
        (println (babysitterd-sweep-lib/format-finding-line f ts))))
    (when nudge?
      (when (seq findings)
        (let [dedup-state (read-dedup-state)
              escalation-dedup (read-escalation-dedup-state)
              now (now-ms)
              nudge-opts {:last-nudged-ms-by-key dedup-state :now-ms now :cooldown-ms nudge-cooldown-ms}
              {:keys [to-nudge new-dedup-state]}
              (babysitterd-sweep-lib/decide-nudges findings nudge-opts)
              {:keys [to-escalate new-escalation-dedup-state]}
              (babysitterd-sweep-lib/decide-escalations findings
                                                         {:last-escalated-ms-by-key escalation-dedup
                                                          :now-ms now
                                                          :cooldown-ms nudge-cooldown-ms})]
          (doseq [f to-escalate]
            (try
              (enqueue-operator-escalation! f)
              (println (str ts " ESCALATED operator: [" (:key f) "] " (:message f)))
              (catch Exception e
                (println (str ts " ESCALATE-FAILED [" (:key f) "] " (.getMessage e))))))
          (when (seq to-escalate)
            (write-escalation-dedup-state! new-escalation-dedup-state))
          (when (seq to-nudge)
            (let [message (babysitterd-sweep-lib/format-nudge-message to-nudge)
                  result (babysitter-nudge-lib/nudge-resident! project-root "coordinator" message)]
              (case (:status result)
                :nudged (do (write-dedup-state! new-dedup-state)
                            (println (str ts " NUDGED coordinator: " (count to-nudge) " finding(s)")))
                :skip-busy (println (str ts " NUDGE-SKIP coordinator busy — " (:detail result)))
                :no-target (println (str ts " NUDGE-SKIP " (:detail result)))
                (println (str ts " NUDGE-FAILED " (:detail result)))))))))
    (System/exit 0)))

;; Run only when invoked as the script itself - load-file from a test runner
;; (BL-962's unit/property runners exercise the pure adjudication core) must
;; never fire a real sweep.
(when (= *file* (System/getProperty "babashka.file"))
  (-main))
