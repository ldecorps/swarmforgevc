;; BL-1029: the ONE place a launch-script path becomes a shell word.
;;
;; tmux hands a `respawn-pane` / `new-session` command's trailing argument to
;; `$SHELL -c`, so that argument must itself be valid POSIX shell. Seven sites
;; used to build it as `(str "zsh '" path "'")` - a bare pair of single quotes
;; with no escaping - which stops being valid the instant the path contains an
;; apostrophe. `/Users/O'Brien/...` is a real macOS home directory shape, not
;; a hypothetical, and on such a host every one of those repair paths failed
;; to restart the role it was invoked to save (BL-1018 confirmed it live: the
;; shell exits 2 with "unexpected EOF looking for matching `''").
;;
;; BL-1018 fixed exactly one member of that family with a private helper.
;; This lib is where that helper lives now, so "the launch path is escaped" is
;; a property of a single constructor rather than a rule seven call sites each
;; have to remember - the posture single_role_repair_lib.bb already takes for
;; "names the pack socket explicitly". A second copy anywhere is the defect
;; coming back, which is why single_role_repair_lib.bb loads this rather than
;; keeping its own.
;;
;; No subprocess, no IO: pure string construction. That matters because
;; handoffd.bb loads this transitively, and daemon_cycle_guard_lib_test_runner's
;; closure gate forbids any subprocess path inside that closure outside the
;; one chokepoint.
;;
;; Loaded via load-file, not required on a classpath:
;;   (load-file (str (fs/path (fs/parent *file*) "shell_quote_lib.bb")))
;; and referred to as shell-quote-lib/foo.

(ns shell-quote-lib
  (:require [clojure.string :as str]))

(defn shell-quote-single
  "One POSIX-shell word carrying `s` literally, whatever is in it.

   The standard escape, and the only one that is safe for every byte: wrap in
   single quotes, and render each embedded quote by closing the quote, emitting
   an escaped literal quote, and reopening. Inside single quotes a shell
   interprets nothing at all, so spaces, $, backticks, backslashes, semicolons
   and newlines all survive untouched - the apostrophe is the single character
   that needs handling, and this handles it.

   nil quotes as the empty word rather than the literal \"nil\": a missing
   path must never become a shell argument that looks like a real one."
  [s]
  (str "'" (str/replace (str s) "'" "'\\''") "'"))

(defn launch-command
  "The shell command string a respawn/new-session passes to tmux for a
   persisted launch script.

   Every respawn site calls THIS, not shell-quote-single directly and never a
   hand-built string: the `zsh ` prefix and the quoting are one decision, and
   splitting them is how a site ends up with the prefix right and the quoting
   wrong. BL-1029 scenario 02 enumerates the tree and asserts exactly that."
  [launch-script]
  (str "zsh " (shell-quote-single launch-script)))
