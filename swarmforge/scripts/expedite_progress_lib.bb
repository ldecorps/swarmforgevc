;; Pure helpers for expedite progress reporting (BL-696 follow-up).

(ns expedite-progress-lib
  (:require [cheshire.core :as json]
            [clojure.string :as str]))

(def stage-emoji
  {"specifier" "📝"
   "coder" "💻"
   "cleaner" "🧹"
   "architect" "🏛"
   "hardender" "🛡"
   "documenter" "📚"
   "QA" "✅"})

(defn stage-label [stage]
  (str (get stage-emoji (name stage) "•") " " (name stage)))

(defn format-progress-line [{:keys [ticket stage status detail]}]
  (let [prefix (str "[" ticket "] " (stage-label stage) " — " (name status))]
    (if (str/blank? (str detail))
      prefix
      (str prefix "\n" detail))))

(defn parse-progress-file [raw]
  (when (and raw (not (str/blank? raw)))
    (try (json/parse-string raw true) (catch Exception _ nil))))
