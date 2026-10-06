#!/usr/bin/env bb

;; BL-432 (epic BL-429 slice 3 - ACT, the mandatory wiring slice): the ONE
;; shell-callable entry point the coordinator's own promotion decision calls
;; to get the EFFECTIVE active-depth cap = min(configured, recommended) -
;; closing the observe (BL-430) -> diagnose (BL-431) -> act loop Article 3.5
;; already sanctions but nothing previously automated.
;;
;; Refreshes the throttle recommendation FRESH on every call (shells to
;; extension/out/tools/emit-throttle-recommendation.js - Babashka has no way
;; to import compiled TS) rather than trusting a periodic sweep that might be
;; stale between coordinator wake-ups - the same "compute at decision time"
;; posture backlog_depth_cli.bb's own sibling scripts use. A failed refresh
;; (CLI not yet compiled, node missing, etc.) degrades to a logged skip and
;; falls through to whatever recommendation is already on disk (or none) -
;; never crashes the caller, mirroring handoffd.bb's own fleet-status-sweep!/
;; drain-answer-files-sweep! shell-and-degrade convention.
;;
;; Usage: effective_backlog_depth_cli.bb <project-root>
;; Prints the resolved EFFECTIVE active_backlog_max_depth and exits 0.
;;
;; BL-1128: raising the STANDING configured cap on host headroom is owned by
;; headroom_cap_raise_cli.bb (not this reader). After a raise, this CLI's next
;; call reflects the higher configured ceiling via read-effective-max-depth.
;; Wiring needle (required_wiring / APS): bl1128HeadroomRaiseConfiguredCap

(ns effective-backlog-depth-cli
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))

(load-file (str (fs/path script-dir "backlog_depth_lib.bb")))
;; bl1128HeadroomRaiseConfiguredCap — acceptance handler registered (BL-1128)
(load-file (str (fs/path script-dir "throttle_release_ask_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: effective_backlog_depth_cli.bb <project-root>")
    (println "  <project-root>: the master checkout or ANY linked worktree of it -")
    (println "  identity resolves at the repository's master checkout either way")
    (println "  (BL-966); a non-git root resolves against itself."))
  (System/exit 1))

(defn refresh-recommendation! [project-root]
  (try
    (let [cli-path (str (fs/path project-root "extension" "out" "tools" "emit-throttle-recommendation.js"))
          {:keys [exit err]} (process/sh ["node" cli-path (str project-root)] {:dir (str project-root)})]
      ;; BL-2033: since BL-1874 the refresh CLI exits 0 when its refresh
      ;; fails and names the failure on stderr, so a non-zero exit is no
      ;; longer the only failure signal - pass on whatever the refresh
      ;; wrote to stderr, whatever its exit. A non-zero exit still adds
      ;; exit=<n> as before; stdout stays the effective depth alone.
      (let [trimmed-err (str/trim (or err ""))]
        (when (or (not (zero? exit)) (not (empty? trimmed-err)))
          (binding [*out* *err*]
            (if (zero? exit)
              (println (str "effective_backlog_depth_cli: throttle-recommendation refresh failed, " trimmed-err))
              (println (str "effective_backlog_depth_cli: throttle-recommendation refresh failed, exit=" exit " " trimmed-err)))))))
    (catch Exception e
      (binding [*out* *err*]
        (println (str "effective_backlog_depth_cli: throttle-recommendation refresh error: " (.getMessage e)))))))

;; ── BL-1982: the throttle-release ask-and-apply step ──────────────────────
;; Runs after refresh-recommendation! (a fresh diagnosis for this tick) and
;; before the final effective-cap print, so a releasing/keeping answer this
;; same run consumes is reflected in that same print. Every IO call here
;; degrades to a logged stderr skip on failure (requirement 6: "never
;; changes the printed cap"), mirroring refresh-recommendation!'s own
;; try/catch convention.

(defn- read-recommendation [project-root]
  (try
    (json/parse-string (slurp (str (backlog-depth-lib/throttle-recommendation-path project-root))) true)
    (catch Exception _ nil)))

(defn- atomic-spit! [path content]
  (fs/create-dirs (fs/parent path))
  (let [tmp (fs/path (fs/parent path) (str "." (fs/file-name path) ".tmp"))]
    (spit (str tmp) content)
    (fs/move tmp path {:replace-existing true :atomic-move true})))

(defn- write-recommendation! [project-root rec]
  (atomic-spit! (backlog-depth-lib/throttle-recommendation-path project-root) (json/generate-string rec)))

(defn- role-awaiting-asked-at-ms [project-root role]
  (try
    (let [p (fs/path project-root ".swarmforge" "operator" "role-awaiting" (str role ".json"))]
      (when (fs/exists? p)
        (:asked_at_ms (json/parse-string (slurp (str p)) true))))
    (catch Exception _ nil)))

;; Scenario 01/invariant 1: raises ONE question per episode via role_ask.bb,
;; recording its own live marker's asked_at_ms onto the episode so a later
;; run never re-asks (question-already-asked?). role_ask.bb refuses (exit 0,
;; {:asked false}) when the coordinator already has ANY other question
;; pending - that refusal IS this ticket's "never asks while another
;; question is pending" (scenario 03), with nothing recorded, exactly as
;; wanted.
(defn- raise-release-question! [project-root rec]
  (try
    (let [question (throttle-release-ask-lib/format-release-question rec (System/currentTimeMillis))
          options-json (json/generate-string throttle-release-ask-lib/release-options)
          {:keys [exit out err]} (process/sh
                                   ["bb" (str (fs/path script-dir "role_ask.bb")) (str project-root)
                                    "--role" "coordinator" "--question" question "--options" options-json]
                                   {:dir (str project-root)})]
      (if (zero? exit)
        (let [parsed (try (json/parse-string out true) (catch Exception _ nil))]
          (when (:asked parsed)
            (when-let [asked-at-ms (role-awaiting-asked-at-ms project-root "coordinator")]
              (write-recommendation! project-root (assoc-in rec [:episode :releaseAskedAtMs] asked-at-ms)))))
        (binding [*out* *err*]
          (println (str "effective_backlog_depth_cli: throttle release ask failed, exit=" exit " " (str/trim (or err "")))))))
    (catch Exception e
      (binding [*out* *err*]
        (println (str "effective_backlog_depth_cli: throttle release ask error: " (.getMessage e)))))))

;; Scenario 04/05: consumes a coordinator answer ONLY when the live pending
;; question is the one this episode itself raised (compared BEFORE calling
;; deliver-role-answer, never after - deliver-role-answer.js is the only
;; sanctioned reader of the answer file regardless, BL-1201). An exact
;; option tap applies through BL-1981's release CLI; anything else is kept
;; on the episode as a reply, never acted on.
(defn- apply-release-answer! [project-root rec]
  (try
    (let [live-asked-at-ms (role-awaiting-asked-at-ms project-root "coordinator")
          our-asked-at-ms (get-in rec [:episode :releaseAskedAtMs])]
      (when (and our-asked-at-ms (= live-asked-at-ms our-asked-at-ms))
        (let [deliver-path (str (fs/path project-root "extension" "out" "tools" "deliver-role-answer.js"))
              {:keys [exit out err]} (process/sh ["node" deliver-path "--role" "coordinator"] {:dir (str project-root)})]
          (if (zero? exit)
            (let [parsed (try (json/parse-string out true) (catch Exception _ nil))]
              (when (= "delivered" (:kind parsed))
                (let [text (:text parsed)
                      kind (throttle-release-ask-lib/release-reply-kind text)
                      release-cli (str (fs/path project-root "extension" "out" "tools" "release-intake-throttle.js"))]
                  (case kind
                    :release
                    (let [{:keys [exit err]} (process/sh ["node" release-cli (str project-root) "--by" "human" "--release"] {:dir (str project-root)})]
                      (when-not (zero? exit)
                        (binding [*out* *err*]
                          (println (str "effective_backlog_depth_cli: throttle release apply failed, exit=" exit " " (str/trim (or err "")))))))

                    :keep
                    (let [held (get-in rec [:episode :lowestCapReached])
                          {:keys [exit err]} (process/sh ["node" release-cli (str project-root) "--by" "human" "--keep" (str held)] {:dir (str project-root)})]
                      (when-not (zero? exit)
                        (binding [*out* *err*]
                          (println (str "effective_backlog_depth_cli: throttle keep apply failed, exit=" exit " " (str/trim (or err "")))))))

                    :typed
                    (write-recommendation! project-root (assoc-in rec [:episode :releaseReply] text))))))
            (binding [*out* *err*]
              (println (str "effective_backlog_depth_cli: throttle release answer delivery failed, exit=" exit " " (str/trim (or err "")))))))))
    (catch Exception e
      (binding [*out* *err*]
        (println (str "effective_backlog_depth_cli: throttle release apply error: " (.getMessage e)))))))

(defn- ask-and-apply-throttle-release! [project-root]
  (when-let [rec (read-recommendation project-root)]
    (when (throttle-release-ask-lib/episode-awaiting-release? rec)
      (if (throttle-release-ask-lib/question-already-asked? rec)
        (apply-release-answer! project-root rec)
        (raise-release-question! project-root rec)))))

(defn -main [& args]
  (when (not= 1 (count args))
    (usage))
  (let [[project-root] args]
    (refresh-recommendation! project-root)
    (ask-and-apply-throttle-release! project-root)
    (println (backlog-depth-lib/read-effective-max-depth project-root))))

(apply -main *command-line-args*)
