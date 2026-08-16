# WP Media Utility

WordPress media testing utility for the block editor — currently focused on **7.1 client-side media processing (CSM)**, with room to grow.

Published by [TiinyCloud](https://github.com/tiinycloud).

**Current version:** see `Version:` in `wp-media-utility.php` (also shown in the panel as `vX.Y.Z`).

## Features
- ACTIVE / OFF status for client-side media
- Uploads grouped by image (`CLIENT DONE`, `SERVER`, `ERROR`, …)
- Stats + filters, expand/collapse
- Values tab: live PHP filters, window flags, REST image settings, browser probes
- Export JSON (Shift+click = CSV), Copy report
- Clear session / clear log / wipe media (throwaway test sites)
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
3. Upload/drop images (don’t only select from Media Library)
4. Expect client path: `generate_sub_sizes=false` → `sideload` → `finalize`

## Optional log mirror
Default log: `wp-content/uploads/wp-media-utility.jsonl`

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
