;; supersede_lib.bb (BL-1084) — durable, stage-independent supersede marker.
;;
;; A supersede note reaches one role; parcels already forwarded keep moving.
;; This lib is the backstop every role's turn-start consults (wired from
;; ready_for_next.bb beside BL-640's freshness guard). Pure decision logic
;; only — callers do the filesystem I/O.
;;
;; Store shape (operator-deletable by hand):
;;   .swarmforge/superseded/<task-name>   file contents = reason (first line)
;; Absent directory => nothing superseded. Unreadable store => refuse (never
;; treat as empty).
;;
;; Loaded via load-file; refer as supersede-lib/foo.

(ns supersede-lib
  (:require [clojure.string :as str]))

(def store-dir-rel ".swarmforge/superseded")

(defn parse-headers
  "Minimal handoff header map from file content (key -> value)."
  [content]
  (let [[header _] (str/split (or content "") #"\n\n" 2)]
    (into {}
          (for [line (str/split-lines (or header ""))
                :let [[k v] (str/split line #":\s*" 2)]
                :when (and k v (not (str/blank? k)))]
            [(str/lower-case (str/trim k)) (str/trim v)]))))

(defn task-name-from-content
  "Task name from a parcel: preferred `task:` header, else `Work BL-…` in
   message/body (Work notes often carry no task: header)."
  [content]
  (let [headers (parse-headers content)
        from-header (not-empty (get headers "task"))]
    (or from-header
        (when-let [m (re-find #"(?m)(?:^|\n)(?:message:\s*)?Work\s+(BL-\S+?)(?::|\s|$)" (or content ""))]
          (second m)))))

(defn entries-from-files
  "Pure: {task-name -> reason} from a seq of {:name :readable? :body}.
   Unreadable individual files make the WHOLE store unreadable (fail closed)."
  [files]
  (if (some (complement :readable?) files)
    {:status :unreadable :detail "one or more superseded marker files could not be read"}
    {:status :ok
     :entries (into {}
                    (for [{:keys [name body]} files
                          :when (and name (not (str/blank? name)))]
                      [name (str/trim (or (first (str/split-lines (or body ""))) ""))]))}))

(defn turn-verdict
  "Decide whether a turn may proceed.

   store: {:status :absent}
          | {:status :ok :entries {task reason}}
          | {:status :unreadable :detail string}
   candidate-tasks: task names this turn would touch (in_process first, then
   new/). May be empty (NO_TASK path) — absent/ok still pass; unreadable
   still refuses.

   Returns :ok
        or {:status :refused :kind :superseded|:store-unreadable
            :task :reason :message}"
  [store candidate-tasks]
  (case (:status store)
    :absent :ok
    :unreadable
    {:status :refused
     :kind :store-unreadable
     :task nil
     :reason nil
     :message (str "SUPERSEDE_STORE_UNREADABLE: the supersede marker store exists but cannot be read"
                   (when-let [d (:detail store)] (str " (" d ")"))
                   " — refusing the turn rather than treating an unreadable store as empty."
                   " Fix permissions or restore .swarmforge/superseded/, then retry.")}
    :ok
    (if-let [task (some (fn [t] (when (contains? (:entries store) t) t))
                        candidate-tasks)]
      (let [reason (get (:entries store) task)]
        {:status :refused
         :kind :superseded
         :task task
         :reason reason
         :message (str "SUPERSEDED: task " task " is recorded as superseded"
                       (when (seq reason) (str " — " reason))
                       ". Leaving the parcel in place; this is not a bounce."
                       " Clear .swarmforge/superseded/" task
                       " by hand only if the supersede was recorded in error.")})
      :ok)
    ;; Unknown status — fail closed.
    {:status :refused
     :kind :store-unreadable
     :task nil
     :reason nil
     :message "SUPERSEDE_STORE_UNREADABLE: unrecognized supersede store status — refusing."}))

(defn refusal-exit-message [verdict]
  (:message verdict))
