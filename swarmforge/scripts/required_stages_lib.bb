#!/usr/bin/env bb
;; BL-606: pure decision logic for a ticket's specifier-declared
;; required_stages — an ALLOWLIST over the canonical skippable chain
;; (coder, cleaner, architect, hardender, documenter, QA), never a bypass.
;; specifier is always the entry and coordinator always bookkeeps; neither
;; is ever a member of required_stages (BL-243/pipeline_stage_lib.bb's own
;; standard-chain excludes coordinator the same way; this ticket additionally
;; excludes specifier since a required_stages set only ever governs the
;; POST-spec chain).
;;
;; DEFAULT-FULL is the safe failure mode everywhere in this file: an absent
;; field, an empty list, or a present-but-not-a-flow-list scalar all resolve
;; to the full canonical chain with no rejection recorded (there is nothing
;; wrong to reject - there is simply no usable declaration). A PRESENT,
;; list-shaped declaration whose CONTENT is invalid (an out-of-chain token, a
;; duplicate, or a token naming specifier/coordinator) is a different,
;; explicit failure mode: :rejected? true, still default-full, but the
;; rejection itself must be logged loudly by the caller - never silently
;; folded into the same bucket as "no declaration at all" (BL-606 acceptance
;; scenario 04).
;;
;; Loaded via load-file, not required on a classpath:
;;   (load-file (str (fs/path (fs/parent *file*) "required_stages_lib.bb")))
;; and referred to as required-stages-lib/foo.

(ns required-stages-lib
  (:require [clojure.string :as str]))

(def canonical-order
  "The real canonical order (PIPELINE.md / role tables) - the Problem prose
   in BL-606's own ticket text is garbled and must be ignored. Casing here is
   authoritative: matches roles.tsv's own recipient tokens exactly (\"QA\"
   upper-case, every other stage lower-case), since this IS the vocabulary
   the send path rewrites a handoff's `to:` recipient into."
  ["coder" "cleaner" "architect" "hardender" "documenter" "QA"])

(def canonical-set (set canonical-order))

(defn- strip-quotes [s]
  (str/replace s #"^[\"']|[\"']$" ""))

;; ── reading the single-line field off a ticket's raw yaml text ───────────

(defn read-required-stages
  "{:present? bool :raw string-or-nil} - the single-line value after
   `required_stages: ` on a ticket's own text, mirroring
   chase_sweep_lib.bb's read-yaml-field shape (single-line only; BL-606's own
   FIELD & FORMAT decision is a flow list specifically so the existing
   line-based reader suffices - no new multi-line YAML parser)."
  [content]
  (let [prefix "required_stages: "]
    (if-let [line (some (fn [l] (when (str/starts-with? l prefix) l))
                         (str/split-lines (or content "")))]
      {:present? true :raw (str/trim (subs line (count prefix)))}
      {:present? false :raw nil})))

;; ── token normalization: case + the hardener/hardender alias ─────────────

(defn normalize-token
  "A raw required_stages token -> its canonical-order member, or nil when the
   token (after lower-casing and the hardener->hardender alias) does not name
   any stage in the canonical chain - covers an out-of-chain stage, a
   misspelling not covered by the one sanctioned alias, and specifier/
   coordinator (neither of which is ever a member of required_stages)."
  [tok]
  (when tok
    (let [t (-> tok str/trim str/lower-case)
          t (if (= t "hardener") "hardender" t)]
      (some #(when (= t (str/lower-case %)) %) canonical-order))))

;; ── stage_skip_reasons: block (committed, git-greppable intent) ──────────

(defn- skip-reason-line [line]
  (when-let [[_ stage reason] (re-matches #"^\s+([A-Za-z]+):\s*(.+?)\s*$" line)]
    [stage reason]))

(defn read-stage-skip-reasons
  "{stage -> reason} from an optional `stage_skip_reasons:` block
   immediately following the header line (one `  <stage>: <reason>` line per
   skipped stage) - {} when the block is absent. Stage keys are normalized
   through normalize-token above (case + hardener/hardender alias) so a
   lookup by canonical stage name always succeeds regardless of how the
   specifier cased it; an unrecognized key is kept verbatim rather than
   dropped, so a typo is still visible to a human reading the report."
  [content]
  (let [lines (str/split-lines (or content ""))
        idx (some (fn [[i l]] (when (str/starts-with? l "stage_skip_reasons:") i))
                  (map-indexed vector lines))]
    (if (nil? idx)
      {}
      (let [block (take-while #(re-matches #"^(\s+.*)?$" %) (drop (inc idx) lines))
            pairs (keep skip-reason-line block)]
        (into {} (map (fn [[stage reason]] [(or (normalize-token stage) stage) reason]) pairs))))))

;; ── parse: the flow-list value after the colon -> raw tokens, or :invalid ──

(defn parse
  "raw is the already-extracted string after `required_stages: ` (e.g.
   \"[coder, cleaner, qa]\", \"[]\", or a bare scalar like \"coder\").
   Returns a vector of RAW (untouched aside from trim/quote-strip) tokens for
   a well-formed `[...]` flow list - `[]` parses to an empty vector, a valid
   parse of a declaration with nothing usable in it, never an invalid parse -
   or the keyword :invalid for anything not bracketed (a bare scalar, a
   block-style list, unmatched brackets). Token-level validation (unknown
   stage, duplicate, specifier/coordinator) happens in resolve-effective, not
   here - parse only decides list-shape."
  [raw]
  (let [s (str/trim (or raw ""))]
    (if (and (>= (count s) 2) (str/starts-with? s "[") (str/ends-with? s "]"))
      (->> (str/split (subs s 1 (dec (count s))) #",")
           (map str/trim)
           (map strip-quotes)
           (remove str/blank?)
           vec)
      :invalid)))

;; ── normalize + validate a parsed token vector into an effective set ─────

(defn- normalize-set
  "tokens is parse's own output (a vector of raw tokens, already confirmed
   list-shaped and non-empty by the caller). {:valid? true :set #{...}} or
   {:valid? false :reason \"...\"} - invalid for any unrecognized/out-of-chain
   token (including specifier/coordinator) or for two tokens that normalize
   to the same canonical stage (a duplicate, including the alias colliding
   with its own canonical spelling)."
  [tokens]
  (let [normalized (mapv normalize-token tokens)
        unknown (keep (fn [[raw norm]] (when (nil? norm) raw)) (map vector tokens normalized))]
    (cond
      (seq unknown)
      {:valid? false
       :reason (str "unknown or out-of-chain stage(s) in required_stages: " (str/join ", " unknown))}

      (not= (count normalized) (count (set normalized)))
      {:valid? false
       :reason (str "duplicate stage(s) in required_stages: " (str/join ", " normalized))}

      :else
      {:valid? true :set (set normalized)})))

;; ── resolve-effective: the one entry point every caller actually wants ───

(def default-full-decision
  {:effective canonical-set
   :source :default-full
   :rejected? false
   :rejection-reason nil
   :qa-omission :none})

(defn resolve-effective
  "field is read-required-stages' own return shape ({:present? :raw}).
   Returns:
     {:effective #{...canonical-order members...}
      :source (:default-full or :declared)
      :rejected? bool          ; true ONLY for a present, list-shaped
                                ; declaration whose content is invalid
                                ; (scenario 04) - never true for absent/
                                ; empty/non-list (scenario 01, no rejection
                                ; to report, just nothing usable)
      :rejection-reason string-or-nil
      :qa-omission (:none, :accepted, or :rejected)}

   QA/coder forcing rule (scenario 05): a declared set naming coder but not
   QA is INVALID -> default-full (with QA), :qa-omission :rejected. A
   declared set omitting coder (a non-code ticket) may omit QA too -
   :qa-omission :accepted whenever the accepted declared set omits QA,
   :none when it includes QA."
  [{:keys [present? raw]}]
  (if-not present?
    default-full-decision
    (let [tokens (parse raw)]
      (if (or (= tokens :invalid) (empty? tokens))
        default-full-decision
        (let [{:keys [valid? set reason]} (normalize-set tokens)]
          (if-not valid?
            (assoc default-full-decision :rejected? true :rejection-reason reason)
            (let [has-coder? (contains? set "coder")
                  has-qa? (contains? set "QA")]
              (if (and has-coder? (not has-qa?))
                (assoc default-full-decision
                       :rejected? true
                       :rejection-reason "QA cannot be omitted from required_stages while coder is present"
                       :qa-omission :rejected)
                {:effective set
                 :source :declared
                 :rejected? false
                 :rejection-reason nil
                 :qa-omission (if has-qa? :none :accepted)}))))))))

;; ── next-required-stage: the pure router primitive ───────────────────────

(defn next-required-stage
  "The canonical-order stage strictly after `current` that is a member of
   required-set, or nil when current is the last member / not found / no
   later member exists - mirroring extension/src/swarm/rolePack.ts:36's
   nextActiveRole design (that TS resolver is dead code, unreachable from the
   babashka send path; this is a fresh implementation of the same shape, not
   a call to it). Self-normalizing on both arguments (case + the hardener
   alias) so a caller can pass raw declared tokens or an already-canonical
   set/role name with identical results."
  [required-set current]
  (let [norm-set (set (keep normalize-token required-set))
        norm-current (normalize-token current)
        idx (if norm-current (.indexOf ^java.util.List canonical-order norm-current) -1)]
    (when (>= idx 0)
      (->> (drop (inc idx) canonical-order)
           (filter norm-set)
           first))))

;; ── sender-order guard: only ROUTE a send that already moves forward ─────
;; (architect BL-606 bounce #3: a reviewer's bounce carries no header this
;; swarm's roles ever write, so direction must be derived from the sender
;; itself, not from an optional rejection_reason/reroute_reason marker.)

(defn sender-position
  "canonical-order index for `sender`, or nil when sender has no position to
   route from. specifier is always the pipeline entry and is never a member
   of canonical-order itself, but the ordinary specifier -> coder send must
   still route - so specifier is special-cased to position -1 (before
   coder), not treated as unknown. Any other non-canonical sender
   (coordinator, or anything unrecognized) resolves to nil - the
   conservative 'no position, do not route' default."
  [sender]
  (cond
    (= sender "specifier") -1
    :else (when-let [norm (normalize-token sender)]
            (.indexOf ^java.util.List canonical-order norm))))

(defn routes-forward?
  "True only when `sender` has a resolvable canonical-order position AND
   `literal-to` names a canonical stage strictly AFTER that position - i.e.
   this send moves forward through the chain the way an ordinary
   git_handoff does. False for a reviewer's bounce (which always targets a
   stage at or before the sender), false for a non-canonical sender
   (coordinator/unknown - identity is the conservative default), and false
   when literal-to is not a recognized stage at all. Only a true result may
   ever be candidate for required_stages rewriting; every false short-
   circuits to the literal recipient untouched (architect BL-606 bounce
   #3)."
  [sender literal-to]
  (let [sender-idx (sender-position sender)
        to-idx (when-let [norm (normalize-token literal-to)]
                 (.indexOf ^java.util.List canonical-order norm))]
    (boolean (and sender-idx to-idx (< sender-idx to-idx)))))

;; ── skipped-stages: canonical-order minus the effective set ──────────────

(defn skipped-stages
  "canonical-order members NOT in required-set, in canonical order -
   self-normalizing the same way next-required-stage is."
  [required-set]
  (let [norm-set (set (keep normalize-token required-set))]
    (vec (remove norm-set canonical-order))))

(defn hop-skipped-stages
  "canonical-order stages strictly between `current` (exclusive) and `next`
   (exclusive) - the stage(s) THIS hop jumps over, as opposed to
   skipped-stages above which is the ticket-level aggregate (the whole
   complement of the effective set, regardless of hop). Self-normalizing the
   same way next-required-stage/skipped-stages are; [] when either stage is
   unrecognized or next is not strictly after current."
  [current next]
  (let [norm-current (normalize-token current)
        norm-next (normalize-token next)
        idx-current (if norm-current (.indexOf ^java.util.List canonical-order norm-current) -1)
        idx-next (if norm-next (.indexOf ^java.util.List canonical-order norm-next) -1)]
    (if (and (>= idx-current 0) (>= idx-next 0) (< idx-current idx-next))
      (vec (subvec canonical-order (inc idx-current) idx-next))
      [])))

;; ── completed-ticket ran-vs-skipped visibility (acceptance scenario 08) ──

(defn ran-and-skipped
  "{:ran [...] :skipped [...]} for a ticket's own committed content, both in
   canonical order - derived purely from the ticket's own required_stages
   declaration (the git-committed, greppable trail), never from a diff."
  [content]
  (let [decision (resolve-effective (read-required-stages content))
        eff (:effective decision)]
    {:ran (vec (filter eff canonical-order))
     :skipped (vec (remove eff canonical-order))}))
