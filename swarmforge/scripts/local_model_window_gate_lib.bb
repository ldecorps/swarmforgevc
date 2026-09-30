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
