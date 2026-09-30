;; BL-1801: pure decision for "does a local-model seat's first turn fit
;; the window Ollama actually serves it". Kept separate from the CLI
;; (which gathers the facts: the composed prompt, the CLI's own recorded
;; overhead, and the served window) so the decision itself is testable
;; with no HTTP call, no subprocess, no filesystem.
(ns local-model-window-gate-lib)

;; Human ruling 2026-09-29 (in chat, quoted in the ticket): three
;; characters per token, the same estimator convention BL-1798's own
;; 8192-character card budget already assumes (about 2731 tokens at 3
;; chars/token).
(def chars-per-token 3)

(defn estimate-tokens
  "ceil((composed-chars + overhead-chars) / chars-per-token)."
  [composed-chars overhead-chars]
  (long (Math/ceil (/ (double (+ composed-chars overhead-chars)) chars-per-token))))

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
