#!/usr/bin/env bb
;; Drift matrix: out-of-band commits on main since BASELINE touching
;; extension/ or swarmforge/scripts, mapped to the specs/features/ and docs/
;; artifacts they implicate. Read-only over git; writes one markdown report.
(ns drift-matrix
  (:require [babashka.process :as p]
            [clojure.string :as str]))

(def baseline "2026-07-15")
(def repo "/home/carillon/swarmforgevc")
(def out-file (first *command-line-args*))

(defn sh [& args]
  (let [r (apply p/sh {:dir repo} args)]
    (when-not (zero? (:exit r))
      (throw (ex-info (str "cmd failed: " (str/join " " args)) {:err (:err r)})))
    (:out r)))

(def role-trailer-re
  #"(?im)^By (coder|cleaner|architect|hardener|hardender|documenter|qa|specifier|coordinator)\b")

(defn classify [body author subject]
  (cond
    (re-find role-trailer-re body) :swarm
    ;; Swarm branch plumbing: merges/reverts between role worktrees and main.
    (re-find #"(?i)^(Revert \")?Merge (commit|branch|coder|cleaner|architect|hardener|QA|documenter|specifier)" subject) :swarm-plumbing
    (re-find #"(?i)co-authored-by: cursor" body) :oob-cursor
    (re-find #"(?i)claude-session:" body) :oob-session
    (re-find #"(?i)laurent" author) :oob-human
    :else :oob-unattributed))

(def commits
  (->> (sh "git" "log" (str "--since=" baseline) "--format=%H|%h|%an|%s"
           "--" "extension/" "swarmforge/scripts/")
       str/split-lines
       (remove str/blank?)
       (mapv (fn [line]
               (let [[full short author & subj] (str/split line #"\|")]
                 {:full full :short short :author author
                  :subject (str/join "|" subj)})))))

(defn commit-files [full]
  (->> (sh "git" "show" "--name-only" "--format=" full "--"
           "extension/src" "extension/test" "swarmforge/scripts")
       str/split-lines
       (remove str/blank?)
       vec))

(def enriched
  (->> commits
       (mapv (fn [{:keys [full author subject] :as c}]
               (let [body (sh "git" "show" "-s" "--format=%B" full)]
                 (assoc c
                        :class (classify body author subject)
                        :files (commit-files full)))))))

(def oob (filterv #(not (#{:swarm :swarm-plumbing} (:class %))) enriched))

;; ── file → spec/doc mapping ──────────────────────────────────────────────────
(defn stem [path]
  (-> path (str/split #"/") last
      (str/replace #"\.(ts|js|bb|sh|mjs)$" "")))

(defn grep-l [pattern dir]
  (let [r (p/sh {:dir repo} "grep" "-rli" "--include=*.feature" "--include=*.md"
                pattern dir)]
    (if (zero? (:exit r))
      (->> (:out r) str/split-lines (remove str/blank?) vec)
      [])))

(def src-files
  (->> oob (mapcat :files)
       (filter #(re-find #"^(extension/src|swarmforge/scripts)" %))
       (remove #(re-find #"test" %))
       distinct sort vec))

(def generic-hit-cap 20)

(def file->refs
  (into {}
        (for [f src-files
              :let [s (stem f)
                    feats (grep-l s "specs/features")
                    docs (grep-l s "docs")
                    generic? (> (+ (count feats) (count docs)) generic-hit-cap)]]
          [f (if generic?
               {:features [(str "(generic stem \"" s "\" — " (count feats)
                                " feature / " (count docs) " doc hits; map manually)")]
                :docs []
                :generic? true}
               {:features feats :docs docs})])))

;; ── rollups ──────────────────────────────────────────────────────────────────
(def by-class (frequencies (map :class enriched)))

(def file-rollup
  (->> src-files
       (mapv (fn [f]
               (let [cs (filterv #(some #{f} (:files %)) oob)]
                 {:file f
                  :oob-commits (count cs)
                  :classes (distinct (map :class cs))
                  :features (get-in file->refs [f :features])
                  :docs (get-in file->refs [f :docs])
                  :specless? (and (not (get-in file->refs [f :generic?]))
                                  (empty? (get-in file->refs [f :features]))
                                  (empty? (get-in file->refs [f :docs])))})))
       (sort-by (comp - :oob-commits))))

;; ── report ───────────────────────────────────────────────────────────────────
(defn md-list [xs] (if (seq xs) (str/join "<br>" xs) "—"))

(def report
  (with-out-str
    (println "# Spec/doc drift matrix —" baseline "→ 2026-07-23")
    (println)
    (println "Out-of-band = no `By <role>` swarm trailer. Classes: cursor / session (direct Claude Code) / human (Laurent) / unattributed.")
    (println)
    (println "## Summary")
    (println)
    (println "| class | commits |")
    (println "|---|---|")
    (doseq [[k v] (sort-by (comp str key) by-class)]
      (println "|" (name k) "|" v "|"))
    (println)
    (println "## Source files touched out-of-band (most-churned first)")
    (println)
    (println "| file | OOB commits | streams | implicated features | implicated docs | SPEC-LESS |")
    (println "|---|---|---|---|---|---|")
    (doseq [{:keys [file oob-commits classes features docs specless?]} file-rollup]
      (println "|" file "|" oob-commits "|" (str/join ", " (map name classes)) "|"
               (md-list (map #(str/replace % #"^specs/features/" "") features)) "|"
               (md-list docs) "|" (if specless? "**YES**" "") "|"))
    (println)
    (println "## Out-of-band commits (newest first)")
    (println)
    (doseq [{:keys [short author subject class files]} oob]
      (println "###" short "—" subject)
      (println "- class:" (name class) "· author:" author)
      (println "- files:" (if (seq files) (str/join ", " files) "(none in scope)"))
      (println))))

(spit out-file report)
(println "commits total:" (count enriched)
         "| oob:" (count oob)
         "| oob src files:" (count src-files)
         "| spec-less:" (count (filter :specless? file-rollup)))
(println "wrote" out-file)
