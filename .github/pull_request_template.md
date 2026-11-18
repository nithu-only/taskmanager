<!-- One logical change per pull request, please. -->

## Summary

<!-- What changed and why. Link the issue: Closes #12 -->

## Type of change

- [ ] Bug fix
- [ ] New feature or view
- [ ] Refactor with no behaviour change
- [ ] Documentation, build or tooling
- [ ] Process / service / startup action (read the safety checklist below)

## How I tested it

<!--
Examples:
- npm run lint && npm run typecheck && npm run build
- Clicked through Processes → Services on Windows 11 24H2
- npm run package:exe, launched the exe, used --stop
-->

## Checklist

- [ ] CI is green (`Lint`, `Typecheck`, `Production build`)
- [ ] UI text is plain English and matches the surrounding style
- [ ] No new runtime dependency, or the issue explains why it is needed
- [ ] No new outbound network access

### Only for process / service / startup changes

- [ ] Critical processes are still rejected server-side with `403`, not just hidden in the UI
- [ ] High-risk actions still require explicit confirmation
- [ ] Every PowerShell parameter is validated and typed in `src/lib/server.ts`
- [ ] Startup writes are limited to `HKCU` and remain reversible
