#!/usr/bin/env bb
;; BL-1758: installs a launchable starter kit into a greenfield target
;; (one that has no swarmforge/ tree at all) FROM THIS checkout - its
;; own engine (swarmforge/scripts), git-hooks, handoff protocol, generic
;; constitution articles, the mono-router pack and a generic role-prompt
;; set (swarmforge/starter-kit/roles/) - so the engine and the pack a
;; target receives always come from the same place and always agree
;; (ruling A, BL-1758). Never touches a target that already holds a
;; swarmforge/ tree: refuses first, before copying anything.
;;
;; What it never copies (a target's own concern, never this project's):
;; project.prompt, engineering.prompt, local-engineering.prompt, the
;; constitution/articles/reference/ directory, or this checkout's own
;; swarmforge/roles/*.prompt.
;;
;; Usage: install_starter_kit.bb <target-path> <swarm-name>
(ns install-starter-kit
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(def this-file (fs/canonicalize *file*))
(def scripts-dir (fs/parent this-file))
;; this-file lives at <checkout>/swarmforge/scripts/install_starter_kit.bb
(def checkout-root (fs/parent (fs/parent scripts-dir)))

;; The generic constitution articles a fresh target gets - never
;; engineering.prompt/local-engineering.prompt/project.prompt (this
;; checkout's own operational prose) or reference/ (its incident history).
(def generic-articles
  ["01_roles.md" "02_handoffs.md" "03_backlog.md" "04_quality_gates.md" "05_amendments.md" "workflow.prompt"])

(defn- checkout-commit []
  (let [{:keys [exit out]} (process/sh ["git" "-C" (str checkout-root) "rev-parse" "HEAD"])]
    (if (zero? exit) (str/trim out) "unknown")))

(defn- copy-tree! [from to]
  (fs/create-dirs to)
  (doseq [f (fs/glob from "**") :when (fs/regular-file? f)]
    (let [rel (fs/relativize from f)
          dest (fs/path to rel)]
      (fs/create-dirs (fs/parent dest))
      (fs/copy f dest {:replace-existing true}))))

(defn refused-existing-tree? [target-sf]
  (fs/exists? target-sf))

(defn install!
  "Returns {:ok true :target-sf <path>} on success, or
   {:ok false :reason <string>} - never touches the target on refusal."
  [target swarm-name]
  (let [target (fs/canonicalize target)
        target-sf (fs/path target "swarmforge")]
    (if (refused-existing-tree? target-sf)
      {:ok false :reason (str "install_starter_kit.bb refused: " target-sf
                              " already exists - the target already has a swarmforge tree")}
      (do
        (copy-tree! (fs/path checkout-root "swarmforge" "scripts") (fs/path target-sf "scripts"))
        (copy-tree! (fs/path checkout-root "swarmforge" "git-hooks") (fs/path target-sf "git-hooks"))
        (fs/copy (fs/path checkout-root "swarmforge" "handoff-protocol.md") (fs/path target-sf "handoff-protocol.md"))
        (fs/copy (fs/path checkout-root "swarmforge" "constitution.prompt") (fs/path target-sf "constitution.prompt"))
        (fs/create-dirs (fs/path target-sf "constitution" "articles"))
        (doseq [f generic-articles]
          (fs/copy (fs/path checkout-root "swarmforge" "constitution" "articles" f)
                   (fs/path target-sf "constitution" "articles" f)))
        (fs/create-dirs (fs/path target-sf "packs"))
        (doseq [f ["mono-router.conf" "mono-router.prompt"]]
          (fs/copy (fs/path checkout-root "swarmforge" "packs" f)
                   (fs/path target-sf "packs" f)))
        (copy-tree! (fs/path checkout-root "swarmforge" "starter-kit" "roles") (fs/path target-sf "roles"))
        (spit (str (fs/path target-sf "swarmforge.conf"))
              (str "# Installed by install_starter_kit.bb from " checkout-root
                   " at commit " (checkout-commit) "\n"
                   "config tooling_root " checkout-root "\n"
                   "config swarm_name " swarm-name "\n"))
        {:ok true :target-sf (str target-sf)}))))

(defn cli-args []
  (let [raw (vec *command-line-args*)]
    (if (and (seq raw) (str/ends-with? (first raw) ".bb"))
      (subvec raw 1)
      raw)))

(let [args (cli-args)]
  (when (< (count args) 2)
    (binding [*out* *err*] (println "Usage: install_starter_kit.bb <target-path> <swarm-name>"))
    (System/exit 2))
  (let [{:keys [ok reason target-sf]} (install! (first args) (second args))]
    (if ok
      (println (str "installed starter kit into " target-sf))
      (do (binding [*out* *err*] (println reason))
          (System/exit 1)))))
