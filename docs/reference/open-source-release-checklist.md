# Open Source Release Checklist

Use this checklist before making the repository public or announcing a major open release.

## Repository Surface

- Confirm the public repo URL, default branch, description, and topics.
- Confirm `README.md`, `LICENSE`, `CONTRIBUTING.md`, and `SECURITY.md` are present and accurate.
- Confirm issue templates and PR template are enabled and point to the current repo.
- Confirm package metadata (`homepage`, `bugs`, `repository`) matches the public repo.

## Naming And Branding

- Confirm the project name is consistently `CrawClaw`.
- Confirm the CLI is `crawclaw`.
- Confirm public package names use the intended `crawclaw` / `@crawclaw/*` naming.
- Confirm old `OpenClaw` / `openclaw` compatibility surfaces are either removed or explicitly documented.

## Sensitive Data And Generated Artifacts

- Scan the working tree for secrets, tokens, internal URLs, and private test data.
- Verify large local caches, screenshots, logs, and editor/tooling artifacts are not tracked.
- Verify `.gitignore` covers local dependency folders, caches, screenshots, and tool state.
- Verify generated files that remain in Git are intentional and reproducible.

## Build And Test

- Run a clean install from lockfile.
- Verify workspace installs do not rely on private or SSH-only transitive dependencies.
- Run `pnpm build`.
- Run the required fast/unit/integration/E2E lanes for the release.
- Verify the package can be installed globally and `crawclaw --version` works.

## Docs And Onboarding

- Verify the README quick start works from a clean checkout.
- Verify install docs match the current package manager and runtime requirements.
- Verify all top-level docs links resolve.
- Verify migration docs match the current state/config path conventions.

## Release And Operations

- Confirm release workflows point to the correct repository and package names.
- Confirm changelog and version are ready for the next public release.
- Confirm branch protections and required checks are configured on GitHub.
- Confirm maintainers know the rollback plan if the release needs to be reverted.

## Final Verification

- Clone the public repo into a fresh directory.
- Confirm the repo contains no `.serena`, `node_modules`, `dist-runtime`, or other local-only state.
- Confirm `git status --short` is clean after the documented setup flow.
- Confirm the repo is ready for external contributors without private context.
