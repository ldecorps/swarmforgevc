#!/usr/bin/env bb
;; BL-668 acceptance seam: drives post_qa_branch_sweep_lib.bb/sweep! with
;; injected role facts and a fake fast-forward adapter (no real git).
;;
;; Usage: post_qa_branch_sweep_cli.bb <daemon-dir> <landed-sha> <roles-json> <facts-json>
;; roles-json: ["coder","cleaner",...]
;; facts-json: {"coder":{"head-sha":"...","dirty?":false,...}}

(ns post-qa-branch-sweep-cli
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "post_qa_branch_sweep_lib.bb")))

(defn- parse-role-facts [raw]
  (into {}
        (map (fn [[role f]]
               [(str role)
                {:head-sha (get f "head-sha")
                 :dirty? (get f "dirty?")
                 :in-process? (get f "in-process?")
                 :can-ff? (get f "can-ff?")
                 :contains-landed? (get f "contains-landed?")}])
             (or (json/parse-string raw false) {}))))

(def daemon-dir (nth *command-line-args* 0))
(def landed-sha (nth *command-line-args* 1))
(def roles (mapv str (json/parse-string (nth *command-line-args* 2) true)))
(def facts-map (parse-role-facts (nth *command-line-args* 3)))

(def settle-calls (atom 0))
(def ff-only (atom true))
(def log-lines (atom []))

(def adapters
  {:role-facts! #(get facts-map %)
   :fast-forward! (fn [_ facts]
                    (swap! settle-calls inc)
                    (when-not @ff-only (throw (ex-info "non-ff operation" {})))
                    {:success true :head-sha (:head-sha facts)})
   :log! (fn [& parts] (swap! log-lines conj (str/join " " parts)))})

(def result (post-qa-branch-sweep-lib/sweep! daemon-dir landed-sha roles adapters))

(println (json/generate-string
          {:state (:state result)
           :actions (:actions result)
           :settleCalls @settle-calls
           :logLines @log-lines
           :ffOnly @ff-only}))
