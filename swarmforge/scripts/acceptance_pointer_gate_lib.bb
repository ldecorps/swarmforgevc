#!/usr/bin/env bb
;; BL-880: pure decision surface for the early, existence-only
;; acceptance-pointer check armed at every PRE-QA git_handoff hop (coder
;; onward) - the mechanical half of stopping a stale acceptance: pointer
;; (BL-877/BL-879) before it rides five pipeline stages to the
;; documenter->QA edge, where the fuller BL-761 acceptance-contract gate
;; (acceptance_contract_gate_lib.bb, unchanged by this ticket) already
;; catches it today.
;;
;; EXISTENCE ONLY: no Gherkin parsing, no step resolution, no draft-ness
;; policing - a legitimately parked .feature.draft (BL-233) passes every
;; pre-QA hop as long as it exists at the cited commit. Blank/absent and
;; multi-line (inline Gherkin) declarations are QA-edge concerns only and
;; are never refused here.
;;
;; pre_qa_gate_gather_lib.bb's gather-acceptance-pointer-facts does the
;; git legwork (one `git cat-file -e` probe for tree readability, one more
;; for path existence) and calls `evaluate` here to decide.

(ns acceptance-pointer-gate-lib
  (:require [clojure.string :as str]))

(def ^:private block-scalar-residue-pattern
  "The ticket-yaml reader this gate's caller uses (pre_qa_gate_gather_lib.bb's
   read-yaml-field) captures only the `acceptance:` LINE's own tail, never
   the indented body that follows - so a genuine multi-line/inline-Gherkin
   block-scalar declaration (`acceptance: |\\n  Feature: ...`) never reaches
   this function as a string containing an embedded newline. What it
   receives instead is the bare YAML block-scalar indicator left on that
   first line (`|`, `>`, and their optional `-`/`+` chomping suffix) - a
   token that could never be a real repo-relative feature-file path, so it
   is excluded here the same as an actually-multi-line string would be."
  #"^[|>][-+]?$")

(defn applicable?
  "A single-line, non-blank acceptance: declaration naming an actual path is
   the only shape this gate ever checks. Blank/absent declarations,
   multi-line (inline Gherkin) declarations, and the bare block-scalar
   indicator a multi-line declaration's first line collapses to (see
   block-scalar-residue-pattern) fall through untouched - the QA edge
   already owns those judgements with full context."
  [raw-declaration]
  (boolean (and raw-declaration
                (not (str/blank? raw-declaration))
                (not (str/includes? raw-declaration "\n"))
                (not (re-matches block-scalar-residue-pattern raw-declaration)))))

(defn evaluate
  "opts: {:ticket-id :raw-declaration :cited-commit :tree-readable?
   :path-exists?}. Returns {:findings [...] :warnings [...]}.

   - the declaration is not applicable (blank/absent/multi-line) -> clean
     pass, nothing to check; tree-readable?/path-exists? are never
     consulted.
   - tree-readable? false -> one warning, fails OPEN (infrastructure
     trouble: the cited commit's tree could not be read).
   - tree-readable? true, path-exists? false -> one :acceptance-pointer
     finding, fails CLOSED.
   - tree-readable? true, path-exists? true -> clean pass."
  [{:keys [ticket-id raw-declaration cited-commit tree-readable? path-exists?]}]
  (cond
    (not (applicable? raw-declaration))
    {:findings [] :warnings []}

    (not tree-readable?)
    {:findings []
     :warnings [(format "acceptance-pointer:%s cited commit %s's tree could not be read (declared path: %s)"
                         ticket-id cited-commit raw-declaration)]}

    path-exists?
    {:findings [] :warnings []}

    :else
    {:findings [{:class :acceptance-pointer :ticket-id ticket-id
                 :detail (format "declared acceptance: path \"%s\" does not exist at cited commit %s"
                                 raw-declaration cited-commit)}]
     :warnings []}))
