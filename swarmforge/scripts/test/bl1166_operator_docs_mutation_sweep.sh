#!/usr/bin/env bash
# BL-1166 hardener: surgical mutation over Operator docs core + HTML shell.
# Soft Gherkin inapplicable (no Scenario Outline) — BL-638 hand-authored sweep.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"
CORE=extension/src/bridge/operatorDocsCore.ts
HTML=extension/src/bridge/operatorDocsHtml.ts

BACKUP_CORE="$(mktemp)"
BACKUP_HTML="$(mktemp)"
cp "$CORE" "$BACKUP_CORE"
cp "$HTML" "$BACKUP_HTML"
restore() {
  cp "$BACKUP_CORE" "$CORE"
  cp "$BACKUP_HTML" "$HTML"
  (cd extension && npm run compile >/dev/null 2>&1) || true
}
cleanup() { restore; rm -f "$BACKUP_CORE" "$BACKUP_HTML" /tmp/bl1166_from.txt /tmp/bl1166_to.txt; }
trap cleanup EXIT

killed=0; survived=0; skipped=0

suite_fails() {
  if ! (cd extension && npm run compile >/dev/null 2>&1); then return 0; fi
  if ! (cd extension && npx vitest run test/operatorDocsCore.test.js >/dev/null 2>&1); then return 0; fi
  if ! (cd extension && npx vitest run --config vitest.properties.config.mjs test/operatorDocsReadOnly.property.test.js >/dev/null 2>&1); then return 0; fi
  if ! (bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1166-bubble-authored-docs-index-and-first-pages.feature >/dev/null 2>&1); then return 0; fi
  return 1
}

apply_once() {
  python3 - "$1" <<'PY'
import sys
from pathlib import Path
p = Path(sys.argv[1])
a = Path('/tmp/bl1166_from.txt').read_text()
b = Path('/tmp/bl1166_to.txt').read_text()
s = p.read_text()
if a not in s:
    sys.exit(3)
p.write_text(s.replace(a, b, 1))
PY
}

apply_all() {
  python3 - "$1" <<'PY'
import sys
from pathlib import Path
p = Path(sys.argv[1])
a = Path('/tmp/bl1166_from.txt').read_text()
b = Path('/tmp/bl1166_to.txt').read_text()
s = p.read_text()
if a not in s:
    sys.exit(3)
p.write_text(s.replace(a, b))
PY
}

mutate_file() {
  local target="$1"
  local label="$2"
  local mode="${3:-once}"
  restore
  if [[ "$mode" == "all" ]]; then
    if ! apply_all "$target"; then echo "  skip     $label"; skipped=$((skipped + 1)); return; fi
  else
    if ! apply_once "$target"; then echo "  skip     $label"; skipped=$((skipped + 1)); return; fi
  fi
  if suite_fails; then echo "  killed   $label"; killed=$((killed + 1)); return; fi
  echo "  SURVIVED $label"; survived=$((survived + 1))
}

echo "mutation sweep over Operator docs (BL-1166)"

python3 - <<'PY'
from pathlib import Path
# /\\/g → four backslashes in Python str; /^\/+/ → two.
Path('/tmp/bl1166_from.txt').write_text(
    "export function isSafeDocsRelativePath(relativePath: string): boolean {\n"
    "  if (!relativePath || relativePath.includes('..')) {\n"
    "    return false;\n"
    "  }\n"
    "  const normalized = relativePath.replace(/\\\\/g, '/').replace(/^\\/+/, '');\n"
    "  return normalized.length > 0 && !normalized.startsWith('..') && !normalized.includes('/../');\n"
    "}\n"
)
Path('/tmp/bl1166_to.txt').write_text(
    "export function isSafeDocsRelativePath(relativePath: string): boolean {\n"
    "  return Boolean(relativePath);\n"
    "}\n"
)
assert Path('/tmp/bl1166_from.txt').read_text() in Path('extension/src/bridge/operatorDocsCore.ts').read_text()
PY
mutate_file "$CORE" "isSafeDocsRelativePath treats every non-empty path as safe"

python3 - <<'PY'
from pathlib import Path
Path('/tmp/bl1166_from.txt').write_text(
    "if (writeMethods.has(method.toUpperCase())) {\n"
    "        return false;\n"
    "      }"
)
Path('/tmp/bl1166_to.txt').write_text(
    "if (writeMethods.has(method.toUpperCase())) {\n"
    "        return true;\n"
    "      }"
)
PY
mutate_file "$CORE" "operatorDocsRoutesAreReadOnly ignores write methods"

python3 - <<'PY'
from pathlib import Path
Path('/tmp/bl1166_from.txt').write_text(
    "const tag = `h${Math.min(level, 3)}`;\n"
    "      out.push(`<${tag}>${renderInlineMarkdown(line.slice(level + 1).trim())}</${tag}>`);"
)
Path('/tmp/bl1166_to.txt').write_text("out.push(line);")
PY
mutate_file "$CORE" "markdown headings leak raw markdown instead of HTML tags"

python3 - <<'PY'
from pathlib import Path
Path('/tmp/bl1166_from.txt').write_text(
    "out.push(`<p>${renderInlineMarkdown(buffer.join(' '))}</p>`);"
)
Path('/tmp/bl1166_to.txt').write_text(
    "out.push(renderInlineMarkdown(buffer.join(' ')));"
)
PY
mutate_file "$CORE" "markdown paragraphs lose p tags"

python3 - <<'PY'
from pathlib import Path
Path('/tmp/bl1166_from.txt').write_text(
    "export const OPERATOR_DOCS_READ_ROUTE_PATHS = [\n"
    "  '/operator-docs',\n"
    "  '/operator-docs-index',\n"
    "  '/operator-docs-page',\n"
    "] as const;"
)
Path('/tmp/bl1166_to.txt').write_text(
    "export const OPERATOR_DOCS_READ_ROUTE_PATHS = [\n"
    "  '/operator-docs',\n"
    "  '/operator-docs-index',\n"
    "] as const;"
)
PY
mutate_file "$CORE" "OPERATOR_DOCS_READ_ROUTE_PATHS drops page route"

python3 - <<'PY'
from pathlib import Path
Path('/tmp/bl1166_from.txt').write_text(
    "return headingLines.map((entry, index) => {\n"
    "    const nextLine = index + 1 < headingLines.length ? headingLines[index + 1].lineIndex : lines.length;\n"
    "    return {\n"
    "      mode: entry.mode,\n"
    "      heading: lines[entry.lineIndex].replace(/^#{1,6}\\s*/, '').trim(),\n"
    "      links: parseLinksFromSection(sliceSectionText(lines, entry.lineIndex, nextLine)),\n"
    "    };\n"
    "  });"
)
Path('/tmp/bl1166_to.txt').write_text("return [];")
assert Path('/tmp/bl1166_from.txt').read_text() in Path('extension/src/bridge/operatorDocsCore.ts').read_text()
PY
mutate_file "$CORE" "parseDocsIndexSections returns empty sections"

python3 - <<'PY'
from pathlib import Path
Path('/tmp/bl1166_from.txt').write_text(
    "+ 'Bridge reachability is required to browse the authored docs corpus. '"
)
Path('/tmp/bl1166_to.txt').write_text("+ 'Connection issue. '")
PY
mutate_file "$HTML" "unavailable state omits Bridge reachability wording"

# Both static <h1> and renderIndex assignment — replace all so the APS match dies.
python3 - <<'PY'
from pathlib import Path
Path('/tmp/bl1166_from.txt').write_text('Operator authored documentation')
Path('/tmp/bl1166_to.txt').write_text('Docs')
PY
mutate_file "$HTML" "page title no longer identifies operator authored documentation" all

echo "surgical killed=$killed survived=$survived skipped=$skipped"
[[ "$survived" -eq 0 ]] || exit 1
[[ "$skipped" -eq 0 ]] || exit 1
echo "ALL MUTANTS KILLED"
exit 0
