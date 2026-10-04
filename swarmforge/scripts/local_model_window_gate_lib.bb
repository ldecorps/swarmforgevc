;; BL-1801: pure decision for "does a local-model seat's first turn fit
;; the window Ollama actually serves it" (estimate-tokens/window-outcome
;; below - no HTTP call, no subprocess, no filesystem). BL-1838 moved
;; served-window here from local_model_window_gate_cli.bb: it is this
;; file's one IO function, kept here rather than duplicated as a second
;; num_ctx parser, so both the launch-time gate (the CLI) and BL-1838's
;; qwen provider-entry writer (local_model_qwen_provider_cli.bb) read
;; Ollama's served window through the exact same code (IO-near code calls
;; the owner, BL-1811).
(ns local-model-window-gate-lib
  (:require [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

;; Human ruling 2026-09-29 (in chat, quoted in the ticket): three
;; characters per token, the same estimator convention BL-1798's own
;; 8192-character card budget already assumes (about 2731 tokens at 3
;; chars/token).
(def chars-per-token 3)

(defn estimate-tokens
  "ceil((composed-chars + overhead-chars) / chars-per-token)."
  [composed-chars overhead-chars]
  (long (Math/ceil (/ (double (+ composed-chars overhead-chars)) chars-per-token))))

;; The native Ollama API (never the OpenAI-compat /v1 suffix a seat's own
;; launch uses) - local_model_endpoint_url in swarmforge.sh returns the
;; /v1 base, so this strips it.
(defn- native-base [endpoint-url]
  (str/replace endpoint-url #"/v1/?$" ""))

(defn served-window
  "The num_ctx Ollama reports for `model` via POST /api/show, parsed from
   the `parameters` field's own text blob (e.g. \"num_ctx    32768\\n...\").
   nil on any failure (unreachable endpoint, non-2xx, unparseable body, or
   no num_ctx line) - the caller falls back to the swarm's own context
   length, never throws."
  [endpoint-url model]
  (try
    (let [{:keys [exit out]} (process/sh "curl" "-sS" "-m" "5"
                                          (str (native-base endpoint-url) "/api/show")
                                          "-d" (json/generate-string {:model model}))]
      (when (zero? exit)
        (let [body (json/parse-string out true)
              params (:parameters body)]
          (when (string? params)
            (when-let [m (re-find #"(?m)^\s*num_ctx\s+(\d+)" params)]
              (Long/parseLong (second m)))))))
    (catch Exception _ nil)))

(defn window-outcome
  "{:window (a positive int, or nil when unknown)
    :estimate-tokens (positive int)
    :override? (bool)
    :role :model (strings, for the message only)}
   ->
   {:decision (:proceed :warn :refuse) :message (string, or nil for :proceed)}

   FIRM (ticket approval_context): known and cannot hold the first turn -
   refuse, unless the override is set, in which case warn and say the
   override let it start. Known and over half the window - warn. Unknown -
   warn, never refuse."
  [{:keys [window estimate-tokens override? role model]}]
  (cond
    (nil? window)
    {:decision :warn
     :message (str "local-model window unknown for " role " (" model
                    "): estimated first turn " estimate-tokens
                    " tokens - proceeding without a known budget")}

    (> estimate-tokens window)
    (if override?
      {:decision :warn
       :message (str "SWARMFORGE_LOCAL_WINDOW_OVERRIDE=1 let " role " (" model
                      ") start over its " window "-token window (estimated first turn "
                      estimate-tokens " tokens)")}
      {:decision :refuse
       :message (str "local-model launch refused: " role " (" model
                      ")'s estimated first turn (" estimate-tokens
                      " tokens) exceeds its " window "-token window - set "
                      "SWARMFORGE_LOCAL_WINDOW_OVERRIDE=1 to start anyway")})

    (> estimate-tokens (/ window 2))
    {:decision :warn
     :message (str role " (" model ")'s estimated first turn (" estimate-tokens
                    " tokens) is more than half its " window "-token window")}

    :else
    {:decision :proceed :message nil}))

;; BL-1840: qwen 0.24.7's own auto-compaction trigger (computeThresholds in
;; the installed @qwen-code/qwen-code package's chunks/chunk-TGWAQ5RB.js) -
;; the token count at which qwen summarises a seat's history for a given
;; served window. pct/max-output/buffer are qwen's own fixed constants: no
;; settings key or env var moves any of them (this ticket's own coder/
;; hardener evidence, confirmed in qwen's source).
(def qwen-compact-pct 0.85)
(def qwen-compact-max-output-tokens 20000)
(def qwen-compact-buffer-tokens 13000)

;; The window every other window is judged against: the one the operator
;; actually ran before this ticket (BL-1840 approval_context).
(def dead-zone-reference-window 32768)

(defn qwen-compaction-trigger
  "qwen's computeThresholds(window, pct): min(pct * window, window -
   max-output - buffer) once that second term is positive, else pct *
   window alone. Matches qwen's own --debug `cheap-gate ... auto=<n>` log
   line exactly (scenario 03's own proof)."
  [window]
  (let [reserved (- window (+ qwen-compact-max-output-tokens qwen-compact-buffer-tokens))
        pct-trigger (long (Math/floor (* qwen-compact-pct window)))]
    (if (pos? reserved)
      (min pct-trigger reserved)
      pct-trigger)))

(def dead-zone-reference-trigger (qwen-compaction-trigger dead-zone-reference-window))

;; 2026-10-04 hotfix (the human: "Does it need to compact this early in?",
;; then "Go"): behind the tool-call shim a compaction summary is capped at
;; COMPACTION_OUTPUT_CAP (local_model_tool_call_shim.py), so most of qwen's
;; qwen-compact-max-output-tokens reserve is never written. A seat behind
;; the shim declares its served window plus shim-reclaim-tokens to qwen, and
;; its trigger moves up by that much (73728 served: 40728 -> 55728), still
;; 18000 under what Ollama serves. That gap holds the worst overshoot before
;; qwen checks again: the last reply (the Modelfile's num_predict, 4096 for
;; iq3), one tool batch (the seat settings' toolOutputBatchBudget, 24000
;; chars, about 8000 tokens) and the shim-capped compaction call, about 2k
;; short of the edge. The shim logs WINDOW_FULL if a prompt reaches it.
(def shim-reclaim-tokens 15000)

(defn declared-window
  "The window a seat declares to qwen for `served` (the Modelfile's num_ctx,
   read from Ollama - the one place the value is written): lifted by
   shim-reclaim-tokens when the seat is behind the shim and `served` already
   holds qwen's whole reserve (max-output + buffer), else `served` itself.
   A smaller window is never lifted: there the lift lands in the dead zone,
   or below 18000 sets qwen's trigger above what Ollama serves."
  [served behind-shim?]
  (if (and behind-shim? (pos? (- served qwen-compact-max-output-tokens qwen-compact-buffer-tokens)))
    (+ served shim-reclaim-tokens)
    served))

;; Derived, never hardcoded: the window at which the trigger climbs back up
;; to dead-zone-reference-trigger (60852 today) - the same formula, read
;; backwards from the reserved-tokens branch.
(def dead-zone-upper-window
  (+ qwen-compact-max-output-tokens qwen-compact-buffer-tokens dead-zone-reference-trigger))

(defn in-dead-zone?
  "True when `window`'s own compaction trigger falls below the trigger a
   32768-token window gives (BL-1840 invariant 1). A window the gate
   cannot learn is never asked - the caller skips this entirely for a nil
   window, as today (BL-1840 'what is wanted' item 1)."
  [window]
  (< (qwen-compaction-trigger window) dead-zone-reference-trigger))

(defn dead-zone-outcome
  "{:window (a positive int, or nil when unknown) :override? :role :model}
   -> {:decision (:proceed :warn :refuse) :message (string, or nil)}

   A window the gate cannot learn is never flagged. A flagged window is
   refused, naming the window, its trigger, and the two windows (32768 and
   the dead zone's own upper bound) that avoid it; the existing
   SWARMFORGE_LOCAL_WINDOW_OVERRIDE lets it start anyway, as a warning."
  [{:keys [window override? role model]}]
  (if (nil? window)
    {:decision :proceed :message nil}
    (let [trigger (qwen-compaction-trigger window)]
      (if (in-dead-zone? window)
        (if override?
          {:decision :warn
           :message (str "SWARMFORGE_LOCAL_WINDOW_OVERRIDE=1 let " role " (" model
                          ") start in qwen's compaction dead zone: its " window
                          "-token window compacts at " trigger " tokens, below the "
                          dead-zone-reference-trigger " tokens a " dead-zone-reference-window
                          "-token window gives - windows " dead-zone-reference-window
                          " and " dead-zone-upper-window " avoid it")}
          {:decision :refuse
           :message (str "local-model launch refused: " role " (" model ")'s "
                          window "-token window compacts at " trigger
                          " tokens, sooner than the " dead-zone-reference-trigger
                          " tokens a " dead-zone-reference-window
                          "-token window gives, while costing more memory - set "
                          "SWARMFORGE_LOCAL_WINDOW_OVERRIDE=1 to start anyway, or use a window at "
                          dead-zone-reference-window " or below, or at " dead-zone-upper-window " or above")})
        {:decision :proceed :message nil}))))
