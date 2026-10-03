;; BL-1861: unit tests for local_llm_lib.bb's pure core. No file, HTTP, or
;; tmux IO - that is local_llm.sh's own domain, covered by
;; test_bl1861_local_llm_remove.sh.
(ns local-llm-lib-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "local_llm_lib.bb")))

(def failures (atom []))

(defn assert= [desc expected actual]
  (if (= expected actual)
    (println "PASS:" desc)
    (do (swap! failures conj desc)
        (println "FAIL:" desc "- expected" (pr-str expected) "got" (pr-str actual)))))

(defn assert-nil [desc actual]
  (assert= desc nil actual))

;; ── local-model-seat-ids ──────────────────────────────────────────────────

(def roles-text
  (str/join "\n"
            ["coder\tcoder\t/wt/coder\tswarmforge-coder\tCoder\tclaude\ttask\toff\tforward-only"
             "coder@2\tcoder\t/wt/coder2\tswarmforge-coder@2\tCoder2\tlocal-model\ttask\toff\tforward-only"
             "coder@iq3\tcoder\t/wt/coder-iq3\tswarmforge-coder@iq3\tCoderIQ3\tlocal-model\ttask\toff\tforward-only"
             "coordinator\tcoordinator\t/wt/root\tswarmforge-coordinator\tCoordinator\tclaude\ttask\toff\tforward-only"]))

(assert= "local-model-seat-ids: picks only the local-model rows, in file order"
         ["coder@2" "coder@iq3"]
         (local-llm-lib/local-model-seat-ids roles-text))

(assert= "local-model-seat-ids: empty roster text yields no seats"
         []
         (local-llm-lib/local-model-seat-ids ""))

(assert= "local-model-seat-ids: a roster with no local-model row yields no seats"
         []
         (local-llm-lib/local-model-seat-ids "coder\tcoder\t/wt/coder\tswarmforge-coder\tCoder\tclaude\ttask\toff\tforward-only"))

;; ── bare-seat? / first-bare-seat ──────────────────────────────────────────

(assert= "bare-seat?: a seat with no @ is bare" true (local-llm-lib/bare-seat? "coder"))
(assert= "bare-seat?: a seat with @ is not bare" false (local-llm-lib/bare-seat? "coder@2"))
(assert= "bare-seat?: the coordinator (no @) is bare" true (local-llm-lib/bare-seat? "coordinator"))

(assert-nil "first-bare-seat: no bare seat among @-suffixed ids" (local-llm-lib/first-bare-seat ["coder@2" "coder@iq3"]))
(assert= "first-bare-seat: names the first bare seat"
         "coordinator"
         (local-llm-lib/first-bare-seat ["coder@2" "coordinator" "coder"]))

;; ── parse-launch-script ───────────────────────────────────────────────────

(def launch-script-text
  "#!/usr/bin/env zsh
export OPENAI_API_BASE='http://127.0.0.1:19999/v1'
export OPENAI_BASE_URL='http://127.0.0.1:19999/v1'
qwen --auth-type openai -y --model 'qwen2.5-coder-14b-q5km:latest' -i \"hello\"
")

(assert= "parse-launch-script: extracts the model and the /v1-stripped endpoint"
         {:model "qwen2.5-coder-14b-q5km:latest" :endpoint "http://127.0.0.1:19999"}
         (local-llm-lib/parse-launch-script launch-script-text))

(assert= "parse-launch-script: double-quoted --model value also parses"
         {:model "qwen2.5-coder-14b-q5km:latest" :endpoint nil}
         (local-llm-lib/parse-launch-script "qwen --auth-type openai -y --model \"qwen2.5-coder-14b-q5km:latest\" -i \"hi\"\n"))

(assert= "parse-launch-script: no --model/OPENAI_BASE_URL line yields both nil"
         {:model nil :endpoint nil}
         (local-llm-lib/parse-launch-script "claude --settings x\n"))

(assert= "parse-launch-script: blank/nil text never throws, yields both nil"
         {:model nil :endpoint nil}
         (local-llm-lib/parse-launch-script nil))

;; BL-1861 bounce (hardener, 2026-10-03): the REAL generated launch script
;; is never the idealized two-line shape above - write_role_launch_script
;; concatenates every agent's guard block before launch_body, local-model
;; included. A slice of that real shape: cerebras_guard's own inert,
;; quoted OPENAI_BASE_URL="${...}" line (textually present, never
;; executed for a local-model seat) BEFORE local_model_guard's real
;; assignment; local_seat_settings_snapshot_cli.bb's own quoted --model
;; recording call BEFORE the real qwen command's UNQUOTED --model. The
;; live bounce evidence (backlog/evidence/BL-1861-bounce-20261003.md)
;; read exactly this shape off .swarmforge/launch/coder.sh.
(def real-guard-block-launch-script-text
  (str
   "if [[ \"${SWARMFORGE_USE_CEREBRAS:-}\" == \"1\" ]]; then\n"
   "  export OPENAI_BASE_URL=\"${OPENAI_BASE_URL:-https://api.cerebras.ai/v1}\"\n"
   "fi\n"
   "export OPENAI_BASE_URL='http://127.0.0.1:11439/v1'\n"
   "bb 'local_seat_settings_snapshot_cli.bb' '/root' --seat 'coder' --model 'ista-iq3s-coder:latest' --endpoint-url 'http://127.0.0.1:11434/v1' >/dev/null || true\n"
   "qwen --auth-type openai -y --model ista-iq3s-coder:latest -i \"hello\"\n"))

(assert= "BL-1861 bounce D1: the LAST OPENAI_BASE_URL assignment wins over an earlier inert guard, and an unquoted --model is accepted"
         {:model "ista-iq3s-coder:latest" :endpoint "http://127.0.0.1:11439"}
         (local-llm-lib/parse-launch-script real-guard-block-launch-script-text))

(assert= "BL-1861 bounce D1: a DIFFERENT real --model than the snapshot CLI's own recording call still reads the real (last) one"
         "a-different-model:latest"
         (:model (local-llm-lib/parse-launch-script
                  (str/replace real-guard-block-launch-script-text
                               "qwen --auth-type openai -y --model ista-iq3s-coder:latest -i \"hello\"\n"
                               "qwen --auth-type openai -y --model a-different-model:latest -i \"hello\"\n"))))

;; ── seat-record ───────────────────────────────────────────────────────────

(def sessions-text
  (str/join "\n"
            ["1\tcoder\tswarmforge-coder\tCoder\tclaude"
             "2\tcoder@2\tswarmforge-coder@2\tCoder2\tlocal-model"
             "3\tcoder@iq3\tswarmforge-coder@iq3\tCoderIQ3\tlocal-model"
             "4\tcoordinator\tswarmforge-coordinator\tCoordinator\tclaude"]))

(assert= "seat-record: finds the seat's own roles.tsv row and 1-based line, and its sessions.tsv row and line"
         {:rolesRow "coder@2\tcoder\t/wt/coder2\tswarmforge-coder@2\tCoder2\tlocal-model\ttask\toff\tforward-only"
          :rolesLine 2
          :sessionsRow "2\tcoder@2\tswarmforge-coder@2\tCoder2\tlocal-model"
          :sessionsLine 2}
         (local-llm-lib/seat-record roles-text sessions-text "coder@2"))

(assert= "seat-record: a seat absent from sessions.tsv gets nil row/line there, roles.tsv unaffected"
         {:rolesRow "coder@2\tcoder\t/wt/coder2\tswarmforge-coder@2\tCoder2\tlocal-model\ttask\toff\tforward-only"
          :rolesLine 2
          :sessionsRow nil
          :sessionsLine nil}
         (local-llm-lib/seat-record roles-text "" "coder@2"))

;; ── models-for-seats ───────────────────────────────────────────────────────

(def api-ps-body-two-loaded
  {:models [{:name "qwen2.5-coder-14b-q5km:latest" :size 999 :size_vram 13364000000}
            {:name "outside-task:latest" :size 111 :size_vram 2000000}]})

(assert= "models-for-seats: dedupes two seats naming the same model into one entry with its vram"
         {"qwen2.5-coder-14b-q5km:latest" {:endpoint "http://127.0.0.1:11434" :vramBytes 13364000000}}
         (local-llm-lib/models-for-seats
          {"coder@2" {:model "qwen2.5-coder-14b-q5km:latest" :endpoint "http://127.0.0.1:11434"}
           "coder@iq3" {:model "qwen2.5-coder-14b-q5km:latest" :endpoint "http://127.0.0.1:11434"}}
          api-ps-body-two-loaded))

(assert= "models-for-seats: a model not currently loaded gets a nil (null) vram, never a default"
         {"some-other:latest" {:endpoint "http://127.0.0.1:11434" :vramBytes nil}}
         (local-llm-lib/models-for-seats
          {"coder@2" {:model "some-other:latest" :endpoint "http://127.0.0.1:11434"}}
          api-ps-body-two-loaded))

(assert= "models-for-seats: a nil api-ps-body (server did not answer) never throws, vram is nil"
         {"qwen2.5-coder-14b-q5km:latest" {:endpoint "http://127.0.0.1:11434" :vramBytes nil}}
         (local-llm-lib/models-for-seats
          {"coder@2" {:model "qwen2.5-coder-14b-q5km:latest" :endpoint "http://127.0.0.1:11434"}}
          nil))

(assert= "models-for-seats: a seat whose script named no model contributes nothing"
         {}
         (local-llm-lib/models-for-seats {"coder@2" {:model nil :endpoint "http://127.0.0.1:11434"}} nil))

;; ── build-removed-record / record->json / parse-record ────────────────────

(def model-facts {"qwen2.5-coder-14b-q5km:latest" {:endpoint "http://127.0.0.1:11434" :vramBytes nil}})

(def built-record
  (local-llm-lib/build-removed-record roles-text sessions-text ["coder@2" "coder@iq3"] model-facts "2026-10-03T19:00:00Z"))

(assert= "build-removed-record: names every removed seat"
         #{"coder@2" "coder@iq3"}
         (set (keys (:seats built-record))))

(assert= "build-removed-record: carries the removed-at timestamp verbatim"
         "2026-10-03T19:00:00Z"
         (:removedAt built-record))

(assert= "build-removed-record: carries the model facts verbatim"
         model-facts
         (:models built-record))

(def round-tripped (local-llm-lib/parse-record (local-llm-lib/record->json built-record)))

(assert= "record->json/parse-record: a record round-trips through JSON with the same seat ids (string keys)"
         #{"coder@2" "coder@iq3"}
         (set (keys (get round-tripped "seats"))))

(assert= "record->json/parse-record: a round-tripped seat's rolesLine survives as a number"
         2
         (get-in round-tripped ["seats" "coder@2" "rolesLine"]))

(assert-nil "parse-record: blank text yields nil - no record exists" (local-llm-lib/parse-record ""))
(assert-nil "parse-record: nil text yields nil" (local-llm-lib/parse-record nil))

(assert= "record-model-names: the model names a parsed record's :models map holds"
         ["qwen2.5-coder-14b-q5km:latest"]
         (local-llm-lib/record-model-names round-tripped))

;; ── loaded-model-names ─────────────────────────────────────────────────────

(assert= "loaded-model-names: the set of names/models in an /api/ps body"
         #{"qwen2.5-coder-14b-q5km:latest" "outside-task:latest"}
         (local-llm-lib/loaded-model-names api-ps-body-two-loaded))

(assert= "loaded-model-names: a body naming :model instead of :name still reads"
         #{"x"}
         (local-llm-lib/loaded-model-names {:models [{:model "x"}]}))

(assert= "loaded-model-names: no models loaded yields an empty set"
         #{}
         (local-llm-lib/loaded-model-names {:models []}))

;; ── report ──────────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "ALL PASS: local_llm_lib.bb")
  (do (println (count @failures) "FAILURES")
      (System/exit 1)))
