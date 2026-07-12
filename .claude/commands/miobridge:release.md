# MioBridge Release

Create a new versioned release: tag the commit, push the tag, and monitor the deployment.

## Steps

1. Read the current version from CHANGELOG.md:
   ```bash
   head -20 CHANGELOG.md | grep -E '^## \[?[0-9]' | head -1
   ```

2. Ask the user to confirm the version number (e.g., `v1.2.0`). If CHANGELOG.md has unreleased changes, suggest the next version based on semver.

3. Create and push the tag:
   ```bash
   git tag -a <version> -m "Release <version>"
   git push origin <version>
   ```

4. The tag push triggers release.yml. Watch the release build:
   ```bash
   RUN_ID=$(gh run list -w release.yml -L1 --json databaseId -q '.[0].databaseId')
   gh run watch $RUN_ID
   ```

5. After the release build succeeds, verify the artifacts are available on the GitHub Releases page.

6. Report the release result with version, commit, and release status.