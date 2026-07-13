#!/usr/bin/env bb

;; BL-324: slice 3 of the dynamic-per-ticket-agent-routing epic. BL-317
;; records which roles a ticket needs (routing_manifest_lib.bb) and
;; deliberately brings nothing up or down - the manifest is INERT without
;; this slice acting on it. This is the per-role SIBLING of BL-307's
;; whole-swarm hibernate-swarm!/relaunch-swarm! (operator_lib.bb) - same
;; adapter-injected shape, one role at a time instead of the whole roster.
;;
;; Park = remove the role from .swarmforge/roles.tsv and kill its pane (the
;; Operator's proven mechanism; a roster-absent role is already a
;; first-class state everywhere - BL-307's roster-idle?, BL-316's
;; roster-driven clear). Unpark = the reverse, in the opposite order (see
;; park-role!/unpark-role! below for why the ordering itself matters).
;;
;; Pure decision logic only in this file - no filesystem, no tmux, no
;; clock. The impure roles.tsv/tmux adapters are wired in
;; role_lifecycle_cli.bb, the shell-callable entry point the coordinator
;; calls on promote (mirrors quiet_period_gate_cli.bb's own CLI-wrapper
;; shape for BL-318's gate).

(ns role-lifecycle-lib)

(def warm-core-roles
  "Roles structurally exempt from parking regardless of any ticket's
   manifest. Coordinator is the dispatcher and the most-woken role -
   parking it is almost certainly never right, and it is also the one
   role no pack can move off Claude today (BL-319). Never a member of
   routing_manifest_lib's own standard-chain (BL-243: coordinator is not
   a pipeline chain role at all), so it can never appear in a ticket's
   declared roles: manifest either - the exemption below is the ONLY
   place its warm-core status is expressed."
  #{"coordinator"})

(defn role-needed?
  "True when role must stay alive: it is warm-core (always), OR the
   CURRENT ticket's manifest names it, OR the NEXT QUEUED ticket's
   manifest names it (hysteresis/lookahead - never park a role about to
   be needed again immediately; park/unpark churn can cost more than
   leaving a role warm)."
  [role current-needed next-needed]
  (boolean (or (contains? warm-core-roles role)
               (contains? (set current-needed) role)
               (contains? (set next-needed) role))))

(defn parkable?
  "A roster role is parkable only when it is NOT needed (role-needed?
   above) AND it is idle (role-idle?-shaped :idle? - never park a role
   holding an in-process task or a pending inbox item; DRAIN BEFORE PARK
   is a hard constraint, not a preference - see the ticket's own note on
   why this slice cannot ship before BL-323)."
  [{:keys [role idle?]} current-needed next-needed]
  (boolean (and idle? (not (role-needed? role current-needed next-needed)))))

(defn roles-to-park
  "Given the CURRENT roster (a vector of {:role :idle?} - the SAME shape
   role-idle?'s own caller already builds), the current ticket's
   needed-roles, and the next queued ticket's needed-roles, returns the
   set of role names safe to park this cycle. A non-idle role is NEVER
   included, full stop - no exception, no override."
  [roster current-needed next-needed]
  (set (map :role (filter #(parkable? % current-needed next-needed) roster))))

(defn roles-to-unpark
  "Given the roster's CURRENT role names and the roles the ticket at hand
   needs, returns the roles that must be brought back up - needed but not
   currently present in the roster (a previously-parked role, or a role
   that was never provisioned at all)."
  [roster-role-names current-needed]
  (set (remove (set roster-role-names) current-needed)))

(defn park-role!
  "Adapter-injected: park ONE role. The roster row is removed FIRST, then
   the pane is killed - never the reverse. The roster is the source of
   truth for who is EXPECTED alive; removing the row first means a crash
   between the two steps leaves at worst 'a ghost pane nobody expects'
   (harmless - the next sweep's own roster read never sees it), never
   'expected alive but the pane is already gone' (exactly the
   AGENT_EXITED-respawn-fight state this whole ticket exists to prevent).
   adapters: :remove-role-row! (fn [role]), :kill-role-session! (fn [role])."
  [role adapters]
  ((:remove-role-row! adapters) role)
  ((:kill-role-session! adapters) role)
  {:parked role})

(defn unpark-role!
  "Adapter-injected: bring ONE role back up. The roster row is re-added
   FIRST, then the session is (re)spawned - mirrors relaunch-swarm!'s own
   restore-then-relaunch order: a crash mid-unpark leaves 'expected alive,
   pane not yet up' (safely recoverable - the next sweep/manual restart
   provisions it), never a phantom pane with no roster entry to claim it.
   adapters: :add-role-row! (fn [role]), :respawn-role! (fn [role])."
  [role adapters]
  ((:add-role-row! adapters) role)
  ((:respawn-role! adapters) role)
  {:unparked role})

(defn- pull-eligible?
  "Duplicated from operator_lib.bb's own paused-item-pull-eligible? - the
   same small live-glue duplication already established across this
   codebase's independent pure libs (read-yaml-field, operator-channel-
   name) rather than cross-namespace-coupling two standalone lib files."
  [{:keys [status]}]
  (not= status "blocked"))

(defn next-queued-roles
  "Given the paused backlog items (each {:status :priority :roles} - roles
   already resolved via routing_manifest_lib/read-roles by the caller,
   since manifest parsing is that lib's own job, not duplicated here),
   picks the highest-priority (lowest number wins, this schema's own
   convention) PULL-ELIGIBLE candidate and returns its declared roles
   manifest - the lookahead role-needed?/roles-to-park above check against.
   nil when no eligible candidate exists (the caller's cue that there is
   nothing to look ahead to this cycle - never blocks park/unpark, the
   hysteresis check just has nothing to add)."
  [paused-items]
  (->> paused-items
       (filter pull-eligible?)
       (sort-by #(or (:priority %) Long/MAX_VALUE))
       first
       :roles))

(defn evaluate-role-lifecycle!
  "The whole per-role lifecycle pass for one shape-change: bring the
   roster from its CURRENT shape to the promoted ticket's needed shape.
   Parks every parkable role (roles-to-park), then unparks every
   needed-but-absent role (roles-to-unpark) - park before unpark, so a
   role being handed off between two DIFFERENT roster slots in the same
   pass never transiently exceeds the roster's real capacity. adapters:
   the same four functions park-role!/unpark-role! above need."
  [roster current-needed next-needed adapters]
  (let [to-park (roles-to-park roster current-needed next-needed)
        roster-names (map :role roster)
        to-unpark (roles-to-unpark roster-names current-needed)]
    {:parked (vec (map #(park-role! % adapters) (sort to-park)))
     :unparked (vec (map #(unpark-role! % adapters) (sort to-unpark)))}))
