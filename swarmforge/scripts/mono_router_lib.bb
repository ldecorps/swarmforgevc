;; mono_router_lib.bb — pure topology rules for `config rotation router`.
;;
;; Intended standing shape (BL-518):
;;   - ONE resident pipeline pane (first non-coordinator role in roles.tsv)
;;   - coordinator (always standing infrastructure)
;;   - every other pipeline role is a dormant rotate target (launch script
;;     on disk only; no tmux session)
;;
;; No filesystem / tmux I/O here — callers inject conf text and role rows.

(ns mono-router-lib
  (:require [clojure.string :as str]))

(defn conf-rotation-router?
  "True when pack/conf text declares `config rotation router`."
  [conf-text]
  (boolean
   (when conf-text
     (re-find #"(?m)^(?:config\s+)?rotation\s+router\b"
              (str conf-text)))))

(defn parse-identity-map
  "Parse swarm-identity TSV (key\\tvalue lines) into a string map."
  [identity-text]
  (->> (str/split-lines (or identity-text ""))
       (remove str/blank?)
       (keep (fn [line]
               (let [[k v] (str/split line #"\t" 2)]
                 (when (and k v) [k v]))))
       (into {})))

(defn rotation-router-from-identity?
  "True when identity already records rotation=router."
  [identity-text]
  (= "router" (get (parse-identity-map identity-text) "rotation")))

(defn classify-role
  "Given ordered role names (roles.tsv order) and one role, return
   :resident | :coordinator | :dormant.
   Resident = first role that is not coordinator."
  [ordered-roles role]
  (let [roles (vec ordered-roles)
        resident (first (remove #(= "coordinator" %) roles))]
    (cond
      (= role "coordinator") :coordinator
      (= role resident) :resident
      :else :dormant)))

(defn should-have-standing-session?
  "Under rotation router, only resident + coordinator stand."
  [ordered-roles role]
  (contains? #{:resident :coordinator} (classify-role ordered-roles role)))

(defn topology-action
  "Pure decide for one role under mono-router.
   alive? = session currently exists.
   Returns :ok | :ensure-standing | :teardown-illicit | :dormant-ok."
  [ordered-roles role alive?]
  (let [standing? (should-have-standing-session? ordered-roles role)]
    (cond
      (and standing? alive?) :ok
      (and standing? (not alive?)) :ensure-standing
      (and (not standing?) alive?) :teardown-illicit
      :else :dormant-ok)))

(defn summarize-topology
  "For reporting: count actions across roles with {:role :alive?}."
  [ordered-roles role-alive-rows]
  (let [actions (map (fn [{:keys [role alive?]}]
                       {:role role
                        :class (classify-role ordered-roles role)
                        :action (topology-action ordered-roles role (boolean alive?))})
                     role-alive-rows)]
    {:actions actions
     :illicit (filterv #(= :teardown-illicit (:action %)) actions)
     :missing-standing (filterv #(= :ensure-standing (:action %)) actions)}))

(defn dormant-mailbox-chase-action
  "How chase should poke a role that may be a mono-router dormant target.

   Incident 2026-07-19: wake-session remapped cleaner→resident while the
   resident was still identity=coder. Chase injected 'new handoff mail' into
   the coder pane; ready_for_next read coder's empty mailbox → NO_TASK, while
   cleaner/inbox/new held the real parcels. Coordinator could not promote the
   next ticket because BL-508 stayed active waiting on cleaner.

   Returns:
     :wake-own-session — role has its own standing pane; wake that session
     :wake-resident    — no own pane, but resident already IS this role
     :rotate           — no own pane, and resident is a different identity;
                         must respawn-as! before any wake
     :wake-own-session — also the degrade path when no resident pane exists"
  [{:keys [target-session-exists? resident-session-exists? active-role target-role]}]
  (cond
    target-session-exists? :wake-own-session
    (not resident-session-exists?) :wake-own-session
    (= (str active-role) (str target-role)) :wake-resident
    :else :rotate))

(defn resident-launch-role
  "Under mono-router the standing tmux session keeps the home role's session
   name (usually coder), but after rotate_to_role the pane runs a different
   role's launch script. `./swarm ensure` must restore THAT script, not always
   home — otherwise ensure mid-pipeline wipes cleaner/architect/… back to coder."
  [home-role active-role]
  (let [active (some-> active-role str str/trim not-empty)]
    (or active home-role)))

(defn should-send-stuck-escalation-email?
  "Whether handoffd should email the human for a stuck-escalation edge.
   Mono-router dormant roles keep roles.tsv session names with no standing
   pane — emailing \"specifier is stuck\" floods the human and cannot be
   fixed by attaching that session. Still record chase-escalations.json;
   skip the email when escalating a role with no live session. Clearing
   (escalated?=false) always proceeds so recovery can disarm state."
  [{:keys [escalated? session-exists?]}]
  (or (not escalated?) (boolean session-exists?)))
