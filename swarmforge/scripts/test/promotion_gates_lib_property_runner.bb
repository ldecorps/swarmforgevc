#!/usr/bin/env bb
;; BL-663 coder pass (BL-654 Invariants): PROPERTY tests over
;; promotion_gates_lib.bb, encoding the ticket's two declared invariants:
;;
;;   1. "A promotion is refused unless every gate passes" - the example-based
;;      runner (promotion_gates_lib_test_runner.bb) only ever breaks ONE gate
;;      at a time per example. P1 here quantifies over every combination of
;;      held?/human_approval/depth/orthogonality at once and checks BOTH that
;;      a refusal only ever fires when at least one gate genuinely fails
;;      (soundness) AND that any failing gate produces a refusal naming the
;;      correct one under the fixed precedence order (completeness) - the
;;      exact shape of bug ("gate exists but a combination slips through")
;;      that made instances 1-4 invisible to machinery in the first place.
;;      P1 quantifies `evaluate`, which enforces four of the invariant's six
;;      named concerns; the fifth (assignee/spec-stage) is a `route-target`
;;      concern, covered by P2/P3 below. The sixth - Article 3.2.4 expedite
;;      ordering - is enforced by neither: it is a SELECTION among multiple
;;      candidates (`rank-candidates`/`expedited?`), not a refusal of one, so
;;      it was left with only example coverage until the architect's 2026-08-01
;;      bounce (backlog/evidence/BL-663-bounce-architect-20260801.md).
;;      P4 closes that gap: it generates an arbitrary-sized candidate set with
;;      mixed type (defect/bug/feature/other), mixed severity
;;      (critical/high/medium/absent), and arbitrary priority (including ties
;;      and the legacy bug-vs-defect mix Article 3.2.4's transition clause
;;      names), and asserts an expedited candidate always wins over every
;;      non-expedited one regardless of priority number, with priority then
;;      id as the only tie-break within a bucket - the ticket's OWN headline
;;      defect class (3 of its 4 recorded historical instances).
;;   2. "assigned_to is never silently rewritten...a reroute is an explicit,
;;      logged decision, never a side effect" - P2/P3 quantify route-target
;;      over the whole space of assigned_to strings, including values no
;;      hand-written example covers (case variants, empty string, other role
;;      names), and P3 states the "never a side effect" half as a genuine
;;      property: applying route-target's own decision must be a FIXED
;;      POINT - a second call on the settled value never asks to rewrite
;;      again.
;;
;; Both scripts call the SAME promotion_gates_cli.bb, which calls the SAME
;; promotion-gates-lib/evaluate and /route-target - proving these properties
;; once here is what "BOTH rewrite sites, not only the promote commit" (the
;; ticket's own invariant 2 wording) actually rests on structurally: a single
;; shared decision function, never two independently-drifting copies.
;;
;; Deterministic by construction: a seeded LCG, never rand. GENERATOR
;; WEIGHTING: small alphabets everywhere (per the recorded lesson that a wide
;; uniform draw can pass hundreds of runs against a live defect because it
;; never reaches the interesting/colliding state) - see the "generator
;; coverage" asserts at the bottom, which fail loudly if a future tweak
;; skews the distribution back out of the interesting region.
;;
;; Non-vacuity proven by hand at authoring time: P1 was run against a
;; deliberately broken evaluate (orthogonality-refusal branch dropped from
;; the `or` chain) and failed as expected before this file was finalized;
;; P2/P3 were run against a broken route-target (assigned-to: "specifier"
;; wrongly routed to coder) and likewise failed. P4 was run against a
;; deliberately broken expedited? (the type-membership check dropped, so
;; every candidate reads as non-expedited and rank-candidates falls through
;; to pure priority order) and failed as expected before this file was
;; finalized; restored before commit.
;;
;; BL-854 (declared invariants; see the coder role's Invariants section - a
;; declared invariant's property test is coder-authored first):
;;   1. "Orthogonality never refuses a promotion" - P1 below was widened so
;;      `expected` no longer includes an orthogonality branch (evaluate must
;;      never refuse on it), and P7 directly asserts no result ever carries
;;      :gate "orthogonality". Non-vacuity: P1 was run against evaluate with
;;      orthogonality-advisory reinstated into the refusal `or` chain (the
;;      pre-BL-854 shape) and failed on every colliding-epic-under-cap case,
;;      as expected; P7 likewise failed against that same reinstated build.
;;      Restored before commit.
;;   2. "An advisory is evidence-bearing... names each active ticket it
;;      fired on" - P8 quantifies evaluate's :advisory over the SAME
;;      active-epics map gen-context draws, independently recomputing the
;;      expected ids (never calling orthogonality-advisory back) and
;;      asserting the advisory is present iff there is real overlap, and
;;      when present names EXACTLY that epic's ids, no more, no fewer.
;;      Non-vacuity: run against orthogonality-advisory with `(first ids)`
;;      substituted for the full ids vector (advisory drops every id but the
;;      first) and failed on every multi-id overlap, as expected. Restored
;;      before commit.
;;   3. "No other verdict changes: human_approval, depth, hold, and Article
;;      3.2.4 ranking stay byte-identical to today" - human-approval-refusal,
;;      depth-refusal, hold-refusal, expedited?, and rank-candidates are not
;;      touched by this ticket's diff at all, so P1 (hold/approval/depth
;;      precedence), P4 (expedite ranking), P5, and P6 continue to exercise
;;      the exact same, unmodified code paths as before BL-854 - this is a
;;      structural fact about which functions BL-854's diff touches, not a
;;      new input/output relationship a property could quantify over any
;;      more directly than "these functions' source is unchanged", per the
;;      coder role's own carve-out for a declared invariant that "quantifies
;;      over prose or process rather than a pure, testable module".
;;
;; BL-900 (declared invariants):
;;   1. "Ordering only: never grants an extra active slot, never overrides
;;      orthogonality, the mutation-heavy window or the circuit breaker" -
;;      rank-candidates/epic-priority/epic-priority-index are net-new
;;      additions never called from evaluate/depth-refusal/hold-refusal/
;;      orthogonality-advisory, and cmd-select's own gate order (evaluate
;;      every candidate, THEN rank only the survivors) is unchanged by this
;;      diff - a structural fact about which functions this ticket's diff
;;      touches, not an input/output relationship a property could quantify
;;      over any more directly than "these functions' source is unchanged",
;;      per the coder role's own carve-out (same one BL-854 invariant 3 and
;;      BL-853 invariant 2 above already use).
;;   2. "The expedite bucket stays strictly first ... regardless of either
;;      candidate's epic priority" - P9 below deliberately gives the
;;      NON-expedited candidate the more urgent (lower) epic-priority, the
;;      adversarial case the invariant exists to name, and asserts the
;;      expedited candidate still wins.
;;   3. "Ranking is a deterministic total order ... regardless of
;;      enumeration order" - P10 ranks the SAME candidate set twice, the
;;      second time reversed, and asserts the FULL resulting order (not
;;      just the winner) is byte-identical both times. A forced-tie shape
;;      (same expedited?/epic-priority/own-priority, different id) is
;;      drawn into a third of sets - stable-sort code that dropped the id
;;      tie-break would let a tied pair's relative order flip between the
;;      two enumerations, which only a forced-tie draw reliably exercises
;;      (same "independently-drawn fields make the interesting conjunction
;;      rare" lesson as gen-context's own shape draws above).
;;
;; Non-vacuity proven by hand at authoring time: P9 was run with
;; epic-priority spliced BEFORE the expedited term instead of after
;; (rank-key reordered to [epic-priority expedited? ...]) and failed on
;; every case where the non-expedited candidate's epic-priority beat the
;; expedited one's, as expected. P10 was run with the trailing id tie-break
;; dropped from rank-key and failed on forced-tie draws once enumeration
;; order flipped, as expected. Both restored before commit.

(ns promotion-gates-lib-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "promotion_gates_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 500))
(def failures (atom []))

;; ── seeded generator ──────────────────────────────────────────────────────

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-bool [s] (let [[v s'] (gen-int s 2)] [(= 1 v) s']))
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop gen-fn pred-fn]
  (loop [i 0 s 7]
    (when (< i runs)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result)
          (report! prop s input (str result)))
        (recur (inc i) s')))))

;; ── generators ────────────────────────────────────────────────────────────

;; Small, deliberately overlapping alphabets - a wide alphabet makes the
;; interesting (colliding-epic, failing-approval) branches rare; see
;; expedite_lib_property_runner.bb's own header for the recorded incident
;; this weighting posture is a direct response to.
(def approval-alphabet [nil "approved" "pending" "amending"])
(def epic-alphabet ["alpha" "beta"])

(defn gen-content [s]
  (let [[approval s1] (gen-pick s approval-alphabet)
        [epic? s2] (gen-bool s1)
        [epic s3] (gen-pick s2 epic-alphabet)]
    [(str (when approval (str "human_approval: " approval "\n"))
          (when epic? (str "epic: " epic "\n")))
     s3]))

;; BL-854: active-epics is now epic -> ids (see promotion_gates_lib.bb's own
;; reader), not a bare epic set - the generator draws a small id alphabet per
;; epic so P8 (advisory evidence-bearing) below has more than one id to prove
;; it names ALL of them, not just the first.
(def active-id-alphabet ["BL-900" "BL-901" "BL-902"])

(defn gen-active-epics [s]
  (let [[n s1] (gen-int s 3)]
    (reduce (fn [[acc sx] _]
              (let [[e sy] (gen-pick sx epic-alphabet)
                    [id sz] (gen-pick sy active-id-alphabet)]
                [(update acc e (fnil conj []) id) sz]))
            [{} s1] (range n))))

;; WEIGHTED, per the recorded "uniform draw passed hundreds of runs against a
;; live defect because it never reached the interesting state" trap
;; (expedite_lib_property_runner.bb's own header): drawing every field
;; independently and uniformly makes ALL-GATES-PASS a rare conjunction (each
;; of held?/approval/depth/orthogonality independently has to land on its
;; passing branch), so P1's :ok branch was measured at 27/500 - below the
;; 10% floor - before this shape draw was added. A third of contexts are now
;; a GUARANTEED-compliant shape (mirrors gen-probe's own "fully stopped"
;; bucket), so the :ok branch is genuinely, not just theoretically, covered.
;;
;; BL-854 P8 needed a FOURTH, similarly guaranteed shape: a genuinely
;; independent draw makes "epic overlaps AND that epic maps to 2+ distinct
;; active ids" a rare conjunction on its own (measured: the naive draw's own
;; multi-id branch was exercised on 0/500 runs - it hid a real gap, the
;; :ids [(first ids)] mutation described in this file's header passed
;; cleanly against the undertuned generator before this shape was added).
;; shape 3 below forces exactly that case so P8's multi-id assertion is
;; genuinely exercised, not just theoretically reachable.
(defn gen-context [s]
  (let [[shape s0] (gen-int s 4)]
    (cond
      (zero? shape)
      (let [[epic? s1] (gen-bool s0)
            [epic s2] (gen-pick s1 epic-alphabet)]
        [{:content (str "human_approval: approved\n" (when epic? (str "epic: " epic "-solo\n")))
          :held? false :active-count 0 :max-depth 3 :active-epics {}}
         s2])

      (= 3 shape)
      (let [[epic s1] (gen-pick s0 epic-alphabet)]
        [{:content (str "human_approval: approved\nepic: " epic "\n")
          :held? false :active-count 1 :max-depth 3
          :active-epics {epic ["BL-900" "BL-901"]}}
         s1])

      :else
      (let [[content s1] (gen-content s0)
            [held? s2] (gen-bool s1)
            [active-count s3] (gen-int s2 4)
            [max-depth s4] (gen-int s3 4)
            [active-epics s5] (gen-active-epics s4)]
        [{:content content :held? held? :active-count active-count :max-depth max-depth :active-epics active-epics} s5]))))

(def assigned-to-alphabet ["specifier" "coder" nil "documenter" "cleaner" "" "Specifier" "Coder"])

(defn gen-assigned-to [s] (gen-pick s assigned-to-alphabet))

;; P4 candidate generator: mixed type (including the retired legacy "bug"
;; alongside "defect", per Article 3.2.4's transition clause), mixed
;; severity (including absent, which must fail CLOSED - never expedited),
;; and a priority alphabet with deliberate repeats so ties are common, not
;; rare.
;;
;; Each generated candidate carries :expected-expedited?, :priority, and :id
;; computed DIRECTLY from the drawn type/severity/priority/id by this file's
;; own restatement of the Article 3.2.4 rule (expected-expedited?, below) -
;; deliberately NOT by calling promotion-gates-lib/expedited? back. Deriving
;; the oracle from the SUT's own classifier would make P4 circular: breaking
;; expedited? would break the property's expectation in lockstep with
;; rank-candidates' behavior, so the property could never fail no matter how
;; badly expedited? was broken (caught by this file's own non-vacuity check -
;; see the header). rank-candidates returns the original candidate map
;; unchanged (sort-by + first never reconstructs it), so the winner carries
;; these fields straight through for the property to read.
(def candidate-type-alphabet ["defect" "bug" "feature" "chore"])
(def candidate-severity-alphabet ["critical" "high" "medium" nil])
(def candidate-priority-alphabet [1 5 5 20])
(def candidate-id-alphabet ["BL-1" "BL-2" "BL-3" "BL-9" "BL-10"])

(defn- expected-expedited?
  "This file's OWN restatement of Article 3.2.4 - independent of, and never
   calling, promotion-gates-lib/expedited?. See the non-vacuity note above."
  [type severity]
  (boolean (and (contains? #{"defect" "bug"} type)
                (contains? #{"critical" "high"} severity))))

(defn gen-candidate [s]
  (let [[type s1] (gen-pick s candidate-type-alphabet)
        [severity s2] (gen-pick s1 candidate-severity-alphabet)
        [priority s3] (gen-pick s2 candidate-priority-alphabet)
        [id s4] (gen-pick s3 candidate-id-alphabet)]
    [{:file (str id "|" type "|" (or severity "none") "|" priority)
      :content (str "id: " id "\n"
                     "type: " type "\n"
                     (when severity (str "severity: " severity "\n"))
                     "priority: " priority "\n")
      :expected-expedited? (expected-expedited? type severity)
      :priority priority
      :id id}
     s4]))

;; Guaranteed-expedited candidate: type defect/bug + severity critical/high.
;; Used to force at least one expedited candidate into a fraction of the
;; generated sets - per the "uniform draw passed hundreds of runs against a
;; live defect" lesson (this file's own header), an independently-drawn
;; type/severity pair makes "expedited AND present in a small random set"
;; a rare conjunction on its own.
(defn gen-forced-expedited-candidate [s]
  (let [[type s1] (gen-pick s ["defect" "bug"])
        [severity s2] (gen-pick s1 ["critical" "high"])
        [priority s3] (gen-pick s2 candidate-priority-alphabet)
        [id s4] (gen-pick s3 candidate-id-alphabet)]
    [{:file (str id "|" type "|" severity "|" priority "|forced")
      :content (str "id: " id "\ntype: " type "\nseverity: " severity "\npriority: " priority "\n")
      :expected-expedited? true
      :priority priority
      :id id}
     s4]))

(defn gen-candidates
  "1-4 candidates; roughly a third of draws force at least one expedited
   candidate into the set (mirrors gen-context's own shape-draw discipline)."
  [s]
  (let [[shape s0] (gen-int s 3)
        [extra s1] (gen-int s0 4)
        n (inc extra)
        [cands s2] (reduce (fn [[acc sx] _]
                              (let [[c sy] (gen-candidate sx)]
                                [(conj acc c) sy]))
                            [[] s1] (range n))]
    (if (zero? shape)
      (let [[forced s3] (gen-forced-expedited-candidate s2)]
        [(conj cands forced) s3])
      [cands s2])))

(defn- candidate-tie-key [c] [(:priority c) (:id c)])

;; ── P1: evaluate refuses iff a BLOCKING gate fails, naming the FIRST by
;;        fixed precedence (held -> human_approval -> depth). BL-854:
;;        orthogonality is no longer in this chain at all - see P7 below for
;;        its own invariant (it never refuses, whatever the epic overlap) ──

(check-all "P1 evaluate composition: refuses iff a blocking gate fails, names the first one"
  gen-context
  (fn [{:keys [content held? active-count max-depth] :as ctx}]
    (let [result (promotion-gates-lib/evaluate ctx)
          hold (promotion-gates-lib/hold-refusal held?)
          approval (promotion-gates-lib/human-approval-refusal content)
          depth (promotion-gates-lib/depth-refusal active-count max-depth)
          expected (:gate (or hold approval depth))]
      (cond
        (and (nil? expected) (not (:ok result)))
        (str "no blocking gate fails but evaluate refused: " (pr-str result))

        (and expected (:ok result))
        (str "gate " expected " fails but evaluate returned ok")

        (and expected (not= expected (:gate result)))
        (str "expected first-failing gate " expected " but evaluate named " (:gate result))

        :else true))))

;; ── P7 (BL-854 invariant 1): orthogonality never refuses a promotion - for
;;        every candidate, whatever the epic overlap, evaluate's refusal (if
;;        any) is never :gate "orthogonality" ───────────────────────────────

(check-all "P7 orthogonality never refuses: evaluate's :gate is never \"orthogonality\""
  gen-context
  (fn [ctx]
    (let [result (promotion-gates-lib/evaluate ctx)]
      (if (= "orthogonality" (:gate result))
        (str "evaluate refused on orthogonality: " (pr-str result) " - it must only ever advise")
        true))))

;; ── P8 (BL-854 invariant 2): the orthogonality advisory is evidence-bearing
;;        - present iff the candidate's epic genuinely overlaps an active
;;        ticket's, and when present names EXACTLY the ids active-epics maps
;;        that epic to, no more, no fewer. Independent oracle: recomputes
;;        expected overlap/ids directly from active-epics, never by calling
;;        orthogonality-advisory back (same non-circularity discipline as
;;        P4's expected-expedited?) ────────────────────────────────────────

(check-all "P8 orthogonality advisory: present iff real overlap, names exactly the overlapping ids"
  gen-context
  (fn [{:keys [content active-epics] :as ctx}]
    (let [result (promotion-gates-lib/evaluate ctx)
          epic (promotion-gates-lib/read-epic content)
          expected-ids (vec (sort (get active-epics epic)))
          advisory (:advisory result)]
      (cond
        (not (:ok result))
        true ; a blocking-gate refusal never reaches the advisory branch (P1)

        (and (empty? expected-ids) advisory)
        (str "no real overlap for epic " (pr-str epic) " but an advisory fired: " (pr-str advisory))

        (and (seq expected-ids) (nil? advisory))
        (str "epic " epic " overlaps active ids " expected-ids " but no advisory fired")

        (and (seq expected-ids) (not= expected-ids (:ids advisory)))
        (str "advisory ids " (pr-str (:ids advisory)) " do not exactly match the overlapping ids " (pr-str expected-ids))

        :else true))))

;; ── P2: route-target never marks assigned_to: specifier for rewrite, and
;;        always routes it to the specifier; every other value routes to
;;        coder, rewritten iff it did not already read exactly "coder" ────

(check-all "P2 route-target: specifier is never rewritten; everything else routes to coder"
  gen-assigned-to
  (fn [assigned-to]
    (let [{:keys [route-to rewrite-assigned-to?]} (promotion-gates-lib/route-target assigned-to)]
      (if (= "specifier" assigned-to)
        (cond
          (not= "specifier" route-to) (str "specifier routed to " route-to)
          rewrite-assigned-to? "specifier was marked for rewrite"
          :else true)
        (cond
          (not= "coder" route-to) (str "non-specifier " (pr-str assigned-to) " routed to " route-to)
          (not= (not= "coder" assigned-to) (boolean rewrite-assigned-to?))
          (str "rewrite flag " rewrite-assigned-to? " disagrees with assigned_to=" (pr-str assigned-to))
          :else true)))))

;; ── P3: route-target is a fixed point - "never a side effect" means a
;;        second call on the settled value never asks to rewrite again ────

(check-all "P3 route-target fixed point: settling once never asks to rewrite twice"
  gen-assigned-to
  (fn [assigned-to]
    (let [first-decision (promotion-gates-lib/route-target assigned-to)
          settled (if (:rewrite-assigned-to? first-decision) (:route-to first-decision) assigned-to)
          second-decision (promotion-gates-lib/route-target settled)]
      (if (:rewrite-assigned-to? second-decision)
        (str "not a fixed point: settled value " (pr-str settled) " still asks for rewrite -> " (pr-str second-decision))
        true))))

;; ── P4: rank-candidates - Article 3.2.4 expedite lane always wins, priority
;;        then id is the ONLY tie-break, and only within a bucket (the
;;        ticket's own headline defect class - architect bounce
;;        2026-08-01, backlog/evidence/BL-663-bounce-architect-20260801.md) ─

(check-all "P4 rank-candidates: an expedited candidate always beats every non-expedited one regardless of priority number; priority then id is the only tie-break, within a bucket"
  gen-candidates
  (fn [candidates]
    (let [winner (promotion-gates-lib/rank-candidates candidates)
          expected-present? (boolean (some :expected-expedited? candidates))
          winner-expected? (boolean (:expected-expedited? winner))]
      (cond
        (and expected-present? (not winner-expected?))
        (str "an Article-3.2.4-expedited candidate exists but rank-candidates picked "
             (:file winner) ", which is not one")

        :else
        (let [same-bucket (filter #(= winner-expected? (boolean (:expected-expedited? %))) candidates)
              winner-key (candidate-tie-key winner)
              loser (some (fn [c] (when (pos? (compare winner-key (candidate-tie-key c))) c)) same-bucket)]
          (if loser
            (str "winner " (:file winner) " (key " (pr-str winner-key) ") does not have the minimal"
                 " priority/id within its own bucket - " (:file loser) " (key " (pr-str (candidate-tie-key loser)) ") ranks ahead of it")
            true))))))

;; ── P5/P6 (BL-853 coder pass, declared invariants) ──────────────────────
;; BL-853: depth-refusal used to be a bare (>= active-count max-depth) with
;; no no-limit branch, so even a correctly-resolved -1 (backlog-depth-lib's
;; documented no-limit sentinel) refused at any active count. P5 quantifies
;; invariant 1 ("with a negative configured or effective cap, the depth
;; gate allows at every active count") over a wide active-count range. P6
;; quantifies invariant 3 ("with a finite cap, every promotion decision is
;; byte-identical to today's") by restating the PRE-FIX formula as an
;; independent oracle here - never by calling depth-refusal back into
;; itself - so a regression that reintroduces a divergent finite-cap
;; formula (not just a missing no-limit branch) would also be caught.
;; Invariant 2 ("every cap comes from the shared depth library - the
;; promotion path parses no config and declares no depth default of its
;; own") is a structural fact about promote_and_route_next.sh's shell
;; script (which literal, if any, it hardcodes), not an input/output
;; relationship of a pure function this generator can quantify over; it is
;; recorded as a stated reason in this ticket's commit rather than forced
;; into a property here, per the coder role's own carve-out for a
;; declared invariant that "quantifies over prose or process rather than a
;; pure, testable module."
;;
;; Non-vacuity proven by hand at authoring time: P5 was run against the
;; PRE-FIX depth-refusal (bare (>= active-count max-depth), no no-limit
;; branch) and failed on every negative-max-depth case, as expected -
;; restored before commit.

(defn gen-depth-case [s]
  (let [[negative? s0] (gen-bool s)
        [magnitude s1] (gen-int s0 6)
        [active-count s2] (gen-int s1 6)]
    (if negative?
      [{:active-count active-count :max-depth (- (inc magnitude))} s2]
      [{:active-count active-count :max-depth magnitude} s2])))

(check-all "P5 depth-refusal: a negative max-depth (no-limit) never refuses, at any active count"
  gen-depth-case
  (fn [{:keys [active-count max-depth]}]
    (if (neg? max-depth)
      (let [result (promotion-gates-lib/depth-refusal active-count max-depth)]
        (if (nil? result)
          true
          (str "no-limit max-depth " max-depth " with active-count " active-count " still refused: " (pr-str result))))
      true)))

(check-all "P6 depth-refusal: a non-negative max-depth is byte-identical to the pre-fix (>= active-count max-depth) formula"
  gen-depth-case
  (fn [{:keys [active-count max-depth]}]
    (if (neg? max-depth)
      true
      (let [result (promotion-gates-lib/depth-refusal active-count max-depth)
            expected-refuse? (>= active-count max-depth)
            expected-reason (format "active count %d >= cap %d - no open slot" active-count max-depth)]
        (cond
          (and expected-refuse? (nil? result))
          (str "expected a refusal for active-count " active-count " >= max-depth " max-depth " but got nil")

          (and (not expected-refuse?) (some? result))
          (str "expected no refusal for active-count " active-count " < max-depth " max-depth " but got " (pr-str result))

          (and expected-refuse? (not= "active_backlog_max_depth" (:gate result)))
          (str "wrong gate name: " (:gate result))

          (and expected-refuse? (not= expected-reason (:reason result)))
          (str "reason string diverged from the pre-fix formula: got " (pr-str (:reason result)) ", expected " (pr-str expected-reason))

          :else true)))))

;; ── P9/P10 (BL-900, declared invariants) - see this file's own header ────

;; Deliberate repeat, biasing draws toward the "urgent" value - same
;; weighting posture as candidate-priority-alphabet's own repeated 5.
(def epic-priority-alphabet [1 1 50 900])

;; BUG FOUND AUTHORING P10: an earlier draft drew each candidate's id
;; independently, so two DIFFERENT candidates could land on the SAME id -
;; then their rank-key (which ends in id) is genuinely, fully tied, and a
;; stable sort legitimately lets enumeration order decide between them
;; (correct sort behavior, not a defect). Real backlog ids are unique per
;; ticket file, so this generator draws WITHOUT replacement - every id in
;; one generated set is distinct, matching that real invariant, and the
;; property only ever asks whether DISTINCT tickets rank deterministically.
(defn- draw-distinct-ids [s n]
  (loop [avail candidate-id-alphabet picked [] sx s cnt n]
    (if (zero? cnt)
      [picked sx]
      (let [[i sy] (gen-int sx (count avail))
            v (nth avail i)]
        (recur (vec (remove #{v} avail)) (conj picked v) sy (dec cnt))))))

(defn- mk-epic-candidate [id type severity priority epic-name epic-p]
  {:file (str id "|" type "|" (or severity "none") "|" priority "|" (or epic-name "noepic"))
   :content (str "id: " id "\n" "type: " type "\n"
                  (when severity (str "severity: " severity "\n"))
                  "priority: " priority "\n"
                  (when epic-name (str "epic: " epic-name "\n")))
   :epic-entry (when epic-name [epic-name epic-p])
   :expected-expedited? (expected-expedited? type severity)
   :priority priority
   :id id
   :tied? (boolean (and epic-name (str/starts-with? epic-name "tied-epic-")))})

(defn gen-epic-candidate-set
  "1-3 base candidates (distinct id, each with its own independent
   type/severity/priority/epic); a third of draws ALSO force a tied pair
   (same type/severity/priority/epic-priority, distinct id from each other
   and from the base candidates) into the set - the case P10's non-vacuity
   depends on (see header). n-base maxes at 3 and a tied pair adds 2, so the
   5-entry id alphabet always covers the total without repeats."
  [s]
  (let [[tie? s0] (gen-bool s)
        [extra s1] (gen-int s0 3)
        n-base (inc extra)
        n-total (+ n-base (if tie? 2 0))
        [ids s2] (draw-distinct-ids s1 n-total)
        base-ids (take n-base ids)
        tied-ids (drop n-base ids)
        [base-cands s3] (reduce (fn [[acc sx] id]
                                   (let [[type sy] (gen-pick sx candidate-type-alphabet)
                                         [severity sz] (gen-pick sy candidate-severity-alphabet)
                                         [priority sw] (gen-pick sz candidate-priority-alphabet)
                                         [epic? sv] (gen-bool sw)
                                         [epic-p su] (gen-pick sv epic-priority-alphabet)
                                         epic-name (when epic? (str "epic-" su))]
                                     [(conj acc (mk-epic-candidate id type severity priority epic-name epic-p)) su]))
                                 [[] s2] base-ids)]
    (if (= 2 (count tied-ids))
      (let [[type s4] (gen-pick s3 candidate-type-alphabet)
            [severity s5] (gen-pick s4 candidate-severity-alphabet)
            [priority s6] (gen-pick s5 candidate-priority-alphabet)
            [epic-p s7] (gen-pick s6 epic-priority-alphabet)
            epic-name (str "tied-epic-" s7)
            tied-cands (map #(mk-epic-candidate % type severity priority epic-name epic-p) tied-ids)]
        [(into base-cands tied-cands) s7])
      [base-cands s3])))

(defn- merged-epic-index [candidates]
  (reduce (fn [m c] (if-let [[k v] (:epic-entry c)] (assoc m k v) m)) {} candidates))

(check-all "P9 rank-candidates (BL-900): the expedited bucket stays strictly first regardless of epic priority"
  gen-epic-candidate-set
  (fn [candidates]
    (let [epic-index (merged-epic-index candidates)
          winner (promotion-gates-lib/rank-candidates candidates epic-index)
          expected-present? (boolean (some :expected-expedited? candidates))
          winner-expected? (boolean (:expected-expedited? winner))]
      (if (and expected-present? (not winner-expected?))
        (str "an expedited candidate exists but rank-candidates picked " (:file winner)
             ", which is not expedited - epic-priority must never outrank the expedite bucket")
        true))))

(defn- ranked-order
  "The FULL ranked :file sequence for candidates against epic-index, by
   repeatedly asking rank-candidates for the winner and removing it - O(n^2),
   fine at these small n, and exercises the real production function rather
   than re-deriving a sort independently."
  [candidates epic-index]
  (loop [remaining candidates order []]
    (if (empty? remaining)
      order
      (let [winner (promotion-gates-lib/rank-candidates remaining epic-index)]
        (recur (remove #(= (:file winner) (:file %)) remaining) (conj order (:file winner)))))))

(check-all "P10 rank-candidates (BL-900): the total order is deterministic regardless of enumeration order"
  gen-epic-candidate-set
  (fn [candidates]
    (let [epic-index (merged-epic-index candidates)
          forward (ranked-order candidates epic-index)
          reversed (ranked-order (vec (reverse candidates)) epic-index)]
      (if (= forward reversed)
        true
        (str "ranking order depends on enumeration order: forward=" (pr-str forward) " reversed=" (pr-str reversed))))))

;; ── generator coverage, asserted rather than assumed ─────────────────────

(let [[refused ok] (loop [i 0 s 7 r 0 o 0]
                     (if (= i runs)
                       [r o]
                       (let [[ctx s'] (gen-context s)]
                         (if (:ok (promotion-gates-lib/evaluate ctx))
                           (recur (inc i) s' r (inc o))
                           (recur (inc i) s' (inc r) o)))))
      floor (quot runs 10)]
  (println (str "  generator coverage: refused=" refused " ok=" ok))
  (when (< refused floor)
    (report! "COVERAGE P1 refused branch" 7 {:refused refused :floor floor} "the refused branch is barely exercised"))
  (when (< ok floor)
    (report! "COVERAGE P1 ok branch" 7 {:ok ok :floor floor} "the ok branch is barely exercised")))

(let [[rewritten kept] (loop [i 0 s 7 rw 0 kp 0]
                          (if (= i runs)
                            [rw kp]
                            (let [[assigned-to s'] (gen-assigned-to s)
                                  rewrite? (:rewrite-assigned-to? (promotion-gates-lib/route-target assigned-to))]
                              (if rewrite?
                                (recur (inc i) s' (inc rw) kp)
                                (recur (inc i) s' rw (inc kp))))))
      floor (quot runs 10)]
  (println (str "  generator coverage: rewrite=" rewritten " kept=" kept))
  (when (< rewritten floor)
    (report! "COVERAGE P2/P3 rewrite branch" 7 {:rewritten rewritten :floor floor} "the rewrite branch is barely exercised"))
  (when (< kept floor)
    (report! "COVERAGE P2/P3 kept branch" 7 {:kept kept :floor floor} "the no-rewrite branch is barely exercised")))

(let [[with-expedited without] (loop [i 0 s 7 w 0 wo 0]
                                  (if (= i runs)
                                    [w wo]
                                    (let [[candidates s'] (gen-candidates s)]
                                      (if (some :expected-expedited? candidates)
                                        (recur (inc i) s' (inc w) wo)
                                        (recur (inc i) s' w (inc wo))))))
      floor (quot runs 10)]
  (println (str "  generator coverage: expedited-present=" with-expedited " none-expedited=" without))
  (when (< with-expedited floor)
    (report! "COVERAGE P4 expedited-present branch" 7 {:with-expedited with-expedited :floor floor} "the expedited-present branch is barely exercised"))
  (when (< without floor)
    (report! "COVERAGE P4 none-expedited branch" 7 {:without without :floor floor} "the none-expedited branch is barely exercised")))

(let [multi-id (loop [i 0 s 7 m 0]
                 (if (= i runs)
                   m
                   (let [[{:keys [content active-epics]} s'] (gen-context s)
                         epic (promotion-gates-lib/read-epic content)
                         ids (get active-epics epic)]
                     (recur (inc i) s' (if (> (count ids) 1) (inc m) m)))))
      floor (quot runs 10)]
  (println (str "  generator coverage: multi-id-advisory=" multi-id))
  (when (< multi-id floor)
    (report! "COVERAGE P8 multi-id advisory branch" 7 {:multi-id multi-id :floor floor} "the multi-id advisory branch is barely exercised")))

(let [[with-expedited without] (loop [i 0 s 7 w 0 wo 0]
                                  (if (= i runs)
                                    [w wo]
                                    (let [[candidates s'] (gen-epic-candidate-set s)]
                                      (if (some :expected-expedited? candidates)
                                        (recur (inc i) s' (inc w) wo)
                                        (recur (inc i) s' w (inc wo))))))
      floor (quot runs 10)]
  (println (str "  generator coverage: P9 expedited-present=" with-expedited " none-expedited=" without))
  (when (< with-expedited floor)
    (report! "COVERAGE P9 expedited-present branch" 7 {:with-expedited with-expedited :floor floor} "the expedited-present branch is barely exercised")))

(let [tied (loop [i 0 s 7 t 0]
             (if (= i runs)
               t
               (let [[candidates s'] (gen-epic-candidate-set s)
                     tied? (>= (count (filter :tied? candidates)) 2)]
                 (recur (inc i) s' (if tied? (inc t) t)))))
      floor (quot runs 10)]
  (println (str "  generator coverage: P10 forced-tie-pair=" tied))
  (when (< tied floor)
    (report! "COVERAGE P10 forced-tie-pair branch" 7 {:tied tied :floor floor} "the forced-tie-pair branch is barely exercised")))

;; ── report ────────────────────────────────────────────────────────────────
(println (str "promotion_gates_lib properties: " runs " runs each"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
