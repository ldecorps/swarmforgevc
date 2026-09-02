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
;; BL-626: which declarations are path pointers is NOT re-decided here —
;; acceptance-pointer-gate-lib/applicable? is the sole checkability predicate
;; (same BL-897 posture as BL-1027's mint-time dangling check).
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "acceptance_pointer_gate_lib.bb")))
;; BL-1128: depth/cap/throttle prefer predicate — one copy in headroom-cap-raise-lib.
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "headroom_cap_raise_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "slice_size_envelope_gate_lib.bb")))

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
(defn read-status [content] (read-field content "status"))
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

;; ── gate: type epic / status blocked (BL-1145) ────────────────────────────
;; promote_and_route_next already refuses these before auto-pick / by-name.
;; Open-slot nudge (BL-798/BL-963) only saw evaluate — after BL-1100 removed
;; prose parks, type: epic trackers (e.g. BL-545) won the nudge forever.
;; Put the same structured refusals on evaluate so every consumer inherits
;; one chain (BL-663); do not invent a nudge-only filter.

(defn epic-type-refusal
  "nil unless content declares type: epic; then {:gate \"epic\" :reason ...}."
  [content]
  (when (= "epic" (read-type content))
    {:gate "epic"
     :reason "type: epic trackers are never promotion candidates"}))

(defn blocked-status-refusal
  "nil unless content declares status: blocked; then {:gate \"blocked\" :reason ...}."
  [content]
  (when (= "blocked" (read-status content))
    {:gate "blocked"
     :reason "status: blocked is never auto-promoted"}))

;; ── gate: depends_on (BL-957) ─────────────────────────────────────────────
;; read-field is unusable here by its own documented design: it returns nil
;; for a blank value (`field: >`/`field: |` must read as absent), so a
;; block-style dependency list would read as NO dependencies at all -
;; failing OPEN on exactly the tickets this gate exists to catch (two live
;; paused tickets use that form today). This gate has its own reader.

(def ^:private ticket-id-pattern #"(?:BL|GH)-\d+")

(defn read-depends-on
  "{:ids [..] :unparseable? bool} - every BL-<n>/GH-<n> token in the
   depends_on field's own value and its indented continuation lines (block
   lists AND folded blocks alike), deduplicated in first-occurrence order,
   inline ` # ...` comments stripped per line so an annotation never
   contributes an id. All four live forms (measured 2026-08-19) are read:
   `[]`, a flow list, a block list, and a bare scalar with trailing prose
   (prose around the ids is ignored without being parsed). :unparseable?
   is true when the field is PRESENT with a non-empty value that yields no
   id token at all - the caller fails closed on it (invariant 2), never
   treats it as dependency-free."
  [content]
  (let [lines (str/split-lines (or content ""))
        [field-line & after] (drop-while #(not (str/starts-with? (str/trim %) "depends_on:"))
                                         lines)]
    (if (nil? field-line)
      {:ids [] :unparseable? false}
      (let [value (strip-comment (str/trim (subs (str/trim field-line) (count "depends_on:"))))
            continuation (->> after
                              (take-while #(and (not (str/blank? %))
                                                (re-find #"^\s" %)))
                              (map (comp strip-comment str/trim)))
            texts (cons value continuation)
            ids (vec (distinct (mapcat #(re-seq ticket-id-pattern %) texts)))
            explicitly-empty? (and (= "[]" value) (empty? continuation))
            value-present? (boolean (some #(and (not (str/blank? %))
                                                (not (#{">" "|"} %)))
                                          texts))]
        ;; explicitly-empty? guards :unparseable? only - `[]` is a
        ;; present, non-blank value that yields no id, and is the one such
        ;; value that means "no dependencies" rather than "unreadable".
        ;; It never has to clear :ids: a value of `[]` with no continuation
        ;; carries no id token to begin with.
        {:ids ids
         :unparseable? (boolean (and value-present?
                                     (not explicitly-empty?)
                                     (empty? ids)))}))))

;; The set of landed ids the refusal below resolves against is read by
;; done-ids, which lives with the other directory-scanning readers in this
;; file's impure half rather than here among the pure decisions.

(defn depends-on-refusal
  "nil when every declared dependency is positively resolved in done-id-set;
   otherwise {:gate :reason} naming EVERY unsatisfied id (and no satisfied
   one), so the coordinator's next action is obvious without re-deriving
   them. Fails CLOSED both ways (invariant 2): an id resolving to no ticket
   anywhere refuses (a typo refuses rather than promotes - approval ruling
   2), and a present-but-unparseable field refuses rather than reading as
   dependency-free. A dependency counts as satisfied ONLY in backlog/done/ -
   an ACTIVE dependency still refuses (approval ruling 1)."
  [content done-id-set]
  (let [{:keys [ids unparseable?]} (read-depends-on content)]
    (if unparseable?
      {:gate "depends_on"
       :reason "depends_on is present but names no parseable BL-/GH- ticket id - failing closed"}
      (when-let [unsatisfied (seq (remove (or done-id-set #{}) ids))]
        {:gate "depends_on"
         :reason (str "depends_on not yet landed in backlog/done/: " (str/join ", " unsatisfied))}))))

;; ── gate: Article 3.2.4 expedite lane ──────────────────────────────────────

(def ^:private expedited-types
  "Article 3.2.4 expedite lane: type: defect only (legacy type: bug retired)."
  #{"defect"})

(def ^:private expedited-severities #{"critical" "high"})

(defn expedited?
  "Article 3.2.4: a defect whose severity is critical or high. Missing
   severity: fails CLOSED - never expedited, never guessed."
  [content]
  (boolean
   (and (contains? expedited-types (read-type content))
        (contains? expedited-severities (read-severity content)))))

;; BL-900: an epic's own priority is compared before the child ticket's own
;; priority - splicing the term AFTER the expedite bucket (invariant "the
;; expedite bucket stays strictly first" holds by construction, not by a
;; guard) and BEFORE own-priority (own-priority remains the within-epic
;; tie-break it already was).

(defn epic-priority
  "The candidate's resolved epic-priority: the minimum `type: epic` tracker
   priority sharing its `epic:` (via epic-index, see epic-priority-index
   below), or its OWN priority when it has no `epic:` field or that epic has
   no tracker anywhere in the backlog (BL-900 decisions 2 and 3 - the
   fallback that keeps such a candidate ranked exactly as it is today). An
   epic tracker that is itself a ranking candidate needs no special case: its
   own priority already participates in epic-index's min for its own epic."
  [content epic-index]
  (let [epic (read-epic content)]
    (or (and epic (get epic-index epic))
        (read-priority content))))

(defn- rank-key [content epic-index]
  ;; Sort keys: lower wins. Expedite (0) first; then depth/cap/throttle prefer
  ;; (0) ahead of unrelated (1); then epic-priority / own-priority / id.
  [(if (expedited? content) 0 1)
   (if (headroom-cap-raise-lib/depth-cap-throttle-ticket? content) 0 1)
   (epic-priority content epic-index)
   (read-priority content)
   (or (read-id content) "")])

(defn rank-candidates
  "candidates: a seq of {:file :content}. Returns the winning candidate map
   (nil for an empty seq) under Article 3.2.4 plus BL-900 plus BL-1128:
   every expedited candidate sorts ahead of every non-expedited one
   regardless of priority number; within a bucket, depth/cap/throttle
   correctness titles (BL-1128) sort ahead of unrelated work; then
   epic-priority (epic-index, defaulted to {} when omitted) breaks ties
   before own-priority; own-priority then id breaks the rest."
  ([candidates] (rank-candidates candidates {}))
  ([candidates epic-index]
   (some->> (seq candidates)
            (sort-by (comp #(rank-key % epic-index) :content))
            first)))

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

;; ── gate: acceptance executable at promotion (BL-626) ─────────────────────
;; An acceptance: pointer under specs/features/ must resolve to an existing
;; .feature file. A parked .feature.draft is never executable. An explicit
;; pointer is authoritative — never rescued by a same-id sibling glob.

(defn- draft-pointer? [p]
  (str/ends-with? (str p) ".feature.draft"))

(defn pins-draft-conversion?
  "BL-1340, human ruling A. True when the ticket's own charter pins the
   conversion of its draft: a `required_wiring:` entry naming a
   specs/pipeline/steps registration - the ticket saying that THIS parcel
   lands the step handler that makes the draft executable.

   That is the whole distinction BL-626's refusal could not draw. A PARKED
   draft belongs to a slice somebody else builds later, and nothing in its
   ticket will ever materialise it, so refusing it still reproduces BL-441
   exactly. A SELF-CONVERTING draft belongs to the slice chartered to rename
   it, register its handler and repoint `acceptance:` in one parcel - the
   shape specifier.prompt has mandated since 2026-08-30, and the only shape
   available while committing a live .feature ahead of its handler would
   throw the runner for every other parcel (BL-233).

   Deliberately narrow. Any required_wiring entry at all would let every
   wired ticket walk through, which is not a distinction; the entry has to
   name the steps directory that the conversion actually writes to.

   read-field is unusable here by its own documented design - required_wiring
   is a block, so it returns nil - hence the line walk: the field's own
   line and every deeper-indented line under it, stopping at the next
   top-level key."
  [content]
  (let [lines (str/split-lines (or content ""))]
    (loop [remaining lines inside? false]
      (if (empty? remaining)
        false
        (let [line (first remaining)
              trimmed (str/trim line)
              top-level? (and (seq trimmed)
                              (not (str/starts-with? line " "))
                              (not (str/starts-with? line "\t")))]
          (cond
            (and inside? top-level? (not (str/starts-with? trimmed "required_wiring:")))
            false

            (or (and inside? (str/includes? line "specs/pipeline/steps"))
                (and (str/starts-with? trimmed "required_wiring:")
                     (str/includes? line "specs/pipeline/steps")))
            true

            :else
            (recur (rest remaining)
                   (or (str/starts-with? trimmed "required_wiring:")
                       (and inside? (not top-level?))))))))))

(defn- specs-features-pointer?
  "True when raw is an applicable single-line pointer under specs/features/."
  [raw]
  (boolean (and (acceptance-pointer-gate-lib/applicable? raw)
                (str/starts-with? raw "specs/features/"))))

(defn- path-exists-under? [root rel]
  (fs/exists? (fs/path root rel)))

(defn- acceptance-refusal [reason]
  {:gate "acceptance" :reason reason})

(defn- missing-feature-refusal
  "Names the missing .feature; when a sibling .draft is present, names that too."
  [root raw]
  (let [draft (str raw ".draft")]
    (acceptance-refusal
     (if (path-exists-under? root draft)
       (format "missing feature file %s (draft present: %s)" raw draft)
       (format "missing feature file %s" raw)))))

(defn acceptance-executable-refusal
  "nil when the gate does not apply or the pointer resolves to a live
   .feature; otherwise {:gate \"acceptance\" :reason ...} naming the
   offending path(s). root is required whenever a specs/features/ pointer
   is present — absence fails closed."
  [content root]
  (let [raw (read-field content "acceptance")]
    (when (specs-features-pointer? raw)
      (cond
        (nil? root)
        (acceptance-refusal
         (format "cannot verify acceptance path %s without project root" raw))

        ;; BL-1340: a draft is two different tickets wearing one shape. The
        ;; one that pins its own conversion is admitted here and refused at
        ;; the OTHER end instead (the documenter->QA edge), where a contract
        ;; can actually have gone unexecuted; the parked one still fails by
        ;; name, and says which kind it is rather than only "blocked".
        (and (draft-pointer? raw) (pins-draft-conversion? content))
        (when-not (path-exists-under? root raw)
          (acceptance-refusal (format "missing draft file %s" raw)))

        (draft-pointer? raw)
        (acceptance-refusal
         (format "acceptance names draft %s as parked with no conversion pinned, so not executable"
                 raw))

        (path-exists-under? root raw)
        nil

        :else
        (missing-feature-refusal root raw)))))

(defn- conf-text-for [root]
  (when root
    (try (slurp (str (fs/path root "swarmforge" "swarmforge.conf")))
         (catch Exception _ ""))))

;; ── the chokepoint ────────────────────────────────────────────────────────

(defn evaluate
  "{:ok true} (optionally carrying :advisory) or {:ok false :gate .. :reason
   ..} for ONE candidate against every BLOCKING gate (hold, type: epic /
   status: blocked (BL-1145), human_approval, acceptance (BL-626),
   slice_size_envelope (BL-634), depends_on (BL-957), active_backlog_max_depth - assignee/spec-stage is
   not a promotion blocker; see route-target above). First failing gate
   wins, in a fixed order, so the refusal is deterministic even when more
   than one gate would fire. held? is checked first: a held ticket's other
   fields are irrelevant, it is not a promotion candidate at all. Epic and
   blocked sit next so open-slot nudge and promote share one structured
   exclusion (BL-1145 / BL-663). BL-854 invariant 1: orthogonality is never
   in this refusal chain - once every blocking gate passes, the result is
   always :ok true, optionally carrying an orthogonality :advisory (never
   instead of :ok true). Optional :root enables the BL-626 acceptance
   existence check against the working tree."
  [{:keys [content held? active-count max-depth active-epics done-ids root]}]
  ;; BL-626: acceptance sits after human_approval and before depends_on — a
  ;; ticket-property refusal beats a transient global one. BL-957 depends_on
  ;; keeps the same relative place vs depth. BL-1145: epic/blocked after
  ;; hold, before approval — structural non-candidates, not human signals.
  (or (some->> (hold-refusal held?) (merge {:ok false}))
      (some->> (epic-type-refusal content) (merge {:ok false}))
      (some->> (blocked-status-refusal content) (merge {:ok false}))
      (some->> (human-approval-refusal content) (merge {:ok false}))
      (some->> (acceptance-executable-refusal content root) (merge {:ok false}))
      (some->> (slice-size-envelope-gate-lib/refusal content (conf-text-for root))
               (merge {:ok false}))
      (some->> (depends-on-refusal content done-ids) (merge {:ok false}))
      (some->> (depth-refusal active-count max-depth) (merge {:ok false}))
      (merge {:ok true}
             (when-let [advisory (orthogonality-advisory (read-epic content) active-epics)]
               {:advisory advisory}))))

;; ── backlog-scanning readers (the small impure half) ───────────────────

(defn- status-yaml-files
  "Every ticket YAML under backlog/<status>/, recursing into milestone
   subfolders (the close-into-done/<Mx>/ convention); empty when the
   directory does not exist. active-yaml-files below deliberately does NOT
   go through this - active/ is flat by contract and its non-recursive glob
   is part of what the depth cap counts."
  [root status]
  (let [dir (fs/path root "backlog" status)]
    (if (fs/exists? dir) (fs/glob dir "**.yaml") [])))

(defn acceptance-audit-findings
  "Read-only scan of backlog/paused and backlog/active: every ticket whose
   acceptance: pointer fails acceptance-executable-refusal, with :id,
   :path, :feature-path, and :reason."
  [root]
  (->> (concat (status-yaml-files root "paused")
               (status-yaml-files root "active"))
       (keep (fn [f]
               (let [content (slurp (str f))
                     refusal (acceptance-executable-refusal content root)]
                 (when refusal
                   {:id (or (read-id content) (fs/file-name f))
                    :path (str f)
                    :feature-path (read-field content "acceptance")
                    :reason (:reason refusal)}))))
       vec))

(defn done-ids
  "The set of ticket ids landed under backlog/done/ - flat files AND <Mx>/
   subfolders alike (see status-yaml-files). A file's id comes from its
   filename's leading BL-/GH- token (the naming convention every
   locate/glob path already relies on), falling back to its id: field when
   the name carries none."
  [root]
  (->> (status-yaml-files root "done")
       (keep (fn [f]
               (or (re-find ticket-id-pattern (fs/file-name f))
                   (read-id (slurp (str f))))))
       set))

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

;; ── epic-priority index (BL-900) ────────────────────────────────────────
;; A `type: epic` tracker's own priority can live anywhere in the backlog
;; tree (active/paused/done, done/ nested one level under a milestone
;; subdir) - same "status-dirs" scan ticket_status_lib.bb's own
;; contains-ticket? already established for "is this ticket anywhere in the
;; backlog", reused here rather than a second, divergent directory list.
;; hold/ is deliberately excluded, mirroring that same precedent: a held
;; item is parked, not a live signal.

(def ^:private epic-tracker-status-dirs ["active" "paused" "done"])

(defn- epic-tracker-yaml-files [root]
  (mapcat (partial status-yaml-files root) epic-tracker-status-dirs))

(defn epic-priority-index
  "Map of epic-name -> the minimum read-priority among every `type: epic`
   tracker ticket anywhere under root's backlog tree whose own `epic:` field
   equals that name (BL-900 decision 1: more than one tracker for the same
   epic ranks by its most urgent - lowest - tracker). Built once per ranking
   call (epic-priority above just does a map lookup), never a per-candidate
   directory scan. A tracker with no `epic:` field of its own contributes
   nothing - `keep` drops it, exactly like active-epics does above."
  [root]
  (->> (epic-tracker-yaml-files root)
       (keep (fn [f]
               (let [content (slurp (str f))]
                 (when (= "epic" (read-type content))
                   (when-let [epic (read-epic content)]
                     [epic (read-priority content)])))))
       (reduce (fn [m [epic priority]]
                 (update m epic (fn [cur] (if cur (min cur priority) priority))))
               {})))
