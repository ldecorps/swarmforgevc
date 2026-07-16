;; BL-214: sends each committed docs/briefings/<date>.md exactly once, from
;; the headless daemon rather than the VS Code extension host - ported from
;; extension/src/notify/briefingEmailWatcher.ts's exact decision logic
;; (sent-marker file shape, "mark sent only after a real success" ordering)
;; so a failed/skipped send is retried on the next sweep instead of lost,
;; same as that module's own docstring promised. Reuses daemon_alarm_lib.bb's
;; send-alarm-email! for the actual POST - no second Resend client - so this
;; module owns only the briefing-specific scanning/marker/subject logic.
;; BL-393 (cleaner extraction): generic markdown->HTML rendering lives in
;; markdown_to_html_lib.bb, not here - this module only merges that render
;; with its own diagram-html concern (merge-diagram-html below).
(ns briefing-email-lib
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "markdown_to_html_lib.bb")))

(defn sent-state-path [briefings-dir]
  (str (fs/path briefings-dir ".sent.json")))

(defn- read-json [path]
  (when (fs/exists? path)
    (try
      (json/parse-string (slurp path) true)
      (catch Exception _ nil))))

(defn load-sent-briefings [briefings-dir]
  (set (:sent (read-json (sent-state-path briefings-dir)))))

(defn record-briefing-sent! [briefings-dir file-name]
  (let [current (conj (load-sent-briefings briefings-dir) file-name)]
    (spit (sent-state-path briefings-dir) (json/generate-string {:sent (vec (sort current))}))))

;; Every committed briefing .md file under briefings-dir not yet sent, oldest
;; (alphabetically, which is chronologically for YYYY-MM-DD names) first.
(defn find-unsent-briefings [briefings-dir]
  (if (fs/exists? briefings-dir)
    (let [sent (load-sent-briefings briefings-dir)]
      (->> (fs/list-dir briefings-dir)
           (map fs/file-name)
           (filter #(str/ends-with? % ".md"))
           (remove sent)
           sort
           vec))
    []))

;; BL-392: the headline's positional contract ("first non-empty line") is
;; unchanged, but a briefing's first line can be a whole markdown-laden lede
;; paragraph rather than a short title - unbounded, that swallowed the
;; entire subject line in a mail client. Pinned as a named constant so the
;; tests assert against it, not a magic number.
(def briefing-subject-headline-limit 80)

;; Strips markdown emphasis/heading markers so a raw `**`/`_`/backtick/`#`
;; never reaches a subject line. Order-independent: every marker character
;; is removed globally, so a broken pair (e.g. bounding cuts through a
;; `**bold**` span) can never leave a stray single marker behind - this
;; always runs BEFORE bound-headline for exactly that reason.
(defn strip-markdown-emphasis [s]
  (-> s
      (str/replace #"^#+\s*" "")
      (str/replace #"\*\*" "")
      (str/replace #"\*" "")
      (str/replace #"_" "")
      (str/replace #"`" "")))

;; Truncates to briefing-subject-headline-limit total characters (ellipsis
;; included), cutting at the last word boundary within budget rather than
;; mid-word - a single character reserved for the ellipsis, per the
;; ticket's "single-character ellipsis" contract. A pathological headline
;; with no space within budget (one unbroken long token) falls back to a
;; hard cut - there is no word boundary to prefer.
(defn bound-headline [s]
  (if (<= (count s) briefing-subject-headline-limit)
    s
    (let [budget (dec briefing-subject-headline-limit)
          truncated (subs s 0 budget)
          last-space (str/last-index-of truncated " ")
          word-bounded (if (and last-space (pos? last-space)) (subs truncated 0 last-space) truncated)]
      (str (str/trimr word-bounded) "…"))))

;; First non-empty line of the briefing, matching briefingEmailWatcher.ts's
;; buildBriefingSubject exactly (BL-099 briefing-03: subject names the date
;; and the headline). BL-392: the headline is markdown-stripped then bounded
;; before it rides the subject - a headline that strips down to nothing
;; (markdown syntax with no real text) is treated the same as no headline at
;; all, so the date-only "no dangling separator" contract holds either way.
(defn build-briefing-subject [date-label content]
  (let [raw-headline (->> (str/split-lines (or content ""))
                           (map str/trim)
                           (filter seq)
                           first)
        headline (some-> raw-headline strip-markdown-emphasis str/trim bound-headline)]
    (str "SwarmForge briefing " date-label (when-not (str/blank? headline) (str " - " headline)))))

;; BL-252 (generalized for BL-251): appends a computed content block - the
;; suite-duration trend + BL-078 regression flag (BL-252), the
;; needs-approval section (BL-251), or any future one - to the outgoing
;; briefing content. A blank/nil block (the source CLI unavailable, not
;; "nothing to report" - each source CLI already renders that as its own
;; non-blank text) leaves content untouched rather than appending nothing
;; meaningful. Shipped under the name append-suite-duration-line in BL-252;
;; renamed here since BL-251 needed the identical behavior for a second,
;; independent block - same function, reused, not duplicated.
(defn append-content-block [content block]
  (if (str/blank? block)
    content
    (str (str/trim-newline (or content "")) "\n\n" block "\n")))

;; Threads content through every optional section adapter present in
;; `adapters`, in order - each key independently appends its own block (or
;; leaves content untouched if its fn returns blank/nil), so adding a third
;; section later is a new entry in this vector, not a new branch.
;;
;; BL-256: three more sections, same shape - :merged-blocked-digest (what
;; merged/what's blocked), :stage-dwell-section (per-stage throughput +
;; dwell), :chase-trend-section (chase/nudge pipeline-health trend).
;; BL-263: :not-done-count-line - the same single not-done total the PWA
;; reads from backlog.json's notDoneCount, never a second derivation.
;; BL-337: :standing-rule-violations-line - "a rule that nobody measures is
;; a rule that silently stops holding"; derived purely from the citation
;; trail already committed to the constitution/role prompts, never a new
;; counter.
;; BL-431: :suboptimality-verdict-line - the swarm's own diagnosis of where
;; it is suboptimal (BL-430's rework signal, read only when meaningfully
;; above baseline), so a human sees it without opening a metrics file.
(def optional-section-adapter-keys
  [:suite-duration-line :needs-approval-section :merged-blocked-digest :stage-dwell-section :chase-trend-section
   :not-done-count-line :standing-rule-violations-line :suboptimality-verdict-line])

(defn- apply-optional-sections [content adapters]
  (reduce
   (fn [acc adapter-key]
     (if-let [section-fn (get adapters adapter-key)]
       (append-content-block acc (section-fn))
       acc))
   content
   optional-section-adapter-keys))

;; BL-286: Gmail (and most webmail) blocks data-URI <img> sources, so a
;; data-URI diagram silently renders broken/blank there - the exact defect
;; this ticket fixes. Content-ids only need to be unique within one email,
;; so the diagram's own name is enough (names are already unique per run).
(defn- diagram-content-id [name]
  (str name "-diagram"))

;; BL-260: given the render CLI's parsed [{:name :base64}...] payload (nil/
;; empty when rendering is unavailable this run - the CLI shell-out failed,
;; threw, or was never installed), returns {:html :note-line :attachments}
;; for send-unsent-briefings!'s optional :diagram-section adapter below.
;; :html is nil when there is nothing to render - the email still sends,
;; plaintext-only, exactly as before this ticket, but with a clear note
;; rather than silence (BL-260 render-unavailable-degradation-04).
;;
;; BL-286: when diagrams ARE available, :html references each by a
;; cid:<content-id> <img> source (RFC-2392) rather than a data-URI - Gmail
;; blocks data-URI image sources, so those rendered broken in every real
;; client that matters. :attachments carries one {:filename :content-id
;; :base64} descriptor per diagram, each content-id matching the cid that
;; references it 1:1; the no-diagrams branch has no :attachments key at all
;; (nothing to attach). :note-line still gets appended to the plaintext
;; part, since a plaintext-only client can never show the html part at all
;; (BL-260 plaintext-degradation-03).
(defn build-diagram-section [diagrams]
  (if (seq diagrams)
    {:html (str "<div>"
                (str/join ""
                          (map (fn [{:keys [name]}]
                                 (str "<h3>" name " diagram</h3>"
                                      "<img src=\"cid:" (diagram-content-id name) "\" "
                                      "alt=\"" name " diagram\" style=\"max-width:100%;height:auto\"/>"))
                               diagrams))
                "</div>")
     :note-line "Architecture diagrams: rendered inline above (HTML view) - see docs/diagrams/ in the repo for the Mermaid source."
     :attachments (mapv (fn [{:keys [name base64]}]
                           {:filename (str name "-diagram.png")
                            :content-id (diagram-content-id name)
                            :base64 base64})
                         diagrams)}
    {:html nil
     :note-line "Architecture diagrams: unavailable this run (renderer not installed) - see docs/diagrams/ in the repo."}))

;; BL-393: the diagram section's own html (a <div> of <h3>/<img> per
;; diagram) must coexist with the rendered body, never replace it -
;; appended after the body so both remain intact and neither clobbers the
;; other (the critical interaction the ticket calls out explicitly).
(defn- merge-diagram-html [body-html diagram-html]
  (if diagram-html
    (str body-html diagram-html)
    body-html))

(defn send-unsent-briefings!
  "Sends each not-yet-sent committed briefing exactly once via the injected
   send-email! adapter (daemon_alarm_lib.bb's send-alarm-email!). A file is
   marked sent only once send-email! reports :success true - unconfigured
   (:reason :disabled/:missing-api-key) or a real failure both log a skip
   and leave the file to retry on the next sweep, never crashing and never
   losing the briefing. Returns the file names actually sent this call.

   Each optional section adapter (:suite-duration-line, BL-252;
   :needs-approval-section, BL-251 - zero-arg fns returning a content block
   string or nil) is appended to the content before sending, in that order.
   A caller that omits an adapter (or whose adapter returns nil) sends the
   original content unaffected by that section, backward compatible with
   every earlier caller.

   BL-260: an optional :diagram-section adapter (zero-arg fn returning
   build-diagram-section's {:html :note-line} shape) appends :note-line to
   the plaintext content exactly like the other optional sections.

   BL-393: :html is now ALWAYS passed to :send-email! (a 3rd arg, minimum),
   rendered from the exact same `content` that rides the plain-text part -
   so the html body is byte-complete by construction, including every
   appended optional section. When a :diagram-section adapter also carries
   :html (available diagrams), that html is merged into the rendered body
   rather than replacing it. A diagram section with :attachments (available
   diagrams, not the renderer-unavailable/no-diagrams branch) is passed as
   a 4th arg alongside :html; every other case - including no
   :diagram-section adapter at all - keeps the 3-arg call, html and all."
  [briefings-dir adapters]
  (let [sent-now (atom [])]
    (doseq [file-name (find-unsent-briefings briefings-dir)]
      (let [raw-content ((:read-briefing-content adapters) file-name)
            content (apply-optional-sections raw-content adapters)
            diagram-section (when-let [f (:diagram-section adapters)] (f))
            content (if diagram-section
                      (append-content-block content (:note-line diagram-section))
                      content)
            date-label (str/replace file-name #"\.md$" "")
            subject (build-briefing-subject date-label content)
            html (merge-diagram-html (markdown-to-html-lib/render-markdown-to-html content) (:html diagram-section))
            result (if (seq (:attachments diagram-section))
                     ((:send-email! adapters) subject content html (:attachments diagram-section))
                     ((:send-email! adapters) subject content html))]
        (cond
          (:success result)
          (do
            (record-briefing-sent! briefings-dir file-name)
            ((:log! adapters) "briefing-sent" file-name)
            (swap! sent-now conj file-name))

          (= (:reason result) :disabled)
          ((:log! adapters) "briefing-skip-disabled" file-name)

          (= (:reason result) :missing-api-key)
          ((:log! adapters) "briefing-skip-missing-key" file-name)

          :else
          ((:log! adapters) "briefing-send-failed" file-name (str (:error result))))))
    @sent-now))
