#!/usr/bin/env bb
;; control_plane_lib.bb — BL-958: the single home for control-plane-loss
;; classification, incident persistence, and response policy.
;;
;; The crash class: the tmux server disappears while support daemons stay up
;; (live 2026-08-19: every role read DOWN, handoffd healthy, repeated
;; `tmux send-literal failed` chases, socket file still on disk, `tmux ls`
;; answering "no server running"). Before this lib each consumer saw only its
;; own slice — status rendered per-role DOWN from a dead probe, handoffd
;; logged and retried forever, ensure repaired panes one by one — and nobody
;; said "the control plane is gone" out loud.
;;
;; One chokepoint, three consumers (the ticket's required_wiring):
;;   swarm_status.bb  — classifies through `classify` and renders through
;;                      `status-agents-view` (never per-role DOWN from stale
;;                      session metadata),
;;   handoffd.bb      — a failed chase send persists exactly one open
;;                      incident via `record-chase-failure-incident!`,
;;   swarm_ensure.bb  — decides recovery through `recovery-decision` and
;;                      closes incidents via `resolve-open-incidents!`.
;;
;; Pure decisions up top (facts in, decisions out — fixture-testable);
;; file/tmux IO kept to the parameterized edge functions below.

(ns control-plane-lib
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def classification-token
  "Fixed by the BL-958 acceptance contract."
  "control-plane-missing")

;; ── pure: classification ─────────────────────────────────────────────────────

(defn classify
  "Decide the control-plane state from observed facts.

   :up                    — the tmux server answers on the socket.
   :control-plane-missing — socket file present, role metadata still present,
                            server not answering. Abnormal by construction:
                            a normal stop (kill_pipeline_swarm.sh) removes
                            BOTH the tmux-socket file and sessions.tsv, so
                            this shape only arises when the server died
                            under a swarm that believes it is running.
   :down                  — server not answering and the launch artifacts
                            are (at least partly) cleaned: an ordinarily
                            stopped or never-launched swarm, not a loss."
  [{:keys [socket-file-exists? server-responds? role-metadata-present?]}]
  (cond
    server-responds? :up
    (and socket-file-exists? role-metadata-present?) :control-plane-missing
    :else :down))

;; ── pure: incident build / record / resolve ──────────────────────────────────

(defn build-incident
  "The single actionable artifact for one loss. Every field is passed in
   (including the clock) so fixtures pin them; the response decision is
   attached at record time by record-chase-failure-incident! below."
  [{:keys [socket-path probe-output expected-sessions observed-at source]}]
  {:classification classification-token
   :socket-path (str socket-path)
   :probe-output (str probe-output)
   :expected-sessions (vec expected-sessions)
   :observed-at (str observed-at)
   :source (str source)
   :status "open"})

(defn open-incident? [incident]
  (= "open" (str (:status incident))))

(defn same-open-loss?
  "An OPEN incident for the same socket is the same loss — chase retries
   against a dead server must never fan out into an incident per retry."
  [existing candidate]
  (and (open-incident? existing)
       (= (:classification existing) (:classification candidate))
       (= (:socket-path existing) (:socket-path candidate))))

(defn record-incident
  "Exactly one OPEN incident per loss: append only when no open incident for
   this loss exists. A RESOLVED prior incident never blocks a new loss."
  [incidents candidate]
  (if (some #(same-open-loss? % candidate) incidents)
    {:incidents (vec incidents) :recorded? false}
    {:incidents (conj (vec incidents) candidate) :recorded? true}))

(defn resolve-incidents
  "Stamp every open incident resolved (the server answered again)."
  [incidents resolved-at]
  (mapv #(if (open-incident? %)
           (assoc % :status "resolved" :resolved-at (str resolved-at))
           %)
        incidents))

;; ── pure: response policy (invariant 4) ──────────────────────────────────────

(defn response-policy
  "Exactly one owning daemon, one deterministic action.

   Owner: babysitterd. The live incident answered the ownership question the
   hard way — operator-runtime was itself down/stale while the control plane
   was gone, so the owner must not be a daemon this shape can take out with
   it; pane liveness is babysitterd's whole job. operator-runtime's absence
   was parallel damage, not the detection path.

   Action: recover when persisted launch scripts exist to respawn roles from
   (`./swarm ensure` recreates sessions, and tmux restarts its server on the
   first new-session); otherwise a single escalation carrying the reason and
   the concrete next action — never repeated silent degradation."
  [{:keys [incident launch-scripts-present?]}]
  (if launch-scripts-present?
    {:owner "babysitterd"
     :action :recover
     :command "./swarm ensure"
     :reason (str "tmux control plane missing at " (:socket-path incident)
                  " while role metadata is still present; persisted launch"
                  " scripts allow session recovery")}
    {:owner "babysitterd"
     :action :escalate
     :reason (str "tmux control plane missing at " (:socket-path incident)
                  " and no persisted launch scripts exist to respawn roles from")
     :next-action (str "relaunch the swarm (./start-swarm.sh) and inspect "
                       ".swarmforge/incidents/control-plane.json for the evidence")}))

(defn recovery-decision
  "What ./swarm ensure should do about the classification it just made.
   :relaunch-roles — proceed with per-role session recreation from the
   persisted launch scripts (creating the first session restarts the tmux
   server itself); :halt — recreation is impossible, report loudly instead
   of churning; :none — nothing to recover."
  [{:keys [classification launch-scripts-present?]}]
  (cond
    (not= :control-plane-missing classification)
    {:action :none}

    launch-scripts-present?
    {:action :relaunch-roles
     :reason "recreating role sessions from persisted launch scripts"}

    :else
    {:action :halt
     :reason "no persisted launch scripts to respawn roles from"}))

;; ── pure: status view (invariants 1 and 3) ───────────────────────────────────

(defn status-agents-view
  "What `./swarm status` shows under Agents. On :control-plane-missing the
   per-role rows are replaced by ONE control-plane row: with the server gone
   there is no live truth about any individual role, and rendering per-role
   DOWN from stale session metadata is exactly the misdiagnosis the live
   incident produced. Any other classification passes the rows through."
  [{:keys [classification agent-rows socket-path]}]
  (if (= :control-plane-missing classification)
    [{:name "control-plane"
      :status :control-plane-missing
      :uptime nil
      :detail (str "tmux server not responding; socket=" socket-path
                   "; role metadata still present; run ./swarm ensure")}]
    (vec agent-rows)))

;; ── IO edge: live probe ──────────────────────────────────────────────────────

(defn probe-server!
  "Does a tmux server answer on this socket? Uses list-sessions so the same
   probe distinguishes 'server up' from 'no server running' (a dead server
   fails with that exact stderr); output is kept for incident evidence."
  [socket]
  (if (str/blank? (str socket))
    {:responds? false :output "no socket path resolved"}
    (let [result (process/sh {:continue true}
                             "tmux" "-S" (str socket) "list-sessions"
                             "-F" "#{session_name}")]
      {:responds? (zero? (:exit result))
       :output (str/trim (str (:out result) " " (:err result)))})))

;; ── IO edge: persistence ─────────────────────────────────────────────────────

(defn incidents-file [state-dir]
  (fs/path state-dir "incidents" "control-plane.json"))

(defn read-incidents
  "Corrupt or missing store degrades to empty — an unreadable incident file
   must never take the chase sweep or status down with it."
  [path]
  (if (fs/exists? path)
    (try
      (let [parsed (json/parse-string (slurp (str path)) true)]
        (if (sequential? parsed) (vec parsed) []))
      (catch Exception _ []))
    []))

(defn write-incidents! [path incidents]
  (fs/create-dirs (fs/parent path))
  (spit (str path) (json/generate-string incidents {:pretty true})))

(defn persist-incident!
  "Record-then-write with the exactly-one-open-incident rule; a duplicate
   loss leaves the store untouched."
  [path candidate]
  (let [{:keys [incidents recorded?]} (record-incident (read-incidents path) candidate)]
    (when recorded?
      (write-incidents! path incidents))
    {:recorded? recorded? :incidents incidents}))

(defn resolve-open-incidents!
  "Close every open incident (server observed answering again). No-op when
   nothing is open, so healthy sweeps never rewrite the store."
  [path resolved-at]
  (let [existing (read-incidents path)]
    (when (some open-incident? existing)
      (write-incidents! path (resolve-incidents existing resolved-at)))))

;; ── composed: the chase-failure hook (handoffd wiring) ───────────────────────

(defn launch-scripts-present? [state-dir]
  (let [dir (fs/path state-dir "launch")]
    (boolean
     (and (fs/directory? dir)
          (some #(str/ends-with? (str %) ".sh") (fs/list-dir dir))))))

(defn record-chase-failure-incident!
  "Called when a chase tmux send fails: probe the control plane, classify,
   and — only for the loss shape — persist exactly one open incident with
   the evidence and the response decision embedded. Returns
   {:classification .. :recorded? ..}; never throws state back at the sweep."
  [{:keys [state-dir socket expected-sessions observed-at source]}]
  (let [probe-result (probe-server! socket)
        facts {:socket-file-exists? (fs/exists? (fs/path state-dir "tmux-socket"))
               :server-responds? (:responds? probe-result)
               :role-metadata-present? (or (fs/exists? (fs/path state-dir "roles.tsv"))
                                           (fs/exists? (fs/path state-dir "sessions.tsv")))}
        classification (classify facts)]
    (if (= :control-plane-missing classification)
      (let [incident (build-incident {:socket-path socket
                                      :probe-output (:output probe-result)
                                      :expected-sessions expected-sessions
                                      :observed-at observed-at
                                      :source source})
            response (response-policy {:incident incident
                                       :launch-scripts-present? (launch-scripts-present? state-dir)})
            outcome (persist-incident! (incidents-file state-dir)
                                       (assoc incident :response response))]
        {:classification classification :recorded? (:recorded? outcome)})
      {:classification classification :recorded? false})))
