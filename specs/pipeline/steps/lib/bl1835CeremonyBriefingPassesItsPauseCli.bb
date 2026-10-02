#!/usr/bin/env bb
;; BL-1835 acceptance driver: a control pause exempts a briefing-instruction
;; note addressed to the documenter from the inbox hold; everything else -
;; including this exact text addressed to any other role - stays held.
;; Drives the REAL swarmforge/scripts/handoff_lib.bb
;; resolve-dequeueable-candidates / partition-pause-held over a REAL scratch
;; git checkout (git init under mkdtemp, proven isolated by `rev-parse
;; --git-common-dir` before any further git write, Guardrails BL-1390) -
;; never a restatement of the exemption logic.
;;
;; The fixture's own control pause is the fixture's own file:
;; handoff-lib/pause-hold-active? resolves its target-root via
;; handoff-lib/set-project-root! (the same override BL-1740's own CLI
;; uses), so this never writes or reads the live swarm's
;; .swarmforge/operator/control-pause.json.
;;
;; Usage: bl1835CeremonyBriefingPassesItsPauseCli.bb <role> <spec>...
;;   Each spec is "note:<message>" or "git_handoff:<task>" - each becomes
;;   one candidate file addressed `to: <role>` in <role>'s own inbox.
;;
;; Prints one JSON line, in the SAME order as the input specs:
;;   [{"message": "...", "served": bool, "stillPresent": bool}, ...]
;; "served" = the candidate was in resolve-dequeueable-candidates' returned
;; list (what ready_for_next would hand the role). "stillPresent" = the
;; candidate file still exists at its original path (the pause-hold
;; invariant: a held candidate is never moved or quarantined).

(require '[babashka.fs :as fs]
         '[babashka.process :as process]
         '[cheshire.core :as json]
         '[clojure.string :as str])

(def script-dir (fs/parent (fs/canonicalize *file*)))
(def repo-root (fs/canonicalize (fs/path script-dir ".." ".." ".." "..")))

(load-file (str (fs/path repo-root "swarmforge" "scripts" "handoff_lib.bb")))

(defn sh! [dir & args]
  (apply process/sh {:dir (str dir) :continue true} args))

(defn- build-fixture! []
  (let [root (str (fs/create-temp-dir {:prefix "bl1835-pause-briefing-"}))]
    (sh! root "git" "init" "-q" "-b" "main" ".")
    (sh! root "git" "config" "user.email" "t@t")
    (sh! root "git" "config" "user.name" "t")
    (sh! root "git" "config" "commit.gpgsign" "false")
    ;; BL-1390: proven isolated (git-common-dir resolves inside the fixture
    ;; root) before any mutating git write beyond `init` itself.
    (let [common (:out (sh! root "git" "rev-parse" "--git-common-dir"))]
      (assert (str/starts-with? (str (fs/canonicalize (fs/path root (str/trim common)))) root)
              (str "fixture git-common-dir must resolve inside the fixture root, got " common)))
    (sh! root "git" "commit" "-q" "--allow-empty" "-m" "seed")
    ;; The pause marker - inside THIS scratch checkout only, never the live
    ;; one this process actually runs in.
    (fs/create-dirs (fs/path root ".swarmforge" "operator"))
    (spit (str (fs/path root ".swarmforge" "operator" "control-pause.json"))
          (json/generate-string {:active true}))
    root))

;; `recipient:` = role (the inbox this candidate is placed in) in every
;; case - the per-copy addressee header a real delivery stamps
;; (handoff-protocol.md). `to:` stays single-role here; the BROADCAST
;; shape (`to:` naming more than one role while `recipient:` names only
;; the inbox owner) is covered at the unit level
;; (handoff_lib_test_runner.bb), since the fixed predicate decides from
;; `recipient:` alone and never re-reads `to:`.
(defn- spec->content [role idx spec]
  (let [[kind payload] (str/split spec #":" 2)]
    (case kind
      "note"
      {:message payload
       :content (str "id: 20261001T000000Z_" (format "%06d" idx) "_from_coordinator\n"
                      "from: coordinator\nto: " role "\nrecipient: " role "\npriority: 00\ntype: note\nmessage: " payload "\n"
                      "\n" payload "\n")}
      "git_handoff"
      {:message payload
       :content (str "id: 20261001T000000Z_" (format "%06d" idx) "_from_qa\n"
                      "from: qa\nto: " role "\nrecipient: " role "\npriority: 50\ntype: git_handoff\n"
                      "task: " payload "\ncommit: abcdef0123\n"
                      "\nmerge_and_process qa abcdef0123\n")}
      (throw (ex-info (str "BL-1835: unrecognized spec kind " (pr-str kind)) {})))))

(let [[role & specs] *command-line-args*
      root (build-fixture!)]
  (try
    (handoff-lib/set-project-root! root)
    (let [inbox (fs/path root "inbox" "new")
          _ (fs/create-dirs inbox)
          entries (map-indexed (fn [idx spec]
                                  (let [{:keys [message content]} (spec->content role idx spec)
                                        file (fs/path inbox (str (format "%02d" idx) "_item.handoff"))]
                                    (spit (str file) content)
                                    {:message message :file file}))
                                specs)
          ;; resolve-fn? stubbed to always-resolve: this acceptance run tests
          ;; the pause-hold exemption only, never BL-610's separate
          ;; unresolvable-commit gate (a synthetic git_handoff's fake commit
          ;; would otherwise get quarantined before ever reaching the
          ;; pause-hold check this ticket changes).
          dequeued (set (map str (handoff-lib/resolve-dequeueable-candidates
                                   (mapv :file entries) [] [] (constantly true))))
          result (mapv (fn [{:keys [message file]}]
                         {:message message
                          :served (contains? dequeued (str file))
                          :stillPresent (fs/exists? file)})
                       entries)]
      (println (json/generate-string result)))
    (finally
      (handoff-lib/set-project-root! nil)
      (fs/delete-tree root))))
