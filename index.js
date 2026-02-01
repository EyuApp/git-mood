#!/usr/bin/env node
import { program } from 'commander';
import simpleGit from 'simple-git';
import { GoogleGenerativeAI } from '@google/generative-ai';
import chalk from 'chalk';
import inquirer from 'inquirer';
import Conf from 'conf';

const config = new Conf({ projectName: 'git-mood' });
const git = simpleGit();

const MODELS = [
  { id: 'gemini-2.5-flash-lite', name: 'Flash-Lite 2.5 (New & Lightest)' },
  { id: 'gemini-2.5-flash', name: 'Flash 2.5 (Fast & Balanced)' },
  { id: 'gemini-3-flash-preview', name: 'Flash 3 (Newest)' },
];
const DEFAULT_MODEL = 'gemini-2.5-flash';

function getModelId() {
  return config.get('model_id') ?? DEFAULT_MODEL;
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
async function generateCommit() {
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
    const prompt = `
      You are an expert developer. Write a single, concise git commit message for these changes.
      Follow "Conventional Commits" format (e.g., 'feat: add login', 'fix: resolve crash').
      Do not add quotes or extra text. Just the message.
      
      THE DIFF:
      ${diff.substring(0, 5000)}
    `;

    const result = await model.generateContent(prompt);
    const message = result.response.text().trim();
    console.log("\r" + " ".repeat(50) + "\r"); // Clear spinner

    console.log(chalk.green("Suggested Message: ") + chalk.bold.white(message));

    // 2. Ask user to confirm COMMIT
    const commitAnswer = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'Commit with this message?',
        default: true
      }
    ]);

    if (commitAnswer.confirm) {
      await git.commit(message);
      console.log(chalk.green("✅ Committed locally!"));

      // 3. NEW STEP: Ask user to PUSH
      const pushAnswer = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'shouldPush',
          message: '🚀 Do you want to push to GitHub now?',
          default: true
        }
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
                
                const pullAnswer = await inquirer.prompt([
                    {
                        type: 'confirm',
                        name: 'shouldPull',
                        message: 'Do you want to PULL (download) changes and try pushing again?',
                        default: true
                    }
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

    } else {
      console.log(chalk.yellow("❌ Cancelled."));
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
    const prompt = `
      Review this code diff like a Senior Engineer.
      1. Identify potential bugs (logic errors, memory leaks).
      2. Point out security risks (exposed keys, unsafe inputs).
      3. Suggest 1 clean code improvement.
      
      Format output as a bulleted list. Be helpful but strict.
      
      THE DIFF:
      ${diff.substring(0, 8000)}
    `;

    const result = await model.generateContent(prompt);
    console.log("\r" + " ".repeat(50) + "\r");

    console.log(chalk.bold.magenta("\n🛡️  AI CODE REVIEW REPORT 🛡️"));
    console.log(result.response.text());

  } catch (e) {
    console.error(chalk.red("Error:"), e.message);
  }
}

// --- COMMAND 3: SETUP ---
async function setupCLI() {
  const answers = await inquirer.prompt([
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
      default: getModelId(),
    },
  ]);
  config.set('gemini_key', answers.apiKey);
  config.set('model_id', answers.modelId);
  console.log(chalk.green("✅ API Key and model saved."));
}

// --- COMMAND 4: MODEL (change model) ---
async function modelCLI() {
  const answer = await inquirer.prompt([
    {
      type: 'select',
      name: 'modelId',
      message: 'Choose Gemini model (↑/↓ arrows, Enter to select):',
      choices: MODELS.map((m) => ({ name: m.name, value: m.id })),
      default: getModelId(),
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
  .version('2.0.0');

program.command('setup').description('Set Gemini API key and model').action(setupCLI);
program.command('model').description('Change Gemini model').action(modelCLI);

program
  .command('commit')
  .description('Generates a commit message from your staged changes and commits it')
  .action(generateCommit);

program
  .command('review')
  .description('Scans your current changes for bugs before you commit')
  .action(codeReview);

program.parse();