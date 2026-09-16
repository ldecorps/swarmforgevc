;; sampled_reach_floor_guard_lib.bb — BL-1584: refuses a git_handoff whose own
;; parcel ADDS a property test file under extension/test/*.property.test.js
;; that draws a low, literal budget (fast-check `numRuns` or `fc.sample`
;; count) and then asserts every arm of its case space was reached - a seed
;; lottery, not a real assertion. BL-1062 shipped the remedy
;; (`runsPerCell` + `assertReachFloor` in extension/test/helpers/reachFloors.js)
;; and the convention is in the hardener's and coder's prompts, but until this
;; gate, nothing at the send chokepoint reads the file to enforce it - seven
;; unowned-red tickets in ten days (BL-1555, BL-1559, BL-1572, BL-1578,
;; BL-1580, BL-1581 and BL-1579's neighbours) share exactly this shape, each
;; costing an Article 4.2 hold on an unrelated parcel.
;;
;; ONE CLASSIFIER (`classify`), pure, file text in, {:verdict :reach-floor?
;; :constructed? :budget :matched} out. The gate and the census CLI
;; (sampled_reach_floor_census_cli.bb) both call it - never a second notion of
;; reach floor, construction, or budget (invariant 2).
;;
;; PARCEL-SCOPED and ADDED-ONLY (invariant 1): the gate refuses only a
;; property test file the parcel itself ADDED (absent at the received commit
;; recorded in the sender's in_process mailbox, present at the forwarded
;; commit) with verdict :sampled-low. A file present at both received and
;; forwarded (however it was touched) is at most a warning, never a refusal -
;; a pre-existing file's shape is not this parcel's fault to fix.
;;
;; FAIL-OPEN IS ABSOLUTE (invariant 3), same posture as every other send-time
;; gate in swarm_handoff.bb: an unreadable commit range, an unresolvable task
;; id, no recorded received commit (the ordinary first-hop case - silent, the
;; same convention merge_drop_guard_lib.bb and BL-806 follow), or an unreadable
;; file each warn (or, for "no recorded received commit", stay silent) and
;; send - never refuse on the gate's own blindness.

(ns sampled-reach-floor-guard-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "pipeline_stage_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "daemon_cycle_guard_lib.bb")))
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "task_scope_gate_lib.bb")))
;; received-commit-for-task: no second reader of the in_process "commit"
;; header - reuse BL-1576's own reader (see merge_drop_guard_lib.bb's
;; identical load-file comment).
(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "review_forward_evidence_gate_lib.bb")))

;; ── the one classifier: pure, over file text alone ──────────────────────────

(def property-test-dir
  "The one tree this gate governs - a flat glob, never recursive, matching
   the ticket's own `extension/test/*.property.test.js` population."
  "extension/test")

(def known-phrases
  "Pinned as data, not a regex the coder hand-assembles, so the census
   evidence can quote it and an amendment is a one-line data change.
   Case-insensitive substring match against an assert call's own argument
   text - never against the whole file, so a comment-only mention (18 of
   the human's 48-file grep 1 hits) never matches."
  ["never produced" "never reached" "never exercised" "never drew" "never saw"
   "never generated" "never built" "never answered" "never refused" "never left"
   "never worked" "never drawn" "never followed" "never created" "ever sampled"
   "too rare" "reach floor" "reachability floor" "generator coverage"
   "generator must reach" "the generator reached" "draws were" "silently lost"
   "pass vacuously" "both arms" "common by construction" "were reached"
   "was reached"])

;; ── comments never match (BL-1584's own version of the phrase-matcher's
;;    "a comment never matches" rule, applied uniformly to every check
;;    below, not only phrase-in-assert-args) ────────────────────────────

(defn strip-comments
  "Pure: text with every // line comment and /* block */ comment blanked out
   (replaced with spaces, newlines preserved) - string/template literal
   content is left untouched, escape-aware, so a `//` or `/*` inside a
   string is never mistaken for a comment start. Applied before every
   classification check (reach-floor?, constructed?, budget) so a comment
   mentioning assertReachFloor, a KNOWN_PHRASES word, or runsPerCell( can
   never itself trigger a match - the same guarantee the ticket's own
   'a comment never matches' note asks for, but general rather than scoped
   only to assert-call argument text."
  [^String text]
  (let [n (count text)
        sb (StringBuilder. n)]
    (loop [i (int 0) in-str nil]
      (if (>= i n)
        (str sb)
        (let [c (.charAt text i)]
          (cond
            in-str
            (cond
              (= c \\) (do (.append sb c)
                           (when (< (inc i) n) (.append sb (.charAt text (inc i))))
                           (recur (+ i 2) in-str))
              (= c in-str) (do (.append sb c) (recur (inc i) nil))
              :else (do (.append sb c) (recur (inc i) in-str)))

            (contains? #{\' \" \`} c)
            (do (.append sb c) (recur (inc i) c))

            (and (= c \/) (< (inc i) n) (= (.charAt text (inc i)) \/))
            (let [end (or (str/index-of text "\n" i) n)]
              (dotimes [_ (- end i)] (.append sb \space))
              (recur end nil))

            (and (= c \/) (< (inc i) n) (= (.charAt text (inc i)) \*))
            (let [close (str/index-of text "*/" i)
                  end (if close (+ close 2) n)]
              (doseq [j (range i end)]
                (.append sb (if (= (.charAt text j) \newline) \newline \space)))
              (recur end nil))

            :else
            (do (.append sb c) (recur (inc i) nil))))))))

;; ── string-aware balanced-paren scanning (shared by call-span extraction
;;    and top-level argument splitting) ───────────────────────────────────

(defn- matching-close-paren
  "Index in text of the ')' that closes the '(' immediately before start
   (start is the index of the char right after that '('), or nil if
   unbalanced. Chars inside '...' \"...\" `...` are skipped, escape-aware,
   so a stray paren inside a string literal never desyncs the depth count."
  [^String text start]
  (let [n (count text)]
    (loop [i (int start) depth (int 1) in-str nil]
      (if (>= i n)
        nil
        (let [c (.charAt text i)]
          (cond
            in-str
            (cond
              (= c \\) (recur (+ i 2) depth in-str)
              (= c in-str) (recur (inc i) depth nil)
              :else (recur (inc i) depth in-str))

            (contains? #{\' \" \`} c)
            (recur (inc i) depth c)

            (= c \()
            (recur (inc i) (inc depth) nil)

            (= c \))
            (if (= depth 1) i (recur (inc i) (dec depth) nil))

            :else
            (recur (inc i) depth nil)))))))

(defn- find-call-spans
  "Every occurrence of call-re (a regex whose match ends exactly at the
   call's own opening '(') in text, as {:start :end :args}, :args being the
   raw text between that call's own balanced parens."
  [text call-re]
  (let [matcher (re-matcher call-re (str text))]
    (loop [spans []]
      (if (.find matcher)
        (let [open (.end matcher)
              close (matching-close-paren text open)]
          (if close
            (recur (conj spans {:start (.start matcher) :end (inc close) :args (subs text open close)}))
            (recur spans)))
        spans))))

(defn- top-level-args
  "text split on commas at depth 0 of (), {}, [] and outside strings - the
   call's own top-level argument list."
  [^String text]
  (let [n (count text)]
    (loop [i (int 0) depth (int 0) in-str nil start (int 0) parts []]
      (if (>= i n)
        (conj parts (subs text start i))
        (let [c (.charAt text i)]
          (cond
            in-str
            (cond
              (= c \\) (recur (+ i 2) depth in-str start parts)
              (= c in-str) (recur (inc i) depth nil start parts)
              :else (recur (inc i) depth in-str start parts))

            (contains? #{\' \" \`} c)
            (recur (inc i) depth c start parts)

            (contains? #{\( \{ \[} c)
            (recur (inc i) (inc depth) nil start parts)

            (contains? #{\) \} \]} c)
            (recur (inc i) (dec depth) nil start parts)

            (and (= c \,) (zero? depth))
            (recur (inc i) depth nil (inc i) (conj parts (subs text start i)))

            :else
            (recur (inc i) depth nil start parts)))))))

;; ── reach-floor? / constructed? / matched-snippet ───────────────────────────

(defn- assert-call-spans
  "assert( or assert.<identifier>( calls - never a bare `assertXxx(` helper
   like assertReachFloor or assertRunWritesNoDecision, which the negative
   lookbehind plus \"immediately '(' or '.'\" shape excludes by construction."
  [text]
  (find-call-spans text #"(?<![\w$])assert(?:\.[A-Za-z_$][\w$]*)?\("))

(defn reach-floor?
  "True when text calls assertReachFloor( OR some assert(/assert.<fn>( call's
   own argument text carries a KNOWN_PHRASES entry, case-insensitive."
  [text]
  (boolean
   (or (str/includes? text "assertReachFloor(")
       (some (fn [{:keys [args]}]
               (let [low (str/lower-case args)]
                 (some #(str/includes? low %) known-phrases)))
             (assert-call-spans text)))))

(defn constructed?
  [text]
  (boolean (str/includes? text "runsPerCell(")))

(defn matched-snippet
  "The text that made reach-floor? true - untruncated; the caller truncates
   to 80 chars for the refusal/warning message."
  [text]
  (if (str/includes? text "assertReachFloor(")
    (let [idx (str/index-of text "assertReachFloor(")]
      (str/trim (subs text idx (min (count text) (+ idx 120)))))
    (some (fn [{:keys [args]}]
            (let [low (str/lower-case args)]
              (when (some #(str/includes? low %) known-phrases)
                (str/trim args))))
          (assert-call-spans text))))

;; ── budget ───────────────────────────────────────────────────────────────

(defn- literal-numruns-values [text]
  (keep (fn [[_ digits]] (parse-long digits)) (re-seq #"numRuns\s*:\s*(\d+)" text)))

(defn- numruns-occurrence-count [text]
  (count (re-seq #"numRuns\s*:" text)))

(defn- fc-sample-spans [text]
  (find-call-spans text #"fc\.sample\("))

;; A fc.sample(<arb>, <int>) call whose own args carry no "numRuns" text at
;; all (an options-object form is left to the general numRuns: scan above,
;; never double-counted here).
(defn- fc-sample-bare-count-candidates [text]
  (keep (fn [{:keys [args]}]
          (when-not (str/includes? args "numRuns")
            (let [parts (top-level-args args)]
              (when (>= (count parts) 2)
                (str/trim (last parts))))))
        (fc-sample-spans text)))

(defn- fc-assert-check-spans [text]
  (concat (find-call-spans text #"fc\.assert\(") (find-call-spans text #"fc\.check\(")))

;; "an fc.assert/fc.check with no numRuns counts as fast-check's default 100"
(defn- fc-assert-check-implicit-100-count [text]
  (count (remove (fn [{:keys [args]}] (str/includes? args "numRuns")) (fc-assert-check-spans text))))

(defn budget
  "The smallest literal draw count among every draw site in text.
   :unresolved when any draw site's count is not an integer literal;
   :none when the file has no fast-check draw site at all."
  [text]
  (let [literal-numruns (literal-numruns-values text)
        unresolved-numruns? (> (numruns-occurrence-count text) (count literal-numruns))
        sample-candidates (fc-sample-bare-count-candidates text)
        sample-literals (keep #(when (re-matches #"\d+" %) (parse-long %)) sample-candidates)
        sample-unresolved? (some #(not (re-matches #"\d+" %)) sample-candidates)
        implicit-100 (repeat (fc-assert-check-implicit-100-count text) 100)
        literals (concat literal-numruns sample-literals implicit-100)
        any-draw-site? (boolean (or (seq literals) unresolved-numruns? sample-unresolved?))]
    (cond
      (not any-draw-site?) :none
      (or unresolved-numruns? sample-unresolved?) :unresolved
      :else (apply min literals))))

;; ── classify: the one entry point every caller (gate + census CLI) uses ────

(defn classify
  "Pure: file text in, {:verdict :reach-floor? :constructed? :budget
   :matched} out. Comments are stripped FIRST (strip-comments) so a comment
   mentioning any of assertReachFloor, a KNOWN_PHRASES word, or runsPerCell(
   can never itself trigger a match, before any other check runs."
  [raw-text]
  (let [text (strip-comments raw-text)
        rf? (reach-floor? text)
        c? (constructed? text)
        b (budget text)
        matched (when rf? (matched-snippet text))
        verdict (cond
                  (not rf?) :no-floor
                  c? :constructed
                  (= b :none) :no-draw
                  (or (= b :unresolved) (< b 100)) :sampled-low
                  :else :sampled-high)]
    {:verdict verdict :reach-floor? rf? :constructed? c? :budget b :matched matched}))

;; ── the gate: added-vs-modified, wired at the git_handoff send ─────────────

(defn- git! [root & args]
  (apply daemon-cycle-guard-lib/sh! (into ["git" "-C" (str root)] args)))

(defn- path-exists-on-ref? [root ref path]
  (zero? (:exit (git! root "cat-file" "-e" (str ref ":" path)))))

(defn- file-text-at-ref [root ref path]
  (let [{:keys [exit out]} (git! root "show" (str ref ":" path))]
    (when (zero? exit) out)))

(defn property-test-path?
  "extension/test/*.property.test.js - flat, never recursive (matches the
   ticket's own glob and the not-recursive convention every sibling gate in
   this tree uses for its own governed directory)."
  [path]
  (let [prefix (str property-test-dir "/")
        p (str path)]
    (and (str/starts-with? p prefix)
         (str/ends-with? p ".property.test.js")
         (not (str/includes? (subs p (count prefix)) "/")))))

(defn change-kind
  "Pure GIVEN the two impure existence facts - split out so the branching is
   unit-testable without a real git process."
  [{:keys [was-present? is-present?]}]
  (cond
    (and (not was-present?) is-present?) :added
    (and was-present? is-present?) :modified
    :else :other))

(defn decide-for-path
  "Pure GIVEN kind and the classifier's own verdict on the forwarded text."
  [{:keys [path kind verdict matched budget]}]
  (cond
    (and (= kind :added) (= verdict :sampled-low))
    {:path path :action :refuse :verdict verdict :matched matched :budget budget}

    (and (= kind :added) (contains? #{:sampled-high :no-draw} verdict))
    {:path path :action :warn :verdict verdict :matched matched :budget budget}

    (and (= kind :modified) (contains? #{:sampled-low :sampled-high :no-draw} verdict))
    {:path path :action :warn :verdict verdict :matched matched :budget budget}

    :else nil))

(defn- warning-line
  [{:keys [path verdict matched budget]}]
  (format "%s: %s (budget %s)%s (BL-1584)"
          path (name verdict) (pr-str budget)
          (if matched (str " - " (subs matched 0 (min 80 (count matched)))) "")))

(defn- unreadable-commit-warning [task-name commit]
  {:findings []
   :warnings [(str "sampled-reach-floor check could not run for " task-name
                    " (the commit history for " commit " unreadable) - send allowed, unverified (BL-1584)")]})

(defn- ref-resolves? [root ref]
  (zero? (:exit (git! root "rev-parse" "-q" "--verify" (str ref "^{commit}")))))

(defn- unreadable-received-warning [task-name received]
  {:findings []
   :warnings [(str "sampled-reach-floor check could not run for " task-name
                    " (received commit " received " unreadable) - send allowed, unverified (BL-1584)")]})

(defn- decisions-for-candidates [root received commit candidates]
  (for [path candidates
        :let [was? (path-exists-on-ref? root received path)
              is? (path-exists-on-ref? root commit path)
              kind (change-kind {:was-present? was? :is-present? is?})]
        :when (not= kind :other)
        :let [text (file-text-at-ref root commit path)]]
    (if (nil? text)
      {:unreadable path}
      (let [{:keys [verdict matched budget]} (classify text)]
        (or (decide-for-path {:path path :kind kind :verdict verdict
                               :matched matched :budget budget})
            {:clean path})))))

(defn findings-for-git-handoff
  "The one impure entry point. {:findings [...refuse entries...] :warnings
   [...ready-to-print strings...]} - never a bare {:warning ...} like the
   simpler sibling gates, because this gate can have BOTH a blocking finding
   on one path and an unrelated warning on another in the same parcel."
  [{:keys [root sender task-name commit]}]
  (let [task-ticket-id (pipeline-stage-lib/extract-ticket-id task-name)]
    (cond
      (not task-ticket-id)
      {:findings [] :warnings []}

      (not (zero? (:exit (git! root "rev-parse" "-q" "--verify" (str commit "^{commit}")))))
      (unreadable-commit-warning task-name commit)

      :else
      (let [changed-paths (task-scope-gate-lib/parcel-own-changed-paths root task-ticket-id commit)]
        (if (nil? changed-paths)
          (unreadable-commit-warning task-name commit)
          (let [received (review-forward-evidence-gate-lib/received-commit-for-task root sender task-name)]
            (cond
              (not received)
              ;; No recorded received commit at all (a fresh task, nothing
              ;; yet received) is silent, not a warning - the same
              ;; convention merge_drop_guard_lib.bb and BL-806 follow.
              {:findings [] :warnings []}

              (not (ref-resolves? root received))
              (unreadable-received-warning task-name received)

              :else
              (let [candidates (->> changed-paths (filter property-test-path?) distinct sort)
                    decisions (decisions-for-candidates root received commit candidates)]
                {:findings (vec (keep #(when (= :refuse (:action %)) %) decisions))
                 :warnings (vec (concat
                                 (keep #(when (= :warn (:action %)) (warning-line %)) decisions)
                                 (keep (fn [{:keys [unreadable]}]
                                         (when unreadable
                                           (str unreadable " could not be read at " commit
                                                " - sampled-reach-floor check skipped for it, send allowed, unverified (BL-1584)")))
                                       decisions)))}))))))))

(defn blocked? [{:keys [findings]}] (boolean (seq findings)))

(defn refusal-message
  "Names the file, the assertion text that matched (first 80 chars), the
   budget, and the remedy - the whole point of moving the check here is
   that the person reading it can act on it without re-deriving the class."
  [{:keys [task-name findings]}]
  (let [describe (fn [{:keys [path matched budget]}]
                    (format "%s (budget %s): \"%s\"" path (pr-str budget)
                            (subs (or matched "") 0 (min 80 (count (or matched ""))))))]
    (str "SAMPLED_REACH_FLOOR: Cannot send git_handoff for " task-name
         " - this parcel adds " (if (= 1 (count findings)) "a property test file" "property test files")
         " that draws a low, literal budget and then asserts every arm was reached (BL-1584): "
         (str/join "; " (map describe findings))
         ". Remedy: runsPerCell(budget, cells) per cell and assertReachFloor "
         "(extension/test/helpers/reachFloors.js).")))
