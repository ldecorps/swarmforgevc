#!/usr/bin/env bb
;; BL-1327: the scheduled descent review. Reads each seat's ladder position and
;; guard window, asks descent_ladder_lib for a decision, and writes a DURABLE
;; PROPOSAL RECORD for a human to apply by hand.
;;
;; Proposal-only, by the human's 2026-09-02 ruling. This CLI has no code path
;; that edits a pack conf, a launch settings file, or a live seat - the record
;; it writes is the whole output. That is enforced by what is absent here, and
;; by BL-1327's own acceptance scenario 01, which asserts no seat's live model
;; or effort changed as a result of a review.
;;
;; Usage:
;;   descent_review_cli.bb review <project-root>   - run the review, write proposals
;;   descent_review_cli.bb list <project-root>     - print the standing proposals

(ns descent-review-cli
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def script-dir (fs/parent (fs/canonicalize *file*)))
(load-file (str (fs/path script-dir "descent_ladder_lib.bb")))

(defn- usage []
  (println "Usage: descent_review_cli.bb <review|list> <project-root>")
  (System/exit 2))

(defn proposals-path [root]
  (str (fs/path root ".swarmforge" "descent-ladder" "proposals.json")))

(defn ladder-state-path [root]
  (str (fs/path root ".swarmforge" "descent-ladder" "state.json")))

(defn- read-json [path fallback]
  (try
    (if (fs/exists? path) (or (json/parse-string (slurp path) true) fallback) fallback)
    (catch Exception _ fallback)))

(defn- write-json! [path value]
  (fs/create-dirs (fs/parent path))
  (spit path (json/generate-string value {:pretty true})))

(defn seats-from-state
  "The seats the review knows about, and their ladder positions. State is a map
   of seat -> {:effort :model :clean-periods :guard-tripped? :last-known-good}.
   A review over an empty state proposes nothing and says so, rather than
   inventing seats."
  [state]
  (map (fn [[seat s]] (assoc s :seat (name seat))) state))

(defn review
  "The pure half of the review: state + config in, proposals out. Kept separate
   from the IO below so the whole decision is testable without a filesystem."
  [{:keys [state model-ladder required-clean-periods price-window-shifted-models]}]
  (let [shifted (set (or price-window-shifted-models []))]
    (->> (seats-from-state state)
         (map (fn [{:keys [seat effort model clean-periods guard-tripped? ] :as s}]
                (let [decision (descent-ladder-lib/descent-decision
                                {:seat seat
                                 :current-effort effort
                                 :current-model model
                                 :model-ladder (or (:model-ladder s) model-ladder)
                                 :clean-periods clean-periods
                                 :required-clean-periods required-clean-periods
                                 :guard-tripped? guard-tripped?
                                 :price-window-shifted? (contains? shifted model)})]
                  (assoc decision :seat seat))))
         vec)))

(defn- run-review! [root]
  (let [state (read-json (ladder-state-path root) {})
        conf (read-json (str (fs/path root ".swarmforge" "descent-ladder" "config.json")) {})
        results (review {:state state
                         :model-ladder (:model_ladder conf)
                         :required-clean-periods (:required_clean_periods conf)
                         :price-window-shifted-models (:price_window_shifted_models conf)})
        proposals (->> results (filter :propose?) (map :proposal) vec)]
    (write-json! (proposals-path root)
                 {:generated_at (str (java.time.Instant/now))
                  :applied false
                  :note "PROPOSAL ONLY - a human applies these by hand (BL-1327 slice 1)"
                  :proposals proposals})
    (doseq [{:keys [seat propose? reason proposal]} results]
      (if propose?
        (println (str "PROPOSE " seat " -> " (:effort proposal) " on " (:model proposal)
                      " (" (:reason proposal) ")"))
        (println (str "HOLD " seat " - " reason))))
    (when (empty? results)
      (println "HOLD (no seats): descent-ladder state is empty, nothing to review"))
    (println (str "proposals written: " (proposals-path root)))))

(defn- list-proposals [root]
  (let [record (read-json (proposals-path root) nil)]
    (if-not record
      (println "no standing descent proposals")
      (doseq [p (:proposals record)]
        (println (str (:seat p) " -> " (:effort p) " on " (:model p) " :: " (:reason p)))))))

(defn -main [& args]
  (let [[cmd root] args]
    (when (or (str/blank? (str cmd)) (str/blank? (str root))) (usage))
    (case cmd
      "review" (run-review! root)
      "list" (list-proposals root)
      (usage))))

(when (= *file* (System/getProperty "babashka.file"))
  (apply -main *command-line-args*))
