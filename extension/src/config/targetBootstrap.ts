import * as fs from 'fs/promises';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { ProposedContract } from '../onboarding/contractTypes';
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

async function isGitRepository(targetPath: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['-C', targetPath, 'rev-parse', '--is-inside-work-tree']);
    return true;
  } catch {
    return false;
  }
}
