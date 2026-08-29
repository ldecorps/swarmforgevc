#!/usr/bin/env bb
;; BL-1261: audit for divergence between backlog/hold/ and live parcels.
;; Reports tickets in hold/ that have parcels still moving in role mailboxes.
;; Report only - never moves tickets or parcels.

(ns hold-divergence-audit-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]
            [clojure.java.io :as io]))

(defn list-yaml-files [dir]
  "List all .yaml files in a directory (non-recursive)."
  (when (fs/directory? dir)
    (->> (fs/list-dir dir)
         (filter #(str/ends-with? (str %) ".yaml"))
         (map str))))

(defn ticket-id-from-yaml [yaml-path]
  "Extract the ticket id from a YAML file's 'id:' field."
  (when (fs/readable? yaml-path)
    (some (fn [line]
            (when (str/starts-with? line "id: ")
              (str/trim (subs line 4))))
          (str/split-lines (slurp yaml-path)))))

(defn list-handoff-files [dir]
  "List all .handoff files in a directory (non-recursive)."
  (when (and (fs/directory? dir) (fs/readable? dir))
    (->> (fs/list-dir dir)
         (filter #(str/ends-with? (str %) ".handoff"))
         (map str))))

(defn list-batch-dirs [dir]
  "List batch_* subdirectories (one level, never deeper)."
  (when (and (fs/directory? dir) (fs/readable? dir))
    (->> (fs/list-dir dir)
         (filter fs/directory?)
         (filter #(str/starts-with? (fs/file-name %) "batch_"))
         (map str))))

(defn list-handoff-files-with-batches [dir]
  "Direct .handoff files in dir, plus files inside any batch_* subdirectory."
  (when (and (fs/directory? dir) (fs/readable? dir))
    (concat (list-handoff-files dir)
            (mapcat list-handoff-files (list-batch-dirs dir)))))

(defn ticket-id-from-handoff [handoff-path]
  "Extract the ticket id from a handoff file's task or message field."
  (when (fs/readable? handoff-path)
    (let [content (slurp handoff-path)
          header (first (str/split content #"\n\n" 2))
          lines (str/split-lines header)]
      (or (some (fn [line]
                  (when (str/starts-with? line "task: ")
                    (let [task (str/trim (subs line 6))]
                      ;; Extract BL-NNNN from the task name
                      (when-let [match (re-find #"BL-\d+" task)]
                        match))))
                lines)
          (some (fn [line]
                  (when (str/starts-with? line "message: ")
                    (let [msg (str/trim (subs line 9))]
                      ;; Extract BL-NNNN from the message
                      (when-let [match (re-find #"BL-\d+" msg)]
                        match))))
                lines)))))

(defn all-role-dirs [backlog-root]
  "All role mailbox directories (inbox/new and inbox/in_process for each role)."
  (let [swarmforge-dir (fs/path backlog-root ".swarmforge" "handoffs")
        roles (when (fs/directory? swarmforge-dir)
                (->> (fs/list-dir swarmforge-dir)
                     (filter fs/directory?)
                     (map str)
                     (filter #(not (str/includes? % "completed")))))]
    (mapcat (fn [role-dir]
              (let [new-dir (fs/path role-dir "inbox" "new")
                    in-proc-dir (fs/path role-dir "inbox" "in_process")]
                (filter fs/directory? [new-dir in-proc-dir])))
            roles)))

(defn find-held-tickets [backlog-root]
  "Find all tickets in backlog/hold/ and return a map of ticket-id -> yaml-path."
  (let [hold-dir (fs/path backlog-root "backlog" "hold")]
    (when (fs/directory? hold-dir)
      (->> (list-yaml-files hold-dir)
           (map (fn [yaml-path]
                  (when-let [tid (ticket-id-from-yaml yaml-path)]
                    [tid yaml-path])))
           (filter identity)
           (into {})))))

(defn find-live-parcels [backlog-root]
  "Find all parcels in role mailboxes and return a map of ticket-id -> [mailbox-paths]."
  (let [role-dirs (all-role-dirs backlog-root)]
    (->> (for [dir role-dirs
               handoff (list-handoff-files-with-batches dir)
               :let [tid (ticket-id-from-handoff handoff)]
               :when tid]
           [tid (str dir)])
         (group-by first)
         (map (fn [[tid pairs]]
                [tid (mapv second pairs)]))
         (into {}))))

(defn audit [backlog-root]
  "Run the audit: find held tickets with live parcels.
   Returns {:divergences [{:ticket-id ... :mailboxes [...]}]
            :unreadable [...]}"
  (let [held (find-held-tickets backlog-root)
        live (find-live-parcels backlog-root)
        ;; Find held tickets that have live parcels
        divergences (->> (keys held)
                         (filter #(contains? live %))
                         (map (fn [tid]
                                {:ticket-id tid
                                 :mailboxes (get live tid)}))
                         (vec))
        ;; Check for unreadable mailboxes
        role-dirs (all-role-dirs backlog-root)
        unreadable (->> role-dirs
                        (remove fs/readable?)
                        (mapv str))]
    {:divergences divergences
     :unreadable unreadable
     :held-count (count held)
     :live-count (count live)}))

(defn format-report [audit-result]
  "Format the audit result as a human-readable report."
  (let [{:keys [divergences unreadable held-count live-count]} audit-result]
    (cond-> []
      (seq divergences)
      (conj (str "DIVERGENCE: " (count divergences) " held ticket(s) with live parcel(s):")
            (str/join "\n" (map (fn [d]
                                  (str "  - " (:ticket-id d) " in " (str/join ", " (:mailboxes d))))
                                divergences)))

      (seq unreadable)
      (conj (str "UNRESOLVED: " (count unreadable) " mailbox(es) unreadable:")
            (str/join "\n" (map #(str "  - " %) unreadable)))

      (and (empty? divergences) (empty? unreadable))
      (conj "CLEAN: no divergence detected"))))
