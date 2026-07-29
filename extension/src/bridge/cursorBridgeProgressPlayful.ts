// Whimsical Telegram progress labels — Frank Zappa titles as verb fuel.

import type { ProgressLocale } from './progressLocale';
import { readActiveRun } from './cursorBridgeRunTracker';
import { zappaPhraseForTool } from './zappaWorkTitles';

type ToolPhrases = { run: string; done: string; fail: string };

const KNOWN_TOOL_VERBS: Record<ProgressLocale, Record<string, ToolPhrases>> = {
  fr: {
    shell: {
      run: 'enchiladaïse le terminal',
      done: 'nanook a frotté le shell',
      fail: 'stink-foot sur le shell',
    },
    grep: {
      run: 'florentine-pogne les haystacks',
      done: 'muffin man a trouvé la ligne',
      fail: 'cosmik debris dans le grep',
    },
    glob: {
      run: 'cosmik-debrise les chemins',
      done: 'inca roads cartographiées',
      fail: 'valley girl perdue dans le glob',
    },
    read: {
      run: 'uncle-meat le fichier',
      done: 'peaches en regalia — lu',
      fail: 'black napkins sur la lecture',
    },
    write: {
      run: 'apostrophe le parchemin',
      done: 'sofa no. 2 inscrit',
      fail: 'yellow snow sur l’écriture',
    },
    edit: {
      run: 'hot-rats le manuscrit',
      done: 'torture (édition) accomplie',
      fail: 'billy the mountain a bloqué l’edit',
    },
    search: {
      run: 'central scrutinizer fouille',
      done: 'jazz discharge — trouvé',
      fail: 'dinosaurs extincts, rien trouvé',
    },
    webfetch: {
      run: 'valley-girl la toile',
      done: 'watermelon in easter hay — fetché',
      fail: 'dancin’ fool sur le fetch',
    },
    task: {
      run: 'joe’s garage délègue',
      done: 'keep it greasey — tâche close',
      fail: 'city of tiny lites — tâche KO',
    },
  },
  en: {
    shell: {
      run: 'enchiladaizing the terminal',
      done: 'nanook rubbed the shell',
      fail: 'stink-foot on the shell',
    },
    grep: {
      run: 'florentine-pogging the haystacks',
      done: 'muffin man found the line',
      fail: 'cosmik debris in grep',
    },
    glob: {
      run: 'cosmik-debrising the paths',
      done: 'inca roads mapped',
      fail: 'valley girl lost in glob',
    },
    read: {
      run: 'uncle-meating the file',
      done: 'peaches en regalia — read',
      fail: 'black napkins on the read',
    },
    write: {
      run: 'apostrophizing the parchment',
      done: 'sofa no. 2 inscribed',
      fail: 'yellow snow on the write',
    },
    edit: {
      run: 'hot-ratsing the manuscript',
      done: 'torture never stops — edit done',
      fail: 'billy the mountain blocked the edit',
    },
    search: {
      run: 'central scrutinizer searches',
      done: 'jazz discharge — found it',
      fail: 'dinosaurs extinct, nothing found',
    },
    webfetch: {
      run: 'valley-girling the web',
      done: 'watermelon in easter hay — fetched',
      fail: 'dancin’ fool on fetch',
    },
    task: {
      run: 'joe’s garage delegates',
      done: 'keep it greasey — task closed',
      fail: 'city of tiny lites — task KO',
    },
  },
};

const STATUS_LINES: Record<ProgressLocale, { creating: string; running: string }> = {
  fr: {
    creating: '🔄 peaches en regalia — l’agent démarre…',
    running: '▶ jazz discharge party hats — agent en marche…',
  },
  en: {
    creating: '🔄 peaches en regalia — agent spinning up…',
    running: '▶ jazz discharge party hats — agent running…',
  },
};

export function resolvePlayfulLocale(locale?: ProgressLocale): ProgressLocale {
  return locale ?? readActiveRun()?.locale ?? 'en';
}

export function isPlayfulProgressEnabled(): boolean {
  const raw = process.env.CURSOR_BRIDGE_PLAYFUL_PROGRESS?.trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'off') {
    return false;
  }
  return true;
}

export function playfulToolProgressLabel(
  toolName: string,
  phase: 'running' | 'completed' | 'error',
  locale?: ProgressLocale
): string {
  const lang = resolvePlayfulLocale(locale);
  const key = toolName.toLowerCase().split(/[._/:-]/)[0];
  const known = KNOWN_TOOL_VERBS[lang][key];
  const phrase = known
    ? phase === 'running'
      ? known.run
      : phase === 'completed'
        ? known.done
        : known.fail
    : zappaPhraseForTool(toolName, lang, phase);

  if (phase === 'running') {
    return `🔧 ${phrase}…`;
  }
  if (phase === 'completed') {
    return `✓ ${phrase}`;
  }
  return `✗ ${phrase}`;
}

export function playfulStatusProgressLine(
  status: 'CREATING' | 'RUNNING',
  message?: string,
  locale?: ProgressLocale
): string | undefined {
  const lang = resolvePlayfulLocale(locale);
  if (status === 'CREATING') {
    return STATUS_LINES[lang].creating;
  }
  if (message?.trim()) {
    return `▶ ${message}`;
  }
  return STATUS_LINES[lang].running;
}
