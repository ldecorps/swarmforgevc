#!/usr/bin/env bb
;; BL-1306: the two-call self-audit stored its challenge under the ROUTED
;; recipient but looked it up under the DRAFTED one, so a forward that
;; required_stages reroutes deleted its own standing challenge on every
;; invocation and could never queue - AUDIT_REQUIRED forever, with no number
;; of correct retries that works.
;;
;; swarm_handoff.bb calls (apply -main *command-line-args*) at load, so it
;; cannot be load-file'd for a unit test. This runner drives the real script
;; end to end instead: a fixture project root, a ticket whose required_stages
;; skips the drafted recipient, and two byte-identical invocations.

(ns bl1306-audit-reroute-test-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(def helper (str (fs/path script-dir ".." "swarm_handoff.bb")))

(def fails (atom 0))
(defn pass [msg] (println "PASS:" msg))
(defn fail [msg] (println "FAIL:" msg) (swap! fails inc))
(defn check [msg ok?] (if ok? (pass msg) (fail msg)))

(defn- sh! [dir & args]
  (let [{:keys [exit out err]} (apply process/sh {:dir (str dir) :continue true} args)]
    {:exit exit :out (str (or out "")) :err (str (or err ""))}))

(defn- fixture!
  "A project root the helper accepts: a git repo with one real commit, a
   ticket declaring required_stages, and the routing config enabled."
  [stages]
  (let [root (str (fs/create-temp-dir {:prefix "bl1306-audit-"}))]
    (sh! root "git" "init" "-q" "-b" "main" ".")
    (sh! root "git" "config" "user.email" "t@t")
    (sh! root "git" "config" "user.name" "t")
    (sh! root "git" "config" "commit.gpgsign" "false")
    (fs/create-dirs (fs/path root "backlog" "active"))
    (spit (str (fs/path root "backlog" "active" "BL-9306-fixture.yaml"))
          (str "id: BL-9306\n"
               "title: \"audit reroute fixture\"\n"
               "human_approval: approved\n"
               "required_stages: [" (str/join ", " stages) "]\n"))
    (fs/create-dirs (fs/path root "swarmforge"))
    (spit (str (fs/path root "swarmforge" "swarmforge.conf"))
          "config required_stages_routing_enabled true\n")
    ;; project-root resolves by finding .swarmforge/roles.tsv, and the roles
    ;; file is what makes a role name known. Every mailbox below lives inside
    ;; the fixture, so nothing reaches the live swarm.
    (fs/create-dirs (fs/path root ".swarmforge"))
    (spit (str (fs/path root ".swarmforge" "roles.tsv"))
          (str/join "\n"
                    (for [r ["coder" "cleaner" "architect" "hardender" "documenter" "QA" "coordinator" "specifier"]]
                      (str/join "\t" [r r root (str "swarmforge-" r) r "claude" "task" "off" "forward-only"]))))
    (doseq [r ["coder" "cleaner" "architect" "hardender" "documenter" "QA" "coordinator" "specifier"]]
      (fs/create-dirs (fs/path root ".swarmforge" "handoffs" "inbox" "new"))
      (fs/create-dirs (fs/path root ".swarmforge" "handoffs" "outbox")))
    (sh! root "git" "add" "-A")
    (sh! root "git" "commit" "-q" "-m" "BL-9306: fixture work")
    root))

(defn- draft! [root to commit]
  (let [p (str (fs/path root "handoff-draft.txt"))]
    (spit p (str "type: git_handoff\n"
                 "to: " to "\n"
                 "priority: 50\n"
                 "task: BL-9306-fixture\n"
                 "commit: " commit "\n"))
    p))

(defn- invoke [root draft]
  (let [{:keys [exit out err]}
        (apply process/sh {:dir root :continue true
                           :extra-env {"SWARMFORGE_ROLE" "coder"
                                       "SWARMFORGE_PROJECT_ROOT" root
                                       "SWARMFORGE_SKIP_SYNC_INJECT" "1"}}
               ["bb" helper draft])]
    {:exit exit :text (str (or out "") (or err ""))}))

(defn- head [root] (subs (str/trim (:out (sh! root "git" "rev-parse" "HEAD"))) 0 10))

(defn- queued?
  "Queued-ness is measured by what reached the mailbox, not by which of the
   helper's several success lines it printed - the wording depends on whether
   the tmux inject succeeded, which a fixture has no socket for."
  [root]
  (boolean (seq (concat (when (fs/exists? (fs/path root ".swarmforge" "handoffs" "outbox"))
                          (fs/list-dir (fs/path root ".swarmforge" "handoffs" "outbox")))
                        (when (fs/exists? (fs/path root ".swarmforge" "handoffs" "inbox" "new"))
                          (fs/list-dir (fs/path root ".swarmforge" "handoffs" "inbox" "new")))))))

;; ── the defect: a rerouted forward never queues ──────────────────────────
;; required_stages [coder, qa] skips cleaner, so a coder drafting to: cleaner
;; is routed to qa. Before the fix, BOTH calls printed AUDIT_REQUIRED.
(let [root (fixture! ["coder" "qa"])
      d (draft! root "cleaner" (head root))
      first-call (invoke root d)
      second-call (invoke root d)]
  (check "BL-1306: the first invocation challenges"
         (str/includes? (:text first-call) "AUDIT_REQUIRED"))
  (check "BL-1306: the first invocation queues nothing"
         (str/includes? (:text first-call) "HANDOFF_NOT_QUEUED"))
  (check "BL-1306: an identical second invocation QUEUES rather than re-challenging"
         (and (not (str/includes? (:text second-call) "AUDIT_REQUIRED"))
              (queued? root)))
  (fs/delete-tree root))

;; ── the unrouted case must keep working exactly as before ────────────────
(let [root (fixture! ["coder" "cleaner" "architect" "hardender" "documenter" "qa"])
      d (draft! root "cleaner" (head root))
      first-call (invoke root d)
      second-call (invoke root d)]
  (check "BL-1306: a non-skipping ticket still challenges once"
         (str/includes? (:text first-call) "AUDIT_REQUIRED"))
  (check "BL-1306: and its identical second invocation still queues" (queued? root))
  (fs/delete-tree root))

;; ── scenario 03: an EDITED draft must still invalidate the challenge, or
;;    the fix bought queueing by disabling the audit ────────────────────────
(let [root (fixture! ["coder" "qa"])
      d (draft! root "cleaner" (head root))
      _ (invoke root d)
      _ (spit d (str (slurp d) "\n"))
      edited (invoke root d)]
  (check "BL-1306: an edited draft still re-challenges"
         (str/includes? (:text edited) "AUDIT_REQUIRED"))
  (check "BL-1306: and queues nothing" (not (queued? root)))
  (fs/delete-tree root))

(if (pos? @fails)
  (do (println (str @fails " failure(s)")) (System/exit 1))
  (println "ALL PASS: BL-1306 audit reroute"))
