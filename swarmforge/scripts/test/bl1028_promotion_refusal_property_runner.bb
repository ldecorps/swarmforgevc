#!/usr/bin/env bb
;; BL-1028 property test (coder-authored, two DECLARED invariants) over
;; promote_and_route_next.sh's refusal path.
;;
;;   Invariant 1: "A promotion never produces a commit that the integrity CLI
;;   refused - FOR ANY REFUSAL REASON, PRESENT AND FUTURE, including ones
;;   added after this ticket."
;;
;;   Invariant 2: "A promotion that does not commit leaves the index exactly
;;   as it found it - no rename it staged itself survives the call."
;;
;; Invariant 1's own wording is what makes a property test the right encoding
;; rather than a table of cases: the claim is explicitly about reasons that do
;; not exist yet. A fix that enumerated today's five (:no-git-dir,
;; :lock-timeout, :add-failed, :commit-failed, :verify-mismatch) plus the
;; close-guard rejection would satisfy every example in the feature file and
;; still break the invariant the day a sixth is added. So the generator draws
;; NOVEL reason names, and the shapes a future refusal might arrive in.
;;
;; REACH, asserted rather than hoped for (BL-654's generator-reach clause).
;; The refusal SHAPES matter more than the reason strings, and drawing a
;; reason uniformly reaches only one of them:
;;
;;   - :success-false, the documented shape - JSON on stdout AND a
;;     `FAILED (reason)` line on stderr.
;;   - close-guard, which exits BEFORE commit-with-integrity! runs and so
;;     prints no JSON at all. A reason parser reading only stdout reports
;;     `unknown` here, and one reading only stderr's FAILED line reports
;;     nothing.
;;   - silent - exit non-zero with no output whatsoever. Not a shape the CLI
;;     produces today; it is what a crashed or truncated CLI looks like, and
;;     the invariant says "never produces a commit that the CLI refused",
;;     not "never, when the CLI explained itself".
;;   - malformed JSON, the shape a partially-written stdout produces.
;;   - a non-1 exit code (2, 3, 127 - `command not found` is 127), because
;;     `||` catches any non-zero and a fix keying on `-eq 1` would not.
;;
;; Each shape is injected at a fixed rate with a floored reach; a uniform draw
;; over reason STRINGS would leave four of the five at zero.
;;
;; Non-vacuity PROVEN at authoring time (2026-08-22), each break restored:
;;   - answer the refusal with a raw `git add` + `git commit` ......... P1
;;   - obey the refusal but skip rollback_promotion .................. P2
;;   - key the refusal branch on `INTEGRITY_RC -eq 1` ................ P1, P2 (exit-code shapes only)
;;   - blanket `git reset` instead of the scoped index restore ....... P3

(ns bl1028-promotion-refusal-property-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as p]
            [clojure.string :as str]))

(def scripts-dir (fs/parent (fs/parent (fs/canonicalize *file*))))
(def helper (str (fs/path scripts-dir "promote_and_route_next.sh")))
(def ticket "BL-9028-fixture-ticket.yaml")

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 30))
(def failures (atom []))
(def coverage (atom {:success-false 0 :close-guard 0 :silent 0 :malformed 0
                     :exotic-exit 0 :novel-reason 0 :known-reason 0
                     :control-commit 0}))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) (max 1 n)) (step s)])

(defn- git [root & args]
  (apply p/shell {:out :string :err :string :continue true} "git" "-C" (str root) args))

(defn- git-out [root & args] (str/trim (:out (apply git root args))))

(def known-reasons ["no-git-dir" "lock-timeout" "add-failed" "commit-failed" "verify-mismatch"])
;; "reasons added after this ticket" - names the fix cannot have been written
;; against, which is the half of invariant 1 an examples table cannot reach.
(def novel-reasons ["quota-exhausted" "worktree-locked" "signature-required"
                    "hook-rejected" "shallow-clone-refused" "index-version-unsupported"])

(defn- make-fixture!
  "A repo with one eligible paused ticket, committed, and a clean index."
  [root]
  (fs/create-dirs root)
  (git root "init" "-q")
  (git root "config" "user.email" "test@test")
  (git root "config" "user.name" "test")
  (git root "commit" "-q" "--allow-empty" "-m" "init")
  (doseq [d ["backlog/paused" "backlog/active" "specs/features" "swarmforge/scripts"]]
    (fs/create-dirs (fs/path root d)))
  (fs/copy helper (fs/path root "swarmforge/scripts/promote_and_route_next.sh") {:replace-existing true})
  ;; promotion_gates (BL-663) and its whole load-file chain must travel with
  ;; the copy, or the gate throws on load and the script reports "no eligible
  ;; paused ticket" - which would look like a promotion decision, not a
  ;; broken fixture, and every property below would pass vacuously.
  (doseq [dep ["promotion_gates_cli.bb" "promotion_gates_lib.bb" "backlog_depth_lib.bb"
               "swarm_identity_lib.bb" "daemon_cycle_guard_lib.bb"]]
    (fs/copy (fs/path scripts-dir dep) (fs/path root "swarmforge/scripts" dep) {:replace-existing true}))
  (spit (str (fs/path root "swarmforge/swarmforge.conf")) "config active_backlog_max_depth 5\n")
  (spit (str (fs/path root "swarmforge/scripts/route_backlog_to_coder.sh"))
        "#!/usr/bin/env bash\nset -euo pipefail\nprintf '%s\\n' \"$1\" >> \"${ROUTE_LOG:?}\"\n")
  (fs/set-posix-file-permissions (fs/path root "swarmforge/scripts/route_backlog_to_coder.sh") "rwxr-xr-x")
  (fs/set-posix-file-permissions (fs/path root "swarmforge/scripts/promote_and_route_next.sh") "rwxr-xr-x")
  (spit (str (fs/path root "backlog/paused" ticket))
        "id: BL-9028\ntitle: \"fixture ticket\"\nstatus: paused\npriority: 1\nassigned_to:\n")
  (spit (str (fs/path root "specs/features/BL-9028-fixture-ticket.feature")) "")
  (git root "add" "backlog" "specs" "swarmforge")
  (git root "commit" "-q" "-m" "fixture paused backlog"))

(defn- install-cli! [root body]
  (let [cli (fs/path root "swarmforge/scripts/commit_integrity_cli.bb")]
    (spit (str cli) body)
    (fs/set-posix-file-permissions cli "rwxr-xr-x")
    ;; Committed, never left untracked: an untracked stub would show up in
    ;; `status --porcelain` and the index comparison would measure this
    ;; harness rather than the script.
    (git root "add" "--" "swarmforge/scripts/commit_integrity_cli.bb")
    (git root "commit" "-q" "-m" "fixture: stub cli")))

(defn- refusing-body
  "One generated refusal shape. `shape` decides what the CLI prints; `code`
   what it exits with."
  [shape reason code]
  (str "#!/usr/bin/env bb\n"
       (case shape
         :success-false (str "(println \"{\\\"success\\\":false,\\\"reason\\\":\\\"" reason
                             "\\\",\\\"attempts\\\":3}\")\n"
                             "(binding [*out* *err*] (println \"commit_integrity_cli: FAILED ("
                             reason ") after 3 attempt(s)\"))\n")
         :close-guard (str "(binding [*out* *err*] (println \"commit_integrity_cli: CLOSE BLOCKED for BL-9028 ("
                           reason ").\"))\n")
         :silent ""
         :malformed "(println \"{\\\"success\\\":fal\")\n")
       "(System/exit " code ")\n"))

(def accepting-body
  (str "#!/usr/bin/env bb\n"
       "(require '[babashka.process :as p])\n"
       "(let [args (vec *command-line-args*)\n"
       "      root (first args)\n"
       "      msg (second (drop-while #(not= \"--message\" %) args))\n"
       "      paths (keep-indexed (fn [i a] (when (= \"--path\" a) (get args (inc i)))) args)]\n"
       "  (doseq [path paths]\n"
       "    (p/shell {:continue true :out :string :err :string} \"git\" \"-C\" root \"add\" \"-A\" \"--\" path))\n"
       "  (p/shell {:out :string :err :string} \"git\" \"-C\" root \"commit\" \"-q\" \"-m\" msg)\n"
       "  (println \"{\\\"success\\\":true,\\\"attempts\\\":1}\"))\n"))

(defn- run-promotion [root log]
  (p/shell {:out :string :err :string :continue true :dir (str root)
            :extra-env {"ROUTE_LOG" (str log) "SWARMFORGE_SKIP_DAEMON" "1"
                        "SWARMFORGE_ROLE" "coordinator"}}
           "bash" (str (fs/path root "swarmforge/scripts/promote_and_route_next.sh"))))

(def tmp-root (fs/create-temp-dir {:prefix "bl1028-property-"}))

(try
  ;; ── Control: the harness CAN observe a promotion commit. Without this,
  ;; every "no commit was created" assertion below could be passing because
  ;; the fixture never promotes anything at all.
  (let [root (fs/path tmp-root "control")
        log (str (fs/path tmp-root "control.log"))]
    (make-fixture! root)
    (install-cli! root accepting-body)
    (let [before (git-out root "rev-parse" "HEAD")
          {:keys [exit]} (run-promotion root log)
          after (git-out root "rev-parse" "HEAD")]
      (if (and (zero? exit) (not= before after)
               (fs/exists? (fs/path root "backlog/active" ticket)))
        (swap! coverage update :control-commit inc)
        (report! "P0 (control: an accepted promotion really does commit in this fixture)" 0 {}
                 (str "exit=" exit " head-moved=" (not= before after))))))

  ;; ── The refusal runs share ONE fixture: a refusal that behaves changes
  ;; nothing, so there is nothing to reset between runs - and if a run DOES
  ;; change something, the next run's own before-state assertion sees it.
  (let [root (fs/path tmp-root "refusals")
        log (str (fs/path tmp-root "refusals.log"))]
    (make-fixture! root)
    (loop [i 0 s 1028]
      (when (< i runs)
        (let [[shape-i s1] (gen-int s 10)
              [novel? s2] (gen-int s1 2)
              [ri s3] (gen-int s2 (count known-reasons))
              [ni s4] (gen-int s3 (count novel-reasons))
              [code-i s5] (gen-int s4 8)
              shape (case shape-i
                      0 :close-guard
                      1 :silent
                      2 :malformed
                      :success-false)
              reason (if (zero? novel?) (nth novel-reasons ni) (nth known-reasons ri))
              ;; `||` catches ANY non-zero, so a fix keying on `-eq 1` must
              ;; be caught. 127 is `command not found`.
              code (case code-i 0 2, 1 3, 2 127, 1)]
          (swap! coverage update shape inc)
          (swap! coverage update (if (zero? novel?) :novel-reason :known-reason) inc)
          (when (not= 1 code) (swap! coverage update :exotic-exit inc))

          (install-cli! root (refusing-body shape reason code))
          (let [before-head (git-out root "rev-parse" "HEAD")
                before-index (git-out root "status" "--porcelain")
                {:keys [exit out err]} (run-promotion root log)
                after-head (git-out root "rev-parse" "HEAD")
                after-index (git-out root "status" "--porcelain")
                input {:shape shape :reason reason :exit-code code}]

            ;; ── P1 (invariant 1): no commit, for ANY refusal reason or shape.
            (when (not= before-head after-head)
              (report! "P1 (invariant 1: a refused promotion never produces a commit)" s input
                       (str "HEAD moved to " (git-out root "log" "--oneline" "-1"))))
            (when (zero? exit)
              (report! "P1 (invariant 1: a refused promotion reports failure)" s input
                       (str "exit=0; stdout=" (pr-str out) " stderr=" (pr-str err))))

            ;; ── P2 (invariant 2): the index is exactly as it was found.
            (when (not= before-index after-index)
              (report! "P2 (invariant 2: a promotion that does not commit leaves the index as it found it)" s input
                       (str "before=" (pr-str before-index) " after=" (pr-str after-index))))
            (when-not (fs/exists? (fs/path root "backlog/paused" ticket))
              (report! "P2 (invariant 2: the ticket stays at its paused path for the next attempt)" s input
                       "the paused file is gone"))
            (when (fs/exists? (fs/path root "backlog/active" ticket))
              (report! "P2 (invariant 2: no half-promoted file is left at the active path)" s input
                       "the active file exists"))

            ;; ── P3 (invariant 2's scoping half): this script runs in the
            ;; SHARED master checkout. A blanket `git reset` would satisfy
            ;; every assertion above and silently discard another role's
            ;; staged work, so the rollback is only correct if it is scoped.
            (let [other (str (fs/path root "other-role.txt"))]
              (spit other (str "staged by another role, run " i "\n"))
              (git root "add" "--" "other-role.txt")
              (let [staged-before (git-out root "status" "--porcelain" "--" "other-role.txt")]
                (run-promotion root log)
                (let [staged-after (git-out root "status" "--porcelain" "--" "other-role.txt")]
                  (when (not= staged-before staged-after)
                    (report! "P3 (invariant 2: the rollback is scoped to this promotion's own two paths)" s input
                             (str "another role's staged entry changed: " (pr-str staged-before)
                                  " -> " (pr-str staged-after))))))
              ;; Put the fixture back for the next run.
              (git root "rm" "-q" "--cached" "--" "other-role.txt")
              (fs/delete-if-exists other))
            (recur (inc i) s5))))))

  (doseq [[k floor] {:success-false 12 :close-guard 2 :silent 2 :malformed 2
                     :exotic-exit 6 :novel-reason 8 :known-reason 8 :control-commit 1}]
    (when (< (get @coverage k 0) floor)
      (swap! failures conj (str "FAIL coverage: the generator reached " k " only "
                                (get @coverage k 0) " time(s), floor " floor))))
  (finally
    (fs/delete-tree tmp-root)))

(if (seq @failures)
  (do (doseq [f @failures] (binding [*out* *err*] (println f)))
      (println (str "\n" (count @failures) " failure(s)"))
      (System/exit 1))
  (println (str "bl1028 promotion-refusal properties: " runs " runs, coverage " (pr-str @coverage)
                "\nALL PROPERTIES HOLD")))
