#!/usr/bin/env bb

;; BL-317: pure reader/validator for a backlog ticket's declared routing
;; manifest (an optional `roles:` field, flow-style `roles: [a, b, c]` OR
;; block-style `roles:\n  - a\n  - b`) - which pipeline roles a ticket
;; actually needs. An absent field means the full standard chain, exactly
;; today's behavior (a pure additive schema change, never a default-path
;; behavior change). A field that IS present but cannot be parsed in
;; either supported form is a validation ERROR, never silently treated as
;; absent (scope 4b - see validate-manifest below). This slice ONLY
;; decides and validates the list - nothing here brings a role's tmux
;; session up or down (that is a later, separate slice - see the ticket's
;; own note on epic sequencing).

(ns routing-manifest-lib
  (:require [clojure.string :as str]))

(def standard-chain
  "The full pipeline chain in order, per PIPELINE.md - coordinator is
   never a member (bookkeeping only, BL-243)."
  ["specifier" "coder" "cleaner" "architect" "hardender" "documenter" "QA"])

(def known-roles (set standard-chain))

(defn- strip-quotes [s]
  (str/replace s #"^[\"']|[\"']$" ""))

(defn- parse-flow-list
  "`[a, b, c]` -> [\"a\" \"b\" \"c\"], trimmed and quote-stripped. Called
   only once after-colon is already confirmed to start/end with [ / ]."
  [after-colon]
  (->> (str/split (subs after-colon 1 (dec (count after-colon))) #",")
       (map str/trim)
       (map strip-quotes)
       (remove str/blank?)
       vec))

(defn- block-item
  "`  - coder` -> \"coder\"; nil for a line that isn't a block-list item."
  [line]
  (when-let [[_ item] (re-matches #"^\s+-\s+(.+?)\s*$" line)]
    (strip-quotes item)))

(defn- parse-block-list
  "Collects `  - item` lines immediately following the `roles:` line -
   this schema's own established convention for multi-item fields
   (acceptance.steps: uses it; only depends_on: is flow-style).

   The block REGION is every consecutive indented-or-blank line (a
   dedent back to column 0 - a sibling top-level key, or end of file -
   ends it, exactly like real YAML block-scoping). Every non-blank line
   in that region must be a `- item` line, or the whole block is
   malformed -> nil, never a silently truncated prefix. Stopping at the
   first non-matching line (an earlier version of this fn did) let a
   list interrupted by a stray non-dash line mid-block silently drop
   every item after the interruption - a real, found-during-hardening
   instance of scope 4b's own defect (present-but-malformed treated as
   if it parsed), just one indentation level deeper than the flow-style
   collision this ticket already bounced once for."
  [lines-after]
  (let [block-lines (take-while #(re-matches #"^(\s+.*)?$" %) lines-after)
        non-blank (remove str/blank? block-lines)]
    (when (and (seq non-blank) (every? #(re-matches #"^\s+-\s+.+$" %) non-blank))
      (mapv block-item non-blank))))

(defn- parse-roles-field
  "Returns {:present? bool :roles (list-or-nil)}.

   :present? false means the `roles:` field is genuinely absent - the safe
   default-to-full-chain case.

   :present? true with :roles nil means the field IS present but its value
   is neither a recognizable flow-style `[...]` list nor an immediately-
   following block-style `- item` list - a validation ERROR (BL-317 scope
   4b: absent and unreadable must never be the same answer), never
   silently treated as absent.

   :present? true with a real :roles list means it parsed successfully, in
   either style.

   Matches only an UNINDENTED `roles:` line (column 0, checked against the
   raw un-trimmed line) - the same anchoring every other read-yaml-field
   in this codebase (chase_sweep_lib.bb, operator_runtime.bb,
   quiet_period_gate_cli.bb, ticket_status_lib.bb) already uses. Trimming
   the line before the starts-with? check (as an earlier version of this
   function did) strips away indentation, so an example line inside a
   `notes: |` block - e.g. a ticket's own notes illustrating what a
   declaration looks like, indented under the block - would collide with
   a real top-level field. A top-level YAML scalar/list field is never
   indented, so anchoring to column 0 is both correct and consistent."
  [content]
  (let [lines (str/split-lines content)
        idx (some (fn [[i l]] (when (str/starts-with? l "roles:") i)) (map-indexed vector lines))]
    (if (nil? idx)
      {:present? false :roles nil}
      (let [line (str/trim (nth lines idx))
            after-colon (str/trim (subs line (inc (str/index-of line ":"))))]
        (cond
          (and (str/starts-with? after-colon "[") (str/ends-with? after-colon "]"))
          {:present? true :roles (parse-flow-list after-colon)}

          (str/blank? after-colon)
          {:present? true :roles (parse-block-list (drop (inc idx) lines))}

          :else
          {:present? true :roles nil})))))

(defn read-roles
  "The routing manifest for a ticket: its declared `roles:` list (flow or
   block style), or the full standard chain when the field is absent OR
   present-but-unparseable - the safe MECHANICAL default for a plain read.
   read-roles alone never blocks anything; validate-manifest below is the
   actual enforcement point for a present-but-unparseable manifest."
  [content]
  (or (:roles (parse-roles-field content)) standard-chain))

(defn validate-roles
  "Rejects a PARSED roles list that omits coder/QA, or that names
   coordinator or an unknown role. Returns {:valid? true} or
   {:valid? false :reason ...}."
  [roles]
  (let [role-set (set roles)]
    (cond
      (not (contains? role-set "coder"))
      {:valid? false :reason "roles: list must include coder"}

      (not (contains? role-set "QA"))
      {:valid? false :reason "roles: list must include QA"}

      (contains? role-set "coordinator")
      {:valid? false :reason "roles: list must not include coordinator (not a pipeline chain member)"}

      (not-every? known-roles roles)
      {:valid? false :reason (str "roles: list names an unknown role: " (str/join ", " (remove known-roles roles)))}

      :else
      {:valid? true})))

(defn validate-manifest
  "The one entry point a spec-time/promotion-time caller should use:
   validates a ticket's WHOLE roles: manifest straight from raw content.
   Absent -> always valid (defaults to the full chain, never narrows
   wrongly). Present but unparseable -> ALWAYS a validation error (scope
   4b - never silently treated as absent, so a malformed manifest can
   never escape validation just by failing to parse). Present and parsed
   -> delegates to validate-roles above."
  [content]
  (let [{:keys [present? roles]} (parse-roles-field content)]
    (cond
      (not present?) {:valid? true}
      (nil? roles) {:valid? false :reason "roles: field is present but could not be parsed (expected a flow-style [a, b] or block-style - a / - b list)"}
      :else (validate-roles roles))))
