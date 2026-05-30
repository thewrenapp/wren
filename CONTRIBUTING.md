# Contributing to Wren

Thanks for your interest in Wren! Contributions — bug reports, features,
documentation, and code — are genuinely welcome. This document explains how to
contribute and the standards we hold contributions to.

By contributing, you agree that your contributions will be licensed under the
project's [MIT License](./LICENSE), and you agree to follow our
[Code of Conduct](./CODE_OF_CONDUCT.md).

---

## No vibe-coded contributions

This is the one hard rule, and it is non-negotiable.

**You may use AI tools, but you may NOT "vibe code":** don't open a PR with code
you haven't read, don't understand, can't explain, and couldn't have written
yourself.

You are accountable for every line you submit. If a maintainer asks how or why
something works, you must be able to answer. PRs that are clearly unreviewed AI
output — or whose author can't explain them — will be closed without further
review.

**What this means in practice:**

- ✅ Using an AI assistant to scaffold, explore, or speed yourself up is fine —
  **as long as you read every line, understand it, test it, and can maintain it.**
- ✅ You own the result. Treat AI output like a snippet from a stranger on the
  internet: verify it, don't trust it.
- ❌ Pasting a prompt's output into a PR without reading it.
- ❌ Generating large diffs you can't walk a reviewer through.
- ❌ "The AI said it works" is not a substitute for understanding and testing.

Why: Wren is a tool people trust with their research library. Every line needs an
accountable human behind it who can maintain and reason about it. Quantity of
generated code is worthless without comprehension.

Every pull request includes an attestation checkbox confirming you wrote and
understand your change. Checking it dishonestly is grounds for closing the PR and
revoking contribution privileges.

---

## Ways to contribute

- **Report a bug** — open an issue using the bug report template. Include your OS,
  Wren version, and clear reproduction steps.
- **Request a feature** — open an issue using the feature request template and
  describe the problem you're trying to solve, not just the solution.
- **Improve docs** — typo fixes and clarifications are great first contributions.
- **Submit code** — see the workflow below. For anything non-trivial, please open
  an issue to discuss the approach first so we don't waste your time.

Security vulnerabilities must **not** be filed as public issues — see
[SECURITY.md](./SECURITY.md).

## Development setup

Requirements: macOS, **Rust 1.96+** (`rustup`), **Node.js 20+**, and Xcode Command
Line Tools (`xcode-select --install`).

```bash
git clone https://github.com/OWNER/wren.git
cd wren
npm install
npm run tauri:dev      # run the app with hot-reload
```

Project layout:

- `src/` — React + TypeScript frontend (Tauri webview)
- `src-tauri/src/` — Rust backend (commands, search, document parsing, jobs, …)
- `docs/` — additional documentation

## Quality bar

Before opening a PR, your change must pass these — they are required:

```bash
# Frontend type-check (zero errors)
npx tsc --noEmit

# Rust lint (ZERO warnings — warnings are treated as failures)
cd src-tauri && cargo clippy --all-targets
```

Conventions:

- **No compiler or clippy warnings.** Ever. Fix them, don't suppress them.
- **Theming:** use the CSS custom-property design tokens (`bg-background`,
  `text-foreground`, `hsl(var(--…))`, …). Don't hardcode hex/rgb colors for
  UI/structural elements.
- Keep files focused and reasonably small; prefer clear names matching the
  surrounding code's style.
- Match the existing code's idioms rather than introducing new patterns
  unprompted.

## Pull request workflow

1. Fork the repo and create a branch from `main` (e.g. `fix/export-attachments`).
2. Make your change. Keep PRs focused — one logical change per PR.
3. Write a clear description: what changed, why, and how you tested it. Link any
   related issue (`Fixes #123`).
4. Ensure `tsc --noEmit` and `cargo clippy` are clean, and test the behavior in
   the running app.
5. Fill out the PR template honestly, including the no-vibe-coding attestation.
6. Be responsive to review feedback.

We may ask you to explain parts of your change. This isn't a gotcha — it's how we
keep the codebase maintainable. If you wrote and understand your change, it's easy.

Thank you for helping make Wren better.
