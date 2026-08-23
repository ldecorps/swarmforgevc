;; BL-1081: the deterministic layer's view of an ACP-hosted seat.
;;
;; Pane text is the control channel for every other seat, and two expensive
;; incident families exist only because of it: idleness is INFERRED from a
;; frozen pane (defeated differently by a truncated tail, a ghost suggestion,
;; and a `pane_current_command` that lies), and a permission moment arrives as
;; an interactive menu that blocks the agent until a human notices.
;;
;; For a seat behind the ACP host, both are facts on disk. The host
;; (extension/src/swarm/acpHostRuntime.ts) rewrites .swarmforge/acp/<role>.json
;; on every structured event; this reads it. Nothing here parses a pane, and
;; that absence is the invariant.
;;
;; Deliberately flat and boring across the TS/bb boundary no import bridges:
;; every field is a scalar in the protocol's own vocabulary, so there is no
;; shared shape to drift. What DOES need holding together is the field NAMES,
;; and bl1081_acp_snapshot_agreement_test_runner.bb is that gate (BL-897: a
;; "kept in sync" comment is not one).

(ns acp-session-lib
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(defn snapshot-path
  "One file per seat. Must agree with acpHostRuntime.ts's acpSnapshotRelPath."
  [project-root role]
  (fs/path project-root ".swarmforge" "acp" (str role ".json")))

(defn read-snapshot
  "The seat's snapshot, or nil when this seat is not ACP-hosted (no file) or
   the file cannot be read. Unreadable is treated as ABSENT on purpose: a
   corrupt snapshot must fall back to the ordinary pane path, never strand the
   seat on a control channel that is not answering."
  [project-root role]
  (try
    (let [p (snapshot-path project-root role)]
      (when (fs/exists? p)
        (let [m (json/parse-string (slurp (str p)) true)]
          (when (and (map? m) (true? (:acp m))) m))))
    (catch Exception _ nil)))

(defn acp-hosted?
  "Is this seat driven over ACP? Answered from the snapshot's own presence, so
   a seat is ACP-hosted exactly when its host is actually running and writing."
  [snapshot]
  (boolean (and snapshot (true? (:acp snapshot)))))

(defn stop-reason
  "The structured stop reason of the seat's last completed turn, or nil when no
   turn has ended. This is the fact that replaces reading a frozen pane."
  [snapshot]
  (let [v (:stopReason snapshot)]
    (when-not (str/blank? (str v)) v)))

(defn idle-decision
  "{:idle? bool :from str} for an ACP seat, taken from the snapshot and from
   nothing else, or nil when the seat is not ACP-hosted (the caller then keeps
   whatever it did before - this widens no other path).

   `from` names the structured fact the verdict came from, so a decision trail
   can be read back and checked. QA procedure step 2 asks for exactly that:
   confirm the layer marked it idle FROM the stop reason rather than inferring
   it from the seat happening to be picked up."
  [snapshot]
  (when (acp-hosted? snapshot)
    {:idle? (true? (:idle snapshot))
     :from (or (:idleFrom snapshot) "unknown")}))

(defn permission-pending?
  "Is the seat blocked on a structured permission request?"
  [snapshot]
  (boolean (and (acp-hosted? snapshot) (true? (:permissionPending snapshot)))))

(defn menu-check-applies?
  "BL-1081: the babysitter's interactive-menu CRIT exists because a permission
   moment is only visible as pane text. For an ACP seat it is a structured
   message instead, so the pane check has nothing to add and must NOT fire -
   a CRIT on a seat whose permission moments are already handled is a false
   alarm on correct behaviour, which is how a health signal stops being read.

   Every non-ACP seat keeps the check exactly as before."
  [snapshot]
  (not (acp-hosted? snapshot)))

;; ── the babysitter's decision site ───────────────────────────────────────

(defn acp-seat-facts
  "The structured facts an ACP-hosted seat's control decisions are taken from,
   flattened for the babysitter's per-agent assessment input.

   A nil snapshot (every seat that is not ACP-hosted) yields the shape the
   ordinary pane path already had: not hosted, no structured idle verdict to
   prefer, and the interactive-menu CRIT still applying. This ticket widens no
   other seat's path, and that is asserted rather than intended."
  [snapshot]
  (let [hosted? (acp-hosted? snapshot)
        idle (idle-decision snapshot)]
    {:acp? hosted?
     :acp-idle? (when hosted? (:idle? idle))
     ;; Names the fact the verdict came from, so the decision trail QA step 2
     ;; asks for can be read back. "pane" for every non-ACP seat, which is the
     ;; honest label for what those decisions still rest on.
     :idle-from (if hosted? (:from idle) "pane")
     :permission-pending? (permission-pending? snapshot)
     :menu-check-applies? (menu-check-applies? snapshot)}))

(defn apply-acp-facts
  "Fold those facts into one agent's assessment input.

   The caller's own keys are left ALONE - this merges onto them and inspects
   none of them. Invariant 2 of this ticket is that the pane keeps a
   human-readable transcript and the babysitter's pane checks survive; a seat
   whose captured pane were blanked or ignored here would pass every structured
   check and quietly cost the observability the swarm is watched through.

   `reason` is passed IN by the caller rather than re-derived, because the
   caller is the place the idle/stuck decision is actually taken and the wiring
   has to be visible there (BL-1081 required_wiring). It must be what
   `stop-reason` returns for this same snapshot: a caller naming a different
   one is deciding from a stale fact, and this throws rather than silently
   preferring either side."
  [assess-input snapshot reason]
  (let [actual (stop-reason snapshot)]
    (when-not (= actual reason)
      (throw (ex-info "BL-1081: the caller's stop reason disagrees with the seat snapshot"
                      {:snapshot-stop-reason actual :caller-stop-reason reason})))
    (merge assess-input (acp-seat-facts snapshot) {:stop-reason reason})))
