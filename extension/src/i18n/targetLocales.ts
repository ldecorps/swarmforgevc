// BL-230: the single source of truth for which locales the build-time
// translation pass targets. Adding a language is exactly: (1) append its
// code here, (2) hand-author its pwa/locales.js chrome catalog entry
// (BL-118/BL-229 convention - chrome strings are hand-authored, never
// auto-translated), (3) rebuild - no other code change anywhere
// (add-language-05). French is the first delivered target.
export const SOURCE_LOCALE = 'en';
export const TARGET_LOCALES: readonly string[] = ['fr'];
