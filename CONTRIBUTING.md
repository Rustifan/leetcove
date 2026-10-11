# Contributing to LeetCove

Bug reports, documentation improvements, and focused pull requests are welcome.
For larger changes, open an issue first to discuss the intended behavior.

## Development setup

Install [Bun](https://bun.sh/) 1.3.14 or newer, then:

```sh
bun install --frozen-lockfile
bun start
```

The application uses TypeScript and [OpenTUI](https://opentui.com/). You can browse
public problems without signing in.

When updating dependencies, generate `bun.lock` with Bun 1.3.14 to keep the lockfile
compatible with the minimum supported runtime. Normal setup uses the frozen
lockfile command above on either supported Bun version.

## Checks

```sh
bun run check
bun test
```

The test suite uses local fixtures and temporary workspaces. It covers API
validation, judging results, session persistence, CLI behavior, solution files,
editor cleanup, and keyboard navigation without contacting LeetCode.

### Terminal integration

The terminal smoke check exercises a real pseudo-terminal and external editor on
Linux or macOS. It uses sample data and an isolated workspace.

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements-dev.txt
bun run verify:terminal
```

It checks canonical terminal mode in the editor, raw mode after returning, file
reload, and clean shutdown. GitHub Actions runs this check alongside the
TypeScript checks and unit tests.

### Live integration

When changing LeetCode request or result handling, you can additionally run:

```sh
bun run login
bun run verify:live
```

This sends four custom test runs for Two Sum using your saved account. Add
`--submit` to also submit a solution and verify recovery of the submitted code:

```sh
bun run verify:live -- --submit
```

Live checks are manual and are not part of CI.

## Code style

- Use guard clauses and early returns. Avoid nested `if` and nested `try`/`catch` blocks.
- Keep functions focused; extract complex conditions and transformations into named functions.
- Prefer immutable data and minimize shared mutable state.
- Reuse existing utilities when the abstraction is clear. Application utilities live in `src/utils/`.
- Explain non-obvious decisions with comments; keep routine behavior clear through naming.
- Use precise TypeScript types. Avoid `any` and type assertions.
- Treat external JSON as `unknown` and validate it at the API boundary.
- Add regression coverage for behavior changes, especially file preservation and terminal cleanup.

## Project layout

| Location | Responsibility |
| --- | --- |
| `src/api/` | LeetCode requests, GraphQL queries, and response schemas |
| `src/auth/` | Browser login, cookies, and session persistence |
| `src/tui/` | Views, keyboard handling, formatting, and saved navigation state |
| `src/utils/` | Browser discovery, command parsing, URL opening, and shared helpers |
| `src/cli.ts` | Command-line argument validation and help |
| `src/storage.ts`, `src/workspace.ts` | Settings, solution files, custom tests, and results |
| `tests/` | Unit and renderer tests with local fixtures |
| `scripts/` | Terminal checks, live integration, and screenshot generation |

## Screenshots

```sh
bun run screenshots
```

This captures the application's native renderer with sample data and writes SVG
screenshots to `docs/screenshots/`. It requires no account and does not contact
LeetCode. Regenerate them when a visible UI change affects the README examples.

## Reporting bugs

Include your operating system, Bun version, terminal, the steps to reproduce, and
the expected and actual behavior. For API failures, include the problem slug and
error message. Keep session cookies and private account information out of reports.
