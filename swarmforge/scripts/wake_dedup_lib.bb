;; BL-1191: handoff-mail wake dedup. Suppresses repeated HANDOFF_WAKE_MESSAGE
;; injections when mailbox state is unchanged or within a bounded cooldown,
;; so Cursor follow-ups and tmux wakes do not stack. Shares a per-role sidecar
;; under .swarmforge/daemon/wake-dedup/<role>.json with the extension path
;; (verifiedInject.ts / wakeDedup.ts). BL-870 attribution records every inject
;; and skip at call sites in handoffd.bb.

(ns wake-dedup-lib
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "handoff_lib.bb")))

(def default-cooldown-ms 120000)

(defn- handoff-basenames [role-info dir-key]
  (let [dir (handoff-lib/mailbox-dir role-info dir-key)]
    (when (fs/exists? dir)
      (->> (fs/list-dir dir)
           (filter #(and (fs/regular-file? %) (str/ends-with? (fs/file-name %) ".handoff")))
           (map fs/file-name)
           sort
           vec))))

(defn mailbox-fingerprint
  "Deterministic fingerprint of a role's mailbox: sorted basenames in
   inbox/new plus inbox/in_process. Empty string when both are empty."
  [role-info]
  (let [names (vec (concat (or (handoff-basenames role-info :new) [])
                           (or (handoff-basenames role-info :in_process) [])))]
    (if (empty? names)
      ""
      (let [digest (doto (java.security.MessageDigest/getInstance "SHA-256")
                     (.update (.getBytes (str/join "\n" names) "UTF-8")))
            raw (.digest digest)]
        (apply str (map #(format "%02x" %) raw))))))

(defn sidecar-path [state-dir role]
  (fs/path state-dir "daemon" "wake-dedup" (str role ".json")))

(defn read-sidecar
  "Returns {:fingerprint string, :lastInjectedAtMs number} or nil."
  [state-dir role]
  (let [path (sidecar-path state-dir role)]
    (when (fs/exists? path)
      (try
        (let [data (json/parse-string (slurp (str path)) true)]
          (when (map? data)
            {:fingerprint (str (or (:fingerprint data) ""))
             :lastInjectedAtMs (long (or (:lastInjectedAtMs data) 0))}))
        (catch Exception _ nil)))))

(defn write-sidecar! [state-dir role {:keys [fingerprint lastInjectedAtMs]}]
  (let [path (sidecar-path state-dir role)]
    (fs/create-dirs (fs/parent path))
    (spit (str path)
          (json/generate-string {:fingerprint (str fingerprint)
                                          :lastInjectedAtMs (long lastInjectedAtMs)}))))

(defn decide-wake-dedup
  "Pure. Returns {:action :inject|:suppress, :skip-reason string-or-nil,
   :fingerprint string}."
  [{:keys [fingerprint last-fingerprint last-injected-at-ms now-ms cooldown-ms]}]
  (let [cooldown-ms (or cooldown-ms default-cooldown-ms)
        fp (str (or fingerprint ""))
        last-fp (str (or last-fingerprint ""))
        last-at (or last-injected-at-ms 0)
        within-cooldown? (and (pos? last-at) (< (- now-ms last-at) cooldown-ms))]
    (cond
      (str/blank? fp)
      {:action :suppress :skip-reason "empty-mailbox" :fingerprint fp}

      (and (= fp last-fp) (not (str/blank? last-fp)) within-cooldown?)
      {:action :suppress :skip-reason "cooldown" :fingerprint fp}

      (and (= fp last-fp) (not (str/blank? last-fp)))
      {:action :suppress :skip-reason "unchanged-mailbox" :fingerprint fp}

      within-cooldown?
      {:action :suppress :skip-reason "cooldown" :fingerprint fp}

      :else
      {:action :inject :skip-reason nil :fingerprint fp})))

(defn load-decision [state-dir role-info now-ms & {:keys [cooldown-ms]}]
  (let [fp (mailbox-fingerprint role-info)
        sidecar (read-sidecar state-dir (:role role-info))]
    (decide-wake-dedup {:fingerprint fp
                        :last-fingerprint (:fingerprint sidecar)
                        :last-injected-at-ms (:lastInjectedAtMs sidecar)
                        :now-ms now-ms
                        :cooldown-ms cooldown-ms})))

(defn record-injection! [state-dir role fingerprint now-ms]
  (write-sidecar! state-dir role {:fingerprint (str fingerprint)
                                  :lastInjectedAtMs now-ms}))
