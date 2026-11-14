#!/usr/bin/env sh
set -eu

required_variables="
LAMPA_BRIDGE_KEYSTORE
LAMPA_BRIDGE_KEYSTORE_PASSWORD
LAMPA_BRIDGE_KEY_ALIAS
LAMPA_BRIDGE_KEY_PASSWORD
"

for variable_name in $required_variables; do
    eval "variable_value=\${$variable_name:-}"
    if [ -z "$variable_value" ]; then
        echo "Missing required environment variable: $variable_name" >&2
        exit 1
    fi
done

if [ ! -f "$LAMPA_BRIDGE_KEYSTORE" ]; then
    echo "Keystore does not exist: $LAMPA_BRIDGE_KEYSTORE" >&2
    exit 1
fi

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$project_dir"

./gradlew --no-daemon clean test lint assembleRelease

version_name=$(./gradlew --no-daemon -q printVersionName)
source_apk="app/build/outputs/apk/release/app-release.apk"
output_dir="dist"
output_apk="$output_dir/lampa-bridge-v$version_name.apk"

if [ ! -f "$source_apk" ]; then
    echo "Signed release APK was not produced: $source_apk" >&2
    exit 1
fi

mkdir -p "$output_dir"
cp "$source_apk" "$output_apk"
sha256sum "$output_apk" > "$output_apk.sha256"

echo "Release artifact: $output_apk"
echo "Checksum: $output_apk.sha256"
