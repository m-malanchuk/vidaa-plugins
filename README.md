# HDRezka for Lampa

A standalone HDRezka source plugin for the Lampa media application.

The plugin adds a dedicated HDRezka action to Lampa title cards. It searches
HDRezka, provides movie and series navigation, and hands the selected video and
subtitles to Lampa's native player. HDRezka control requests are sent through a
Lampa Bridge phone on the local network; media streams are played directly from
their final CDN URLs.

## Features

- Dedicated HDRezka card action without replacing Lampa's native Watch action.
- Movie and series search with ambiguous-result selection and pagination.
- Voice, season, episode, quality, and subtitle selection.
- Optional HDRezka account sign-in and cookie management.
- Ordered failover across as many as three Lampa Bridge phones.
- Russian, English, and Ukrainian interface text.

## Requirements

- Lampa with support for external JavaScript plugins.
- A phone running a compatible Lampa Bridge instance and reachable from the
  device running Lampa.
- At least one valid Lampa Bridge URL configured in the plugin settings.

The bridge handles search, page, authentication, cookie, redirect, and other
control requests. It does not proxy video or subtitle streams.

## Installation

Add the following URL as an external plugin in Lampa:

```text
https://m-malanchuk.github.io/vidaa-plugins/lampa/hdrezka.js
```

After the plugin loads, open **Settings > HDRezka > Lampa Bridge** and enter the
URL of at least one phone running Lampa Bridge, including `http://` or
`https://`. Up to three phone URLs can be configured in failover order.

If needed, set a different HDRezka mirror in the same section. An address
without a scheme is treated as HTTPS.

## Usage

1. Open a movie or series card in Lampa.
2. Select the green **HDRezka** action.
3. Choose a search result when the title cannot be matched automatically.
4. For a series, choose a voice, season, and episode.
5. Start playback in Lampa's native player.

Account credentials and cookies can be configured under **Settings > HDRezka >
Authorization**. They are stored by Lampa on the device and are not encrypted
by this plugin.

## Limitations

- A compatible Lampa Bridge installation is required and is distributed
  separately from this repository.
- HDRezka mirror markup and response formats may change and require a plugin
  update.
- Browser rules for local-network requests, CORS, Private Network Access, and
  mixed HTTP/HTTPS content vary by device and Lampa installation.
- Operation on a real VIDAA television still requires device-specific
  acceptance testing.
