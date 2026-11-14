# Building Lampa Bridge

## Prerequisites

- JDK 17
- Android SDK Platform 35
- Android SDK Build Tools

Set `ANDROID_HOME` or `ANDROID_SDK_ROOT` to the Android SDK location.

## Verification

Run the complete local check:

```bash
./gradlew --no-daemon test lint assembleDebug assembleRelease
```

The unsigned release APK is created at `app/build/outputs/apk/release/app-release-unsigned.apk` when signing variables are not set.

## Signed release

Provide an existing Android release keystore through environment variables:

```bash
export LAMPA_BRIDGE_KEYSTORE=/absolute/path/to/release.keystore
export LAMPA_BRIDGE_KEYSTORE_PASSWORD='keystore password'
export LAMPA_BRIDGE_KEY_ALIAS='key alias'
export LAMPA_BRIDGE_KEY_PASSWORD='key password'
./build-release.sh
```

The script runs unit tests and Android lint before producing `dist/lampa-bridge-v<version>.apk` and its SHA-256 checksum. It does not create or store signing credentials.

Keep the keystore and its passwords outside the project. Future releases must use the same signing key and an incremented `versionCode`.
