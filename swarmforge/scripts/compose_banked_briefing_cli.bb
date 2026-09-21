#!/usr/bin/env bb
;; BL-1641: standalone CLI over banked_briefing_lib.bb's pure composer, for
;; a caller that is not itself a long-lived Babashka process - the closing
;; ceremony's Node.js executor, which forces the banked briefing at its
;; deadline when nothing was landed from the documenter branch. Gathers the
;; same "cheap headless signals" handoffd.bb's own
;; compose-and-write-banked-briefing! gathers, parameterized by an explicit
;; <root> rather than the daemon's own project-root global, so a fixture
;; root (mkdtemp, git init) drives it identically to a live checkout.
;;
;; Usage: compose_banked_briefing_cli.bb <root> <day-key> [--label <text>]
;;
;; Writes <root>/docs/briefings/<day-key>.md and exits 0, printing the
;; written path; a gathering failure degrades quietly per input (same
;; posture as handoffd.bb's own adapters), but a write failure exits
;; non-zero with nothing committed by this CLI (it does not commit at all -
;; the caller commits, so a partial write is never mistaken for a landed
;; briefing).

(ns compose-banked-briefing-cli
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(load-file (str (fs/path script-dir "banked_briefing_lib.bb")))
(load-file (str (fs/path script-dir "daemon_cycle_guard_lib.bb")))

(defn usage []
  (binding [*out* *err*]
    (println "Usage: compose_banked_briefing_cli.bb <root> <day-key> [--label <text>]"))
  (System/exit 1))

(defn parse-opts [args]
  (loop [args args opts {}]
    (if (empty? args)
      opts
      (let [[flag value & more] args]
        (when (nil? value) (usage))
        (case flag
          "--label" (recur more (assoc opts :label value))
          (usage))))))

(defn- count-yaml-files [dir]
  (if (fs/exists? dir)
    (count (filter #(str/ends-with? (fs/file-name %) ".yaml") (fs/list-dir dir)))
    0))

(defn- gathered-backlog-counts [root]
  {:active (count-yaml-files (fs/path root "backlog" "active"))
   :paused (count-yaml-files (fs/path root "backlog" "paused"))
   :done (count-yaml-files (fs/path root "backlog" "done"))})

(defn- read-hibernation-state [root]
  (let [f (fs/path root ".swarmforge" "operator" "hibernation.json")]
    (when (fs/exists? f)
      (try (json/parse-string (slurp (str f)) true) (catch Exception _ nil)))))

;; git log since the prior UTC day-key, oneline - degrades to [] on any
;; failure (not yet a git repo, git not on PATH, no commits since, etc.),
;; the same posture as handoffd.bb's own recent-git-activity-lines.
(defn- recent-git-activity-lines [root day-key]
  (try
    (let [since (str (banked-briefing-lib/prior-day-key day-key) "T00:00:00Z")
          {:keys [exit out]} (daemon-cycle-guard-lib/sh! "git" "-C" (str root) "log" "--oneline" (str "--since=" since))]
      (if (zero? exit)
        (vec (remove str/blank? (str/split-lines out)))
        []))
    (catch Exception _ [])))

;; Reuses the day's own docs/briefings/<day>.json sidecar when present
;; (BL-272), same as handoffd.bb's banked-daemon-health-lines - degrades to
;; [] when the sidecar is missing/unreadable/has no reliability data.
(defn- daemon-health-lines [root day-key]
  (try
    (let [sidecar (fs/path root "docs" "briefings" (str day-key ".json"))]
      (if (fs/exists? sidecar)
        (let [{:keys [reliability]} (json/parse-string (slurp (str sidecar)) true)]
          (if reliability
            [(str "chases=" (get-in reliability [:chases :value] 0)
                  " nudges=" (get-in reliability [:nudges :value] 0)
                  " respawns=" (get-in reliability [:respawns :value] 0)
                  " failedDeliveries=" (get-in reliability [:failedDeliveries :value] 0))]
            []))
        []))
    (catch Exception _ [])))

(defn -main [args]
  (let [root (first args)
        day-key (second args)]
    (when (or (str/blank? root) (str/blank? day-key)) (usage))
    (let [state (read-hibernation-state root)
          opts (parse-opts (drop 2 args))
          content (banked-briefing-lib/compose-banked-briefing
                    (cond-> {:day-key day-key
                             :profile-name (banked-briefing-lib/profile-name-from-config-path (:config_path state))
                             :hibernated-at-ms (:hibernated_at_ms state)
                             :backlog-counts (gathered-backlog-counts root)
                             :git-activity-lines (recent-git-activity-lines root day-key)
                             :daemon-health-lines (daemon-health-lines root day-key)}
                      (:label opts) (assoc :label (:label opts))))
          out-path (fs/path root "docs" "briefings" (str day-key ".md"))]
      (fs/create-dirs (fs/parent out-path))
      (spit (str out-path) content)
      (println (str out-path)))))

(-main *command-line-args*)
