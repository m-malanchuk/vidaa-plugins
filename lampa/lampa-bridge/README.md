# Lampa Bridge

Lampa Bridge is an Android companion app that connects the Lampa media application to supported HDRezka domains over a local network.

The app runs a small HTTP bridge on an Android phone. Lampa sends search, page, authentication, cookie, and redirect requests through the phone, while video and subtitle streams continue to play directly from their CDN URLs. Lampa Bridge does not proxy media streams.

## Features

- Displays the phone's local IPv4 address and a ready-to-use Lampa Bridge URL.
- Implements the `/enc2` protocol used by the HDRezka plugin.
- Continues running through an Android foreground service while the app is in the background.
- Supports configurable local ports from `1024` to `65535`.
- Accepts requests only from local-network clients.
- Restricts upstream requests to the HDRezka domain allowlist built into the app.
- Provides `/health`, `/header`, `/headers`, and `/jsonip` diagnostic endpoints.

## Requirements

- Android 8.0 (API 26) or later.
- The Android phone and the device running Lampa must be connected to the same local network.
- A compatible Lampa HDRezka plugin.

The app requests network access and foreground-service permissions. Android 13 and later may also ask for notification permission so the foreground-service status remains visible.

## Installation

Install the signed Lampa Bridge APK on the Android phone. Android may ask you to allow installation from the app that opened the APK.

Lampa Bridge is not currently distributed through an app store. Build and signing instructions for maintainers are available in [BUILDING.md](BUILDING.md).

## Usage

1. Connect the phone and the Lampa device to the same Wi-Fi network.
2. Open Lampa Bridge and confirm that a local IPv4 address is shown.
3. Keep the default port `8080` unless another app already uses it.
4. Select **Start Lampa Bridge** (or **Запустить Lampa Bridge** on a Russian-language device).
5. Enter the displayed URL, including `http://` and the port, in the HDRezka plugin's Lampa Bridge settings.
6. Open `<bridge-url>/health` from another device on the same network to verify connectivity.

The notification remains visible while the bridge is running. Use the stop action in the app or notification when the bridge is no longer needed.

## Security and privacy

Lampa Bridge is intended only for trusted local networks. It rejects non-local clients and upstream destinations outside its built-in allowlist, but requests and account data sent between Lampa and the phone use plain HTTP on the local network.

Do not expose the bridge port to the internet. Avoid untrusted or public Wi-Fi networks when using account credentials.

The app does not provide account credentials of its own. Authentication data configured in Lampa may pass through the bridge when the plugin performs an authenticated request.

## Troubleshooting

### Lampa cannot reach the bridge

- Confirm that both devices are on the same Wi-Fi network.
- Open `<bridge-url>/health` from another local device.
- Check whether the router has client or access-point isolation enabled.
- Try another port if `8080` is already in use.
- Use an `http://` Lampa page when the target platform blocks requests from HTTPS pages to local HTTP services.

### The bridge stops in the background

Disable battery optimization for Lampa Bridge. On MIUI devices, set the app's battery mode to **No restrictions**.

### The phone shows no local IP address

Reconnect to Wi-Fi and reopen the app. Mobile-data addresses are not suitable for a local Lampa connection.
