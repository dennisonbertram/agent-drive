#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd "$script_dir/../.." && pwd -P)"

usage() {
  cat <<'USAGE'
Usage:
  native/macos/build-app.sh build <output.app>
  native/macos/build-app.sh local <output.app>
  native/macos/build-app.sh distribute <output.zip>

Modes:
  build      Compile an unsigned app and embedded File Provider extension.
  local      Sign a runnable local build with a development identity.
  distribute Archive, export, Developer ID sign, notarize, staple, and verify a zip.

The local and distribute modes read these environment variables:
  AGENT_DRIVE_MACOS_TEAM_ID
  AGENT_DRIVE_MACOS_SIGNING_IDENTITY

The distribute mode also reads:
  AGENT_DRIVE_MACOS_NOTARY_PROFILE  Existing notarytool keychain profile name.
USAGE
}

if [[ $# -eq 1 && "$1" == --help ]]; then
  usage
  exit 0
fi

fail() {
  printf '%s\n' "build-app: $*" >&2
  exit 1
}

if [[ $# -ne 2 ]]; then
  usage >&2
  exit 2
fi

mode="$1"
output="$2"
case "$mode" in
  build|local|distribute) ;;
  *) usage >&2; exit 2 ;;
esac

case "$mode:$output" in
  distribute:*.zip) ;;
  distribute:*) fail 'distribute output must end in .zip' ;;
  *:*.app) ;;
  *) fail 'build and local output must end in .app' ;;
esac

if [[ "$output" != /* ]]; then
  output="$PWD/$output"
fi
[[ -d "$(dirname "$output")" ]] || fail 'output parent directory must already exist'
output_parent="$(cd "$(dirname "$output")" && pwd -P)" || fail 'output parent directory must exist'
output="$output_parent/$(basename "$output")"
case "$output" in
  "$repo_root"|"$repo_root"/*) fail 'write the app outside the repository' ;;
esac
[[ ! -e "$output" && ! -L "$output" ]] || fail "refusing to overwrite existing output: $output"

team_id="${AGENT_DRIVE_MACOS_TEAM_ID:-}"
signing_identity="${AGENT_DRIVE_MACOS_SIGNING_IDENTITY:-}"
notary_profile="${AGENT_DRIVE_MACOS_NOTARY_PROFILE:-}"
if [[ "$mode" != build ]]; then
  [[ "$team_id" =~ ^[A-Z0-9]{10}$ ]] || fail 'set AGENT_DRIVE_MACOS_TEAM_ID to the signing team ID'
  [[ -n "$signing_identity" ]] || fail 'set AGENT_DRIVE_MACOS_SIGNING_IDENTITY to the installed signing identity name'
fi
if [[ "$mode" == distribute ]]; then
  [[ -n "$notary_profile" ]] || fail 'set AGENT_DRIVE_MACOS_NOTARY_PROFILE to an existing notarytool keychain profile name'
fi

command -v xcodegen >/dev/null 2>&1 || fail 'install XcodeGen first: brew install xcodegen'
command -v xcodebuild >/dev/null 2>&1 || fail 'install Xcode and select its command line tools'

temporary_root="$(mktemp -d "${TMPDIR:-/tmp}/agent-drive-macos.XXXXXX")"
trap 'rm -rf "$temporary_root"' EXIT
staged_project="$temporary_root/native/macos"
derived_data="$temporary_root/DerivedData"
mkdir -p "$(dirname "$staged_project")"
/usr/bin/ditto "$script_dir" "$staged_project"
(cd "$staged_project" && xcodegen generate)
project="$staged_project/Agent Drive.xcodeproj"

assert_app_bundle() {
  local app_path="$1"
  local extension_path="$app_path/Contents/PlugIns/AgentDriveFileProvider.appex"
  [[ -d "$app_path" ]] || fail 'Xcode did not produce Agent Drive.app'
  [[ -d "$extension_path" ]] || fail 'the File Provider extension is missing from the app'
  local extension_point
  extension_point="$(/usr/libexec/PlistBuddy -c 'Print :NSExtension:NSExtensionPointIdentifier' "$extension_path/Contents/Info.plist")"
  [[ "$extension_point" == 'com.apple.fileprovider-nonui' ]] || fail 'embedded extension has the wrong extension point'
  local supports_enumeration
  supports_enumeration="$(/usr/libexec/PlistBuddy -c 'Print :NSExtension:NSExtensionFileProviderSupportsEnumeration' "$extension_path/Contents/Info.plist" 2>/dev/null || true)"
  [[ "$supports_enumeration" == 'true' ]] || fail 'embedded extension must declare NSExtensionFileProviderSupportsEnumeration under NSExtension'
}

verify_signed_component() {
  local component="$1"
  local component_name="$2"
  local require_developer_id="$3"
  local require_hardened_runtime="$4"
  local details entitlements app_group
  details="$(/usr/bin/codesign --display --verbose=4 "$component" 2>&1)" || fail "cannot inspect signature for $component_name"
  [[ "$details" == *"TeamIdentifier=$team_id"* ]] || fail "$component_name was signed by a different team"
  if [[ "$require_developer_id" == yes ]]; then
    [[ "$details" == *'Authority=Developer ID Application:'* ]] || fail "$component_name is not signed with Developer ID Application"
  fi
  if [[ "$require_hardened_runtime" == yes ]]; then
    [[ "$details" == *'flags='*'(runtime)'* ]] || fail "$component_name does not enable the hardened runtime"
  fi

  entitlements="$temporary_root/$component_name.entitlements.plist"
  /usr/bin/codesign --display --entitlements :- "$component" >"$entitlements" 2>/dev/null || fail "$component_name has no readable entitlements"
  app_group="$(/usr/libexec/PlistBuddy -c 'Print :com.apple.security.application-groups:0' "$entitlements")" || fail "$component_name is missing its app group entitlement"
  [[ "$app_group" == "$team_id.group.xyz.agentdrive.finder" ]] || fail "$component_name has the wrong team-prefixed app group"
}

common_xcodebuild_args=(
  -quiet
  -project "$project"
  -scheme AgentDriveFinder
  -destination 'generic/platform=macOS'
  -derivedDataPath "$derived_data"
)

case "$mode" in
  build)
    xcodebuild "${common_xcodebuild_args[@]}" \
      -configuration Release \
      CODE_SIGNING_ALLOWED=NO \
      CODE_SIGNING_REQUIRED=NO \
      build
    app_path="$derived_data/Build/Products/Release/Agent Drive.app"
    assert_app_bundle "$app_path"
    /usr/bin/ditto "$app_path" "$output"
    ;;
  local)
    xcodebuild "${common_xcodebuild_args[@]}" \
      -configuration Debug \
      CODE_SIGN_STYLE=Manual \
      "DEVELOPMENT_TEAM=$team_id" \
      "CODE_SIGN_IDENTITY=$signing_identity" \
      CODE_SIGNING_ALLOWED=YES \
      CODE_SIGNING_REQUIRED=YES \
      build
    app_path="$derived_data/Build/Products/Debug/Agent Drive.app"
    assert_app_bundle "$app_path"
    /usr/bin/codesign --verify --deep --strict "$app_path"
    verify_signed_component "$app_path" 'Agent Drive.app' no no
    verify_signed_component "$app_path/Contents/PlugIns/AgentDriveFileProvider.appex" 'AgentDriveFileProvider.appex' no no
    /usr/bin/ditto "$app_path" "$output"
    ;;
  distribute)
    archive_path="$temporary_root/Agent Drive.xcarchive"
    export_path="$temporary_root/export"
    export_options="$temporary_root/ExportOptions.plist"
    xcodebuild "${common_xcodebuild_args[@]}" \
      -configuration Release \
      -archivePath "$archive_path" \
      CODE_SIGN_STYLE=Manual \
      "DEVELOPMENT_TEAM=$team_id" \
      "CODE_SIGN_IDENTITY=$signing_identity" \
      ENABLE_HARDENED_RUNTIME=YES \
      CODE_SIGNING_ALLOWED=YES \
      CODE_SIGNING_REQUIRED=YES \
      archive

    /usr/bin/plutil -create xml1 "$export_options"
    /usr/bin/plutil -insert destination -string export "$export_options"
    /usr/bin/plutil -insert method -string developer-id "$export_options"
    /usr/bin/plutil -insert signingStyle -string manual "$export_options"
    /usr/bin/plutil -insert signingCertificate -string "$signing_identity" "$export_options"
    /usr/bin/plutil -insert teamID -string "$team_id" "$export_options"
    xcodebuild -exportArchive \
      -archivePath "$archive_path" \
      -exportOptionsPlist "$export_options" \
      -exportPath "$export_path"

    app_path="$export_path/Agent Drive.app"
    assert_app_bundle "$app_path"
    /usr/bin/codesign --verify --deep --strict --verbose=2 "$app_path"
    verify_signed_component "$app_path" 'Agent Drive.app' yes yes
    verify_signed_component "$app_path/Contents/PlugIns/AgentDriveFileProvider.appex" 'AgentDriveFileProvider.appex' yes yes

    notarization_zip="$temporary_root/Agent Drive.notarization.zip"
    /usr/bin/ditto -c -k --keepParent "$app_path" "$notarization_zip"
    xcrun notarytool submit "$notarization_zip" --keychain-profile "$notary_profile" --wait
    xcrun stapler staple "$app_path"
    xcrun stapler validate "$app_path"
    /usr/sbin/spctl --assess --type execute --verbose=2 "$app_path"
    /usr/bin/ditto -c -k --keepParent "$app_path" "$output"
    /usr/bin/unzip -tq "$output"
    ;;
esac

printf 'Wrote %s\n' "$output"
