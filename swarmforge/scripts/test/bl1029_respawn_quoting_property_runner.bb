#!/usr/bin/env bb
;; BL-1029 property test (coder-authored, TWO declared invariants).
;;
;;   Invariant 1: every shell-command string a respawn path emits round-trips
;;   through a real shell to the exact original launch path, for every path
;;   shape - including one containing an apostrophe.
;;   Invariant 2: no site in swarmforge/scripts/ quotes a launch path for a
;;   shell on its own; all of them go through one shared quoting helper, and
;;   the check proving this derives its site list from the TREE rather than
;;   from a hand-maintained list of files.
;;
;; WHY A ROUND TRIP AND NOT A TEXT MATCH. This defect already survived one
;; property runner: BL-1018's checked `str/includes?` on the raw path, which
;; passes whether the escaping is correct or broken (the accepted hardener
;; rule of 2026-08-22 records why). So P1 hands the constructed argument to a
;; REAL shell and compares what comes back, byte for byte, to what went in.
;; Nothing here asserts over the text of the argument.
;;
;; WHY THE ENUMERATION IS FROM THE TREE. A hand list of the seven sites is the
;; thing that goes stale the day an eighth is written - which is precisely how
;; this family came to exist after BL-1018 fixed one member of it. P2 walks
;; swarmforge/scripts/**/*.bb and classifies what it finds.
;;
;; REACH, asserted rather than hoped for (BL-654's generator-reach clause).
;; Two states a naive generator would essentially never produce:
;;
;;   (a) AN APOSTROPHE. A path drawn from an alphabet that happens to include
;;       `'` at some low rate would contain one rarely, and it is the ONLY
;;       character that breaks the pre-fix construction - a run without one
;;       proves nothing at all. Every generated path therefore draws from an
;;       alphabet of shell-hostile FRAGMENTS, and the apostrophe-bearing share
;;       carries its own floor.
;;   (b) A PATH THAT IS MERELY AWKWARD, NOT HOSTILE. If every path were
;;       hostile, a helper that mangled ordinary paths would still pass. Plain
;;       segments are drawn too, and floored.
;;
;; Non-vacuity PROVEN at authoring time (2026-08-22), each break applied and
;; reverted:
;;   - launch-command rebuilt as the pre-fix (str "zsh '" p "'") ....... P1
;;   - shell-quote-single escaping `'` as `\'` (wrong inside single
;;     quotes - the shell never leaves the quote) ...................... P1
;;   - one call site restored to the bare-quote construction ........... P2

(ns bl1029-respawn-quoting-property-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(def test-dir (fs/parent (fs/canonicalize *file*)))
(def scripts-dir (str (fs/parent test-dir)))
(load-file (str (fs/path scripts-dir "shell_quote_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 200))

(def failures (atom []))
(defn fail! [msg] (swap! failures conj (str "FAIL: " msg)))
(defn check! [msg expr] (when-not expr (fail! msg)))

(def reached (atom {}))
(defn bump! [k] (swap! reached update k (fnil inc 0)))

;; ONE generator advanced across every run - a fresh LCG seeded per run index
;; returns a near-constant first draw for a small modulus (measured while
;; writing BL-991's runner: one arm drawn 40 times out of 40).
(def rng
  (let [state (atom 1029)]
    (fn [n] (let [next (mod (+ (* 1103515245 @state) 12345) 2147483648)]
              (reset! state next)
              (mod (quot next 65536) n)))))

;; Fragments, not characters: the apostrophe is the one that breaks the
;; pre-fix construction, and the rest are here so a helper that fixed only
;; the apostrophe still has to survive everything else a real path can carry.
(def segments
  ["plain" "two words" "O'Brien" "it's" "$role" "back\\slash" "semi;colon"
   "amp&and" "pipe|d" "`backtick`" "\"double\"" "new\nline" "star*" "tab\there"
   "(parens)" "{brace}" "#hash" "~tilde"])

(def plain-segments ["Users" "home" "carillon" "projects" "swarmforgevc" "opt"])

(defn draw-path
  "One generated launch path. Roughly one in five is drawn from ORDINARY
   segments only: if every path were hostile, a helper that mangled a plain
   path would still pass every case. The rest mix in the shell-hostile
   fragments above, so the apostrophe - the one character that breaks the
   pre-fix construction - turns up constantly rather than by luck."
  []
  (let [depth (+ 2 (rng 3))
        alphabet (if (zero? (rng 5)) plain-segments segments)]
    (str "/" (str/join "/" (repeatedly depth #(alphabet (rng (count alphabet)))))
         "/launch/coder.sh")))

;; Evaluates the argument the way tmux does: hands the whole string to a
;; shell. `printf %s` rather than `echo` so nothing in the path is
;; interpreted on the way back out.
(defn round-trip [argument]
  (let [{:keys [out exit]} (process/sh {:out :string :err :string :continue true}
                                       "sh" "-c" (str "printf '%s' " argument))]
    {:exit exit :recovered out}))

;; ── P1: every emitted command round-trips to the exact path ──────────────

(doseq [run-index (range runs)]
  (let [p (draw-path)
        command (shell-quote-lib/launch-command p)
        where (str "run " run-index " " (pr-str p))]
    (when (str/includes? p "'") (bump! :apostrophe))
    (when-not (re-find #"[' \\$`\"|;&*\n\t(){}#~]" p) (bump! :plain))
    (bump! :paths)

    (check! (str where ": the command does not run zsh: " (pr-str command))
            (str/starts-with? command "zsh "))
    ;; The argument tmux would hand the shell, minus the `zsh ` verb.
    (let [{:keys [exit recovered]} (round-trip (subs command 4))]
      (check! (str where ": the argument is not valid shell (exit " exit ")") (zero? exit))
      (check! (str where ": recovered " (pr-str recovered) ", not the path it was given")
              (= p recovered)))))

;; ── P2: the tree has exactly one place that quotes a launch path ─────────

(defn production-bb-files
  "Every .bb in swarmforge/scripts/ EXCEPT the test tree beneath it.
   Derived from the tree, never a list - the whole point of invariant 2.

   test/ is out of scope deliberately, and it is the only exclusion: a test
   that asserts about the shape has to be able to NAME the shape, and a gate
   that forbade naming it would forbid the very runner that catches the
   defect (this file's own regexes are two such names). Checked: no .bb lives
   anywhere under swarmforge/scripts/ other than that directory and test/."
  [dir]
  (->> (fs/glob dir "*.bb")
       (map str)
       sort))

;; Code only: a line whose trimmed text starts with `;` is prose, and prose
;; naming the pre-fix construction (this file's own header does) must never
;; trip a gate that exists to catch calls.
(defn code-lines [content]
  (->> (str/split-lines content)
       (remove #(str/starts-with? (str/trim %) ";"))))

;; A launch-argument construction site: any code line building a shell command
;; string that runs the launch script. Derived from the tree, never a list.
(def construction-re #"\"zsh ")
(def bare-quote-re #"\"zsh '\"")

(def sites
  (for [file (production-bb-files scripts-dir)
        line (code-lines (slurp file))
        :when (re-find construction-re line)]
    {:file (str/replace file (str scripts-dir "/") "") :line (str/trim line)}))

(def helper-file "shell_quote_lib.bb")

(bump! :enumerated-sites)

;; Scenario 03's substance: an enumeration that finds nothing proves nothing.
(check! (str "the enumeration found no construction site at all - it is not looking at the tree")
        (seq sites))

(doseq [{:keys [file line]} sites]
  (check! (str file " builds a launch command outside the shared helper: " line)
          (= helper-file file)))

;; And the sharper form of the same rule, which is what qa_e2e step 4 greps
;; for by hand: no bare-single-quote interpolation anywhere in code.
(doseq [file (production-bb-files scripts-dir)
        line (code-lines (slurp file))
        :when (re-find bare-quote-re line)]
  (fail! (str (str/replace file (str scripts-dir "/") "")
              " still interpolates a launch path into a bare-quoted shell string: " (str/trim line))))

;; Every file that respawns a pane with a launch script must reach the helper.
;; Enumerated the same way - from the tree.
(def respawn-files
  (for [file (production-bb-files scripts-dir)
        :let [content (slurp file)]
        ;; Word-boundary, not substring: `launch-command-renamed` contains
        ;; `launch-command`, so a plain match would keep reporting the sites
        ;; routed after exactly the rename this check exists to notice.
        :when (some #(re-find #"launch-command(?![\w-])" %) (code-lines content))]
    (str/replace file (str scripts-dir "/") "")))

(check! "no file in the tree calls the shared launch-command helper"
        (seq respawn-files))
(doseq [f respawn-files] (bump! :routed-file))

;; ── reach, asserted rather than hoped for ────────────────────────────────

(defn floor! [k min-count]
  (let [seen (get @reached k 0)]
    (when (< seen min-count)
      (fail! (str "generator reach: " k " was produced " seen " times, needed >= " min-count
                  ". A property that never reaches a state proves nothing about it.")))))

(floor! :apostrophe 20)
(floor! :plain 5)
(floor! :routed-file 5)

(if (empty? @failures)
  (println (str "bl1029_respawn_quoting_property (BL-1029): ALL " runs " PATHS PASSED "
                (pr-str @reached) " sites=" (pr-str (map :file sites))))
  (do (println (str "bl1029_respawn_quoting_property (BL-1029): " (count @failures) " FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))
