# MioBridge Release

Create a checksum-covered CLI and Agent release after all gates pass.

## Steps

1. Read the current version from CHANGELOG.md:
   ```bash
   head -20 CHANGELOG.md | grep -E '^## \[?[0-9]' | head -1
   ```

2. Confirm that `main` is clean, pushed, and has successful `ci.yml` and
   `cli-systemd-e2e.yml` runs for the same commit.

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

5. After the release build succeeds, verify both CLI archives, both compressed
   Agent binaries, and `SHA256SUMS` are available on the GitHub Releases page.

6. Run `scripts/install.sh --version <version> --skip-setup` on a clean Linux
   host or rely on the successful release workflow installer/systemd gates.

7. Report the release URL, commit, checksums, and gate status.
