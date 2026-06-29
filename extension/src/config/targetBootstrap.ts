import * as fs from 'fs/promises';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

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

export function planTargetBootstrapFiles(existingFiles: Set<string>): BootstrapPlan {
  const filesToCreate: BootstrapFile[] = [];
  const alreadyPresent: string[] = [];

  for (const file of buildTargetBootstrapFiles()) {
    if (existingFiles.has(file.path)) {
      alreadyPresent.push(file.path);
    } else {
      filesToCreate.push(file);
    }
  }

  return { filesToCreate, alreadyPresent };
}

export async function initializeTargetRepo(targetPath: string): Promise<{
  created: string[];
  skipped: string[];
  committed: boolean;
}> {
  const files = buildTargetBootstrapFiles();
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

  const plan = planTargetBootstrapFiles(existingFiles);

  for (const file of plan.filesToCreate) {
    await fs.writeFile(path.join(targetPath, file.path), file.content, 'utf8');
  }

  let committed = false;
  if (plan.filesToCreate.length > 0 && (await isGitRepository(targetPath))) {
    const createdPaths = plan.filesToCreate.map((f) => f.path);
    await execFileAsync('git', ['-C', targetPath, 'add', ...createdPaths]);
    const commitResult = await execFileAsync('git', [
      '-C',
      targetPath,
      'commit',
      '-m',
      'Initialize SwarmForge target prompts',
    ]).catch(async (error: { stdout?: string; stderr?: string }) => {
      const message = `${error.stderr ?? ''}\n${error.stdout ?? ''}`.trim();
      if (!message.includes('nothing to commit')) {
        throw error;
      }
      return undefined;
    });
    committed = Boolean(commitResult);
  }

  return {
    created: plan.filesToCreate.map((file) => file.path),
    skipped: plan.alreadyPresent,
    committed,
  };
}

async function isGitRepository(targetPath: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['-C', targetPath, 'rev-parse', '--is-inside-work-tree']);
    return true;
  } catch {
    return false;
  }
}
