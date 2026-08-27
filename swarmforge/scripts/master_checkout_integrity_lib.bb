;; BL-1123: guard the master checkout against core.bare=true and collapsed
;; (tiny-tree) tips. Heal bare when possible; refuse tip moves below a floor.
;;
;;   (load-file ".../master_checkout_integrity_lib.bb")
;;   master-checkout-integrity-lib/foo

(ns master-checkout-integrity-lib
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "daemon_cycle_guard_lib.bb")))

;; Production repos have thousands of paths; fixtures use a low injectable floor.
(def default-tip-floor 500)

(defn tip-floor-verdict
  "Pure: :allowed when count >= floor, else :refused."
  [file-count floor]
  (if (>= (or file-count 0) (or floor default-tip-floor))
    :allowed
    :refused))

(defn evaluate-tip-move
  "Pure alias of tip-floor-verdict for tip-move call sites."
  [candidate-count floor]
  (tip-floor-verdict candidate-count floor))

(defn- sh [project-root args]
  (try
    (let [res (daemon-cycle-guard-lib/sh! (into ["git" "-C" (str project-root)] args))]
      {:ok? (zero? (:exit res)) :out (str/trim (or (:out res) "")) :err (str/trim (or (:err res) ""))})
    (catch Exception e
      {:ok? false :out "" :err (.getMessage e)})))

(defn read-core-bare
  "Returns true/false/nil (nil = could not read)."
  [project-root]
  (let [r (sh project-root ["config" "--bool" "core.bare"])]
    (when (:ok? r)
      (= "true" (str/lower-case (:out r))))))

(defn inside-work-tree?
  [project-root]
  (let [r (sh project-root ["rev-parse" "--is-inside-work-tree"])]
    (and (:ok? r) (= "true" (:out r)))))

(defn set-core-bare!
  [project-root value]
  (sh project-root ["config" "core.bare" (if value "true" "false")]))

(defn tree-file-count
  "Count blobs reachable from rev's tree (git ls-tree -r --name-only)."
  [project-root rev]
  (let [r (sh project-root ["ls-tree" "-r" "--name-only" (str rev)])]
    (if-not (:ok? r)
      nil
      (->> (str/split-lines (:out r))
           (remove str/blank?)
           count))))

(defn heal-bare-if-needed!
  "If core.bare is true, set false. Returns {:bare-was? :healed? :alarm? :inside?}."
  [{:keys [project-root emit-alarm! heal?]
    :or {heal? true}}]
  (let [bare? (read-core-bare project-root)]
    (cond
      (nil? bare?)
      (do (when emit-alarm! (emit-alarm! "MASTER CHECKOUT BARE GUARD: could not read core.bare"))
          {:bare-was? nil :healed? false :alarm? true :inside? (inside-work-tree? project-root)})

      (not bare?)
      {:bare-was? false :healed? false :alarm? false :inside? (inside-work-tree? project-root)}

      heal?
      (do (set-core-bare! project-root false)
          (let [inside (inside-work-tree? project-root)]
            (when (and emit-alarm! (not inside))
              (emit-alarm! "MASTER CHECKOUT BARE GUARD: core.bare was true; heal left work-tree unusable"))
            {:bare-was? true :healed? true :alarm? (not inside) :inside? inside}))

      :else
      (do (when emit-alarm!
            (emit-alarm! "MASTER CHECKOUT BARE-CHECKOUT ALARM: core.bare=true"))
          {:bare-was? true :healed? false :alarm? true :inside? false}))))

(defn check-tip-floor!
  "Evaluate candidate tip against floor. Returns {:verdict :count :floor}."
  [{:keys [project-root candidate-rev tip-floor]
    :or {tip-floor default-tip-floor
         candidate-rev "HEAD"}}]
  (let [n (tree-file-count project-root candidate-rev)
        verdict (if (nil? n) :refused (tip-floor-verdict n tip-floor))]
    {:verdict verdict :count n :floor tip-floor}))

(defn run-master-checkout-integrity!
  "Bare heal + tip-floor check for HEAD. Emits alarms via emit-alarm!."
  [{:keys [project-root emit-alarm! tip-floor heal?]
    :or {tip-floor default-tip-floor heal? true}}]
  (let [bare (heal-bare-if-needed! {:project-root project-root
                                    :emit-alarm! emit-alarm!
                                    :heal? heal?})
        tip (check-tip-floor! {:project-root project-root
                               :candidate-rev "HEAD"
                               :tip-floor tip-floor})]
    (when (and emit-alarm! (= :refused (:verdict tip)))
      (emit-alarm! (str "MASTER CHECKOUT TIP-FLOOR ALARM: HEAD tree has "
                        (:count tip) " paths; floor is " (:floor tip))))
    {:bare bare :tip tip}))
