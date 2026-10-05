#!/usr/bin/env bb
;; local_model_edit_hook.bb - the qwen PostToolUse hook a local-model seat's
;; .qwen/settings.json runs after every edit and write_file
;; (write_local_model_qwen_settings in swarmforge.sh registers it).
;;
;; Why (2026-10-04, BL-1970): the iq3 coder, working BL-1902, left one form
;; in a Babashka test runner unclosed and spent more than twenty minutes and
;; two compactions adding and removing a closing paren by hand. The reader
;; had named the place all along ("EOF while reading, expected ) to match (
;; at [239,1]"), but only inside a stack trace printed by a later test run.
;; A small model cannot balance parentheses by counting them.
;;
;; After an edit of Clojure source (.bb .clj .cljc .cljs .edn) this reads the
;; file and, when a delimiter does not close, answers with the reader's
;; message as additionalContext, which qwen hands the model with the edit's
;; result. It prints nothing for a file that reads, for any other kind of
;; file, and for a reader error that is not a delimiter error (that one is
;; the test run's to report). It never blocks, undoes or changes the edit.

(ns local-model-edit-hook
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]
            [edamame.core :as e]))

(def lisp-extensions #{"bb" "clj" "cljc" "cljs" "edn"})

(defn lisp-source? [path]
  (contains? lisp-extensions (str/lower-case (str (fs/extension (str path))))))

(def reader-opts
  ;; Every reader feature on, an alias resolves to itself and a tagged
  ;; literal reads as its value, so only a delimiter can stop the read.
  {:all true
   :auto-resolve (fn [alias] (if (= :current alias) 'user alias))
   :readers (fn [_tag] identity)})

(defn delimiter-error
  "The reader message for the first delimiter that does not close in text,
   or nil when every form closes or the read stops for another reason."
  [text]
  (try
    (e/parse-string-all text reader-opts)
    nil
    (catch clojure.lang.ExceptionInfo ex
      (let [data (ex-data ex)]
        (when (or (contains? data :edamame/expected-delimiter)
                  (contains? data :edamame/opened-delimiter)
                  (str/starts-with? (str (ex-message ex)) "Unmatched delimiter"))
          {:message (ex-message ex) :row (:row data) :col (:col data)})))))

(defn stray-closer-note
  "Where an unmatched closing delimiter sits, with its line and a caret.
   Why (2026-10-05): the iq3 coder, on BL-1987, read \"expected: ] to match
   [ at [1317 8]\" as a count to fix on the line it had just edited, and
   added and removed one paren there fifteen times in five minutes. The
   stray ) was on the next line, at [1344 55], and no message said so."
  [text {:keys [message row col]}]
  (when (and (str/starts-with? (str message) "Unmatched delimiter")
             (pos-int? row) (pos-int? col))
    (when-let [line (get (vec (str/split-lines text)) (dec row))]
      (str "The closing delimiter that has nothing open to close is at line " row
           " column " col ":\n" line "\n" (apply str (repeat (dec col) " ")) "^\n"
           "Fix it there: remove it, or add what the reader expected before it."
           " The line you just edited is not the problem unless it is that line. "))))

(defn context-for
  "The additionalContext for an edited path, or nil when there is none."
  [path]
  (when (and path (lisp-source? path) (fs/regular-file? path))
    (when-let [{:keys [message] :as error} (delimiter-error (slurp (str path)))]
      (str path " no longer reads: " message ". "
           (stray-closer-note (slurp (str path)) error)
           "The reader names the line and column of the form that does not close. "
           "Read a short range from that line, fix that form, and run the file again. "
           "Do not count parentheses by hand."))))

(defn edited-path
  "The file the tool call edited, absolute, from the PostToolUse event."
  [event]
  (when-let [p (get-in event ["tool_input" "file_path"])]
    (str (fs/absolutize (fs/path (or (get event "cwd") ".") p)))))

(defn answer [event]
  (when-let [context (context-for (edited-path event))]
    (json/generate-string {"hookSpecificOutput" {"hookEventName" "PostToolUse"
                                                 "additionalContext" context}})))

(when (= *file* (System/getProperty "babashka.file"))
  (let [event (try (json/parse-string (slurp *in*)) (catch Exception _ nil))]
    (when-let [out (and (map? event) (answer event))]
      (println out))))
