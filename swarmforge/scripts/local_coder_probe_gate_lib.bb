#!/usr/bin/env bb
;; BL-1702: the pure decision for the first local pack's staffing gate - no
;; launch path starts a pack with a driver seat (BL-1697's own driver-seat?
;; - agent capability + role, never a raw "aider" string) unless the
;; NEWEST BL-1700/BL-1701 steward probe summary for that seat's model
;; records a passing verdict (>= 4 of 5 coder fixtures handed off, no
;; breached hazard). This never recomputes that verdict from scorecards -
;; it trusts the "handed off N of M - verdict pass|fail" line
;; model_steward_coder_probe_lib.bb's own `probe!` already wrote (BL-1701's
;; scoring stays owned there); "newest" is by the summary's own UTC stamp,
;; embedded in its filename, never file mtime (a copy, sync or checkout can
;; freely change mtime without changing when the probe actually ran).
;;
;; Pure: given already-read window lines and already-read evidence file
;; contents, decides admit/refuse per driver seat. local_coder_probe_gate_cli.bb
;; is the thin fs adapter that reads the pack conf and the evidence dir and
;; calls this.
;;
;; Loaded via load-file, referred to as local-coder-probe-gate-lib/foo.
(ns local-coder-probe-gate-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def ^:private lib-dir (fs/parent (fs/canonicalize *file*)))
(load-file (str (fs/path lib-dir "local_parcel_driver_lib.bb")))

;; ── window-line parsing ───────────────────────────────────────────────────
;; Deliberately narrow: this gate only ever needs a window line's seat id,
;; agent and --model value. swarmforge.sh's parse_config owns the full
;; window-line grammar (task/batch, propagation, idle-clear); those extra
;; tokens are harmless noise here because flag-value only ever searches for
;; a literal "--model" pair, wherever it falls in the line's tail.

(defn parse-window-lines
  "Parses a pack conf file's text into a vector of {:role :agent :rest}
   maps, one per `window` line (comment and config lines are skipped)."
  [conf-text]
  (->> (str/split-lines (str conf-text))
       (map str/trim)
       (remove str/blank?)
       (remove #(str/starts-with? % "#"))
       (keep (fn [line]
               (let [tokens (str/split line #"\s+")]
                 (when (and (>= (count tokens) 4) (= "window" (first tokens)))
                   {:role (nth tokens 1)
                    :agent (str/lower-case (nth tokens 2))
                    :rest (str/join " " (drop 3 tokens))}))))
       vec))

(defn flag-value
  "First token following `flag` in `text`, or nil. Same shape as
   pack_staffing_gate_lib.bb's own flag-value - kept local rather than
   shared since this gate's window-line grammar is deliberately narrower."
  [text flag]
  (let [tokens (str/split (str text) #"\s+")]
    (->> tokens
         (partition 2 1)
         (filter #(= flag (first %)))
         first
         second)))

(defn window-model
  "The --model value a window line declares, with an aider openai/ prefix
   stripped - the probe's own evidence names the bare model id, never the
   aider CLI's openai/ routing prefix (pack_staffing_gate_lib.bb's
   resolve-seat strips the same prefix for the same reason)."
  [window]
  (some-> (flag-value (:rest window) "--model")
          (str/replace-first #"^openai/" "")))

(defn driver-windows
  "Every window that is a driver seat (BL-1697's driver-seat? - capability
   + role, never a raw \"aider\" string check here either)."
  [windows]
  (filterv #(local-parcel-driver-lib/driver-seat? (:agent %) (:role %)) windows))

;; ── evidence: the newest matching summary ─────────────────────────────────

(defn safe-model-id
  "Same transform model_steward_coder_probe_lib.bb's probe! applies before
   naming its evidence file - ':' and '/' become '-'."
  [model]
  (str/replace (str model) #"[:/]" "-"))

(def ^:private summary-filename-re
  #"^local-coder-probe-(.+)-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:\.\d+)?Z)\.md$")

(defn parse-summary-filename
  "{:model-segment :stamp} from a probe evidence filename, or nil when the
   name does not match the shape probe! writes."
  [filename]
  (when-let [m (re-matches summary-filename-re (str filename))]
    {:model-segment (nth m 1) :stamp (nth m 2)}))

(defn stamp->instant
  "The filename's own UTC stamp (colons already turned into dashes when the
   file was written) back into a real java.time.Instant, so 'newest' is a
   chronological comparison - never a lexical/mtime one, which an
   inconsistent fractional-second digit count could get wrong."
  [stamp]
  (let [[date time] (str/split stamp #"T" 2)]
    (java.time.Instant/parse (str date "T" (str/replace time "-" ":")))))

(defn- model-segment-matches?
  "Exact match, or the probe's own ':latest' resolution appended (BL-1700's
   resolve-model-id: a bare requested name that the endpoint only serves
   tagged) - never a broader/fuzzy match."
  [segment safe-model]
  (or (= segment safe-model) (= segment (str safe-model "-latest"))))

(defn newest-summary
  "evidence-files: [{:filename :content} ...]. The newest (by the stamp
   ENCODED IN THE FILENAME, not mtime) summary whose model segment matches
   `model`, or nil when none does."
  [evidence-files model]
  (let [safe-model (safe-model-id model)]
    (->> evidence-files
         (keep (fn [{:keys [filename] :as f}]
                 (when-let [{:keys [model-segment stamp]} (parse-summary-filename filename)]
                   (when (model-segment-matches? model-segment safe-model)
                     (assoc f :instant (stamp->instant stamp))))))
         (sort-by :instant)
         last)))

;; ── the summary's own recorded verdict ────────────────────────────────────
;; Trusts the line model_steward_coder_probe_lib.bb's summarize already
;; computed (BL-1701's four-of-five-and-no-breach rule lives there, once) -
;; never a second, drifting implementation of that rule here.

(def ^:private verdict-re #"handed off \d+ of \d+ - verdict (pass|fail)")

(defn summary-verdict [content]
  (some-> (re-find verdict-re (str content)) second))

;; ── the gate ───────────────────────────────────────────────────────────────

(def reason-no-summary "no probe summary")
(def reason-verdict-fail "probe verdict fail")

(defn window-decision
  "Pure per-driver-window decision, given already-read evidence files.
   {:decision \"admit\"|\"refuse\" :seat :model :reason :summary-path}."
  [window evidence-files]
  (let [seat (:role window)
        model (window-model window)]
    (if (nil? model)
      {:decision "refuse" :seat seat :model nil :reason reason-no-summary}
      (let [summary (newest-summary evidence-files model)]
        (cond
          (nil? summary)
          {:decision "refuse" :seat seat :model model :reason reason-no-summary}

          (not= "pass" (summary-verdict (:content summary)))
          {:decision "refuse" :seat seat :model model :reason reason-verdict-fail
           :summary-path (:filename summary)}

          :else
          {:decision "admit" :seat seat :model model :summary-path (:filename summary)})))))

(defn gate-decisions
  "One decision per DRIVER window only - empty when the pack has no driver
   seat (nothing to gate; every other seat is untouched by this ticket)."
  [windows evidence-files]
  (mapv #(window-decision % evidence-files) (driver-windows windows)))
