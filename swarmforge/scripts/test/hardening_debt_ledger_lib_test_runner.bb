#!/usr/bin/env bb
;; BL-942: example-based unit tests for hardening_debt_ledger_lib.bb's pure
;; core - parse/render round-trip, record-deferral's idempotent dedup on
;; (gate, file-set), and outstanding-debt's machine-readable shape.

(ns hardening-debt-ledger-lib-test-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "hardening_debt_ledger_lib.bb")))
(require '[hardening-debt-ledger-lib :as hdl])

(def failures (atom []))
(defn check [msg expr]
  (when-not expr (swap! failures conj (str "FAIL: " msg))))

;; ── normalize-file-set ──────────────────────────────────────────────────
(check "normalize-file-set sorts, dedupes, and strips blanks/whitespace"
       (= ["a.ts" "b.ts" "c.ts"] (hdl/normalize-file-set ["c.ts" " a.ts " "b.ts" "a.ts" "" "  "])))

;; ── debt-key ────────────────────────────────────────────────────────────
(check "debt-key is stable across input ordering/duplicates"
       (= (hdl/debt-key "mutation" ["a.ts" "b.ts"]) (hdl/debt-key "mutation" ["b.ts" "a.ts" "a.ts"])))
(check "debt-key differs across gates for the same file set"
       (not= (hdl/debt-key "mutation" ["a.ts"]) (hdl/debt-key "CRAP" ["a.ts"])))
(check "debt-key differs across different file sets for the same gate"
       (not= (hdl/debt-key "mutation" ["a.ts"]) (hdl/debt-key "mutation" ["b.ts"])))

;; ── record-deferral: append + idempotent dedup (scenario 03) ──────────────
(def d1 {:parcel "BL-915" :gate "mutation" :file-set ["a.ts" "b.ts"]
         :reason "host load above busy threshold" :load "44.47/27.77/22.49" :detected-at "2026-08-19"})

(def after-1 (hdl/record-deferral [] d1))
(check "record-deferral appends a row on first defer" (= 1 (count after-1)))
(check "the appended row's file-set is normalized" (= ["a.ts" "b.ts"] (:file-set (first after-1))))

(def after-2 (hdl/record-deferral after-1 d1))
(check "record-deferral is a no-op when the exact same request repeats" (= after-1 after-2))

(def d1-different-parcel (assoc d1 :parcel "BL-916" :load "50/40/30"))
(def after-3 (hdl/record-deferral after-1 d1-different-parcel))
(check "record-deferral dedups on (gate, file-set) even when the parcel differs"
       (= 1 (count after-3)))
(check "the FIRST recorded parcel wins the row - a later duplicate never overwrites it"
       (= "BL-915" (:parcel (first after-3))))

(def d2 {:parcel "BL-917" :gate "CRAP" :file-set ["a.ts" "b.ts"]
         :reason "host load above busy threshold" :load "20/18/16" :detected-at "2026-08-19"})
(def after-4 (hdl/record-deferral after-1 d2))
(check "a different gate for the same file set is a DIFFERENT debt (not deduped)"
       (= 2 (count after-4)))

(def d3 {:parcel "BL-918" :gate "mutation" :file-set ["c.ts"]
         :reason "host load above busy threshold" :load "30/25/20" :detected-at "2026-08-19"})
(def after-5 (hdl/record-deferral after-1 d3))
(check "a different file set for the same gate is a DIFFERENT debt (not deduped)"
       (= 2 (count after-5)))

;; ── rows-for-parcel / rows-for-file-set ────────────────────────────────
(check "rows-for-parcel finds only that parcel's rows"
       (= ["BL-915"] (mapv :parcel (hdl/rows-for-parcel after-4 "BL-915"))))
(check "rows-for-parcel returns empty for a parcel with no rows (gate ran, nothing to find)"
       (= [] (hdl/rows-for-parcel after-4 "BL-999-never-deferred")))
(check "rows-for-file-set finds the row regardless of the querying order"
       (= 1 (count (hdl/rows-for-file-set after-1 ["b.ts" "a.ts"]))))

;; ── outstanding-debt: machine-readable, no evidence prose (scenario 04) ──
(def outstanding (hdl/outstanding-debt after-4))
(check "outstanding-debt returns every row's parcel and file-set" (= 2 (count outstanding)))
(check "outstanding-debt's rows expose parcel/gate/file-set directly (map access, no text parse)"
       (every? #(and (:parcel %) (:gate %) (seq (:file-set %))) outstanding))

;; ── parse-ledger / render-ledger round-trip ────────────────────────────
(def rendered (hdl/render-ledger after-4))
(check "render-ledger starts with the header comment block"
       (clojure.string/starts-with? rendered "# backlog/hardening-debt-ledger.yaml"))
(check "render-ledger emits one '- parcel:' line per row"
       (= 2 (count (re-seq #"(?m)^- parcel:" rendered))))

(def roundtripped (hdl/parse-ledger rendered))
(check "parse-ledger round-trips render-ledger's output exactly" (= after-4 roundtripped))

(check "parse-ledger on an empty (header-only) ledger returns no rows"
       (= [] (hdl/parse-ledger (hdl/render-ledger []))))

(check "parse-ledger tolerates a leading comment block with no rows at all"
       (= [] (hdl/parse-ledger "# just a comment\n# another\n")))

;; a hand-written ledger line (not our own render-ledger output) still parses,
;; proving the parser is not merely round-tripping its own exact formatting
(def hand-written
  (str "# header\n\n"
       "- parcel: BL-920\n"
       "  gate: mutation\n"
       "  file_set: x.ts,y.ts\n"
       "  reason: \"busy host\"\n"
       "  load: \"12/11/10\"\n"
       "  detected_at: 2026-08-01\n"))
(def hand-parsed (hdl/parse-ledger hand-written))
(check "a hand-written ledger row parses to the expected map"
       (= [{:parcel "BL-920" :gate "mutation" :file-set ["x.ts" "y.ts"]
            :reason "busy host" :load "12/11/10" :detected-at "2026-08-01"}]
          hand-parsed))

;; ── BL-942 architect bounce D1: reason/load survive an embedded quote ─────
(def d-quoted {:parcel "BL-999" :gate "mutation" :file-set ["a.ts"]
               :reason "blocked by the \"quiet host\" promise"
               :load "44/27/22" :detected-at "2026-08-19"})
(def quoted-rendered (hdl/render-ledger [d-quoted]))
(check "render-ledger escapes an embedded double-quote in reason (never a bare unescaped \")"
       (clojure.string/includes? quoted-rendered "\\\"quiet host\\\""))
(check "parse-ledger round-trips a reason/load containing an embedded double-quote exactly"
       (= [d-quoted] (hdl/parse-ledger quoted-rendered)))

;; a literal backslash immediately adjacent to a quote - the exact shape
;; that breaks a naive two-pass (replace \, then replace ") escaper
(def d-backslash-quote {:parcel "BL-921" :gate "CRAP" :file-set ["z.ts"]
                         :reason "path is a\\\"b" :load "1/1/1" :detected-at "2026-08-19"})
(check "a literal backslash immediately before a quote also round-trips exactly"
       (= [d-backslash-quote] (hdl/parse-ledger (hdl/render-ledger [d-backslash-quote]))))

;; ── BL-1439: discharge-debt / outstanding-debt excludes discharged rows ──

(def d-undischarged {:parcel "BL-620" :gate "mutation" :file-set ["a.ts" "b.ts"]
                     :reason "host busy" :load "14/17/16" :detected-at "2026-08-19"})
(def d-other {:parcel "BL-955" :gate "mutation" :file-set ["c.ts"]
             :reason "host busy" :load "35/35/28" :detected-at "2026-08-19"})

(let [{:keys [rows discharged?]} (hdl/discharge-debt [d-undischarged d-other]
                                                       {:parcel "BL-620" :gate "mutation"
                                                        :evidence "backlog/evidence/BL-1439-a.md"
                                                        :discharged-at "2026-09-05"})]
  (check "discharge-debt: reports discharged? true on a real match" discharged?)
  (check "discharge-debt: the row COUNT is unchanged - never deleted (invariant 1)"
         (= 2 (count rows)))
  (check "discharge-debt: the matching row gains discharged_at"
         (= "2026-09-05" (:discharged-at (first (filter #(= "BL-620" (:parcel %)) rows)))))
  (check "discharge-debt: the matching row gains discharged_evidence"
         (= "backlog/evidence/BL-1439-a.md" (:discharged-evidence (first (filter #(= "BL-620" (:parcel %)) rows)))))
  (check "discharge-debt: the OTHER row is untouched"
         (= d-other (first (filter #(= "BL-955" (:parcel %)) rows))))
  (check "outstanding-debt: the discharged row no longer contributes outstanding debt"
         (= ["BL-955"] (mapv :parcel (hdl/outstanding-debt rows))))
  (check "outstanding-debt: the row itself still round-trips through render/parse with its discharge fields"
         (let [reparsed (hdl/parse-ledger (hdl/render-ledger rows))]
           (= "2026-09-05" (:discharged-at (first (filter #(= "BL-620" (:parcel %)) reparsed)))))))

(let [{:keys [rows discharged?]} (hdl/discharge-debt [d-undischarged]
                                                       {:parcel "BL-620" :gate "mutation" :evidence ""
                                                        :discharged-at "2026-09-05"})]
  (check "discharge-debt: an empty evidence path refuses (discharged? false)" (not discharged?))
  (check "discharge-debt: a refused discharge changes nothing" (= [d-undischarged] rows)))

(let [{:keys [rows discharged?]} (hdl/discharge-debt [d-undischarged]
                                                       {:parcel "BL-999-no-such-row" :gate "mutation"
                                                        :evidence "backlog/evidence/x.md"
                                                        :discharged-at "2026-09-05"})]
  (check "discharge-debt: naming no matching row refuses (discharged? false)" (not discharged?))
  (check "discharge-debt: a refused discharge (no match) changes nothing" (= [d-undischarged] rows)))

;; ── BL-1439 amendment: record-attempt never discharges (invariant 3) ─────

(let [{:keys [rows recorded?]} (hdl/record-attempt [d-undischarged d-other]
                                                     {:parcel "BL-620" :gate "mutation"
                                                      :blocker "cooldown gate skip-cooldown, file_age_days 0.12"
                                                      :attempted-at "2026-09-06"})
      matched (first (filter #(= "BL-620" (:parcel %)) rows))]
  (check "record-attempt: reports recorded? true on a real match" recorded?)
  (check "record-attempt: the row COUNT is unchanged" (= 2 (count rows)))
  (check "record-attempt: the matching row gains attempted_at" (= "2026-09-06" (:attempted-at matched)))
  (check "record-attempt: the matching row gains attempted_blocker"
         (= "cooldown gate skip-cooldown, file_age_days 0.12" (:attempted-blocker matched)))
  (check "record-attempt: the row is NOT discharged (invariant 3 - never discharged by assertion)"
         (nil? (:discharged-at matched)))
  (check "record-attempt: outstanding-debt STILL reports the attempted row (an attempt is not a discharge)"
         (= #{"BL-620" "BL-955"} (set (map :parcel (hdl/outstanding-debt rows)))))
  (check "record-attempt: the row round-trips its attempt fields through render/parse"
         (let [reparsed (hdl/parse-ledger (hdl/render-ledger rows))
               reparsed-match (first (filter #(= "BL-620" (:parcel %)) reparsed))]
           (and (= "2026-09-06" (:attempted-at reparsed-match))
                (= "cooldown gate skip-cooldown, file_age_days 0.12" (:attempted-blocker reparsed-match))))))

(let [{:keys [rows recorded?]} (hdl/record-attempt [d-undischarged] {:parcel "BL-620" :gate "mutation" :blocker ""
                                                                       :attempted-at "2026-09-06"})]
  (check "record-attempt: an empty blocker refuses (recorded? false)" (not recorded?))
  (check "record-attempt: a refused attempt changes nothing" (= [d-undischarged] rows)))

(let [{:keys [rows recorded?]} (hdl/record-attempt [d-undischarged]
                                                     {:parcel "BL-999-no-such-row" :gate "mutation"
                                                      :blocker "some reason" :attempted-at "2026-09-06"})]
  (check "record-attempt: naming no matching row refuses (recorded? false)" (not recorded?))
  (check "record-attempt: a refused attempt (no match) changes nothing" (= [d-undischarged] rows)))

(when (seq @failures)
  (binding [*out* *err*]
    (doseq [f @failures] (println f)))
  (println (str "\n" (count @failures) " failure(s)"))
  (System/exit 1))

(println "hardening_debt_ledger_lib_test_runner: ok")
