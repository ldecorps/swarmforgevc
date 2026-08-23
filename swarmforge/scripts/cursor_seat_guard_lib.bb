;; BL-1078: may this pack staff a seat with a Cursor identity?
;;
;; `cursor` becomes a first-class agent token in this slice, but a Cursor
;; IDENTITY is not certified by it. BL-1079 lands steward certification; until
;; then an uncertified identity needs a deliberate escape, and the refusal has
;; to name the escape that would admit it — a guard that refuses without
;; saying how to proceed is one an operator routes around with something
;; cruder.
;;
;; Pure: every input is passed in, including the registry map and the env
;; value. Nothing here reads a file, an env var or a clock, so the CLI beside
;; it stays a thin wrapper (engineering.prompt's CLI rule).
;;
;; The admission rule deliberately mirrors extension/src/swarm/cursorIdentity.ts
;; rather than inventing a second one: same statuses, same fail-CLOSED posture,
;; same `provider/model` key. That is a rule mirrored across a boundary no
;; import bridges, so cursor_seat_guard_lib_test_runner.bb drives the REAL
;; TypeScript and asserts both sides agree — a "kept in sync" comment is not a
;; gate (BL-897).

(ns cursor-seat-guard-lib
  (:require [clojure.string :as str]))

(def escape-env
  "The spike-only escape. Same name BL-713's cursorIdentity.ts declares; the
   agreement test pins them together."
  "SWARMFORGE_CURSOR_SEAT_SPIKE")

(def escape-value "1")

(def cursor-binary
  "The real Cursor CLI. `cursor-agent`, not `cursor` — the agent TOKEN and the
   BINARY name differ, and checking the token would look like a dependency
   check while verifying nothing."
  "cursor-agent")

(def default-model
  "What cursor-agent runs with when a window line names no --model. Its own
   default is server-chosen and reported as `auto`; naming it explicitly keeps
   the registry key stable rather than empty."
  "auto")

(def known-statuses #{"certified" "candidate" "retired"})

(defn identity-key
  "`provider/model`. Mirrors cursorIdentity.ts's identityKey."
  [provider model]
  (str provider "/" model))

(defn model-from-cli
  "The model a window line's extra CLI args select, or the default.

   Reads `--model <m>` and `--model=<m>`, because a pack author will write
   either and a guard that silently missed one would key the registry on the
   wrong identity while reading green."
  [extra-cli]
  (let [s (str (or extra-cli ""))]
    (or (second (re-find #"--model[=\s]+(\S+)" s))
        default-model)))

(defn identity-status
  "The identity's status as the registry records it.

   Fails CLOSED at every step — an unreadable registry, a missing `models`
   map, an absent entry, an entry with no `status`, or a status this guard
   does not understand all report \"unknown\", which admission refuses exactly
   like a candidate. Absence must never buy certification."
  [registry provider model]
  (let [models (get registry "models" (get registry :models))
        entry (when (map? models)
                (or (get models (identity-key provider model))
                    (get models (keyword (identity-key provider model)))))
        status (when (map? entry) (or (get entry "status") (get entry :status)))]
    (if (and (string? status) (contains? known-statuses status))
      status
      "unknown")))

(defn escape-set?
  "Is the spike-only escape in force? Exact match on the declared value: a
   guard that admitted on any non-empty string would be opened by a stray
   `SWARMFORGE_CURSOR_SEAT_SPIKE=0`."
  [env-value]
  (= escape-value (str/trim (str (or env-value "")))))

(defn admission
  "May this seat be provisioned? {:admit? :reason :status :identity :message}.

   Three outcomes, and the message differs because the reader's next action
   differs: a certified identity needs no explanation, an escaped one must be
   told it is running uncertified, and a refused one must be told what would
   admit it."
  [{:keys [registry provider model escape]}]
  (let [provider (or provider "cursor")
        model (or model default-model)
        key (identity-key provider model)
        status (identity-status registry provider model)]
    (cond
      (= "certified" status)
      {:admit? true :reason :certified :status status :identity key
       :message (str "cursor identity " key " is certified")}

      (escape-set? escape)
      {:admit? true :reason :uncertified-escape :status status :identity key
       :message (str "cursor identity " key " is UNCERTIFIED (status " status
                     ") and is admitted only because " escape-env "=" escape-value
                     " is set; this seat is a spike, not a certified one")}

      :else
      {:admit? false :reason :uncertified :status status :identity key
       :message (str "cursor identity " key " is not certified in the model steward"
                     " registry (status " status "). Set " escape-env "=" escape-value
                     " to admit it as a spike seat, or certify it first")})))
