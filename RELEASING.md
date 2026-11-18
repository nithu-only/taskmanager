# Releasing Task Manager Portable

This is the maintainer checklist for publishing a release and getting it signed.

## One-time setup (after SignPath Foundation approval)

1. Create the project in [SignPath.io](https://signpath.io/) (suggested slugs below) and
   generate an **API token**.
2. Add the repository secret and variable:

   ```powershell
   gh secret set SIGNPATH_API_TOKEN --repo nithu-only/taskmanager
   gh variable set SIGNPATH_ORGANIZATION_ID --repo nithu-only/taskmanager --body "<org-id>"
   ```

3. Match the slugs in `.github/workflows/release.yml`:

   | Setting | Workflow key | Suggested value |
   | --- | --- | --- |
   | Project slug | `project-slug` | `task-manager` |
   | Signing policy | `signing-policy-slug` | `release-signing` |
   | Artifact configuration | `artifact-configuration-slug` | `task-manager-exe` |

4. The artifact configuration must sign the PE file inside the uploaded artifact
   (`TaskManager.exe`) and nothing else. Builds are only signed when the workflow runs
   from this repository, so **never sign a locally built exe** — SignPath verifies the
   origin and will reject it.
5. Enable the signing step by setting the variable above. Until then, releases publish
   unsigned (with checksums and provenance).

Signing requests need a manual approval in the SignPath UI. The workflow waits up to one
hour (`wait-for-completion-timeout-in-seconds`) for that approval; approve promptly or
re-run the job after approving.

## Versioning

The version lives in `package.json` and is stamped into the exe metadata by
`packaging/build-exe.ps1`:

- `1.0.1` → file version `1.0.1.0`
- The Git tag is the same number with a `v` prefix: `v1.0.1`

Keep the two in sync. Never move or reuse a published tag.

## Pre-release checks

```powershell
git switch main
git pull

npm ci
npm run lint
npm run typecheck
npm run package:exe

# Smoke test the exe that was just built
Start-Process .\packaging\out\TaskManager.exe
# open the UI, check Processes/Performance/Services, then:
Start-Process .\packaging\out\TaskManager.exe -ArgumentList --stop
```

A locally built exe is only for testing; the published exe is rebuilt in CI and will have
a different hash.

## Release steps

```powershell
# 1. Bump the version in package.json (e.g. "1.0.1") and commit
git add package.json
git commit -m "Release v1.0.1"

# 2. Push main first so the tag points at the released commit
git push

# 3. Tag and push the tag — this triggers the Release workflow
git tag -a v1.0.1 -m "Task Manager Portable 1.0.1"
git push origin v1.0.1
```

## What the Release workflow does

1. Checks out the tagged commit on `windows-latest`.
2. Runs `npm ci`, lint and typecheck.
3. Builds the portable exe (`npm run package:exe`) and uploads it.
4. If `SIGNPATH_ORGANIZATION_ID` is configured: submits the artifact to SignPath, waits
   for review, and downloads the signed exe.
5. Writes `SHA256SUMS.txt`.
6. Creates a GitHub build-provenance attestation for the exe.
7. Creates the GitHub Release with the exe and checksum attached.

If any step fails, nothing is published. Manual runs via **Actions → Release → Run
workflow** build and attest but do **not** create a release (no tag).

## After publishing

Verify the published artifact (also send these commands to users):

```powershell
gh release download v1.0.1 --pattern TaskManager.exe
Get-FileHash .\TaskManager.exe -Algorithm SHA256      # compare with SHA256SUMS.txt
gh attestation verify .\TaskManager.exe --repo nithu-only/taskmanager

# Once signing is active
Get-AuthenticodeSignature .\TaskManager.exe | Format-List Status, SignerCertificate
```

The signer should be **SignPath Foundation** with `Status: Valid`. `signtool verify /pa`
from the Windows SDK gives the same result.

Update the release notes (`gh release edit v1.0.1 --notes-file notes.md`) to describe
changes. Do not replace assets on an already-published release — a re-signed file has a
new hash. Publish a new patch version instead.

## Hotfix and rollback

- **Broken but signed release:** publish a new patch version with the fix. Deleting and
  re-uploading breaks checksums and attestations and should be avoided.
- **Release must be hidden:** mark it as a pre-release:
  ```powershell
  gh release edit v1.0.1 --prerelease
  ```
- **Tag was pushed by mistake:** delete the release and tag before anyone downloads it:
  ```powershell
  gh release delete v1.0.1 --yes --cleanup-tag
  ```
  Use with care; never do this after the assets have been shared.

## Secrets and permissions

- `SIGNPATH_API_TOKEN` — repository secret, signer/approver token. Rotate it if leaked.
- `SIGNPATH_ORGANIZATION_ID` — repository variable, not secret.
- Workflow permissions are already minimal: `contents: write` (release), `id-token: write`
  and `attestations: write` (provenance). Signing jobs should not need anything else.
- The signing step is a no-op until the variable exists, so forks and pull requests never
  attempt to sign.

## Package-manager manifests

`packaging/winget/` contains the Windows Package Manager manifests. On every release:

1. Bump `PackageVersion` in all three manifest files.
2. Update `InstallerUrl` (release tag) and `InstallerSha256`.
3. Update `ReleaseDate` and `ReleaseNotesUrl`.
4. Submit the updated manifests to `microsoft/winget-pkgs`.

See [packaging/winget/README.md](packaging/winget/README.md) for the full steps.
