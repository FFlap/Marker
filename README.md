# Marker

A local-first Chrome extension built with WXT that remembers the latest episode you opened on Crunchyroll and Netflix.

## What it does

- Detects Crunchyroll and Netflix watch pages automatically.
- Tracks one latest episode per series.
- Shows the series title, season number, episode number, and episode title.
- Opens the exact last episode when you click a series in the popup.
- Lets Crunchyroll handle playback-position resume through your signed-in account.
- Stores all bookmark data locally in Chrome. It does not read cookies, credentials, or account data.

## Install for development

```bash
npm install
npm run build
```

Then open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select:

```text
.output/chrome-mv3
```

Pin **Marker** to the Chrome toolbar if you want one-click access.

## Use

1. Open or continue an episode on Crunchyroll or Netflix.
2. The extension records it after the service finishes rendering the episode metadata.
3. Move to another episode and that series updates automatically.
4. Open the extension popup and click the series to return to that episode.

## Commands

```bash
npm test
npm run typecheck
npm run build
npm run zip
```
