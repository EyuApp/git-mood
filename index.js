#!/usr/bin/env node
import { program } from 'commander';
import simpleGit from 'simple-git';
import { GoogleGenerativeAI } from '@google/generative-ai';
import chalk from 'chalk';
import inquirerPkg from 'inquirer';
import Conf from 'conf';
import fs from 'node:fs/promises';
import path from 'node:path';

const config = new Conf({ projectName: 'git-mood' });
const git = simpleGit();

// Inquirer has changed module shapes across versions (ESM/CJS interop).
// Normalize to a single `prompt()` function to avoid runtime "prompt is not a function".
const inquirer = (inquirerPkg && typeof inquirerPkg === 'object' && 'default' in inquirerPkg)
  ? inquirerPkg.default
  : inquirerPkg;
const inqPrompt = (inquirer && typeof inquirer === 'object' && typeof inquirer.prompt === 'function')
  ? inquirer.prompt.bind(inquirer)
  : (typeof inquirer === 'function' ? inquirer : undefined);
if (typeof inqPrompt !== 'function') {
  throw new Error("Inquirer failed to load: expected a 'prompt' function.");
}

const MODELS = [
  { id: 'gemini-2.5-flash-lite', name: 'Flash-Lite 2.5 (New & Lightest)' },
  { id: 'gemini-2.5-flash', name: 'Flash 2.5 (Fast & Balanced)' },
  { id: 'gemini-3-flash-preview', name: 'Flash 3 (Newest)' },
];
const DEFAULT_MODEL = 'gemini-2.5-flash';

function getModelId() {
  return config.get('model_id') ?? DEFAULT_MODEL;
}

function parseCommitSuggestion(text) {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return { subject: '', body: '' };

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const jsonSlice = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      const parsed = JSON.parse(jsonSlice);
      return {
        subject: String(parsed.subject ?? '').trim(),
        body: String(parsed.body ?? '').trim(),
      };
    } catch {
    
    }
  }

  const lines = trimmed.split(/\r?\n/);
  const subject = (lines.shift() ?? '').trim();
  const body = lines.join('\n').trim();
  return { subject, body };
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function safeReadText(filePath, maxChars) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    if (typeof maxChars === 'number' && maxChars > 0 && content.length > maxChars) {
      return content.slice(0, maxChars);
    }
    return content;
  } catch {
    return '';
  }
}

async function buildFileTree(rootDir, options) {
  const ignore = new Set(options?.ignore ?? ['node_modules', '.git']);
  const maxDepth = options?.maxDepth ?? 6;
  const maxEntries = options?.maxEntries ?? 500;

  let entriesCount = 0;
  const lines = [];

  async function walk(currentDir, depth) {
    if (depth > maxDepth) return;
    if (entriesCount >= maxEntries) return;

    let dirents;
    try {
      dirents = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    dirents.sort((a, b) => a.name.localeCompare(b.name));

    for (const d of dirents) {
      if (entriesCount >= maxEntries) return;
      if (ignore.has(d.name)) continue;

      const full = path.join(currentDir, d.name);
      const rel = path.relative(rootDir, full).replace(/\\/g, '/');

      lines.push(rel + (d.isDirectory() ? '/' : ''));
      entriesCount += 1;

      if (d.isDirectory()) {
        await walk(full, depth + 1);
      }
    }
  }

  await walk(rootDir, 0);
  return lines.join('\n');
}

async function collectProjectContext(rootDir, scope) {
  const packageJsonPath = path.join(rootDir, 'package.json');
  const packageJson = await safeReadText(packageJsonPath, 12000);
  const cliCommands = `
git-mood setup
git-mood model
git-mood commit
git-mood review
git-mood readme
`.trim();

  if (scope === 'package') {
    return `PACKAGE.JSON:\n${packageJson}\n\nCLI COMMANDS:\n${cliCommands}`;
  }

  const tree = await buildFileTree(rootDir, { ignore: ['node_modules', '.git'], maxDepth: 6, maxEntries: 500 });

  if (scope === 'tree_key') {
    const indexPath = path.join(rootDir, 'index.js');
    const indexJs = await safeReadText(indexPath, 20000);
    return `PACKAGE.JSON:\n${packageJson}\n\nCLI COMMANDS:\n${cliCommands}\n\nFILE TREE:\n${tree}\n\nKEY SOURCE FILES:\n\n--- index.js ---\n${indexJs}`;
  }

  const readmePath = path.join(rootDir, 'README.md');
  const existingReadme = await safeReadText(readmePath, 20000);
  const packageLockPath = path.join(rootDir, 'package-lock.json');
  const packageLock = await safeReadText(packageLockPath, 12000);
  const indexPath = path.join(rootDir, 'index.js');
  const indexJs = await safeReadText(indexPath, 20000);

  return `PACKAGE.JSON:\n${packageJson}\n\nPACKAGE-LOCK.JSON (TRUNCATED):\n${packageLock}\n\nCLI COMMANDS:\n${cliCommands}\n\nFILE TREE:\n${tree}\n\nEXISTING README (IF ANY):\n${existingReadme}\n\nSOURCE FILES:\n\n--- index.js ---\n${indexJs}`;
}

async function generateReadme() {
  try {
    const rootDir = process.cwd();
    const readmePath = path.join(rootDir, 'README.md');
    const hasReadme = await fileExists(readmePath);

    const scopeAnswer = await inqPrompt([
      {
        type: 'select',
        name: 'scope',
        message: 'Choose context for README generation:',
        choices: [
          { name: 'Only package.json + CLI commands (fast)', value: 'package' },
          { name: 'File tree + key source files (recommended)', value: 'tree_key' },
          { name: 'Everything (can be slow / token-heavy)', value: 'all' },
        ],
        default: 0,
      },
    ]);

    if (hasReadme) {
      const overwriteAnswer = await inqPrompt([
        {
          type: 'confirm',
          name: 'overwrite',
          message: 'README.md already exists. Overwrite it?',
          default: false,
        },
      ]);
      if (!overwriteAnswer.overwrite) {
        console.log(chalk.yellow('❌ Cancelled.'));
        return;
      }
    }

    process.stdout.write(chalk.blue('🧠 Writing README...'));

    const model = getAI();
    const context = await collectProjectContext(rootDir, scopeAnswer.scope);
    const prompt = `
      You are an expert technical writer.
      Generate a high-quality README.md for this project in Markdown.
      Output Markdown ONLY.

      Include these sections (if applicable):
      - Title
      - Description
      - Features
      - Installation
      - Setup (including Gemini API key configuration)
      - Usage (show CLI commands and examples)
      - Configuration
      - Requirements
      - License

      Keep it concise and accurate. Do not invent features.

      PROJECT CONTEXT:
      ${context}
    `;

    const result = await model.generateContent(prompt);
    const markdown = (result?.response?.text?.() ?? '').trim();

    console.log("\r" + " ".repeat(50) + "\r");

    if (!markdown) {
      console.log(chalk.red('❌ Failed to generate README content.'));
      return;
    }

    await fs.writeFile(readmePath, markdown + '\n', 'utf8');
    console.log(chalk.green('✅ README.md generated!'));
    console.log(chalk.cyan('📄 Saved locally to: ') + chalk.white(readmePath));
    console.log(chalk.yellow('ℹ️  This only writes the file locally. It does NOT commit or push to GitHub yet.'));

    let isRepo = false;
    try {
      isRepo = await git.checkIsRepo();
    } catch {
      isRepo = false;
    }

    if (isRepo) {
      const stageAnswer = await inqPrompt([
        {
          type: 'confirm',
          name: 'stage',
          message: 'Stage README.md now (git add README.md)?',
          default: false,
        },
      ]);

      if (stageAnswer.stage) {
        await git.add(['README.md']);
        console.log(chalk.green('✅ Staged README.md'));

        const commitNowAnswer = await inqPrompt([
          {
            type: 'confirm',
            name: 'commitNow',
            message: 'Generate commit message and commit now?',
            default: false,
          },
        ]);

        if (commitNowAnswer.commitNow) {
          await generateCommit();
        } else {
          console.log(chalk.gray('Next: run `git-mood commit` when you are ready.'));
        }
      } else {
        console.log(chalk.gray('Next: `git add README.md` then `git-mood commit` to publish it.'));
      }
    }
  } catch (e) {
    console.error(chalk.red('Error:'), e.message);
  }
}

// --- HELPER: GET AI MODEL ---
function getAI() {
  const apiKey = config.get('gemini_key');
  if (!apiKey) {
    console.log(chalk.red("❌ No API Key found! Run 'git-mood setup' first."));
    process.exit(1);
  }
  const genAI = new GoogleGenerativeAI(apiKey);
  const modelId = getModelId();
  return genAI.getGenerativeModel({ model: modelId });
}

// --- COMMAND 1: AUTO COMMIT & PUSH ---
async function generateCommit(options = {}) {
  try {
    // 1. Check staged files
    const diff = await git.diff(['--staged']);

    if (!diff) {
      console.log(chalk.yellow("⚠️ No staged changes found. Did you run 'git add .'?"));
      return;
    }

    process.stdout.write(chalk.blue("🧠 Analyzing changes..."));

    const model = getAI();
    // Prompt asking for a conventional commit message
    const aiPrompt = `
      You are an expert developer. Generate a git commit subject and an extended description for these changes.
      The subject MUST follow "Conventional Commits" format (e.g., 'feat: add login', 'fix: resolve crash').
      Keep the subject <= 72 characters and do not wrap it in quotes.
      The body should be 1-6 short lines explaining what changed and why (no code blocks).
      Return STRICT JSON only, with exactly these keys:
      {"subject":"...","body":"..."}
      
      THE DIFF:
      ${diff.substring(0, 5000)}
    `;

    const result = await model.generateContent(aiPrompt);
    const suggestion = parseCommitSuggestion(result.response.text());
    const subject = suggestion.subject;
    const body = suggestion.body;
    console.log("\r" + " ".repeat(50) + "\r"); // Clear spinner

    console.log(chalk.bold.cyan('\n─ Suggested Commit ─\n'));
    console.log(chalk.green('Subject: ') + chalk.bold.white(subject));
    if (body) {
      console.log(chalk.green('Description:\n') + chalk.white(body));
    }
    console.log(chalk.gray('─'.repeat(50)));

    let finalSubject = subject;
    let finalBody = body;

    if (options.interactive) {
      const edited = await inqPrompt([
        {
          type: 'input',
          name: 'subject',
          message: 'Edit commit subject:',
          default: finalSubject,
        },
        {
          type: 'editor',
          name: 'body',
          message: 'Edit commit description (body):',
          default: finalBody,
        },
      ]);
      finalSubject = String(edited.subject ?? '').trim();
      finalBody = String(edited.body ?? '').trim();
    } else {
      const nextAction = await inqPrompt([
        {
          type: 'select',
          name: 'action',
          message: 'What do you want to do?',
          choices: [
            { name: 'Commit as-is', value: 'commit' },
            { name: 'Edit then commit', value: 'edit_commit' },
            { name: 'Cancel', value: 'cancel' },
          ],
          default: 0,
        },
      ]);

      if (nextAction.action === 'cancel') {
        console.log(chalk.yellow('❌ Cancelled.'));
        return;
      }

      if (nextAction.action === 'edit_commit') {
        const edited = await inqPrompt([
          {
            type: 'input',
            name: 'subject',
            message: 'Edit commit subject:',
            default: finalSubject,
          },
          {
            type: 'editor',
            name: 'body',
            message: 'Edit commit description (body):',
            default: finalBody,
          },
        ]);
        finalSubject = String(edited.subject ?? '').trim();
        finalBody = String(edited.body ?? '').trim();
      }
    }

    if (!finalSubject) {
      console.log(chalk.red('❌ Commit subject cannot be empty.'));
      return;
    }

    const fullMessage = finalBody ? `${finalSubject}\n\n${finalBody}` : finalSubject;
    await git.commit(fullMessage);
    console.log(chalk.green("✅ Committed locally!"));

    // 3. NEW STEP: Ask user to PUSH
    const pushAnswer = await inqPrompt([
      {
        type: 'confirm',
        name: 'shouldPush',
        message: '🚀 Do you want to push to GitHub now?',
        default: true
      },
    ]);

    if (pushAnswer.shouldPush) {
      process.stdout.write(chalk.yellow("🚀 Pushing code..."));
      try {
          await git.push();
          console.log("\r" + " ".repeat(50) + "\r");
          console.log(chalk.green.bold("🎉 Pushed to GitHub successfully!"));
      } catch (pushError) {
          // Check if the error is because we need to pull
          if (pushError.message.includes('fetch first') || pushError.message.includes('rejected')) {
              console.log(chalk.yellow("\n⚠️  GitHub is ahead of your computer."));
              
              const pullAnswer = await inqPrompt([
                  {
                      type: 'confirm',
                      name: 'shouldPull',
                      message: 'Do you want to PULL (download) changes and try pushing again?',
                      default: true
                  },
              ]);

              if (pullAnswer.shouldPull) {
                  try {
                      console.log(chalk.blue("⬇️  Pulling changes..."));
                      await git.pull();
                      console.log(chalk.blue("⬆️  Pushing again..."));
                      await git.push();
                      console.log(chalk.green.bold("🎉 Pushed to GitHub successfully!"));
                  } catch (pullError) {
                      console.error(chalk.red("\n❌ Auto-fix failed. You likely have merge conflicts. Fix them manually."));
                  }
              }
          } else {
              console.error(chalk.red("\n❌ Push failed:"), pushError.message);
          }
      }
    }

  } catch (e) {
    console.error(chalk.red("Error:"), e.message);
  }
}

// --- COMMAND 2: CODE REVIEW ---
async function codeReview() {
  try {
    // Look at unstaged AND staged changes
    const diff = await git.diff();
    
    if (!diff) {
      console.log(chalk.green("✨ No changes to review. Working directory clean."));
      return;
    }

    process.stdout.write(chalk.magenta("🕵️  Scanning code for bugs and smell..."));

    const model = getAI();
    const aiPrompt = `
      Review this code diff like a Senior Engineer.
      1. Identify potential bugs (logic errors, memory leaks).
      2. Point out security risks (exposed keys, unsafe inputs).
      3. Suggest 1 clean code improvement.
      
      Format output as a bulleted list. Be helpful but strict.
      
      THE DIFF:
      ${diff.substring(0, 8000)}
    `;

    const result = await model.generateContent(aiPrompt);
    console.log("\r" + " ".repeat(50) + "\r");

    console.log(chalk.bold.magenta("\n🛡️  AI CODE REVIEW REPORT 🛡️"));
    console.log(result.response.text());

  } catch (e) {
    console.error(chalk.red("Error:"), e.message);
  }
}

// --- COMMAND 3: SETUP ---
async function setupCLI() {
  const answers = await inqPrompt([
    {
      type: 'input',
      name: 'apiKey',
      message: 'Paste your Google Gemini API Key:',
    },
    {
      type: 'select',
      name: 'modelId',
      message: 'Choose Gemini model (↑/↓ arrows, Enter to select):',
      choices: MODELS.map((m) => ({ name: m.name, value: m.id })),
      default: Math.max(0, MODELS.findIndex((m) => m.id === getModelId())),
    },
  ]);
  config.set('gemini_key', answers.apiKey);
  config.set('model_id', answers.modelId);
  console.log(chalk.green("✅ API Key and model saved."));
}

// --- COMMAND 4: MODEL (change model) ---
async function modelCLI() {
  const answer = await inqPrompt([
    {
      type: 'select',
      name: 'modelId',
      message: 'Choose Gemini model (↑/↓ arrows, Enter to select):',
      choices: MODELS.map((m) => ({ name: m.name, value: m.id })),
      default: Math.max(0, MODELS.findIndex((m) => m.id === getModelId())),
    },
  ]);
  config.set('model_id', answer.modelId);
  const label = MODELS.find((m) => m.id === answer.modelId)?.name ?? answer.modelId;
  console.log(chalk.green("✅ Model set to: " + label));
}

// --- CLI CONFIG ---
program
  .name('git-mood')
  .description('AI-Powered Git Assistant — conventional commits & code review')
  .version('2.0.9');

program.command('setup').description('Set Gemini API key and model').action(setupCLI);
program.command('model').description('Change Gemini model').action(modelCLI);

program
  .command('commit')
  .description('Generates a commit message from your staged changes and commits it')
  .option('-i, --interactive', 'Edit subject/body before committing')
  .action((options) => generateCommit(options));

program
  .command('review')
  .description('Scans your current changes for bugs before you commit')
  .action(codeReview);

program
  .command('readme')
  .description('Generates a README.md for your current project using AI')
  .action(generateReadme);

function cleanupAndExit(code) {
  try {
    if (process.stdin.isTTY) {
      try {
        process.stdin.setRawMode(false);
      } catch {
        // ignore
      }
    }
    process.stdin.pause();
    if (typeof process.stdin.unref === 'function') {
      process.stdin.unref();
    }
  } catch {
    // ignore
  }
  process.exit(code);
}

await program
  .parseAsync(process.argv)
  .then(() => cleanupAndExit(0))
  .catch((err) => {
    console.error(chalk.red('Error:'), err?.message ?? String(err));
    cleanupAndExit(1);
  });