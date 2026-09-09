;; BL-1191: handoff-mail wake dedup. Suppresses repeated HANDOFF_WAKE_MESSAGE
;; injections when mailbox state is unchanged or within a bounded cooldown,
;; so Cursor follow-ups and tmux wakes do not stack. Shares a per-role sidecar
;; under .swarmforge/daemon/wake-dedup/<role>.json with the extension path
;; (verifiedInject.ts / wakeDedup.ts). BL-870 attribution records every inject
;; and skip at call sites in handoffd.bb.
;;
;; Hotfix 2026-09-09 (fresh-target): the sidecar also remembers WHICH seat
;; incarnation the last wake reached (`lastTargetEpoch`, the wake pane's root
;; pid as probed by handoffd). A wake is never suppressed as
;; unchanged-mailbox / cooldown for a target the sidecar has not woken yet:
;; the documenter seat was rotated at 07:54Z with its parcel still in
;; in_process, the daemon's startup-notify hit the pre-rotation fingerprint
;; and skipped, and the fresh aider session sat idle for 2h28m (flow-stall
;; escalation). A blank epoch (fixture fakes, tmux cannot answer) keeps the
;; pre-hotfix decision exactly.

(ns wake-dedup-lib
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "handoff_lib.bb")))

(def default-cooldown-ms 120000)

(def inject-reason-fresh-target "fresh-target")

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
  "Returns {:fingerprint string, :lastInjectedAtMs number,
   :lastTargetEpoch string} or nil. A sidecar written before the
   fresh-target hotfix reads back with a blank epoch."
  [state-dir role]
  (let [path (sidecar-path state-dir role)]
    (when (fs/exists? path)
      (try
        (let [data (json/parse-string (slurp (str path)) true)]
          (when (map? data)
            {:fingerprint (str (or (:fingerprint data) ""))
             :lastInjectedAtMs (long (or (:lastInjectedAtMs data) 0))
             :lastTargetEpoch (str (or (:lastTargetEpoch data) ""))}))
        (catch Exception _ nil)))))

(defn write-sidecar! [state-dir role {:keys [fingerprint lastInjectedAtMs lastTargetEpoch]}]
  (let [path (sidecar-path state-dir role)]
    (fs/create-dirs (fs/parent path))
    (spit (str path)
          (json/generate-string {:fingerprint (str fingerprint)
                                 :lastInjectedAtMs (long lastInjectedAtMs)
                                 :lastTargetEpoch (str (or lastTargetEpoch ""))}))))

(defn decide-wake-dedup
  "Pure. Returns {:action :inject|:suppress, :skip-reason string-or-nil,
   :fingerprint string}; an inject forced by a never-woken target also
   carries :inject-reason \"fresh-target\".

   :target-epoch identifies the live seat behind the wake pane (handoffd
   passes the pane's root pid). When it is non-blank and differs from
   :last-target-epoch the target has never received a wake, so neither
   unchanged-mailbox nor cooldown may suppress - those two reasons exist to
   stop wake text stacking in ONE pane, and a respawned/rotated seat is a
   different pane. An empty mailbox still suppresses: there is nothing to
   wake for."
  [{:keys [fingerprint last-fingerprint last-injected-at-ms now-ms cooldown-ms
           target-epoch last-target-epoch]}]
  (let [cooldown-ms (or cooldown-ms default-cooldown-ms)
        fp (str (or fingerprint ""))
        last-fp (str (or last-fingerprint ""))
        last-at (or last-injected-at-ms 0)
        within-cooldown? (and (pos? last-at) (< (- now-ms last-at) cooldown-ms))
        epoch (str (or target-epoch ""))
        last-epoch (str (or last-target-epoch ""))
        fresh-target? (and (not (str/blank? epoch)) (not= epoch last-epoch))]
    (cond
      (str/blank? fp)
      {:action :suppress :skip-reason "empty-mailbox" :fingerprint fp}

      fresh-target?
      {:action :inject :skip-reason nil :fingerprint fp
       :inject-reason inject-reason-fresh-target}

      (and (= fp last-fp) (not (str/blank? last-fp)) within-cooldown?)
      {:action :suppress :skip-reason "cooldown" :fingerprint fp}

      (and (= fp last-fp) (not (str/blank? last-fp)))
      {:action :suppress :skip-reason "unchanged-mailbox" :fingerprint fp}

      within-cooldown?
      {:action :suppress :skip-reason "cooldown" :fingerprint fp}

      :else
      {:action :inject :skip-reason nil :fingerprint fp})))

(defn load-decision [state-dir role-info now-ms & {:keys [cooldown-ms target-epoch]}]
  (let [fp (mailbox-fingerprint role-info)
        sidecar (read-sidecar state-dir (:role role-info))]
    (decide-wake-dedup {:fingerprint fp
                        :last-fingerprint (:fingerprint sidecar)
                        :last-injected-at-ms (:lastInjectedAtMs sidecar)
                        :now-ms now-ms
                        :cooldown-ms cooldown-ms
                        :target-epoch target-epoch
                        :last-target-epoch (:lastTargetEpoch sidecar)})))

(defn record-injection!
  "Records the wake. `target-epoch` (optional) is the seat incarnation the
   wake reached; a blank/absent epoch is stored blank so the next probe that
   CAN identify the seat counts as fresh."
  [state-dir role fingerprint now-ms & [target-epoch]]
  (write-sidecar! state-dir role {:fingerprint (str fingerprint)
                                  :lastInjectedAtMs now-ms
                                  :lastTargetEpoch (str (or target-epoch ""))}))
