import * as fs from 'fs/promises';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { GateDecision, ProposedContract, ProposedPrompts } from '../onboarding/contractTypes';
import { generateContractMarkdown, renderContractYaml } from '../onboarding/contractView';

const execFileAsync = promisify(execFile);

export interface BootstrapFile {
  path: string;
  content: string;
}

export interface BootstrapPlan {
  filesToCreate: BootstrapFile[];
  alreadyPresent: string[];
}

export function buildTargetBootstrapFiles(): BootstrapFile[] {
  return [
    {
      path: 'project.prompt',
      content: [
        '# Project',
        '<what this project does and why>',
        '',
        '# Goals for this swarm run',
        '<what you want built or fixed - updated before each run>',
        '',
        '# Constraints',
        '<anything the swarm must not touch or break>',
        '',
      ].join('\n'),
    },
    {
      path: 'engineering.prompt',
      content: [
        '# Tech Stack',
        '<languages, frameworks, runtimes>',
        '',
        '# Conventions',
        '<naming, folder structure, testing approach>',
        '',
        '# Architecture rules',
        '<patterns to follow, anti-patterns to avoid>',
        '',
      ].join('\n'),
    },
  ];
}

// BL-262: generalized to plan over any file list (defaulting to the two
// swarm bootstrap prompts, unchanged for every existing caller) so the same
// existence-only idempotency seam covers the onboarding contract files too,
// without a second plan function.
export function planTargetBootstrapFiles(
  existingFiles: Set<string>,
  files: BootstrapFile[] = buildTargetBootstrapFiles()
): BootstrapPlan {
  const filesToCreate: BootstrapFile[] = [];
  const alreadyPresent: string[] = [];

  for (const file of files) {
    if (existingFiles.has(file.path)) {
      alreadyPresent.push(file.path);
    } else {
      filesToCreate.push(file);
    }
  }

  return { filesToCreate, alreadyPresent };
}

// BL-262: the proposed onboarding contract's hybrid artifact - a structured
// .swarmforge/contract.yaml the build-start gate parses, plus a generated
// legible CONTRACT.md for the target's humans (BL-262
// legible-view-mirrors-source-03: both rendered from the SAME ProposedContract,
// so they can never diverge).
export function buildContractBootstrapFiles(contract: ProposedContract): BootstrapFile[] {
  return [
    { path: path.join('.swarmforge', 'contract.yaml'), content: renderContractYaml(contract) },
    { path: 'CONTRACT.md', content: generateContractMarkdown(contract) },
  ];
}

async function writeAndCommitBootstrapPlan(
  targetPath: string,
  files: BootstrapFile[],
  commitMessage: string
): Promise<{
  created: string[];
  skipped: string[];
  committed: boolean;
}> {
  const existingFiles = new Set<string>();
  await Promise.all(
    files.map(async (file) => {
      try {
        await fs.access(path.join(targetPath, file.path));
        existingFiles.add(file.path);
      } catch {
        // file does not exist — will be created
      }
    })
  );

  const plan = planTargetBootstrapFiles(existingFiles, files);

  for (const file of plan.filesToCreate) {
    await fs.mkdir(path.dirname(path.join(targetPath, file.path)), { recursive: true });
    await fs.writeFile(path.join(targetPath, file.path), file.content, 'utf8');
  }

  let committed = false;
  if (plan.filesToCreate.length > 0 && (await isGitRepository(targetPath))) {
    const createdPaths = plan.filesToCreate.map((f) => f.path);
    await execFileAsync('git', ['-C', targetPath, 'add', ...createdPaths]);
    const commitResult = await execFileAsync('git', ['-C', targetPath, 'commit', '-m', commitMessage]).catch(
      async (error: { stdout?: string; stderr?: string }) => {
        const message = `${error.stderr ?? ''}\n${error.stdout ?? ''}`.trim();
        if (!message.includes('nothing to commit')) {
          throw error;
        }
        return undefined;
      }
    );
    committed = Boolean(commitResult);
  }

  return {
    created: plan.filesToCreate.map((file) => file.path),
    skipped: plan.alreadyPresent,
    committed,
  };
}

export async function initializeTargetRepo(targetPath: string): Promise<{
  created: string[];
  skipped: string[];
  committed: boolean;
}> {
  return writeAndCommitBootstrapPlan(targetPath, buildTargetBootstrapFiles(), 'Initialize SwarmForge target prompts');
}

// BL-262: scaffolds + commits the proposed onboarding contract on target
// onboarding, reusing the exact same idempotent plan/write/commit seam as
// initializeTargetRepo above (never a duplicate mechanism).
export async function initializeTargetContract(
  targetPath: string,
  contract: ProposedContract
): Promise<{
  created: string[];
  skipped: string[];
  committed: boolean;
}> {
  return writeAndCommitBootstrapPlan(
    targetPath,
    buildContractBootstrapFiles(contract),
    'Propose SwarmForge onboarding contract'
  );
}

// BL-344: a negotiation round REVISES an already-existing contract.yaml/
// CONTRACT.md - writeAndCommitBootstrapPlan's own idempotency is
// existence-only (it never overwrites a file that is already there), the
// right behavior for a first proposal but the wrong one for a revision,
// which must always land. Unconditional write + commit, reusing the SAME
// buildContractBootstrapFiles rendering so the structured source and the
// legible view never diverge, exactly as slice 1 already guarantees.
export async function updateTargetContract(
  targetPath: string,
  contract: ProposedContract,
  commitMessage: string
): Promise<{ committed: boolean }> {
  const files = buildContractBootstrapFiles(contract);
  for (const file of files) {
    const filePath = path.join(targetPath, file.path);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, file.content, 'utf8');
  }
  let committed = false;
  if (await isGitRepository(targetPath)) {
    await execFileAsync('git', ['-C', targetPath, 'add', ...files.map((f) => f.path)]);
    const commitResult = await execFileAsync('git', ['-C', targetPath, 'commit', '-m', commitMessage]).catch(
      async (error: { stdout?: string; stderr?: string }) => {
        const message = `${error.stderr ?? ''}\n${error.stdout ?? ''}`.trim();
        if (!message.includes('nothing to commit')) {
          throw error;
        }
        return undefined;
      }
    );
    committed = Boolean(commitResult);
  }
  return { committed };
}

// BL-269: the target repo's own project.prompt/engineering.prompt,
// generated from the survey (replaces buildTargetBootstrapFiles's generic
// placeholder content for the same two paths once this has run - the
// existing existence-only idempotency in writeAndCommitBootstrapPlan means
// whichever of the two runs FIRST wins; initializeTargetRepo's generic
// scaffold backs off on a path that already exists).
export function buildGeneratedPromptBootstrapFiles(prompts: ProposedPrompts): BootstrapFile[] {
  return [
    { path: 'project.prompt', content: prompts.projectPrompt },
    { path: 'engineering.prompt', content: prompts.engineeringPrompt },
  ];
}

// BL-269: the generated prompts ride the SAME agreement gate as the
// contract (one agreement, whole artifact set) - withheld from the target
// repo (never written, never committed) while gateDecision is 'hold'
// (proposed/pending/missing/malformed), released for commit only on
// 'allow' (agreed). Unlike initializeTargetContract's contract.yaml/
// CONTRACT.md (committed immediately, marked "proposed", so the human can
// review/edit it during negotiation), these prose files simply do not
// exist in the target repo until agreement - BL-269's own explicit
// "withheld from... released for commit to" contract.
export async function initializeTargetPrompts(
  targetPath: string,
  prompts: ProposedPrompts,
  gateDecision: GateDecision
): Promise<{
  created: string[];
  skipped: string[];
  committed: boolean;
  withheld: boolean;
}> {
  if (gateDecision.decision !== 'allow') {
    return { created: [], skipped: [], committed: false, withheld: true };
  }
  const result = await writeAndCommitBootstrapPlan(
    targetPath,
    buildGeneratedPromptBootstrapFiles(prompts),
    'Commit onboarding-generated target prompts'
  );
  return { ...result, withheld: false };
}

async function isGitRepository(targetPath: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['-C', targetPath, 'rev-parse', '--is-inside-work-tree']);
    return true;
  } catch {
    return false;
  }
}
