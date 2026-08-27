;; BL-634: slice size envelope at promotion — pure gate on declared estimates.
;; Thresholds default to the 2026-07-25 measured distribution (median 65,
;; p90 514, p99 1502). Loaded via load-file; referred as
;; slice-size-envelope-gate-lib/foo.

(ns slice-size-envelope-gate-lib
  (:require [clojure.string :as str]))

(def default-p90-flag 514)
(def default-p99-stop 1502)
(def default-median 65)

(defn- strip-quotes [s]
  (str/replace s #"^[\"']|[\"']$" ""))

(defn- strip-comment [s]
  (str/trim (first (str/split s #"\s+#" 2))))

(defn read-field
  "Single-line scalar for `field:` in ticket YAML, or nil when absent."
  [content field]
  (let [prefix (str field ":")]
    (some (fn [line]
            (let [trimmed (str/trim line)]
              (when (str/starts-with? trimmed prefix)
                (let [after (str/trim (subs trimmed (count prefix)))]
                  (when-not (or (str/blank? after) (#{">" "|"} after))
                    (strip-quotes (strip-comment after)))))))
          (str/split-lines (or content "")))))

(defn- parse-conf-long [conf-text key default]
  (or (some->> (str/split-lines (or conf-text ""))
               (filter #(str/starts-with? % (str "config " key)))
               first
               (re-find #"\d+")
               parse-long)
      default))

(defn read-thresholds
  "Configurable p90 flag and p99 stop; defaults trace to measured distribution."
  [conf-text]
  {:p90-flag (parse-conf-long conf-text "slice_size_p90_flag" default-p90-flag)
   :p99-stop (parse-conf-long conf-text "slice_size_p99_stop" default-p99-stop)
   :median default-median})

(defn envelope-band
  "Declared band from slice_size_envelope:, else mutation_cost:, else medium."
  [content]
  (or (read-field content "slice_size_envelope")
      (read-field content "mutation_cost")
      "medium"))

(defn- read-insertions [content]
  (some-> (read-field content "size_envelope_insertions") parse-long))

(defn- has-decision? [content]
  (boolean (read-field content "size_envelope_decision")))

(defn- needs-decision? [content thresholds]
  (let [band (envelope-band content)
        insertions (read-insertions content)]
    (or (= "high" band)
        (and insertions (>= insertions (:p90-flag thresholds))))))

(defn refusal
  "nil when the gate passes; otherwise {:gate \"slice_size_envelope\" :reason ..}."
  [content conf-text]
  (let [thresholds (read-thresholds conf-text)]
    (when (needs-decision? content thresholds)
      (when-not (has-decision? content)
        {:gate "slice_size_envelope"
         :reason (format
                  "size envelope requires split-or-justify (band=%s insertions=%s; p90=%d median=%d)"
                  (envelope-band content)
                  (or (read-insertions content) "unset")
                  (:p90-flag thresholds)
                  (:median thresholds))}))))

(defn format-actual-size-recording
  "YAML lines QA appends to record actual slice size (BL-635 calibration input)."
  [insertions files]
  (str "actual_insertions: " insertions "\nactual_files: " files "\n"))
