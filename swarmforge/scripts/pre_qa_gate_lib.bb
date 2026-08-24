#!/usr/bin/env bb
;; BL-531: pure decision surface for the pre-QA durability and wiring gate.
;;
;; `qa_bounce:behavior:coder` (31) is the largest non-chaser failure mode in
;; the BL-512 audit. Two of its causes are decidable at send time from the
;; sender's own checkout: a ticket-commit stranded off the parcel's lineage
;; (BL-490), and a ticket's own declared wiring never landing at the call
;; site it named (BL-419). This lib turns pre-gathered facts - never git or
;; fs access of its own - into an ordered list of PRE_QA_GATE_FAIL findings.
;; swarm_handoff.bb's `validate` (the QA edge only) and pre_qa_gate_cli.bb
;; (the standalone self-check) both do the git/fs gathering and call
;; `evaluate` here to decide.

(ns pre-qa-gate-lib
  (:require [clojure.string :as str]))

;; ── arming ───────────────────────────────────────────────────────────────

(defn gate-armed?
  "Arms only for a git_handoff whose comma-separated `to` includes QA -
   membership, not equality, so `to: QA,documenter` arms same as `to: QA`."
  [{:keys [type to]}]
  (and (= "git_handoff" type)
       (contains? (set (remove str/blank? (str/split (or to "") #","))) "QA")))

;; ── whole-token ticket-id reference ──────────────────────────────────────

(defn message-references-ticket?
  "True when `message` names `ticket-id` as a whole token: bounded on both
   sides so BL-49 never matches a search for BL-490, while BL-490-VIOLATION
   does (the character after \"490\" is a hyphen, a non-word boundary)."
  [message ticket-id]
  (boolean (and message ticket-id
                (re-find (re-pattern (str "(?i)\\b" (java.util.regex.Pattern/quote ticket-id) "\\b"))
                          message))))

;; ── required_wiring: entry parsing ──────────────────────────────────────

(defn- strip-quotes [s]
  (str/replace s #"^[\"']|[\"']$" ""))

(defn parse-wiring-entry
  "`path::pattern` or `path::pattern::why` (why may itself contain `::`,
   split on the first two occurrences only) -> {:path :pattern :why}, or
   nil when the entry cannot be parsed: no `::` separator at all, or an
   empty path/pattern. A typo here must fail loud, never silently pass."
  [raw]
  (when (string? raw)
    (let [s (strip-quotes (str/trim raw))
          first-idx (str/index-of s "::")]
      (when first-idx
        (let [path (subs s 0 first-idx)
              after-first (subs s (+ first-idx 2))
              second-idx (str/index-of after-first "::")
              pattern (if second-idx (subs after-first 0 second-idx) after-first)
              why (when second-idx (subs after-first (+ second-idx 2)))]
          (when (and (not (str/blank? path)) (not (str/blank? pattern)))
            {:path path :pattern pattern :why (when (not (str/blank? why)) why)}))))))

;; ── generic column-0-anchored flow/block YAML list reader ───────────────
;; Same reader shape as routing_manifest_lib.bb's `roles:` field - a small
;; duplication deliberate per this codebase's established "small live-glue
;; duplicated across independent pure libs" posture (see
;; pipeline_stage_lib.bb's own comment) rather than cross-namespace-coupling
;; to routing-manifest-lib's private helpers.

(defn- parse-flow-list [after-colon]
  (->> (str/split (subs after-colon 1 (dec (count after-colon))) #",")
       (map str/trim)
       (map strip-quotes)
       (remove str/blank?)
       vec))

(defn- block-item [line]
  (when-let [[_ item] (re-matches #"^\s+-\s+(.+?)\s*$" line)]
    (strip-quotes item)))

(defn- parse-block-list [lines-after]
  (let [block-lines (take-while #(re-matches #"^(\s+.*)?$" %) lines-after)
        non-blank (remove str/blank? block-lines)]
    (when (and (seq non-blank) (every? #(re-matches #"^\s+-\s+.+$" %) non-blank))
      (mapv block-item non-blank))))

(defn- read-list-field
  "{:present? bool :items (list-or-nil)}. :present? true with :items nil
   means the field IS present but neither flow-style `[...]` nor an
   immediately-following block-style `- item` list - a caller-visible
   parse failure, never silently treated as absent."
  [content field]
  (let [lines (str/split-lines content)
        prefix (str field ":")
        idx (some (fn [[i l]] (when (str/starts-with? l prefix) i)) (map-indexed vector lines))]
    (if (nil? idx)
      {:present? false :items nil}
      (let [line (str/trim (nth lines idx))
            after-colon (str/trim (subs line (inc (str/index-of line ":"))))]
        (cond
          (and (str/starts-with? after-colon "[") (str/ends-with? after-colon "]"))
          {:present? true :items (parse-flow-list after-colon)}

          (str/blank? after-colon)
          {:present? true :items (parse-block-list (drop (inc idx) lines))}

          :else
          {:present? true :items nil})))))

(defn read-required-wiring [content]
  (read-list-field content "required_wiring"))

(defn read-abandoned-commits [content]
  (read-list-field content "abandoned_commits"))

;; ── finding formatting ────────────────────────────────────────────────

(defn format-finding-line
  "PRE_QA_GATE_FAIL <class> <ticket-id> <detail> - machine-greppable, one
   line per finding."
  [{:keys [class ticket-id detail]}]
  (format "PRE_QA_GATE_FAIL %s %s %s" (name class) ticket-id detail))

;; ── ancestry findings ─────────────────────────────────────────────────

(defn paths-overlap?
  "True when any path in candidate-paths is also in parcel-paths.
   Empty on either side is never evidence."
  [candidate-paths parcel-paths]
  (boolean
   (and (seq candidate-paths) (seq parcel-paths)
        (some (set parcel-paths) candidate-paths))))

(defn- abandoned-sha?
  [sha abandoned]
  (some #(str/starts-with? sha %) abandoned))

(defn- stranded-ticket-commit?
  "Subject-named, not on main, not an ancestor of the cited tip, not
   abandoned, and not already excluded as carrying no dropped work."
  [{:keys [sha message]} ticket-id main-reachable-set cited-ancestors-set
   abandoned no-dropped-work-set]
  (and (message-references-ticket? message ticket-id)
       (not (contains? main-reachable-set sha))
       (not (contains? cited-ancestors-set sha))
       (not (abandoned-sha? sha abandoned))
       (not (contains? no-dropped-work-set sha))))

(defn- ancestry-verdict
  "BL-972: block only with path evidence; subject-only → warning string;
   abandoned already filtered by stranded-ticket-commit?."
  [ticket-id branch {:keys [sha paths]} parcel-paths]
  (if (paths-overlap? paths parcel-paths)
    {:finding {:class :ancestry
               :ticket-id ticket-id
               :sha sha
               :branch branch
               :detail (format "%s stranded on %s" sha branch)}}
    {:warning (format "ancestry %s %s subject-only on %s (no path overlap with parcel)"
                      ticket-id sha branch)}))

(defn- ancestry-findings-and-warnings
  [{:keys [ticket-id role-branch-commits main-reachable-set cited-ancestors-set
           abandoned-commits no-dropped-work-set parcel-paths]}]
  (let [main-reachable-set (or main-reachable-set #{})
        cited-ancestors-set (or cited-ancestors-set #{})
        no-dropped-work-set (or no-dropped-work-set #{})
        parcel-paths (or parcel-paths [])
        abandoned (remove str/blank? (or abandoned-commits []))
        branches (sort (keys (or role-branch-commits {})))]
    (reduce
     (fn [acc branch]
       (reduce
        (fn [acc commit]
          (if-not (stranded-ticket-commit? commit ticket-id main-reachable-set
                                           cited-ancestors-set abandoned
                                           no-dropped-work-set)
            acc
            (let [{:keys [finding warning]}
                  (ancestry-verdict ticket-id branch commit parcel-paths)]
              (cond-> acc
                finding (update :findings conj finding)
                warning (update :warnings conj warning)))))
        acc
        (get role-branch-commits branch)))
     {:findings [] :warnings []}
     branches)))

;; ── wiring findings ───────────────────────────────────────────────────

(defn- wiring-findings
  [{:keys [ticket-id wiring-entries file-contents]}]
  (vec
   (keep
    (fn [raw]
      (let [parsed (parse-wiring-entry raw)]
        (if (nil? parsed)
          {:class :manifest
           :ticket-id ticket-id
           :detail (format "required_wiring entry could not be parsed: %s" raw)}
          (let [{:keys [path pattern why]} parsed
                why-suffix (if why (str " (" why ")") "")
                content (get file-contents path ::missing)]
            (cond
              (= content ::missing)
              {:class :wiring :ticket-id ticket-id :path path :pattern pattern :why why
               :detail (format "%s not found at cited commit (expected to contain \"%s\")%s" path pattern why-suffix)}

              (not (str/includes? content pattern))
              {:class :wiring :ticket-id ticket-id :path path :pattern pattern :why why
               :detail (format "%s does not contain \"%s\"%s" path pattern why-suffix)}

              :else nil)))))
    (or wiring-entries []))))

;; ── top-level entry point ─────────────────────────────────────────────

(defn evaluate
  "opts: {:type :to :ticket-id :cited-commit :role-branch-commits
   :main-reachable-set :cited-ancestors-set :wiring-entries :file-contents
   :abandoned-commits :no-dropped-work-set :parcel-paths}.
   role-branch-commits entries may carry :paths (touched paths).
   parcel-paths is the cited parcel's path set (merge-base..cited, plus
   acceptance/required_wiring paths). Returns {:armed? bool :findings [...]
   :warnings [...]} - unarmed drafts are never evaluated. Ancestry findings
   precede wiring findings. BL-972: a subject-only stranded commit is a
   warning, never a finding; path overlap still blocks. :no-dropped-work-set
   (condition 5) excludes empty-merge / tree-identical commits as before."
  [{:keys [type to] :as opts}]
  (if-not (gate-armed? {:type type :to to})
    {:armed? false :findings [] :warnings []}
    (let [{:keys [findings warnings]} (ancestry-findings-and-warnings opts)]
      {:armed? true
       :findings (vec (concat findings (wiring-findings opts)))
       :warnings (vec warnings)})))
