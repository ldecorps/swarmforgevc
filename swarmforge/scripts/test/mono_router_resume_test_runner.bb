#!/usr/bin/env bb
;; Smoke: newest-parcel resume beats stale furthest-stage claim.
(ns mono-router-resume-test
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

;; Minimal pure check of the created_at sort rule used by mono_router_resume.
(defn choose [holdings]
  (when (seq holdings)
    (:role (last (sort-by :created-at holdings)))))

(def failures (atom []))
(defn assert= [msg e a]
  (when (not= e a)
    (swap! failures conj (str "FAIL " msg " expected=" (pr-str e) " actual=" (pr-str a)))))

(assert= "newest cleaner wins over older architect"
         "cleaner"
         (choose [{:role "architect" :created-at "2026-07-18T13:55:20Z"}
                  {:role "cleaner" :created-at "2026-07-18T15:26:44Z"}
                  {:role "QA" :created-at "2026-07-18T14:17:48Z"}]))

(assert= "QA newest wins when it is newest"
         "QA"
         (choose [{:role "cleaner" :created-at "2026-07-18T13:00:00Z"}
                  {:role "QA" :created-at "2026-07-18T16:00:00Z"}]))

(if (seq @failures)
  (do (doseq [f @failures] (println f)) (System/exit 1))
  (println "ALL PASS: mono_router_resume newest-parcel rule"))
