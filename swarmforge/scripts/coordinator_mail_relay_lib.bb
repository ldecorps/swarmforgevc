;; coordinator_mail_relay_lib.bb — BL-1847: the pure parcel-summarizing and
;; batching core for the deterministic-coordinator mail relay. handoffd.bb's
;; coordinator-mail-sweep! is the thin I/O wrapper: it lists the coordinator's
;; inbox/new/ files, parses each with handoff_lib's own parse-envelope, calls
;; this file's relay-line for the text, relay-text to batch a tick's lines
;; into ONE Telegram-sized message, and owns the outbox append + file moves.
;; No tmux, no fs, no clock read happens in this file.
;;
;; Loaded via load-file, not required on a classpath:
;;   (load-file (str (fs/path (fs/parent *file*) "coordinator_mail_relay_lib.bb")))
;; and referred to as coordinator-mail-relay-lib/foo.

(ns coordinator-mail-relay-lib
  (:require [clojure.string :as str]))

(def telegram-char-limit
  "Telegram's own hard per-message character cap. A tick whose joined
   lines would exceed it is split: relay-text keeps as many leading lines
   as fit, appends \"and N more\", and the sweep leaves the rest in
   inbox/new/ for the next tick (never silently drops anything, and never
   rewrites a parcel to fit)."
  4096)

(defn- first-line [s]
  (-> (or s "") str/trim str/split-lines first (or "")))

(defn- payload-summary
  "The first line of the parcel's own message text (ticket's own wording):
   the `message:` header when present (a `note`'s own field), else the
   body's own first line (covers every other note shape this swarm sends -
   `Work BL-N: ...`, `BL-N QA-approved ...`, etc., which carry their text
   in the body, not a `message:` header), else `task:`/`commit:` for a
   `git_handoff` with neither (BL-1847's own fallback, since a git_handoff
   carries no message/body prose at all)."
  [{:keys [headers body]}]
  (let [message (get headers "message")
        body-line (first-line body)]
    (cond
      (not (str/blank? message)) (first-line message)
      (not (str/blank? body-line)) body-line
      (= (get headers "type") "git_handoff")
      (str/trim (str (get headers "task" "") " " (get headers "commit" "")))
      :else "")))

(defn relay-line
  "One text line for `parcel` ({:headers :body}, handoff_lib's own
   parse-envelope shape) at `filename`: sender, type, ticket id if the
   parcel names one (BL-1847's own direction - `extract-ticket-id-fn` is
   injected so this stays a pure fn: handoffd.bb passes the real
   chase_sweep_lib.bb/extract-ticket-id, never a copy of its pattern), the
   first line of its message text, and the parcel's own file name (so a
   human can find the exact parcel on disk if a line's prose is unclear)."
  [{:keys [headers] :as parcel} filename extract-ticket-id-fn]
  (let [from (get headers "from" "unknown")
        type (get headers "type" "unknown")
        summary (payload-summary parcel)
        ticket (or (extract-ticket-id-fn (get headers "task"))
                   (extract-ticket-id-fn summary))]
    (str from " " type (when ticket (str " " ticket)) ": " summary " [" filename "]")))

(defn relay-text
  "Batches `lines` (one per relay-line above, in the order they will be
   moved to completed/) into ONE Telegram message text, bounded at
   telegram-char-limit. When every line fits, returns all of them and
   `:kept` equal to `(count lines)`. When they do not, keeps as many
   LEADING lines as fit alongside an \"and N more\" trailer naming how
   many were held back - the sweep moves only the kept parcels to
   completed/ and leaves the rest in inbox/new/ for the next tick
   (BL-1847's invariant: a parcel moves to completed only after its own
   relay line was actually written).
   A single line that alone exceeds the limit (pathological - no real
   parcel's summary is this long) is still sent once, un-truncated, rather
   than silently dropped: `:kept` 1, hard-truncating prose is a worse
   failure mode than one oversized Telegram send."
  [lines]
  (let [total (count lines)]
    (if (zero? total)
      {:text "" :kept 0}
      (loop [k total]
        (if (zero? k)
          {:text (first lines) :kept 1}
          (let [kept (take k lines)
                remaining (- total k)
                text (if (zero? remaining)
                       (str/join "\n" kept)
                       (str (str/join "\n" kept) "\nand " remaining " more"))]
            (if (<= (count text) telegram-char-limit)
              {:text text :kept k}
              (recur (dec k)))))))))
