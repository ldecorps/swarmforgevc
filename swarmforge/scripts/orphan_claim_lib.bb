;; BL-648: pure decision logic for the launch-time (or handoffd-tick)
;; orphan-claim sweep. See orphan_claim_sweep_lib.bb for the impure wiring
;; half (mirrors the fixture_reaper_lib.bb/fixture_reaper_sweep_lib.bb and
;; orphan_agent_reaper_lib.bb/orphan_agent_reaper_sweep_lib.bb split already
;; used in this codebase).
;;
;; A role's inbox/in_process claim is reclaimed to inbox/new only when it
;; genuinely has nobody left to finish it: it holds a claim, its owner is not
;; alive, AND it is not the role the resident is about to resume - resuming
;; IS how a dead owner's claim gets finished (BL-648 item 1: the recorded-
;; role boot fix), so reclaiming it too would re-deliver a duplicate of work
;; already in hand.
;;
;; No filesystem / tmux I/O here - callers inject has-claim?/owner-alive?/
;; being-resumed? booleans.

(ns orphan-claim-lib)

(defn claim-reclaim?
  "BL-648 invariant 2: a claim is reclaimed iff it exists, its owner is not
   alive, and it is not the role about to be resumed. Any of the other three
   states (no claim; a genuinely live owner; the role being resumed) leaves
   the claim untouched."
  [{:keys [has-claim? owner-alive? being-resumed?]}]
  (boolean (and has-claim? (not owner-alive?) (not being-resumed?))))
