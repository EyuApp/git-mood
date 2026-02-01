# git-mood

**AI-powered Git assistant** — generate conventional commit messages and run quick code reviews using Google Gemini.

- **commit** — AI suggests a commit message from your staged diff, then commit (and optionally push).
- **review** — AI reviews your current diff for bugs, security, and clean-code tips.
- **model** — Switch between Gemini Flash-Lite, Flash 2.5, and Flash 3.

---

## Install

```bash
npm install -g git-mood
```

Or run without installing (with `npx`):

```bash
npx git-mood setup
npx git-mood commit
```

---

## Setup (first-time)

Run once to store your **Google Gemini API key** and pick a **model**:

```bash
git-mood setup
```

You’ll be prompted for:

1. **API key** — Paste your key (plain input so you can paste). Get one at [Google AI Studio](https://aistudio.google.com/apikey). It’s stored locally (see [How API key is stored](#how-api-key-is-stored)).
2. **Model** — Use **↑/↓ arrow keys** to choose, **Enter** to select:
   - **Flash-Lite 2.5** — New & lightest
   - **Flash 2.5** — Fast & balanced (default)
   - **Flash 3** — Newest

Change the model later with:

```bash
git-mood model
```

(Same arrow-key list; choose and press Enter.)

---

## How to use

### Generate commit message and commit

1. Stage your changes: `git add .` (or specific files).
2. Run:

   ```bash
   git-mood commit
   ```

3. git-mood analyzes the diff, suggests a **Conventional Commits**-style message, and asks to confirm.
4. After committing, it can push to the remote (with optional pull-if-needed).

### Code review (no commit)

Review current working + staged diff for bugs, security, and improvements:

```bash
git-mood review
```

---

## Commands

| Command   | Description                              |
|----------|------------------------------------------|
| `git-mood setup`  | Set Gemini API key and model (first-time). API key = plain input (paste OK). Model = arrow keys + Enter. |
| `git-mood commit` | Generate commit message from staged diff, commit, optional push. |
| `git-mood review` | AI code review of current diff.          |
| `git-mood model`  | Change Gemini model (arrow keys + Enter to select). |

---

## How API key is stored

- git-mood uses [conf](https://github.com/sindresus/conf) to store config on your machine (project name: `git-mood`).
- Stored values: `gemini_key` (your API key) and `model_id` (e.g. `gemini-2.5-flash`).
- Location is OS-specific (e.g. `%APPDATA%\git-mood\config.json` on Windows, `~/.config/git-mood/` on Linux/macOS).
- The key is **only used to call Google’s Gemini API** from your machine; it isn’t sent to any other service.

---

## Requirements

- **Node.js** 18+
- **Git** repo (run commands from a repo with staged or unstaged changes as needed).

---

## License

ISC
"# git-mood" 
