#!/usr/bin/env bb
;; BL-1181: BoB starting cast — steward cherry-pick export + ModelFactory apply.
;; BL-1337: the same machinery, driven by a NAMED PROFILE and gated on a
;; handshake. Two holes this closes, both named in the ticket:
;;
;;   1. The policy was hard-coded — the entry point was literally
;;      `export-bob-starting-cast`, so "same machinery, different profile" had
;;      no way to be said.
;;   2. Nothing handshaked. `assignment-eligible?` answers a REGISTRY question;
;;      whether the chosen model is reachable on THIS HOST is a different
;;      question nobody asked, and the live cast's own note records a human
;;      doing that reasoning by hand ("not pure steward top-pick").
;;
;; The profile constrains the SAME cherry-pick and the handshake gates the SAME
;; apply path — no second generator, no second door (ticket constraints).
;; Reachability arrives as an INJECTED predicate, so this lib reads no keys and
;; nothing it returns can carry credential material.
(ns bob-starting-cast-lib
  (:require [clojure.string :as str]))

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

(def handshake-bars #{"registry-and-host" "registry-only"})

(defn parse-profile
  "A steward-owned profile (JSON under .swarmforge/model-steward/profiles/) ->
   the map the generator reads. Refuses rather than defaulting: a profile with
   no name, no roles, or an unrecognised handshake bar is a mistake, and
   quietly weakening the bar is the failure this ticket exists to prevent."
  [raw]
  (let [get* (fn [k] (or (get raw k) (get raw (keyword k))))
        name* (get* "name")
        roles (vec (or (get* "roles") []))
        handshake (or (get* "handshake") "registry-and-host")]
    (when (str/blank? (str name*))
      (throw (ex-info "profile has no name" {:profile raw})))
    (when (empty? roles)
      (throw (ex-info "profile names no roles" {:profile name*})))
    (when-not (contains? handshake-bars handshake)
      (throw (ex-info (str "unknown handshake bar: " handshake) {:profile name* :handshake handshake})))
    {:name (str name*)
     :roles roles
     :quality-floor (double (or (get* "quality_floor") (get* "quality-floor") 0))
     :providers (vec (or (get* "providers") []))
     :handshake handshake}))

;; One candidate, one verdict. The ORDER matters only for what gets recorded:
;; every rejected candidate keeps the reason it lost, so the evidence note can
;; say why a seat is staffed by its second choice rather than its first.
(defn- candidate-verdict
  [registry role {:keys [provider model score]} {:keys [quality-floor providers handshake]} reachable?]
  (cond
    (and (seq providers) (not (some #{provider} providers))) :provider-not-allowed
    (< (double (or score 0)) (double (or quality-floor 0))) :below-quality-floor
    (not (model-steward-lib/assignment-eligible? registry provider model)) :not-assignment-eligible
    (and (= handshake "registry-and-host") (not (reachable? provider model))) :unreachable
    :else :accepted))

(defn handshake-role
  "Walks the role's ranked recommendations in order and returns
   {:entry <cast entry or nil> :trail [{:provider :model :verdict}...]}.

   `include-uncertified?` is deliberately true here: an uncertified model must
   be SEEN and rejected as :not-assignment-eligible, so the trail can say the
   seat's top pick failed the registry bar rather than silently pretending it
   was never ranked."
  [registry role profile {:keys [reachable?]}]
  (let [candidates (model-steward-lib/role-recommendations registry role {:include-uncertified? true})
        reachable? (or reachable? (constantly true))]
    (loop [remaining candidates trail []]
      (if (empty? remaining)
        {:entry nil :trail trail}
        (let [{:keys [provider model score evidence] :as candidate} (first remaining)
              verdict (candidate-verdict registry role candidate profile reachable?)
              trail (conj trail {:provider provider :model model :score score :verdict verdict})]
          (if (= verdict :accepted)
            {:entry {:role role
                     :agent (model-factory-lib/require-launch-agent! role provider model)
                     :provider provider
                     :model model
                     :policy (:name profile)
                     :reason (str "profile " (:name profile) ": handshaken pick (score=" score
                                  ", bar=" (:handshake profile) ")")
                     :evidence evidence}
             :trail trail}
            (recur (rest remaining) trail)))))))

(defn generate-cast-from-profile
  "The profile-driven generator. Returns the cast plus the two things the
   ticket's invariants are about: whether it is RUNNABLE (every seat handshook)
   and, when it is not, WHICH seats could not be staffed. A seat nothing could
   staff produces no cast entry at all - a cast that omitted or substituted
   silently would be a cast that lies about availability."
  [registry profile & [{:keys [reachable?]}]]
  (let [profile (if (:roles profile) profile (parse-profile profile))
        per-role (into {} (map (fn [role] [role (handshake-role registry role profile {:reachable? reachable?})])
                               (:roles profile)))
        staffed (into {} (keep (fn [[role {:keys [entry]}]] (when entry [role entry])) per-role))
        unstaffable (vec (sort (keep (fn [[role {:keys [entry]}]] (when-not entry role)) per-role)))]
    {:profile profile
     :cast {:kind cast-kind
            :schema-version cast-schema-version
            :policy (:name profile)
            :roles staffed}
     :handshakes (into {} (map (fn [[role {:keys [trail]}]] [role trail]) per-role))
     :unstaffable unstaffable
     :runnable? (empty? unstaffable)}))

(defn generation-failure-text
  "Loud, and by seat name: what a caller prints when the cast is not runnable."
  [{:keys [profile unstaffable handshakes]}]
  (str "profile " (:name profile) ": cannot staff "
       (str/join ", " unstaffable)
       " — no ranked model passed the handshake (bar=" (:handshake profile) "). "
       (str/join "; "
                 (map (fn [role]
                        (str role ": "
                             (if-let [trail (seq (get handshakes role))]
                               (str/join ", " (map (fn [{:keys [provider model verdict]}]
                                                     (str provider "/" model " " (name verdict)))
                                                   trail))
                               "no ranked candidates")))
                      unstaffable))))

(defn evidence-note-text
  "The note that travels with a generated cast: the profile, and every seat's
   handshake result including the candidates that lost and why. Carries model
   and provider NAMES only - never a key, a token or an endpoint credential
   (invariant 3), because the reachability answer arrives as a boolean from an
   injected predicate and no secret ever enters this lib."
  [{:keys [profile handshakes unstaffable runnable?]}]
  (str/join
   "\n"
   (concat
    [(str "profile: " (:name profile))
     (str "handshake bar: " (:handshake profile)
          (when (= "registry-only" (:handshake profile))
            "  (WEAKER BAR: registry eligibility only, no host reachability probe was run)"))
     (str "quality floor: " (:quality-floor profile))
     (str "runnable: " (boolean runnable?))]
    (when (seq unstaffable) [(str "unstaffable seats: " (str/join ", " unstaffable))])
    ["seats:"]
    (map (fn [role]
           (str "  " role ": "
                (str/join ", " (map (fn [{:keys [provider model score verdict]}]
                                      (str provider "/" model " score=" score " -> " (name verdict)))
                                    (get handshakes role)))))
         (sort (keys handshakes))))))

(defn apply-via-modelfactory-overlay
  "BL-1181's apply path, now GATED (BL-1337 required_wiring): when a generation
   result is supplied, a cast that is not runnable is REFUSED here rather than
   installed. The one-argument arity is BL-1181's own call site, unchanged -
   an ungated apply of an already-built cast still works exactly as before."
  ([cast]
   {:via "model-factory-overlay"
    :assignment (cast-to-assignment-overlay cast)
    :path-kind "model-factory-assignment-overlay"})
  ([cast {:keys [runnable? unstaffable] :as generation}]
   (when-not runnable?
     (throw (ex-info (str "refusing to apply a cast that is not runnable: "
                          (str/join ", " unstaffable) " did not handshake")
                     {:unstaffable unstaffable})))
   (assoc (apply-via-modelfactory-overlay cast)
          :profile (get-in generation [:profile :name])
          :handshake (get-in generation [:profile :handshake]))))

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
