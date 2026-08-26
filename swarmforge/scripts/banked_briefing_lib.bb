;; BL-308: pure content composer for the headless (no-agent, no-LLM)
;; briefing generated while the swarm is banked (BL-307 hibernation). The
;; coordinator normally composes docs/briefings/<day>.md itself as agentic
;; work; while hibernated there is no coordinator to do that, so
;; briefing_generation_schedule_lib.bb's generate-briefing-if-due! (extended
;; by this ticket with a hibernated? branch) calls this composer instead of
;; nudging anyone. Every input here is already-gathered data (git log
;; lines, backlog counts, the parked profile name, daemon health lines) -
;; this lib only formats it; gathering that data (git shell-out, directory
;; listings, reading the day's cost-health sidecar) is the impure adapter
;; side, wired in handoffd.bb, same split as every other *-briefing-section
;; function there.
(ns banked-briefing-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def parked-briefing-label "Swarm parked - lightweight briefing")

(defn profile-name-from-config-path
  "The parked pack's name, derived from hibernation.json's :config_path
   (e.g. \".../swarmforge/packs/concierge-banked.conf\" -> \"concierge-banked\").
   A blank/nil config path (no pack override was set at hibernate time)
   falls back to \"unknown\" - never a crash."
  [config-path]
  (if (str/blank? config-path)
    "unknown"
    (str/replace (fs/file-name config-path) #"\.conf$" "")))

(defn prior-day-key
  "The UTC calendar day immediately before day-key (a \"YYYY-MM-DD\"
   string) - used to scope the headless composer's \"recent git activity\"
   window to since-yesterday, per the ticket's own wording."
  [day-key]
  (-> (java.time.LocalDate/parse day-key)
      (.minusDays 1)
      .toString))

(defn- iso-instant [ms]
  (str (java.time.Instant/ofEpochMilli ms)))

(defn- lines-or-fallback [lines fallback]
  (if (seq lines) (vec lines) [fallback]))

(defn compose-banked-briefing
  "Pure: builds the full markdown text for the day's headless briefing.
   inputs is a map:
     :day-key             \"YYYY-MM-DD\"
     :profile-name        string (see profile-name-from-config-path)
     :hibernated-at-ms    epoch ms the swarm hibernated (nil tolerated)
     :backlog-counts      {:active n :paused n :done n}
     :git-activity-lines  vector of already-formatted strings (may be empty)
     :daemon-health-lines vector of already-formatted strings (may be empty)
   First line is the subject line (matching briefing_email_lib.bb's
   build-briefing-subject, which reads the first non-blank line as the
   headline) and explicitly carries parked-briefing-label so a reader (and
   the acceptance suite) can tell this was authored by the headless
   composer, not the coordinator."
  [{:keys [day-key profile-name hibernated-at-ms backlog-counts
           git-activity-lines daemon-health-lines]}]
  (let [{:keys [active paused done]} backlog-counts]
    (str
     (str/join
      "\n"
      (concat
       [(str parked-briefing-label " for " day-key)
        ""
        "## Recent git activity"]
       (lines-or-fallback git-activity-lines "No recent git activity.")
       [""
        "## Backlog counts"
        (str "active: " (or active 0))
        (str "paused: " (or paused 0))
        (str "done: " (or done 0))
        ""
        "## Parked profile"
        (str profile-name
             (when hibernated-at-ms
               (str " (hibernated since " (iso-instant hibernated-at-ms) ")")))
        ""
        "## Daemon health"]
       (lines-or-fallback daemon-health-lines "Daemon health unavailable this run.")))
     "\n")))
