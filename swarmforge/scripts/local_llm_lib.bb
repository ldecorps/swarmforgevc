;; BL-1861: pure core for `local_llm.sh remove` - picking the roster's
;; local-model seats, refusing a bare one, parsing a seat's own launch
;; script for its model/endpoint, and building/reading the
;; .swarmforge/local-llm/removed.json record. No file, HTTP, or tmux IO
;; here - local_llm.sh supplies already-read text and already-decoded
;; /api/ps bodies; this file only decides and shapes data.

(ns local-llm-lib
  (:require [cheshire.core :as json]
            [clojure.string :as str]))

(defn- rows [text]
  (->> (str/split-lines (or text ""))
       (remove str/blank?)
       (map #(str/split % #"\t"))))

(defn local-model-seat-ids
  "Seat ids (roles.tsv column 1, 0-indexed) whose agent column (6,
   1-indexed - column 5, 0-indexed) is \"local-model\", in file order -
   the live roster is the target, never a hardcoded seat name."
  [roles-text]
  (->> (rows roles-text)
       (filter (fn [cols] (= "local-model" (nth cols 5 nil))))
       (map first)
       vec))

(defn bare-seat?
  "True when seat-id carries no '@' - the shape stage addressing (and the
   coordinator's own pane) needs. remove refuses rather than take one out
   (BL-1861 invariant 1)."
  [seat-id]
  (not (str/includes? (or seat-id "") "@")))

(defn first-bare-seat
  "The first bare seat id among seat-ids, or nil - what remove refuses on,
   before touching any file."
  [seat-ids]
  (some #(when (bare-seat? %) %) seat-ids))

(defn- strip-v1 [url]
  (when-not (str/blank? (str url))
    (str/replace url #"/v1/?$" "")))

(defn parse-launch-script
  "{:model :endpoint} parsed from a generated launch script's own text:
   the --model flag's value (qwen's own CLI arg) and OPENAI_BASE_URL's
   value with its /v1 suffix stripped (the native Ollama base the unload
   call targets - local_model_window_gate_lib.bb's own native-base rule).
   Either key is nil when the script names no such line - the caller
   decides what an absent model/endpoint means, never a default guessed
   here.

   BL-1861 bounce (hardener, 2026-10-03): write_role_launch_script
   concatenates every agent's guard block before launch_body, local-model
   included - an EARLIER, inert guard (cerebras_guard's own
   OPENAI_BASE_URL=\"${OPENAI_BASE_URL:-...}\" line, textually present but
   never executed for a local-model seat) sits before local_model_guard's
   own real, unconditional assignment, so the FIRST match is the wrong
   one; the LAST OPENAI_BASE_URL= assignment in the file is always the
   one that actually governs. The real qwen command line's own --model
   value is also spliced in UNQUOTED (swarmforge.sh's own EXTRA_CLI_ARGS
   interpolation), with an EARLIER, quoted --model invocation from
   local_seat_settings_snapshot_cli.bb's own recording call (BL-1850)
   sitting before it in the same guard block - the same \"take the LAST
   one, accept either quoting\" fix covers both."
  [script-text]
  (let [text (or script-text "")
        model-matches (re-seq #"--model[ =]+(?:'([^']+)'|\"([^\"]+)\"|(\S+))" text)
        model (when (seq model-matches)
                (let [[_ q1 q2 bare] (last model-matches)]
                  (or q1 q2 bare)))
        endpoint-matches (re-seq #"OPENAI_BASE_URL=['\"]([^'\"]+)['\"]" text)
        endpoint (when (seq endpoint-matches) (second (last endpoint-matches)))]
    {:model model :endpoint (strip-v1 endpoint)}))

(defn seat-record
  "One removed seat's {:rolesRow :rolesLine :sessionsRow :sessionsLine} -
   its row, byte for byte, off roles-text/sessions-text, and the row's
   1-based LINE POSITION in each (blank lines never counted - the same
   shape write_roles_file/write_sessions_file produce), so a later add
   (BL-1862) can put it back at the same spot. nil row/line when the seat
   has no row in that file (sessions.tsv is optional, retire_seat_lib's
   own posture)."
  [roles-text sessions-text seat-id]
  (let [find-at (fn [text col]
                  (first (keep-indexed
                          (fn [idx cols]
                            (when (= seat-id (nth cols col nil))
                              [(inc idx) (str/join "\t" cols)]))
                          (rows text))))
        [r-line r-row] (find-at roles-text 0)
        [s-line s-row] (find-at sessions-text 1)]
    {:rolesRow r-row :rolesLine r-line
     :sessionsRow s-row :sessionsLine s-line}))

(defn models-for-seats
  "Deduped {model {:endpoint :vramBytes}} across every removed seat's own
   parsed launch script (seat->launch-facts: {seat-id {:model :endpoint}}).
   A seat whose script names no model contributes nothing. api-ps-body
   (already decoded JSON, or nil when the server did not answer) supplies
   each model's current size_vram - null when it is not loaded (BL-1861
   item 3)."
  [seat->launch-facts api-ps-body]
  (let [vram-of (fn [model]
                  (->> (:models api-ps-body)
                       (some #(when (= model (or (:name %) (:model %))) (:size_vram %)))))]
    (reduce (fn [acc {:keys [model endpoint]}]
              (if (str/blank? (str model))
                acc
                (assoc acc model {:endpoint endpoint :vramBytes (vram-of model)})))
            {}
            (vals seat->launch-facts))))

(defn build-removed-record
  "The full removed.json shape: :seats (by id, seat-record above) and
   :models (model-facts, already deduped by models-for-seats), plus
   :removedAt."
  [roles-text sessions-text seat-ids model-facts removed-at-iso]
  {:removedAt removed-at-iso
   :seats (into {} (map (fn [id] [id (seat-record roles-text sessions-text id)]) seat-ids))
   :models model-facts})

(defn record->json [record]
  (json/generate-string record {:pretty true}))

(defn parse-record
  "removed.json's text, parsed back to a STRING-keyed map (never
   keywordized: a seat id or model name is dynamic data, not a fixed
   schema key, and cheshire's keywordize-keys has no partial mode), or
   nil for a blank/absent file - no record exists (the 'no local-model
   seat' vs 'already removed' branch, BL-1861 scenario 03). Read with
   string keys throughout (\"seats\", \"models\", \"rolesLine\", ...) -
   never the keyword keys build-removed-record's own in-memory value
   uses, which this never round-trips through."
  [record-text]
  (when-not (str/blank? (str record-text))
    (json/parse-string record-text)))

(defn record-model-names
  "The model names a parsed (string-keyed) record's own \"models\" map
   holds, for the no-seats-left retry path (scenario 03 row 1) - re-run
   the unload of exactly these, never the live roster's (there is none)."
  [record]
  (vec (keys (get record "models" {}))))

(defn loaded-model-names
  "The :name (or :model) of every entry in an already-decoded /api/ps
   body - pure over the parsed JSON; the HTTP call itself is never faked
   here (BL-1861's own fixture posture: stub the server)."
  [api-ps-body]
  (->> (:models api-ps-body)
       (map #(or (:name %) (:model %)))
       set))
