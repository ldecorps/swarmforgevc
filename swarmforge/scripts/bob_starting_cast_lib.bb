#!/usr/bin/env bb
;; BL-1181: BoB starting cast — steward cherry-pick export + ModelFactory apply.
(ns bob-starting-cast-lib)

(load-file (str (babashka.fs/path (babashka.fs/parent (babashka.fs/canonicalize *file*))
                                  "model_steward_lib.bb")))
(load-file (str (babashka.fs/path (babashka.fs/parent (babashka.fs/canonicalize *file*))
                                  "model_factory_lib.bb")))

(def cast-kind "bob-starting-cast")
(def cast-schema-version 1)

(defn top-certified-recommendation [registry role]
  (first (model-steward-lib/role-recommendations registry role {:include-uncertified? false})))

(defn cherry-pick-role-entry [registry role]
  (when-let [{:keys [provider model score evidence]} (top-certified-recommendation registry role)]
    (let [agent (model-factory-lib/require-launch-agent! role provider model)]
      {:role role
       :agent agent
       :provider provider
       :model model
       :policy "bob-starting-cast"
       :reason (str "bob: steward cherry-pick top certified recommendation (score=" score ")")
       :evidence evidence})))

(defn export-bob-starting-cast [registry roles]
  {:kind cast-kind
   :schema-version cast-schema-version
   :roles (into {}
                (keep (fn [role]
                        (when-let [entry (cherry-pick-role-entry registry role)]
                          [role entry]))
                      roles))})

(defn cast-to-assignment-overlay [cast]
  (into {} (map (fn [[role entry]] [(keyword role) entry]) (:roles cast))))

(defn distinct-providers [cast]
  (->> (vals (:roles cast)) (map :provider) distinct vec))

(defn apply-via-modelfactory-overlay [cast]
  {:via "model-factory-overlay"
   :assignment (cast-to-assignment-overlay cast)
   :path-kind "model-factory-assignment-overlay"})

(defn role-model [entry]
  (when entry (:model entry)))

(defn roles-with-model-change [cast current-overlay]
  (vec
   (keep (fn [[role entry]]
           (let [role-k (keyword role)
                 cur (or (get current-overlay role-k) (get current-overlay role))
                 nxt (:model entry)]
             (when (and nxt (not= (role-model cur) nxt))
               (name role-k))))
         (:roles cast))))
