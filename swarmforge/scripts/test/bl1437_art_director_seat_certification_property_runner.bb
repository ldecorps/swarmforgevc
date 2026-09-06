#!/usr/bin/env bb
;; BL-1437 coder pass (BL-654 invariants): PROPERTY tests over the REAL
;; model_steward_cli.bb `evaluate` command - never a reimplementation of
;; its decision. Seeded (not wall-clock) java.util.Random so failures
;; reproduce. Each case runs the real CLI as a subprocess against isolated
;; temp state dirs (MODEL_STEWARD_STATE_DIR, MODEL_FACTORY_STATE_DIR),
;; seeded on first read from THIS repo's own committed
;; swarmforge/model-steward/seed/models.seed.json - never a fixture copy of
;; it, so a case is exercising the exact seed this parcel lands.
;;
;;   P1 (invariant 1, the load-bearing property): every certified role_matrix
;;      row `evaluate` produces carries an evidence pointer that IS the
;;      scorecard's own id (never invented), and a certification report
;;      artifact is written whose own body carries that same scorecard id -
;;      "resolves to a committed scorecard artifact" is provable for any
;;      scorecard content, not just the one real BL-1419 sample.
;;   P2 (invariant 2): evaluating a role's row never touches any OTHER
;;      role's role_matrix entries - `role-matrix <role>` for every
;;      pre-existing role is byte-identical to a freshly-seeded, untouched
;;      reference state dir, whatever the scorecard's own content.
;;   P3 (invariant 3): the steward never assigns. Running `evaluate` writes
;;      nothing at all under MODEL_FACTORY_STATE_DIR - ModelFactory's own
;;      state is untouched by a steward-only command.
;;
;; Non-vacuity, checked by hand before landing (see
;; backlog/evidence/BL-1437-coder-pass-20260906.md for the exact breaks and
;; the failures each produced, then restored and re-verified green).

(ns bl1437-art-director-seat-certification-property-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def SCRIPT-DIR (str (fs/parent (fs/canonicalize *file*))))
(def SCRIPTS-DIR (str (fs/path SCRIPT-DIR "..")))
(def CLI (str (fs/path SCRIPTS-DIR "model_steward_cli.bb")))

(def OTHER-ROLES ["architect" "coder" "cleaner" "QA" "hardender" "documenter" "specifier"])

(def failures (atom []))
(defn- report-fail [prop n input msg]
  (swap! failures conj (str "FAIL " prop " case " n "\n  input: " (pr-str input) "\n  " msg)))

(def ^:private rng (java.util.Random. 1437))
(defn- rint [bound] (.nextInt rng (int bound)))
(defn- rbool [] (.nextBoolean rng))
(def ^:private WORDS ["alpha" "bravo" "charlie" "delta" "echo" "foxtrot" "golf" "hotel" "india" "juliet"])
(defn- rword [] (nth WORDS (rint (count WORDS))))

(defn- run! [env & args]
  (apply process/sh (into ["bb" CLI] args) [{:env env}]))

(defn- base-env [state-dir factory-dir]
  (merge (into {} (System/getenv))
         {"MODEL_STEWARD_STATE_DIR" state-dir "MODEL_FACTORY_STATE_DIR" factory-dir}))

;; A random scorecard whose entries sometimes hit "look_and_feel" (BL-1437's
;; own minimal dimension), sometimes other dimensions, sometimes plain -
;; and whose id always contains "scorecard" (the tier-0 authority marker
;; battery-or-scorecard-evidence? already checks for, matching every other
;; certified row's own evidence convention).
(defn- gen-scorecard [n]
  (let [id (str "test-scorecard:" (rword) "-" n "-" (rint 100000))
        n-entries (inc (rint 4))
        competency-kinds ["look-and-feel:clarity" "look-and-feel:consistency"
                          "protocol-shape" "tool-shape" "plain-check"]
        entries (vec (for [i (range n-entries)]
                       {:competency (str (nth competency-kinds (rint (count competency-kinds))) "-" i)
                        :status "pass"
                        :reason (str "generated case " n " entry " i)}))]
    {:id id
     :body {:scorecard_id id
            :model "claude-sonnet-5"
            :entries entries
            :overall "generated"}}))

(defn- write-scorecard! [dir {:keys [body]}]
  (let [p (fs/path dir "scorecard.json")]
    (spit (str p) (json/generate-string body))
    (str p)))

(def RUNS 24)
(dotimes [n RUNS]
  (let [state-dir (str (fs/create-temp-dir {:prefix "bl1437-prop-state-"}))
        ref-dir (str (fs/create-temp-dir {:prefix "bl1437-prop-ref-"}))
        factory-dir (str (fs/create-temp-dir {:prefix "bl1437-prop-factory-"}))
        scratch (str (fs/create-temp-dir {:prefix "bl1437-prop-scratch-"}))]
    (try
      (let [scorecard (gen-scorecard n)
            scorecard-path (write-scorecard! scratch scorecard)
            env (base-env state-dir factory-dir)
            ref-env (base-env ref-dir factory-dir)]

        ;; ── seed BOTH state dirs identically before either is touched, so
        ;;    ref-dir is a true "never evaluated" baseline for P2 ─────────
        (run! env "status")
        (run! ref-env "status")

        (let [{:keys [exit out]} (run! env "evaluate" "anthropic/claude-sonnet-5"
                                        "--role" "art-director" "--scorecard" scorecard-path)]
          (when-not (zero? exit)
            (report-fail "P1" n scorecard (str "evaluate itself failed, exit " exit ": " out)))

          ;; ── P1: the row's evidence IS the scorecard id, and a report
          ;;    artifact exists carrying that same id ─────────────────────
          (let [{:keys [exit out]} (run! env "role-matrix" "art-director")
                lines (str/split-lines (str/trim out))
                matching (filter #(str/includes? % (:id scorecard)) lines)]
            (when-not (zero? exit)
              (report-fail "P1" n scorecard (str "role-matrix art-director failed: " out)))
            (when (empty? matching)
              (report-fail "P1" n scorecard
                           (str "no role_matrix row carries the scorecard's own id as evidence: " out))))
          (let [reports-dir (fs/path state-dir "certification-reports")
                report-files (when (fs/exists? reports-dir) (fs/list-dir reports-dir))
                bodies (map #(slurp (str %)) report-files)
                any-carries-id? (some #(str/includes? % (:id scorecard)) bodies)]
            (when-not any-carries-id?
              (report-fail "P1" n scorecard
                           (str "no certification report artifact carries the scorecard's own id; reports: "
                                (pr-str (map str report-files))))))

          ;; ── P2: every OTHER role's role_matrix is byte-identical to the
          ;;    untouched reference ────────────────────────────────────────
          (doseq [role OTHER-ROLES]
            (let [got (:out (run! env "role-matrix" role))
                  want (:out (run! ref-env "role-matrix" role))]
              (when-not (= got want)
                (report-fail "P2" n {:role role :scorecard scorecard}
                             (str "role-matrix " role " changed after evaluating art-director\n  before: "
                                  (pr-str want) "\n  after:  " (pr-str got))))))

          ;; ── P3: the steward never assigns - ModelFactory's own state dir
          ;;    gains nothing at all ────────────────────────────────────────
          (let [factory-files (if (fs/exists? factory-dir) (fs/list-dir factory-dir) [])]
            (when (seq factory-files)
              (report-fail "P3" n scorecard
                           (str "MODEL_FACTORY_STATE_DIR gained file(s) from a steward-only evaluate call: "
                                (pr-str (map str factory-files))))))))
      (finally
        (doseq [d [state-dir ref-dir factory-dir scratch]]
          (try (fs/delete-tree d) (catch Exception _ nil)))))))

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println (str "ALL PASS: bl1437_art_director_seat_certification_property_runner.bb (" RUNS " cases)")))
