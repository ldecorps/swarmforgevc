;; BL-1128: raise standing active_backlog_max_depth on sustained CPU+memory
;; headroom; unhold eligible hold→paused; durable reversible audit.
;; Loaded via load-file; referred as headroom-cap-raise-lib/foo.

(ns headroom-cap-raise-lib
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "backlog_depth_lib.bb")))

(def default-ceiling 8)
(def default-step 1)
(def default-cooldown-minutes 60)
(def default-cpu-ratio-max 1.0)
(def default-mem-available-mb-min 2048)
(def default-sample-interval-ms (* 5 60 1000))
(def default-sustained-minutes 15)

(def audit-relpath [".swarmforge" "coordinator" "headroom-cap-changes.jsonl"])
(def last-raise-relpath [".swarmforge" "coordinator" "headroom-cap-last-raise.json"])
(def signal-override-relpath [".swarmforge" "coordinator" "headroom-signal-override.json"])

(defn audit-path [root]
  (apply fs/path (backlog-depth-lib/resolve-identity-root root) audit-relpath))

(defn last-raise-path [root]
  (apply fs/path (backlog-depth-lib/resolve-identity-root root) last-raise-relpath))

(defn signal-override-path [root]
  (apply fs/path (backlog-depth-lib/resolve-identity-root root) signal-override-relpath))

(defn- parse-conf-long [conf-text key]
  (some->> (str/split-lines (or conf-text ""))
           (filter #(str/starts-with? % (str "config " key)))
           first
           (re-find #"-?\d+(?:\.\d+)?")
           parse-double))

(defn parse-conf-depth [conf-text]
  (or (some-> (parse-conf-long conf-text "active_backlog_max_depth") long)
      backlog-depth-lib/default-max-depth))

(defn- conf-long-or [conf-text key default]
  (or (some-> (parse-conf-long conf-text key) long) default))

(defn- conf-double-or [conf-text key default]
  (or (parse-conf-long conf-text key) default))

(defn read-policy [root]
  (let [text (try (slurp (str (backlog-depth-lib/conf-file-path root)))
                  (catch Exception _ ""))]
    {:configured (parse-conf-depth text)
     :ceiling (conf-long-or text "active_backlog_max_depth_ceiling" default-ceiling)
     :step (conf-long-or text "active_backlog_headroom_raise_step" default-step)
     :cooldown-minutes (conf-long-or text "active_backlog_headroom_raise_cooldown_minutes"
                                     default-cooldown-minutes)
     :cpu-ratio-max (conf-double-or text "active_backlog_headroom_cpu_ratio_max"
                                    default-cpu-ratio-max)
     :mem-min-mb (conf-long-or text "active_backlog_headroom_mem_available_mb_min"
                               default-mem-available-mb-min)
     :sustained-minutes (conf-long-or text "host_load_sustained_minutes"
                                      default-sustained-minutes)
     :sample-interval-ms (conf-long-or text "host_load_sample_interval_ms"
                                       default-sample-interval-ms)
     :conf-text text
     :conf-path (str (backlog-depth-lib/conf-file-path root))}))

(defn sustained-cpu-headroom?
  "Trailing samples at/below max-ratio covering sustained-ms at sample-interval-ms.
   One sample alone never qualifies."
  [ratio-events max-ratio sustained-ms sample-interval-ms]
  (let [trailing (->> ratio-events reverse (take-while #(<= (double (:ratio %)) max-ratio)) count)]
    (and (> trailing 1)
         (>= (* trailing sample-interval-ms) sustained-ms))))

(defn memory-headroom? [available-mb min-mb]
  (boolean (and (number? available-mb) (number? min-mb) (>= available-mb min-mb))))

(defn decide-raise
  [{:keys [configured ceiling step headroom? throttle-severity cooldown-active?]}]
  (cond
    (contains? #{"degraded" "severe"} throttle-severity) {:action :noop :reason "throttle"}
    (not headroom?) {:action :noop :reason "pressure"}
    cooldown-active? {:action :noop :reason "cooldown"}
    (or (nil? configured) (backlog-depth-lib/no-limit? configured)) {:action :noop :reason "no-limit"}
    (>= configured ceiling) {:action :noop :reason "ceiling"}
    :else {:action :raise :to (min ceiling (+ configured step))}))

(defn rewrite-max-depth-line [conf-text new-depth]
  (if (re-find #"(?m)^config active_backlog_max_depth\s+-?\d+" (or conf-text ""))
    (str/replace-first (or conf-text "")
                       #"(?m)^(config active_backlog_max_depth)\s+-?\d+"
                       (str "$1 " new-depth))
    (str (or conf-text "")
         (when-not (str/blank? conf-text)
           (when-not (str/ends-with? conf-text "\n") "\n"))
         "config active_backlog_max_depth " new-depth "\n")))

(defn unhold-eligible? [content]
  (= "eligible" (some->> (str/split-lines (or content ""))
                         (filter #(str/starts-with? % "headroom_unhold:"))
                         first
                         (re-find #"(?i)eligible|refuse")
                         str/lower-case)))

(defn depth-cap-throttle-ticket? [content]
  (let [blob (str/lower-case (or content ""))]
    (boolean (or (re-find #"headroom_prefer:\s*depth" blob)
                 (re-find #"\b(active[_ ]?backlog[_ ]?max[_ ]?depth|backlog depth|depth warning|depth cap|intake cap|throttle|headroom)\b" blob)))))

(defn- read-throttle-severity [root]
  (try
    (let [parsed (json/parse-string
                  (slurp (str (backlog-depth-lib/throttle-recommendation-path root))) true)]
      (:severity parsed))
    (catch Exception _ nil)))

(defn- read-override [root]
  (try
    (json/parse-string (slurp (str (signal-override-path root))) true)
    (catch Exception _ nil)))

(defn- meminfo-path []
  (or (System/getenv "SWARMFORGE_HEADROOM_MEMINFO_PATH")
      (System/getenv "BABYSITTER_MEMINFO_PATH")
      "/proc/meminfo"))

(defn- read-mem-available-mb []
  (try
    (with-open [in (java.io.FileInputStream. (str (meminfo-path)))]
      (let [text (String. (.readAllBytes in) java.nio.charset.StandardCharsets/US_ASCII)]
        (when-let [m (re-find #"MemAvailable:\s+(\d+)" text)]
          (quot (parse-long (second m)) 1024))))
    (catch Exception _ nil)))

(defn format-chaser-year-month
  "Pure: format a YearMonth as `yyyy-MM` for chaser telemetry filenames.
   BL-1132: must use `(DateTimeFormatter/ofPattern …)` — bare `ofPattern`
   interop throws and fails closed to pressure."
  ([] (format-chaser-year-month (java.time.YearMonth/now)))
  ([year-month]
   (.format year-month (java.time.format.DateTimeFormatter/ofPattern "yyyy-MM"))))

(defn telemetry-path
  "Resolve `.swarmforge/telemetry/chaser-YYYY-MM.jsonl` for root.
   Optional second arg injects the `yyyy-MM` stamp for tests."
  ([root]
   (telemetry-path root (format-chaser-year-month)))
  ([root ym-str]
   (or (System/getenv "SWARMFORGE_HEADROOM_TELEMETRY_PATH")
       (str (fs/path (backlog-depth-lib/resolve-identity-root root)
                     ".swarmforge" "telemetry" (str "chaser-" ym-str ".jsonl"))))))

(defn- parse-host-load-ratios [text]
  (->> (str/split-lines (or text ""))
       (map (fn [line]
              (try
                (let [o (json/parse-string line true)]
                  (when (and (= "host_load_sample" (:type o)) (number? (:ratio o)))
                    {:ratio (double (:ratio o))}))
                (catch Exception _ nil))))
       (filter some?)
       vec))

(defn- live-cpu-headroom? [root policy]
  (let [ratios (parse-host-load-ratios (try (slurp (telemetry-path root)) (catch Exception _ "")))
        sustained-ms (* (:sustained-minutes policy) 60 1000)]
    (sustained-cpu-headroom? ratios (:cpu-ratio-max policy) sustained-ms (:sample-interval-ms policy))))

(defn headroom-signals [root policy]
  (if-let [ov (read-override root)]
    {:cpu-headroom? (boolean (:cpuHeadroom ov))
     :mem-available-mb (:memAvailableMb ov)}
    {:cpu-headroom? (live-cpu-headroom? root policy)
     :mem-available-mb (read-mem-available-mb)}))

(defn- cooldown-active? [root policy now-ms]
  (try
    (let [last (json/parse-string (slurp (str (last-raise-path root))) true)
          at (or (:atMs last) 0)
          cool-ms (* (:cooldown-minutes policy) 60 1000)]
      (< (- now-ms at) cool-ms))
    (catch Exception _ false)))

(defn- append-audit! [root entry]
  (let [p (audit-path root)]
    (fs/create-dirs (fs/parent p))
    (spit (str p) (str (json/generate-string entry) "\n") :append true)))

(defn- write-conf! [path text]
  (fs/create-dirs (fs/parent path))
  (spit (str path) text))

(defn- apply-raise!
  [root policy now from to]
  (let [new-text (rewrite-max-depth-line (:conf-text policy) to)]
    (write-conf! (:conf-path policy) new-text)
    (append-audit! root {:ts (.toString (java.time.Instant/ofEpochMilli now))
                         :atMs now
                         :action "raise"
                         :from from
                         :to to
                         :confPath (:conf-path policy)
                         :reason "sustained CPU+memory headroom"})
    (fs/create-dirs (fs/parent (last-raise-path root)))
    (spit (str (last-raise-path root))
          (json/generate-string {:atMs now :from from :to to :confPath (:conf-path policy)}))
    {:action :raise :to to :from from :conf-path (:conf-path policy)}))

(defn run-raise! [root {:keys [now-ms]}]
  (let [now (or now-ms (System/currentTimeMillis))
        policy (read-policy root)
        signals (headroom-signals root policy)
        headroom? (and (:cpu-headroom? signals)
                       (memory-headroom? (:mem-available-mb signals) (:mem-min-mb policy)))
        decision (decide-raise
                  {:configured (:configured policy)
                   :ceiling (:ceiling policy)
                   :step (:step policy)
                   :headroom? headroom?
                   :throttle-severity (read-throttle-severity root)
                   :cooldown-active? (cooldown-active? root policy now)})]
    (if (not= :raise (:action decision))
      decision
      (apply-raise! root policy now (:configured policy) (:to decision)))))

(defn run-undo! [root]
  (try
    (let [last (json/parse-string (slurp (str (last-raise-path root))) true)
          from (:from last)
          path (or (:confPath last) (str (backlog-depth-lib/conf-file-path root)))
          text (slurp path)
          restored (rewrite-max-depth-line text from)]
      (write-conf! path restored)
      (append-audit! root {:ts (.toString (java.time.Instant/now))
                           :action "undo"
                           :from (parse-conf-depth text)
                           :to from
                           :confPath path
                           :reason "documented reversible undo"})
      {:action :undo :to from})
    (catch Exception e
      {:action :noop :reason (str "undo-failed: " (.getMessage e))})))

(defn- append-unhold-note [content]
  (let [line "  - \"UNHOLD: headroom raise reinstated hold→paused\"\n"]
    (cond
      (re-find #"(?m)^notes:\s*$" content)
      (str/replace-first content #"(?m)^notes:\s*\n" (str "notes:\n" line))

      (re-find #"(?m)^notes:\s*\[" content)
      (str content (when-not (str/ends-with? content "\n") "\n") line)

      :else
      (str content (when-not (str/ends-with? content "\n") "\n") "notes:\n" line))))

(defn- last-raise-succeeded? [root]
  (try
    (let [last (json/parse-string (slurp (str (last-raise-path root))) true)]
      (and (number? (:to last)) (number? (:from last)) (> (:to last) (:from last))))
    (catch Exception _ false)))

(defn run-unhold!
  "Move eligible hold/ → paused/ only when a successful raise is on record.
   Never promotes into active/. Untagged human holds stay put."
  [root]
  (if-not (last-raise-succeeded? root)
    {:action :noop :reason "no-successful-raise" :moved []}
    (let [hold-dir (fs/path root "backlog" "hold")
          paused-dir (fs/path root "backlog" "paused")
          _ (fs/create-dirs paused-dir)
          moved (atom [])]
      (when (fs/exists? hold-dir)
        (doseq [f (fs/list-dir hold-dir)
                :when (and (fs/regular-file? f) (str/ends-with? (fs/file-name f) ".yaml"))
                :let [content (slurp (str f))]
                :when (unhold-eligible? content)]
          (let [dest (fs/path paused-dir (fs/file-name f))
                noted (append-unhold-note content)]
            (spit (str dest) noted)
            (fs/delete f)
            (swap! moved conj (fs/file-name f)))))
      {:action :unhold :moved @moved})))
