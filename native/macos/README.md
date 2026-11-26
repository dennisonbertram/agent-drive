# Agent Drive Finder for macOS

The CLI registers a drive in Finder through Apple's File Provider framework. Finder reads file contents in authenticated ranges. Writes and renames check the last observed version before saving. If a save conflicts with a newer version, the bridge keeps the user's edits on disk and returns their recovery path.

The CLI holds the drive key. The extension connects to it over an authenticated loopback connection and discovers which operations the configured key permits.

Agent Drive does not yet publish a signed macOS companion app. The npm release includes native Linux mount helpers for x64 and arm64. The [macOS builder workflow](https://github.com/dennisonbertram/agent-drive/actions/workflows/mount-macos.yml) compiles the app but does not sign, notarize, or publish it. Until a notarized zip is available from GitHub Releases, use the build and signing instructions below to prepare the companion app from source.

## Supported operations

- Files can be read, created, edited, renamed, and deleted when the authenticated capability response grants each operation and the path is within the reported write scope.
- Directories can be listed, created, and deleted. Recursive delete processes paged children and checks each file version before unlinking; the parent directory is removed last. This is not an atomic subtree transaction. If another process adds an entry during deletion, the final `rmdir` fails and leaves the directory in place, although earlier children from the user's recursive delete may already have been removed.
- Directory rename and move are not advertised. The current guarded rename API requires a stable source file version, and directory metadata has no such version. The extension does not emulate a directory move by copying and deleting its contents.
- The File Provider working set is empty. Full directory enumeration remains paged. An unknown sync anchor expires and causes a full rescan.

## Build and test

Requirements: macOS, Xcode with the macOS SDK, Swift 6, and XcodeGen. Install
XcodeGen with `brew install xcodegen` if it is not already installed.

Run the core tests with:

```sh
swift test --package-path native/macos
```

These Swift package tests do not need a provisioning profile or app-group
entitlement. They test the bridge and connection store without registering a
File Provider domain.

Build an unsigned app and embedded extension outside the repository with:

```sh
native/macos/build-app.sh build "$TMPDIR/Agent Drive.app"
```

This mode compiles both Xcode targets but is not a runnable mount: the app and
extension are unsigned and cannot access their shared app-group container.
GitHub Actions runs this build on `macos-15` after the Swift package tests. It
does not sign, notarize, or publish the app.

For a local signed build, use an installed development signing identity and its
team ID:

```sh
AGENT_DRIVE_MACOS_TEAM_ID=ABCDE12345 \
AGENT_DRIVE_MACOS_SIGNING_IDENTITY='Apple Development: Developer Name (ABCDE12345)' \
  native/macos/build-app.sh local "$TMPDIR/Agent Drive.app"
```

The team ID must match the identity. Run a native mount smoke test from a logged
in macOS user session with:

```sh
node native/macos/native-finder-probe.mjs \
  "$TMPDIR/Agent Drive.app/Contents/MacOS/AgentDriveFinder"
```

The probe uses a random synthetic drive ID and a loopback-only fixture. It
registers a temporary synthetic File Provider domain, which the helper removes
with an ownership check while it still owns the drive connection. Run it from a
dedicated, signed-in test macOS account. Do not point it at a real drive or real
files.

## Signing and public distribution

The app and its embedded `AgentDriveFileProvider.appex` both declare the same
team-prefixed app group from `project.yml`:
`$(DEVELOPMENT_TEAM).group.xyz.agentdrive.finder`. Both bundles must be signed
with the same authorized team so macOS grants them access to that shared
container. Apple documents that this team-prefixed format on macOS does not
need a provisioning profile; the test executable also needs no profile. Keep
the app sandbox, extension network-client entitlement, bundle identifiers, and
group name from `project.yml` intact.

For direct distribution, use an existing, user-authorized **Developer ID
Application** identity for that same team. The distribution helper archives
and exports with Xcode, checks the signatures and matching app-group
entitlements for both bundles, requires the hardened runtime, submits the
exported app to Apple's notary service using an existing `notarytool` keychain
profile, staples the ticket, checks the stapled app with Gatekeeper, and writes
a zip file outside the repository. It never uploads a GitHub release or other
public artifact.

Configure these environment variables in the shell before running the helper:

```sh
export AGENT_DRIVE_MACOS_TEAM_ID='ABCDE12345'
export AGENT_DRIVE_MACOS_SIGNING_IDENTITY='Developer ID Application: Developer Name (ABCDE12345)'
export AGENT_DRIVE_MACOS_NOTARY_PROFILE='agent-drive-notary'
native/macos/build-app.sh distribute "$HOME/Downloads/Agent Drive.zip"
```

`AGENT_DRIVE_MACOS_NOTARY_PROFILE` is the keychain profile **name**, not a
password. Keep Apple private keys and notary credentials in Keychain; never put
them in command arguments, source files, or GitHub Actions for this workflow.
The distribution mode contacts Apple's notary service, so run it only when a
public distribution candidate is ready and authorized. The resulting zip still
needs a separate, reviewed publishing step.

References:

- [XcodeGen usage](https://github.com/yonaskolb/XcodeGen#usage)
- [Apple: accessing app-group containers](https://developer.apple.com/documentation/xcode/accessing-app-group-containers)
- [Apple: distribution-signed macOS code](https://developer.apple.com/documentation/xcode/creating-distribution-signed-code-for-the-mac)
- [Apple: notarizing macOS software](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
- [Apple: packaging macOS software](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution)

## Synthetic Finder probe

`native-finder-probe.mjs` starts a loopback-only, read-only RPC fixture and
requests a temporary File Provider domain in the private helper startup line.
The helper removes the domain it created with Apple's
`preserveDirtyUserData` mode, and only while that helper still owns the drive's
connection descriptor. If the generated domain identifier already exists, the
probe stops without disconnecting or removing it. Normal CLI mounts omit the
temporary flag and keep the existing persistent-domain lifecycle. Run the probe
only in a dedicated logged-in test macOS account; it verifies a synthetic list
and a bounded read of `sample.txt` and must not be pointed at a real drive.
