;; BL-214: sends each committed docs/briefings/<date>.md exactly once, from
;; the headless daemon rather than the VS Code extension host - ported from
;; extension/src/notify/briefingEmailWatcher.ts's exact decision logic
;; (sent-marker file shape, "mark sent only after a real success" ordering)
;; so a failed/skipped send is retried on the next sweep instead of lost,
;; same as that module's own docstring promised. Reuses daemon_alarm_lib.bb's
;; send-alarm-email! for the actual POST - no second Resend client - so this
;; module owns only the briefing-specific scanning/marker/subject logic.
(ns briefing-email-lib
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(defn sent-state-path [briefings-dir]
  (str (fs/path briefings-dir ".sent.json")))

(defn- read-json [path]
  (when (fs/exists? path)
    (try
      (json/parse-string (slurp path) true)
      (catch Exception _ nil))))

(defn load-sent-briefings [briefings-dir]
  (set (:sent (read-json (sent-state-path briefings-dir)))))

(defn record-briefing-sent! [briefings-dir file-name]
  (let [current (conj (load-sent-briefings briefings-dir) file-name)]
    (spit (sent-state-path briefings-dir) (json/generate-string {:sent (vec (sort current))}))))

;; Every committed briefing .md file under briefings-dir not yet sent, oldest
;; (alphabetically, which is chronologically for YYYY-MM-DD names) first.
(defn find-unsent-briefings [briefings-dir]
  (if (fs/exists? briefings-dir)
    (let [sent (load-sent-briefings briefings-dir)]
      (->> (fs/list-dir briefings-dir)
           (map fs/file-name)
           (filter #(str/ends-with? % ".md"))
           (remove sent)
           sort
           vec))
    []))

;; First non-empty line of the briefing, matching briefingEmailWatcher.ts's
;; buildBriefingSubject exactly (BL-099 briefing-03: subject names the date
;; and the headline).
(defn build-briefing-subject [date-label content]
  (let [headline (->> (str/split-lines (or content ""))
                       (map str/trim)
                       (filter seq)
                       first)]
    (str "SwarmForge briefing " date-label (when headline (str " - " headline)))))

(defn send-unsent-briefings!
  "Sends each not-yet-sent committed briefing exactly once via the injected
   send-email! adapter (daemon_alarm_lib.bb's send-alarm-email!). A file is
   marked sent only once send-email! reports :success true - unconfigured
   (:reason :disabled/:missing-api-key) or a real failure both log a skip
   and leave the file to retry on the next sweep, never crashing and never
   losing the briefing. Returns the file names actually sent this call."
  [briefings-dir adapters]
  (let [sent-now (atom [])]
    (doseq [file-name (find-unsent-briefings briefings-dir)]
      (let [content ((:read-briefing-content adapters) file-name)
            date-label (str/replace file-name #"\.md$" "")
            subject (build-briefing-subject date-label content)
            result ((:send-email! adapters) subject content)]
        (cond
          (:success result)
          (do
            (record-briefing-sent! briefings-dir file-name)
            ((:log! adapters) "briefing-sent" file-name)
            (swap! sent-now conj file-name))

          (= (:reason result) :disabled)
          ((:log! adapters) "briefing-skip-disabled" file-name)

          (= (:reason result) :missing-api-key)
          ((:log! adapters) "briefing-skip-missing-key" file-name)

          :else
          ((:log! adapters) "briefing-send-failed" file-name (str (:error result))))))
    @sent-now))
