#!/usr/bin/env bb
;; BL-1123 unit tests

(require '[babashka.fs :as fs]
         '[babashka.process :as process]
         '[clojure.string :as str])

(def script-dir (fs/parent (fs/canonicalize *file*)))
(load-file (str (fs/path script-dir ".." "master_checkout_integrity_lib.bb")))

(def failures (atom []))

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))
(defn- assert= [msg e a]
  (when (not= e a) (swap! failures conj (str "FAIL " msg " e=" (pr-str e) " a=" (pr-str a)))))
(defn- assert-true [msg p]
  (when-not p (swap! failures conj (str "FAIL " msg))))

(assert= "tip-floor: below refused" :refused
         (master-checkout-integrity-lib/tip-floor-verdict 3 10))
(assert= "tip-floor: at floor allowed" :allowed
         (master-checkout-integrity-lib/tip-floor-verdict 10 10))
(assert= "tip-floor: above allowed" :allowed
         (master-checkout-integrity-lib/tip-floor-verdict 50 10))
(assert= "tip-floor: nil floor uses default (tiny count refused)"
         :refused
         (master-checkout-integrity-lib/tip-floor-verdict 2 nil))
(assert= "evaluate-tip-move refuses tiny"
         :refused (master-checkout-integrity-lib/evaluate-tip-move 2 10))
(assert= "evaluate-tip-move allows full"
         :allowed (master-checkout-integrity-lib/evaluate-tip-move 20 10))

(defn- sh [dir & args]
  (apply process/sh {:dir (str dir)} args))

(defn- mk-repo []
  (let [dir (str (fs/create-temp-dir {:prefix "bl1123-"}))]
    (swap! created-temp-dirs conj dir)
    (sh dir "git" "init" "-q")
    (sh dir "git" "symbolic-ref" "HEAD" "refs/heads/main")
    (sh dir "git" "config" "user.email" "t@t")
    (sh dir "git" "config" "user.name" "t")
    dir))

(let [dir (mk-repo)
      _ (doseq [i (range 15)]
          (fs/write-bytes (fs/path dir (str "f" i ".txt")) (.getBytes (str i "\n"))))
      _ (sh dir "git" "add" ".")
      _ (sh dir "git" "commit" "-q" "-m" "full")
      alarms (atom [])
      _ (sh dir "git" "config" "core.bare" "true")
      result (master-checkout-integrity-lib/heal-bare-if-needed!
              {:project-root dir
               :heal? true
               :emit-alarm! (fn [t] (swap! alarms conj t))})]
  (assert-true "bare was true" (true? (:bare-was? result)))
  (assert-true "healed" (:healed? result))
  (assert-true "inside work tree after heal" (:inside? result))
  (assert= "config bare false" "false"
           (str/trim (:out (sh dir "git" "config" "--bool" "core.bare")))))

(let [dir (mk-repo)
      _ (doseq [i (range 12)]
          (fs/write-bytes (fs/path dir (str "g" i ".txt")) (.getBytes "x\n")))
      _ (sh dir "git" "add" ".")
      _ (sh dir "git" "commit" "-q" "-m" "full")
      full (master-checkout-integrity-lib/check-tip-floor!
            {:project-root dir :candidate-rev "HEAD" :tip-floor 10})]
  (assert= "full tip allowed" :allowed (:verdict full))
  (assert-true "full count >= 10" (>= (:count full) 10)))

(let [dir (mk-repo)
      _ (fs/write-bytes (fs/path dir "solo.txt") (.getBytes "1\n"))
      _ (sh dir "git" "add" ".")
      _ (sh dir "git" "commit" "-q" "-m" "tiny")
      tip (master-checkout-integrity-lib/check-tip-floor!
           {:project-root dir :candidate-rev "HEAD" :tip-floor 10})]
  (assert= "tiny tip refused" :refused (:verdict tip))
  (assert-true "tiny count < 10" (< (:count tip) 10)))

(let [dir (mk-repo)
      tip (master-checkout-integrity-lib/check-tip-floor!
           {:project-root dir :candidate-rev "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef" :tip-floor 10})]
  (assert= "missing rev count is nil" nil (:count tip))
  (assert= "missing rev refused" :refused (:verdict tip)))

(if (empty? @failures)
  (println "master_checkout_integrity_lib (BL-1123): ALL TESTS PASSED")
  (do (println (str (count @failures) " FAILURE(S):"))
      (doseq [f @failures] (println f))
      (System/exit 1)))
