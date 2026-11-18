# Security policy

## Supported versions

Only the latest release is supported. Fixes ship as a new patch version; older release
assets are left in place but not updated.

## Reporting a vulnerability

**Do not open a public issue.** Use GitHub's private vulnerability reporting:

<https://github.com/nithu-only/taskmanager/security/advisories/new>

Please include the app version, your Windows version, what you did, what happened, and a
proof of concept if you have one. You can expect an acknowledgement within 7 days. Please
give the project a reasonable window to publish a fix before disclosing publicly.

## Scope

The app runs with your own user rights and is meant to manage your own machine, so the
security boundary is: *another program or website must not be able to make it do something
you did not ask for.*

**In scope**

- Command or argument injection from the local API into PowerShell (`scripts/*.ps1`).
- A way to reach processes, services or startup entries that bypasses the critical-process
  guard in `src/lib/server.ts`.
- Cross-site scripting in the UI, or a request a website you visit can trigger against the
  local server (it binds to `127.0.0.1`, so drive-by requests should fail; tell us if they
  do not).
- Path traversal or arbitrary file write in the portable launcher's extraction step.
- Anything that makes the app contact the network.

**Not in scope**

- Ending, suspending or reprioritising a process, starting or stopping a service, or
  disabling a startup entry. That is the product; doing it to your own account is not a
  vulnerability.
- A service operation requiring administrator rights.
- SmartScreen or antivirus warnings about the unsigned build — see the README for the
  checksum and attestation commands.
- Anything that requires an attacker to already have code execution or administrator
  rights on the machine.
