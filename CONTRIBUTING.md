# Contributing to Task Manager Portable

Thanks for taking a look. This is a small project — one maintainer and GitHub Actions —
so focused pull requests get merged fastest.

## Before you start

- **Bugs and ideas:** open an issue for anything larger than a typo or a one-file fix, so
  you do not build something that does not fit the app.
- **Security problems:** do **not** open a public issue. Follow [SECURITY.md](SECURITY.md).
- **Looking for a first task:** see the
  [`good first issue`](https://github.com/nithu-only/taskmanager/labels/good%20first%20issue)
  label.

## Development setup

You need Windows 10/11, Node.js 20 or newer, and Windows PowerShell 5.1 (installed with
Windows — `pwsh` is not required).

```powershell
git clone https://github.com/nithu-only/taskmanager.git
cd taskmanager
npm install
npm run dev
```

Open <http://localhost:3000>. The app reads the machine it runs on, so there is no demo
data: what you see is your own PC.

### Checks before pushing

```powershell
npm run lint
npm run typecheck
npm run build
```

CI runs the same checks on `windows-latest` and must be green before a pull request is
merged.

If you changed `packaging/`, also build and smoke-test the exe:

```powershell
npm run package:exe
.\packaging\out\TaskManager.exe        # open the UI, click through the pages
.\packaging\out\TaskManager.exe --stop
```

## Code layout

| Path | Contents |
| --- | --- |
| `scripts/*.ps1` | The long-lived sampler and the one-shot action helpers |
| `src/lib/host.ts` | Sampler lifecycle, delta maths, in-memory snapshot |
| `src/lib/server.ts` | Validation, risk model, process/service/startup actions |
| `src/lib/types.ts` | Shared types, labels, formatters |
| `src/app/api/*` | REST endpoints used by the UI |
| `src/components/*` | Table, drawers, dialogs, shell |
| `packaging/` | C# launcher and the exe build script |

## Conventions

- TypeScript strict mode is on. Avoid `any` unless there is no alternative.
- Server code stays Windows-guarded: on other platforms the API answers `501`.
- UI text is plain English — no exclamation marks and no emoji in the product UI.
- Match the surrounding style: Tailwind utilities, `cx()` for conditionals, and the
  existing primitives in `src/components/ui.tsx` instead of new ones.
- Comments should explain *why*, not restate the line.
- No new runtime dependencies without discussing it in an issue first. The app ships as a
  single exe and every dependency adds weight.

## Safety rules

The app can end processes and change services. A change in that area must keep these
guarantees:

1. Critical Windows processes (`csrss`, `winlogon`, `services`, `lsass`, `smss`, `System`)
   are rejected **on the server** with `403` before PowerShell is called. Hiding the button
   in the UI is not enough.
2. High-risk processes still require the explicit confirmation dialog.
3. Startup entries are only changed under `HKCU`. Disabling one moves the value to
   `HKCU\Software\TaskManager\DisabledStartup` so it can be restored — nothing is deleted.
4. No unvalidated user input reaches PowerShell. New actions must validate and type every
   parameter in `src/lib/server.ts`.
5. No new network access. The server binds to `127.0.0.1` only.

A pull request that weakens any of these will not be merged.

## Commits and pull requests

- One logical change per pull request.
- Commit messages in the imperative mood: `Add sort persistence to the process table`,
  not `added` or `fixes`.
- Reference the issue in the pull request body (`Closes #12`).
- Say how you tested it. "Ran `npm run lint` and `npm run typecheck`, clicked through
  Services on Windows 11" is enough.
- Include a screenshot or a short clip for UI changes.
- By contributing you agree that your work is licensed under the [MIT license](LICENSE).

## Releases

Releases are cut by the maintainer from `main`; see [RELEASING.md](RELEASING.md). Tagging
is not part of a normal contribution.
