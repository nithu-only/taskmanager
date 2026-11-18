# Privacy Policy

**Task Manager for Windows** runs entirely on your own computer. It does not collect,
store, or transmit personal data.

## What the app does with data

- Process, service, startup and performance data is read from Windows through PowerShell
  and kept **in memory** by the local server.
- The UI is served only on the loopback interface (`127.0.0.1`) on a random free port. It
  is not reachable from your network or the internet.
- The activity log (last 300 entries) is memory-only and disappears when the app stops.
- The only file the app writes is `scripts/versioninfo.json`, a local cache of
  publisher/description lookups keyed by executable path. It never leaves your machine.
- The portable `TaskManager.exe` extracts its runtime files to
  `%LOCALAPPDATA%\TaskManagerPortable` and writes a server log there.

## Network access

The app makes no outbound network requests. It has no telemetry, analytics, crash
reporting, accounts, ads, or cloud sync.

The bundled Next.js/Node.js runtime serves the UI locally and does not contact external
services during normal use.

## Third-party components

- [Node.js](https://nodejs.org/) — bundled runtime, MIT license.
- [Next.js](https://nextjs.org/) and [React](https://react.dev/) — MIT license.
- [Tailwind CSS](https://tailwindcss.com/) — MIT license.
- [Lucide](https://lucide.dev/) icons — ISC license.

These components run locally; none of them receive your data.

## System changes

The app can end or suspend processes, change process priority, start/stop services, and
enable/disable per-user startup entries. These actions are requested explicitly by the
user, are limited to the current user's own settings where Windows allows it, and are
reversible as described in the README. Core Windows processes are blocked by design.

## Contact

Questions or concerns: open an issue at
<https://github.com/nithu-only/taskmanager/issues>.
