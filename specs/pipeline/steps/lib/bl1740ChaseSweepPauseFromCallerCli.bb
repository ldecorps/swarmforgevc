#!/usr/bin/env bb
;; BL-1740 acceptance driver: the chase sweep reads the pause from its
;; adapters, never resolving the checkout it runs in itself.
;;
;; Drives the REAL swarmforge/scripts/chase_sweep_lib.bb sweep-role-inbox!
;; over a REAL scratch git checkout (git init under mkdtemp, proven
;; isolated by `rev-parse --git-common-dir` before any further git write,
;; Guardrails BL-1390) - never a restatement of the pause-read logic.
;;
;; Usage: bl1740ChaseSweepPauseFromCallerCli.bb <pause-adapter-mode>
;;   pause-adapter-mode: none | false | true | live
;;     none  - adapters carry no :pause-hold-active? key at all
;;     false - a fake adapter that reads false
;;     true  - a fake adapter that reads true
;;     live  - the REAL handoff-lib/pause-hold-active?, scoped to this
;;             scratch checkout via handoff-lib/set-project-root! (the
;;             same override handoffd.bb's own startup uses) - proves the
;;             live reading resolves the CALLER's checkout, never a
;;             different one, once it is wired in as an adapter.
;;
;; Prints one JSON line: {"chaseCount": N}

(require '[babashka.fs :as fs]
         '[babashka.process :as process]
         '[cheshire.core :as json]
         '[clojure.string :as str])

(def script-dir (fs/parent (fs/canonicalize *file*)))
(def repo-root (fs/canonicalize (fs/path script-dir ".." ".." ".." "..")))

(load-file (str (fs/path repo-root "swarmforge" "scripts" "handoff_lib.bb")))
(load-file (str (fs/path repo-root "swarmforge" "scripts" "chase_sweep_lib.bb")))

(defn sh! [dir & args]
  (apply process/sh {:dir (str dir) :continue true} args))

(defn- build-fixture! []
  (let [root (str (fs/create-temp-dir {:prefix "bl1740-pause-from-caller-"}))]
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
    ;; A stale, unheld handoff item for role "coder" - old enough to clear
    ;; every existing chase/stuck timeout the config below sets.
    (fs/create-dirs (fs/path root "inbox" "new"))
    (let [item (str (fs/path root "inbox" "new" "00_item.handoff"))]
      (spit item (str "id: t\nfrom: specifier\nto: coder\npriority: 50\ntype: note\n"
                       "message: hi\ncreated_at: 2026-07-01T00:00:00Z\n\nhi\n"))
      (fs/set-last-modified-time item (java.nio.file.attribute.FileTime/fromMillis
                                        (- (System/currentTimeMillis) (* 1000 60 60)))))
    root))

(defn- pause-adapter-fn [mode root]
  (case mode
    "none" nil
    "false" (fn [_role] false)
    "true" (fn [_role] true)
    "live" (do (handoff-lib/set-project-root! root)
               (fn [_role] (handoff-lib/pause-hold-active?)))
    (throw (ex-info (str "BL-1740: unrecognized pause-adapter-mode " (pr-str mode)) {}))))

;; The same shape handoffd.bb's own chase-sweep-config uses - duplicated
;; rather than loading handoffd.bb itself, which starts a real daemon on
;; load ("small live-glue duplicated across independent test surfaces, no
;; shared lifecycle worth coupling", chase_sweep_test_runner.bb's own
;; posture).
(def config
  {:chaseIntervalSeconds 5
   :chaseTimeoutSeconds 30
   :maxChases 3
   :stuckInProcessTimeoutSeconds 60
   :respawnCooldownSeconds 300
   :chaseBackoffBaseSeconds 30
   :chaseBackoffMaxSeconds 300
   :claim-idle-timeout-ms (* 20 60 1000)
   :nudge-threshold 1
   :bounce-threshold 6
   :halt-threshold 10})

(let [[mode] *command-line-args*
      root (build-fixture!)
      now-ms (System/currentTimeMillis)
      base-adapters {:get-liveness (fn [_role] "alive")
                     :get-last-activity-ms (fn [_role] (- now-ms 200000))
                     :send-wake-up! (fn [_role] {:attempted true :landed true})
                     :send-in-process-resume! (fn [_role] false)
                     :trigger-respawn! (fn [_role _readings] nil)
                     :log-dead-letter! (fn [_role _path] nil)
                     :on-stuck-escalation! (fn [_role _escalated?] nil)
                     :log-telemetry! (fn [_event _at-ms] nil)}
      adapter-fn (pause-adapter-fn mode root)
      adapters (if adapter-fn (assoc base-adapters :pause-hold-active? adapter-fn) base-adapters)]
  (try
    (chase-sweep-lib/sweep-role-inbox!
     "coder"
     (str (fs/path root "inbox" "new"))
     (str (fs/path root "inbox" "completed"))
     (str (fs/path root "inbox" "abandoned"))
     now-ms config adapters)
    (let [chase-json (str (fs/path root "inbox" "new" "00_item.handoff.chase.json"))
          chase-count (if (fs/exists? chase-json)
                        (:chaseCount (json/parse-string (slurp chase-json) true))
                        0)]
      (println (json/generate-string {:chaseCount chase-count})))
    (finally
      (handoff-lib/set-project-root! nil)
      (fs/delete-tree root))))
