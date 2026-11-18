# winget manifests

Windows Package Manager manifests for `Task Manager Portable`.

Validated locally with:

```powershell
winget validate --manifest packaging\winget
```

## Submit to the community repository

The package becomes installable with `winget install nithu-only.TaskManager` once the
manifests are merged into [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs).

1. Fork `microsoft/winget-pkgs`.
2. Add the three files to `manifests/n/nithu-only/TaskManager/1.0.0/`:
   - `nithu-only.TaskManager.yaml`
   - `nithu-only.TaskManager.installer.yaml`
   - `nithu-only.TaskManager.locale.en-US.yaml`
3. Open a pull request titled
   `New package: nithu-only.TaskManager version 1.0.0`.
4. The validation bot checks the manifest and the installer hash. Fix anything it reports
   (usually a URL/hash mismatch or a schema field).
5. After merge, install with:

   ```powershell
   winget install nithu-only.TaskManager
   ```

To test a local manifest, enable local manifests once in an elevated shell:

```powershell
winget settings --enable LocalManifestFiles
winget install --manifest packaging\winget
```

## Updating for a new release

1. Bump `PackageVersion` in all three files and the folder name (`manifests/n/nithu-only/TaskManager/<version>/`).
2. Point `InstallerUrl` at the new release asset and update `InstallerSha256`
   (`Get-FileHash TaskManager.exe -Algorithm SHA256`).
3. Update `ReleaseDate` and `ReleaseNotesUrl`.
4. Submit a PR titled
   `Update nithu-only.TaskManager to version X.Y.Z`.

The installer hash must match the published asset exactly — take it from
`SHA256SUMS.txt` or the release checksum step, not from a local build.
