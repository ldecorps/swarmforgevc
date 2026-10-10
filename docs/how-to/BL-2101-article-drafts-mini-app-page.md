# Article drafts Mini App page — read the Art Director's episode drafts on phone (BL-2101)

*How-to. Task-oriented: open **Article drafts** from the console menu and
read the Art Director's LinkedIn episode drafts, newest first, without the
meta block above each post.*

Live holistic UI (bridge, token-gated feeds), never the static backlog PWA
(Local Engineering Architecture Rule 5). Read-only: no route writes, moves,
or deletes a draft.

## What you get

1. Open the console menu → **Article drafts** (`/article-drafts`), or find
   it as the `article-drafts` page in the Mini App page bundle.
2. An index of every `DRAFT-linkedin-*.md` under the project's
   `.swarmforge/operator/`, newest file first. A file in that directory
   that is not a LinkedIn draft (e.g. a `NOTE-*.md`) never appears.
3. A page per draft, showing only the post: everything below the draft's
   first standalone `---` line. The meta block above that line (the Art
   Director's own review notes) is never rendered.
4. The existing Listen (speech synthesis) control reads the post aloud,
   same as the other Mini App pages.

## The Art Director owns the drafts

The Art Director writes each episode as `DRAFT-linkedin-*.md` in the
master checkout's `.swarmforge/operator/` and never commits one
(art-director.prompt) — the drafts stay gitignored there. This page is a
**reader** of those files; it never writes, moves, or deletes a draft, and
posting to LinkedIn or reading readers' feedback is manual, not this page
(human ruling, 2026-10-09).

## Where it lives

| Piece | Location |
| --- | --- |
| Console menu link | `consoleMenuUiHtml.ts` → `#article-drafts` → `/article-drafts` |
| Mini App manifest entry | `letsTalkRoutes.ts` → `articleDrafts` (id `article-drafts`), merged via `mergeArticleDraftsIntoUiBundleManifest` |
| Index/page logic | `articleDraftsCore.ts` — `computeArticleDraftsIndex`, `buildArticleDraftPagePayload`, `stripDraftMetaHeader`, `isSafeArticleDraftFilename` |
| Bridge route wiring | `bridgeServer.ts` → `buildArticleDraftsIndexState(targetPath)`, `buildArticleDraftPageState(targetPath, url)`, `getArticleDraftsUiHtml()` |
| Mini App shell | `/article-drafts` |
| JSON feeds | `/article-drafts-index` (the list), `/article-drafts-page?file=<name>` (one draft) — both token-gated, GET only |

## Safety

| Rule | Detail |
| --- | --- |
| Filename allowlist | Only a basename matching `DRAFT-linkedin-[A-Za-z0-9._-]+\.md` is ever read — `isSafeArticleDraftFilename` refuses a path separator, `..`, or any other name |
| No directory escape | A draft page request never reads outside the project's `.swarmforge/operator/` |
| Read-only | Every article-drafts route is a GET; none writes, moves, or deletes |
| Auth | The JSON feeds answer only a request carrying the bridge token |
| Meta block hidden | `stripDraftMetaHeader` drops everything at or above the first standalone `---` line before the page ever renders it |

## Verify

```bash
cd extension && npm test -- articleDraftsCore
cd extension && npm test -- articleDraftsBridge
node specs/pipeline/cli.js specs/features/BL-2101-the-article-drafts-page-shows-the-art-directors-episode-drafts.feature
```

Manual once on device: console menu → Article drafts → the newest draft
is listed first, its page shows the post only (no meta line), and Listen
reads it aloud.

Related: [Bubble remote page pager](BL-829-bubble-remote-page-pager.md),
[Bubble Health page](BL-832-bubble-health-trends-page.md),
[Operator docs on phone](BL-1166-bubble-authored-docs-index-and-first-pages.md).
