;; BL-464: pure decision logic for the pipeline board's authoritative
;; ticket->stage source. The board (extension/src/concierge/pipelineBoard.ts)
;; used to scrape each role's inbox/in_process for a git_handoff `task:`
;; header - blind to a note-only kickoff (the promote-via-note convention
;; carries no task: header at all) and prone to a double-row when the same
;; ticket is momentarily observable at two roles during a transition. This
;; file computes the SAME reconciled {ticket-id -> role} map the
;; coordinator's own `pipeline_stage_cli.bb sync` persists - one role per
;; ticket, covering both a note and a git_handoff kickoff - kept entirely
;; side-effect-free so every branch is unit-testable with no filesystem,
;; exactly the way operator_lib.bb isolates its own decisions from
;; operator_runtime.bb's I/O.

(ns pipeline-stage-lib
  (:require [clojure.string :as str]))

;; BL-488-VIOLATION: an ALLOWLIST, never a denylist - the same posture
;; fixture_reaper_lib.bb's own known-fixture-prefixes already establishes.
;; The only ticket-id prefixes this project actually mints: "BL-" for
;; swarm-numbered tickets, "GH-" for a GitHub-issue-seeded ticket (Article
;; 1.8 / handoff-protocol.md's "close the GH issue for a GH-seeded ticket").
;; An unbounded [A-Za-z]+ prefix cannot be safely disambiguated from a
;; GLUED prefix: `\b` only guards a DIGIT-adjacent embedding (no `\w`
;; boundary exists between a digit and a letter) - it does NOT guard a
;; LETTER-adjacent one, because a run of letters has no `\b` anywhere
;; INSIDE it, so greedy [A-Za-z]+ starting at a valid boundary (e.g.
;; string-start) absorbs the WHOLE run: "ABL-476" would extract "ABL-476"
;; as if "ABL" were the ticket's own prefix, silently swallowing the real
;; "BL-476" reference instead of resolving it - the exact "durable false
;; not-started" failure mode this ticket exists to close, just reached a
;; different way. Extend this list explicitly as new prefixes are minted,
;; never widen it to a broad `[A-Za-z]+` glob.
(def known-ticket-prefixes ["BL" "GH"])

;; The SAME "<PREFIX>-<digits> id-shaped token" convention chase_sweep_lib.bb's
;; own extract-ticket-id/dispatch-ticket-ref already establish for the
;; dispatch-gap sweep. Duplicated here rather than cross-namespace-coupled to
;; chase_sweep_lib.bb's private (defn-) helpers - this codebase's own
;; established "small live-glue duplicated across independent pure libs"
;; posture (see operator_lib.bb's yaml-field comment).
;;
;; BL-488: resolves the FIRST id-shaped token ANYWHERE in the text, not only
;; a leading one - a held ticket's task/message header carrying a textual
;; prefix before the id ("Re: BL-476 …", "continuing BL-476 next slice") used
;; to match nothing and resolve to nil, reading as a durable false
;; not-started on the board. `\b` on both sides guards a DIGIT-adjacent
;; embedding (e.g. "v2BL-476" resolves to nil: no boundary exists between
;; the "2" and "B"); the known-prefix allowlist above guards the
;; LETTER-adjacent case `\b` cannot (see its own comment). Byte-identical on
;; an already-leading id, since the first id-shaped token IS the leading one
;; there.
;;
;; BL-471: canonicalized to upper-case here, at the ONE point every header-
;; extracted id passes through - active-ticket-ids (pipeline_stage_cli.bb)
;; reads backlog/active/*.yaml's own canonical (always upper-case) `id:`
;; field verbatim, so filter-active's case-SENSITIVE membership test only
;; ever agrees with a header id if both sides already share that same
;; upper-case form. Without this, a note/task header carrying a
;; differently-cased id (freeform text is exactly the "when-not-if"
;; external-influence surface, not a hypothetical) would extract, reconcile,
;; and then silently fail the active-set join - the ticket vanishes from the
;; board with no error.
(def ^:private ticket-id-pattern
  (re-pattern (str "(?i)\\b(" (str/join "|" known-ticket-prefixes) ")-(\\d+)\\b")))

(defn extract-ticket-id [text]
  (when text
    (when-let [[_ prefix digits] (re-find ticket-id-pattern text)]
      (str/upper-case (str prefix "-" digits)))))

;; A handoff file's own ticket reference for board-tracking purposes: its
;; task header (git_handoff) if present, else its message header (note) -
;; the note-aware read the old TS scrape never had (task-header-only), which
;; is the exact BL-464 root-cause gap this closes. Mirrors chase_sweep_lib.bb's
;; own dispatch-ticket-ref precedence exactly.
(defn ticket-id-from-headers [{:keys [task message]}]
  (or (extract-ticket-id task) (extract-ticket-id message)))

;; BL-464 board-authoritative-stage-02/03: reconciles possibly-conflicting
;; {:role :ticket-id} observations (the same ticket id momentarily held at
;; two roles during a transition) down to EXACTLY ONE role per ticket id -
;; the structural fix for the double-row defect. role-order is the pipeline's
;; own role sequence (roles.tsv order, specifier..QA..coordinator) - when a
;; ticket-id is observed at more than one role, the role LATER in role-order
;; (more downstream, i.e. more current) wins; a role absent from role-order
;; is treated as least-downstream (index -1) so it never wins over a
;; recognized role. Order-independent: the same input set reconciles to the
;; same output regardless of the order role-ticket-pairs is given in.
(defn reconcile-stage-map [role-ticket-pairs role-order]
  (let [rank (fn [role] (.indexOf ^java.util.List (vec role-order) role))]
    (reduce (fn [acc {:keys [role ticket-id]}]
              (if (or (not (contains? acc ticket-id))
                      (> (rank role) (rank (get acc ticket-id))))
                (assoc acc ticket-id role)
                acc))
            {}
            role-ticket-pairs)))

;; Drops any ticket id no longer in the active set (e.g. a stale note
;; referencing an already-closed/paused ticket) - the board must never show
;; a done or paused ticket as if it were still active.
(defn filter-active [stage-map active-ids]
  (into {} (filter (fn [[ticket-id _role]] (contains? active-ids ticket-id)) stage-map)))
