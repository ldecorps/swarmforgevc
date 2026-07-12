#!/usr/bin/env bb

;; BL-317: pure reader/validator for a backlog ticket's declared routing
;; manifest (an optional `roles:` field, flow-style YAML list -
;; `roles: [coder, QA]`) - which pipeline roles a ticket actually needs.
;; An absent field means the full standard chain, exactly today's
;; behavior (a pure additive schema change, never a default-path
;; behavior change). This slice ONLY decides and validates the list -
;; nothing here brings a role's tmux session up or down (that is a later,
;; separate slice - see the ticket's own note on epic sequencing).

(ns routing-manifest-lib
  (:require [clojure.string :as str]))

(def standard-chain
  "The full pipeline chain in order, per PIPELINE.md - coordinator is
   never a member (bookkeeping only, BL-243)."
  ["specifier" "coder" "cleaner" "architect" "hardender" "documenter" "QA"])

(def known-roles (set standard-chain))

(defn- parse-roles-field
  "Pulls a flow-style `roles: [a, b, c]` field's contents out of raw YAML
   text - trimmed, comma-split, quote-stripped. nil when the field is
   absent (the caller's cue to default to the full chain) or when the
   value is not a recognizable `[...]` flow list.

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
  (when-let [line (some (fn [l] (when (str/starts-with? l "roles:") (str/trim l)))
                        (str/split-lines content))]
    (let [after-colon (str/trim (subs line (inc (str/index-of line ":"))))]
      (when (and (str/starts-with? after-colon "[") (str/ends-with? after-colon "]"))
        (->> (str/split (subs after-colon 1 (dec (count after-colon))) #",")
             (map str/trim)
             (map #(str/replace % #"^[\"']|[\"']$" ""))
             (remove str/blank?)
             vec)))))

(defn read-roles
  "The routing manifest for a ticket: its declared `roles:` list, or the
   full standard chain when the field is absent."
  [content]
  (or (parse-roles-field content) standard-chain))

(defn validate-roles
  "Rejects a declared roles list that omits coder/QA, or that names
   coordinator or an unknown role. Returns {:valid? true} or
   {:valid? false :reason ...}. The default (absent-field) case is always
   the full chain and therefore never needs validating."
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
