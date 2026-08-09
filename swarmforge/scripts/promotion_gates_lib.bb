;; BL-663: the ONE chokepoint every promotion path (promote_and_route_next.sh's
;; auto-pick AND by-name modes, plus route_backlog_to_coder.sh invoked on its
;; own) must call before a ticket crosses into backlog/active/ or a Work note
;; is routed. Four gates were bypassed in 48h, each caught only because a
;; human happened to be watching: human_approval, the Article 3.2.4 expedite
;; lane, and a silent assigned_to rewrite that skipped the spec stage
;; (recurred a 4th time 2026-08-01). Depth cap and hold/ exclusion already
;; worked; they are folded in here too so no future auto-picker can grow a
;; second, divergent copy.
;;
;; Pure decisions only - no git/fs access of its own except the small,
;; explicit active/-scanning readers below (mirrors backlog_depth_lib.bb's
;; own impure/pure split). Loaded via load-file, not required on a classpath:
;;   (load-file (str (fs/path (fs/parent *file*) "promotion_gates_lib.bb")))
;; and referred to as promotion-gates-lib/foo.

(ns promotion-gates-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

;; BL-853: depth-refusal below needs the documented no-limit sentinel
;; (any negative max-depth means unlimited) - reuse backlog-depth-lib's own
;; predicate rather than re-deriving "negative means unlimited" a second
;; time here, which is exactly the kind of divergent copy this file's own
;; header comment (above) warns against.
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "backlog_depth_lib.bb")))

;; ── ticket field reading ──────────────────────────────────────────────────
;; Same "small live-glue duplicated across independent pure libs" idiom as
;; ambulance_lib.bb / ticket_status_lib.bb / chase_sweep_lib.bb's own private
;; read-yaml-field - deliberate per this codebase's established posture
;; (pipeline_stage_lib.bb's own comment), not an oversight.

(defn- strip-quotes [s]
  (str/replace s #"^[\"']|[\"']$" ""))

(defn- strip-comment
  "A trailing ` # ...` inline comment, e.g. `human_approval: approved  #
   human (ldecorps), 2026-07-15: ...` - the value is everything before the
   first ` #`."
  [s]
  (str/trim (first (str/split s #"\s+#" 2))))

(defn read-field
  "The single-line scalar value of `field:` in ticket YAML content, comment-
   and quote-stripped, or nil when the field is absent or its value is
   blank/folded (`field: >` or `field: |` read as blank here - a folded
   block is never a valid single-line value)."
  [content field]
  (let [prefix (str field ":")]
    (some (fn [line]
            (let [trimmed (str/trim line)]
              (when (str/starts-with? trimmed prefix)
                (let [after (str/trim (subs trimmed (count prefix)))]
                  (when-not (or (str/blank? after) (#{">" "|"} after))
                    (strip-quotes (strip-comment after)))))))
          (str/split-lines (or content "")))))

(defn read-id [content] (read-field content "id"))
(defn read-type [content] (read-field content "type"))
(defn read-severity [content] (read-field content "severity"))
(defn read-epic [content] (read-field content "epic"))
(defn read-assigned-to [content] (read-field content "assigned_to"))
(defn read-human-approval [content] (read-field content "human_approval"))

(defn read-priority
  "Numeric priority, or 999999 (sorts last) for an absent/unparseable value -
   identical fallback to promote_and_route_next.sh's pre-existing
   ticket_priority()."
  [content]
  (let [raw (read-field content "priority")]
    (if (and raw (re-matches #"\d+" raw))
      (Long/parseLong raw)
      999999)))

;; ── gate: human_approval ──────────────────────────────────────────────────
;; backlog-schema.md: absent means "not applicable, no approval needed" and
;; must pass; any PRESENT value other than the literal "approved" (pending,
;; amending, rejected, or a malformed/unrecognized value) fails closed -
;; absence buys nothing on its own but a present, non-approved value is never
;; silently treated as good enough.

(defn human-approval-refusal [content]
  (let [v (read-human-approval content)]
    (when (and v (not= "approved" v))
      {:gate "human_approval"
       :reason (format "human_approval is %s, not approved" v)})))

;; ── gate: Article 3.2.4 expedite lane ──────────────────────────────────────

(def ^:private expedited-types
  "type: bug is the retired legacy label (Article 3.2.4's own transition
   clause) - matched only because some already-done tickets still carry it;
   never write it on a new ticket."
  #{"defect" "bug"})

(def ^:private expedited-severities #{"critical" "high"})

(defn expedited?
  "Article 3.2.4: a defect/bug whose severity is critical or high. Missing
   severity: fails CLOSED - never expedited, never guessed."
  [content]
  (boolean
   (and (contains? expedited-types (read-type content))
        (contains? expedited-severities (read-severity content)))))

(defn- rank-key [content]
  [(if (expedited? content) 0 1) (read-priority content) (or (read-id content) "")])

(defn rank-candidates
  "candidates: a seq of {:file :content}. Returns the winning candidate map
   (nil for an empty seq) under Article 3.2.4: every expedited candidate
   sorts ahead of every non-expedited one regardless of priority number;
   priority then id breaks ties within each bucket - the same tie-break
   promote_and_route_next.sh's pre-existing candidate_sort_line already used,
   preserved so a fully-compliant, non-expedited pick is unchanged."
  [candidates]
  (some->> (seq candidates)
           (sort-by (comp rank-key :content))
           first))

;; ── gate: assignee / spec-stage routing ─────────────────────────────────
;; Recurrence #3 (de5b5d323): promote_and_route_next.sh's own sed flipped
;; assigned_to: specifier -> coder as a silent side effect, skipping the spec
;; stage the ticket's own acceptance required. route_backlog_to_coder.sh
;; carried an independent copy of the same rewrite (BL-663 required_wiring
;; entry 2) - fixing only one site left the other reproducible on its own.

(defn route-target
  "{:route-to .. :rewrite-assigned-to? bool}. assigned_to: specifier is NEVER
   rewritten and routes to the specifier. Every other value (absent, coder,
   or anything else) routes to coder; rewrite-assigned-to? is true only when
   the field does not already read exactly 'coder', so a promotion that was
   already correct performs no write (BL-663 acceptance scenario 05:
   'promoted and routed exactly as today')."
  [assigned-to]
  (if (= "specifier" assigned-to)
    {:route-to "specifier" :rewrite-assigned-to? false}
    {:route-to "coder" :rewrite-assigned-to? (not= "coder" assigned-to)}))

;; ── gate: depth cap ──────────────────────────────────────────────────────
;; Already enforced pre-BL-663 (promote_and_route_next.sh's own
;; ACTIVE_COUNT >= CAP early exit) - folded in here so the SAME function
;; produces the named reason the acceptance scenarios assert on, and so a
;; future caller of `evaluate` below cannot skip it by construction.

(defn depth-refusal
  "BL-853: a negative max-depth is the documented no-limit sentinel
   (backlog-depth-lib/no-limit?), never a real ceiling to compare
   active-count against - this gate must allow at every active-count under
   it, exactly like backlog-depth-lib's own depth-exceeded?/under-depth-cap?
   already do for their call sites."
  [active-count max-depth]
  (when (and (not (backlog-depth-lib/no-limit? max-depth))
             (>= active-count max-depth))
    {:gate "active_backlog_max_depth"
     :reason (format "active count %d >= cap %d - no open slot" active-count max-depth)}))

;; ── advisory: orthogonality ──────────────────────────────────────────────
;; No ticket field declares file/module scope, so this uses `epic:` - already
;; mandatory on every non-epic-tracker ticket (backlog-schema.md hygiene rule
;; 1) - as the scope proxy: two tickets sharing an epic are the concrete
;; "tightly coupled area" the Concurrent Work Orthogonality workflow rule
;; means. BL-854: measured against the live backlog, the epic proxy is far
;; too coarse to REFUSE on (112 of 204 paused tickets blocked behind a single
;; active defect, and the coordinator was already overriding it by hand every
;; time by comparing the tickets' real declared file paths - the judgement
;; the constitution's Concurrent Work Orthogonality rule assigns to the
;; coordinator, not to this automated layer, which has no scope data to rule
;; on). This is now an ADVISORY, never a refusal (invariant 1): it names
;; every active ticket sharing the epic (invariant 2) so the coordinator can
;; check real file overlap without re-deriving which tickets collided.
;; Naturally produces no advisory whenever backlog/active/ is empty (the
;; common active_backlog_max_depth=1 regime), matching the constitution
;; rule's own "applies when the cap is above 1" carve-out without a separate
;; special case.

(defn orthogonality-advisory
  "{:gate \"orthogonality\" :epic .. :ids [..]} naming every active ticket
   sharing candidate-epic (active-epics: epic -> ids map, see the
   active-epics reader below), or nil when candidate-epic is nil or shares
   no active ticket. Never a refusal - the caller (evaluate, below) merges
   this into an :ok true result, it never gates it. Sorts ids itself rather
   than trusting the caller to have pre-sorted them (the real active-epics
   reader below does, but this function's own output must be deterministic
   on its own terms - an operator-visible advisory line whose id order
   depended on map-building order would be needlessly flaky to read and to
   test)."
  [candidate-epic active-epics]
  (when candidate-epic
    (when-let [ids (seq (get active-epics candidate-epic))]
      {:gate "orthogonality" :epic candidate-epic :ids (vec (sort ids))})))

(defn advisory-line
  "The one-line ADVISORY|orthogonality|... text written to stderr - the
   human signal half of the evaluate/select stdout|stderr split (BL-854):
   stdout keeps its pre-existing ALLOW/REFUSE contract untouched, this line
   is additional and never parsed by any existing caller."
  [{:keys [epic ids]}]
  (format "ADVISORY|orthogonality|epic %s is also active on %s" epic (str/join ", " ids)))

;; ── gate: hold marker ────────────────────────────────────────────────────
;; backlog/hold/ is a sibling of backlog/paused/, never scanned by auto-pick -
;; that already keeps a held ticket out of the auto-picked set. The gap
;; BL-663 closes is by-name mode: asking for a held ticket by id used to
;; surface only "no paused yaml for X", indistinguishable from a typo. `held?`
;; is supplied by the caller (promotion_gates_cli.bb's `locate`), which is the
;; one that knows whether the resolved file came from paused/ or hold/.

(defn hold-refusal [held?]
  (when held?
    {:gate "hold marker"
     :reason "ticket is parked in backlog/hold/, never auto-promoted"}))

;; ── the chokepoint ────────────────────────────────────────────────────────

(defn evaluate
  "{:ok true} (optionally carrying :advisory) or {:ok false :gate .. :reason
   ..} for ONE candidate against every BLOCKING gate (human_approval,
   active_backlog_max_depth, hold marker - assignee/spec-stage is not a
   promotion blocker; see route-target above). First failing gate wins, in a
   fixed order, so the refusal is deterministic even when more than one gate
   would fire. held? is checked first: a held ticket's other fields are
   irrelevant, it is not a promotion candidate at all. BL-854 invariant 1:
   orthogonality is never in this refusal chain - once every blocking gate
   passes, the result is always :ok true, optionally carrying an
   orthogonality :advisory (never instead of :ok true)."
  [{:keys [content held? active-count max-depth active-epics]}]
  (or (some->> (hold-refusal held?) (merge {:ok false}))
      (some->> (human-approval-refusal content) (merge {:ok false}))
      (some->> (depth-refusal active-count max-depth) (merge {:ok false}))
      (merge {:ok true}
             (when-let [advisory (orthogonality-advisory (read-epic content) active-epics)]
               {:advisory advisory}))))

;; ── active/-scanning readers (the small impure half) ─────────────────────

(defn active-yaml-files [root]
  (let [dir (fs/path root "backlog" "active")]
    (if (fs/exists? dir) (vec (fs/glob dir "*.yaml")) [])))

(defn active-count [root]
  (count (active-yaml-files root)))

(defn active-epics
  "Map of epic string -> sorted vector of active ticket ids sharing that
   epic, read from every backlog/active/*.yaml under root. BL-854: the
   orthogonality advisory must NAME the overlapping tickets (invariant 2),
   so this reads id alongside epic rather than a bare epic set - a file
   whose own id: cannot be read falls back to its filename so a malformed
   ticket still contributes a locatable name to the advisory instead of
   silently vanishing from it."
  [root]
  (->> (active-yaml-files root)
       (keep (fn [f]
               (let [content (slurp (str f))]
                 (when-let [epic (read-epic content)]
                   [epic (or (read-id content) (fs/file-name f))]))))
       (reduce (fn [m [epic id]] (update m epic (fnil conj []) id)) {})
       (reduce-kv (fn [m epic ids] (assoc m epic (vec (sort ids)))) {})))
