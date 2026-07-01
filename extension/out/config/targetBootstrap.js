"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildTargetBootstrapFiles = buildTargetBootstrapFiles;
exports.planTargetBootstrapFiles = planTargetBootstrapFiles;
exports.initializeTargetRepo = initializeTargetRepo;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
function buildTargetBootstrapFiles() {
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
function planTargetBootstrapFiles(existingFiles) {
    const filesToCreate = [];
    const alreadyPresent = [];
    for (const file of buildTargetBootstrapFiles()) {
        if (existingFiles.has(file.path)) {
            alreadyPresent.push(file.path);
        }
        else {
            filesToCreate.push(file);
        }
    }
    return { filesToCreate, alreadyPresent };
}
async function initializeTargetRepo(targetPath) {
    const files = buildTargetBootstrapFiles();
    const existingFiles = new Set();
    await Promise.all(files.map(async (file) => {
        try {
            await fs.access(path.join(targetPath, file.path));
            existingFiles.add(file.path);
        }
        catch {
            // file does not exist — will be created
        }
    }));
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
        ]).catch(async (error) => {
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
async function isGitRepository(targetPath) {
    try {
        await execFileAsync('git', ['-C', targetPath, 'rev-parse', '--is-inside-work-tree']);
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=targetBootstrap.js.map