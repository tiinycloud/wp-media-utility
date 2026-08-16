# WP CSM Monitor

Floating block-editor panel for testing **WordPress 7.1 client-side media processing (CSM)**.

Built for contributor-day / QA workflows. Published by [TiinyCloud](https://github.com/tiinycloud).

**Current version:** see `Version:` in `wp-csm-monitor.php` (also shown in the panel as `vX.Y.Z`).

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
1. Download `wp-csm-monitor-vX.Y.Z.zip` from [Releases](https://github.com/tiinycloud/wp-csm-monitor/releases)
2. WP Admin → **Plugins → Add New → Upload Plugin**
3. Activate **WP CSM Monitor**

### Folder
Copy `wp-csm-monitor/` to `wp-content/plugins/wp-csm-monitor/` and activate.

## Requirements
- WordPress **7.1+**
- Block editor over **HTTPS** (or localhost)
- Chrome/Edge **137+** for full WASM / DIP path
- Capability: `upload_files`

## Usage
1. Open a post in the block editor
2. Bottom-right panel: **WP CSM Monitor**
3. Upload/drop images (don’t only select from Media Library)
4. Expect client path: `generate_sub_sizes=false` → `sideload` → `finalize`

## Optional log mirror
Default log: `wp-content/uploads/wp-csm-monitor.jsonl`

```php
define( 'WP_CSM_MONITOR_MIRROR', '/absolute/path/to/wp-csm-monitor.jsonl' );
```

Or:

```php
add_filter( 'wp_csm_monitor_mirror_path', function () {
	return '/absolute/path/to/wp-csm-monitor.jsonl';
} );
```

## Releasing
1. Bump `Version:` header and `WP_CSM_MONITOR_VERSION` (must match)
2. From repo root:

```bash
./pack.sh
```

Creates `wp-csm-monitor-vX.Y.Z.zip`.

## Notes
- Panel loads only in the block editor
- **Wipe** deletes **all** media library items — for throwaway test sites only
- Classic Media Library admin uploads are not client-side
