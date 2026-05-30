# Security Policy

## Supported versions

Wren is in early development. Security fixes are applied to the latest `0.1.x`
release and `main`.

| Version | Supported |
| ------- | --------- |
| 0.1.x   | ✅        |
| < 0.1   | ❌        |

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues,
discussions, or pull requests.**

Instead, report them privately:

- Preferred: open a [GitHub Security Advisory](https://github.com/OWNER/wren/security/advisories/new)
  ("Report a vulnerability" under the repository's **Security** tab), or
- Email **<SECURITY_CONTACT_PLACEHOLDER>**.

Please include:

- A description of the issue and its potential impact.
- Steps to reproduce, or a proof of concept.
- The version / commit you tested, and your OS.

We'll acknowledge your report as soon as we can, keep you updated on progress,
and credit you once a fix ships (unless you prefer to remain anonymous). Please
give us a reasonable window to address the issue before any public disclosure.

## Scope notes

A few areas worth understanding when assessing impact:

- **Local connector server** — Wren can run a local HTTP server on
  `127.0.0.1` for the browser connector and REST API. It binds to localhost only;
  reports about its exposure, CORS, or auth are in scope.
- **Model downloads** — on first PDF parse, Wren downloads document-analysis
  models over HTTPS and verifies them by SHA-256. Issues with that verification
  are in scope.
- **AI providers** — if you configure a cloud AI provider, your API key and the
  relevant document text are sent to that provider by your choice. That is
  expected behavior, not a vulnerability.
