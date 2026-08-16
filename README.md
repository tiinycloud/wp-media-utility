# WP Media Utility

WordPress media testing utility for the block editor — currently focused on **7.1 client-side media processing (CSM)**, with room to grow.

Published by [TiinyCloud](https://github.com/tiinycloud).

**Current version:** see `Version:` in `wp-media-utility.php` (also shown in the panel as `vX.Y.Z`).

## Features
- ACTIVE / OFF status for client-side media
- **Logs** tab: uploads grouped by image (`CLIENT DONE`, `SERVER`, `ERROR`, …)
- Stats + filters, expand/collapse
- **Test Files** tab: PR #13068 fixtures with one-click CSM upload, status pills, and expandable per-file event log
- **Server** tab: live PHP filters, window flags, REST image settings, browser probes
- **Settings** tab: insert prefs, reset panel layout
- Drag the header to move; drag the bottom-right corner to resize (saved per browser tab)
- Export JSON (Shift+click = CSV), Copy report
- Clear session / clear disk log / wipe media (throwaway test sites; Wipe requires admin)
- Hover tooltips on controls

## Install

### ZIP
1. Download `wp-media-utility-vX.Y.Z.zip` from [Releases](https://github.com/tiinycloud/wp-media-utility/releases)
2. WP Admin → **Plugins → Add New → Upload Plugin**
3. Activate **WP Media Utility**

### Folder
Copy `wp-media-utility/` to `wp-content/plugins/wp-media-utility/` and activate.

## Requirements
- WordPress **7.1+**
- Block editor over **HTTPS** (or localhost)
- Chrome/Edge **137+** for full WASM / DIP path
- Capability: `upload_files`

## Usage
1. Open a post in the block editor
2. Bottom-right panel: **WP Media Utility**
3. Upload/drop images, **or** open **Test Files** and click **Upload** on a PR #13068 fixture
4. Expect client path: `generate_sub_sizes=false` → `sideload` → `finalize`

### Test Files tab
Lists curated images from [PR #13068](https://github.com/WordPress/wordpress-develop/pull/13068). Each **Upload** fetches the file from GitHub raw and sends it through `core/upload-media` `addItems` (same pipeline as a real editor upload). Rows show the same status pills as **Logs** (`CLIENT DONE` / `SERVER` / `ERROR`) and expand for create / sideload / finalize events.

Optional: **Settings → Insert Image blocks with Test Files uploads** (on by default).

- **Single Upload** inserts a blob `core/image` (same as drag-and-drop) so CSM runs through the block.
- **Upload all / group** uploads via `upload-media` one file at a time, waits until the attachment exists and the queue is quiet, then inserts a finished Image block — so Gutenberg is not clogged with concurrent blob CSM jobs.

Override the raw base URL if the PR branch moves:

```php
add_filter( 'wp_media_utility_catalog_base_url', function () {
	return 'https://raw.githubusercontent.com/OWNER/REPO/REF/';
} );
```

External datasets (libwebp, PNGSuite, etc.) are linked for reference only.

## Optional log mirror
Default log: `wp-content/wp-media-utility-logs/wp-media-utility.jsonl` (outside public `uploads/`)

```php
define( 'WP_MEDIA_UTILITY_MIRROR', '/absolute/path/to/wp-media-utility.jsonl' );
```

Or:

```php
add_filter( 'wp_media_utility_mirror_path', function () {
	return '/absolute/path/to/wp-media-utility.jsonl';
} );
```

## Releasing
1. Bump `Version:` header and `WP_MEDIA_UTILITY_VERSION` (must match)
2. From repo root:

```bash
./pack.sh
```

Creates `wp-media-utility-vX.Y.Z.zip`.

## Notes
- Panel loads only in the block editor
- **Wipe** deletes **all** media library items — for throwaway test sites only
- Classic Media Library admin uploads are not client-side
