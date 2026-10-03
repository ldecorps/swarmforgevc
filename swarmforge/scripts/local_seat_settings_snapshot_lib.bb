;; BL-1850: the PURE half of a local-model seat's settings snapshot - the
;; record that ties a change in the seat's behaviour to the setting that
;; changed. local_seat_settings_snapshot_cli.bb gathers the facts (Ollama's
;; /api/version and /api/show, qwen's settings files and version, the card,
;; nvidia-smi) and appends the row; everything that shapes the row lives
;; here, with no HTTP call, no subprocess and no filesystem.
;;
;; Loaded via load-file and referred to as local-seat-settings-snapshot-lib/foo.
(ns local-seat-settings-snapshot-lib
  (:require [cheshire.core :as json]
            [clojure.string :as str]))

(def unknown
  "How a source that did not answer is marked in the row."
  "unknown")

(defn- parse-value [s]
  (let [t (str/trim (str s))
        unquoted (if (and (>= (count t) 2) (str/starts-with? t "\"") (str/ends-with? t "\""))
                   (subs t 1 (dec (count t)))
                   t)]
    (cond
      (not= unquoted t) unquoted
      (re-matches #"-?\d+" t) (Long/parseLong t)
      (re-matches #"-?\d+\.\d+" t) (Double/parseDouble t)
      :else t)))

(defn parse-show-parameters
  "Ollama /api/show's `parameters` text (one `name value` per line) as a
   map: numbers as numbers, quoted strings unquoted, a name repeated (stop)
   as a vector of its values in order."
  [text]
  (reduce (fn [acc line]
            (let [[_ k v] (re-matches #"\s*(\S+)\s+(.*?)\s*" line)]
              (if-not k
                acc
                (let [value (parse-value v)]
                  (if (contains? acc k)
                    (update acc k #(if (vector? %) (conj % value) [% value]))
                    (assoc acc k value))))))
          {}
          (str/split-lines (str text))))

(defn pick-provider-entry
  "The modelProviders.openai entry qwen uses for model: the seat worktree's
   settings list replaces the user list when it carries one (QA's BL-1838
   reading), else the user list's. nil when the list qwen uses has none."
  [{:keys [workspace user model]}]
  (let [ws-list (get-in workspace [:modelProviders :openai])
        providers (if (some? ws-list) ws-list (get-in user [:modelProviders :openai]))]
    (some #(when (= (:id %) model) %) providers)))

(defn credential-key?
  "Every key naming an API key (apiKey, timeoutApiKey, OPENAI_API_KEY), a
   token, a secret or a password. envKey is not one: its value names an
   environment variable, never holds a credential."
  [k]
  (let [s (str/lower-case (name k))]
    (or (str/includes? s "apikey")
        (str/includes? s "api_key")
        (str/includes? s "api-key")
        (str/includes? s "token")
        (str/includes? s "secret")
        (str/includes? s "password"))))

(defn drop-credentials
  "x with every map entry whose key is a credential key removed, at any
   depth, inside maps and vectors alike."
  [x]
  (cond
    (map? x) (into (empty x) (for [[k v] x :when (not (credential-key? k))] [k (drop-credentials v)]))
    (sequential? x) (mapv drop-credentials x)
    :else x))

(defn parse-nvidia-smi
  "The first GPU's `name, enforced.power.limit, power.default_limit` line
   (csv,noheader) as {:name :powerLimitW :defaultPowerLimitW}, or nil."
  [text]
  (let [line (first (remove str/blank? (str/split-lines (str text))))
        [name enforced default] (some-> line (str/split #"\s*,\s*"))
        watts (fn [s] (some->> s (re-find #"-?\d+(?:\.\d+)?") Double/parseDouble))]
    (when (and (not (str/blank? name)) (watts enforced) (watts default))
      {:name (str/trim name) :powerLimitW (watts enforced) :defaultPowerLimitW (watts default)})))

(defn- canonical
  "x with every map's keys sorted, so equal settings always print equally."
  [x]
  (cond
    (map? x) (into (sorted-map) (for [[k v] x] [(name k) (canonical v)]))
    (sequential? x) (mapv canonical x)
    :else x))

(defn fingerprint
  "sha256 (hex) of every field of row except :at and :fingerprint: it
   changes only when a setting does."
  [row]
  (let [text (json/generate-string (canonical (dissoc row :at :fingerprint)))
        digest (.digest (java.security.MessageDigest/getInstance "SHA-256") (.getBytes text "UTF-8"))]
    (apply str (map #(format "%02x" (bit-and % 0xff)) digest))))

(defn finish-row
  "row with its :fingerprint."
  [row]
  (assoc row :fingerprint (fingerprint row)))
