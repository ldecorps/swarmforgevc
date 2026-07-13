;; BL-337 cleaner pass: the one impure "which files carry a standing rule"
;; directory listing, shared by standing_rule_violations_cli.bb and
;; handoffd.bb's briefing-line adapter - previously duplicated verbatim in
;; both, each with the SAME ".prompt"-only filter bug (silently dropping
;; the five numbered constitution articles, 01_roles.md through
;; 05_amendments.md, which are .md, not .prompt - contradicting both
;; copies' own comment claiming to scan "the constitution articles
;; (numbered + the project-wide prompts)"). One definition, one place to
;; fix, matching standing_rule_violations_lib.bb's own split: pure text
;; parsing lives in the lib, filesystem access lives here.
(ns standing-rule-violations-files
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

;; Every file this project treats as carrying a standing engineering rule:
;; the constitution articles (numbered .md files AND the project-wide
;; .prompt files) and every role prompt (architect.prompt's own
;; co-change-tool citation lives here, not under constitution/articles/).
;; A rule added tomorrow in any of these needs no code change - only a new
;; FILE (a role prompt this project doesn't have yet) would, and that is
;; an explicit, reviewed addition to the swarm's own role roster, not a
;; silent gap.
(defn rule-source-files [project-root]
  (let [articles-dir (fs/path project-root "swarmforge" "constitution" "articles")
        roles-dir (fs/path project-root "swarmforge" "roles")
        matching-files (fn [dir exts] (if (fs/exists? dir)
                                         (filter #(some (fn [ext] (str/ends-with? (fs/file-name %) ext)) exts)
                                                 (fs/list-dir dir))
                                         []))]
    (concat (matching-files articles-dir [".md" ".prompt"]) (matching-files roles-dir [".prompt"]))))
