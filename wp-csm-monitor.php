<?php
/**
 * Plugin Name: WP CSM Monitor
 * Description: Floating block-editor panel for WordPress 7.1 client-side media (CSM) testing — gates, uploads, Values tab, export.
 * Version: 1.4.0
 * Author: TiinyCloud
 * Requires at least: 7.1
 * Requires PHP: 7.4
 * License: GPL-2.0-or-later
 * Text Domain: wp-csm-monitor
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'WP_CSM_MONITOR_VERSION', '1.4.0' );
define( 'WP_CSM_MONITOR_FILE', __FILE__ );
define( 'WP_CSM_MONITOR_DIR', plugin_dir_path( __FILE__ ) );
define( 'WP_CSM_MONITOR_URL', plugin_dir_url( __FILE__ ) );

/**
 * Primary log path (inside the site uploads dir).
 */
function wp_csm_monitor_log_path(): string {
	$dir = WP_CONTENT_DIR . '/uploads';
	if ( ! is_dir( $dir ) ) {
		wp_mkdir_p( $dir );
	}
	return trailingslashit( $dir ) . 'wp-csm-monitor.jsonl';
}

/**
 * Optional mirror path.
 *
 * Define in wp-config.php to also write logs somewhere convenient, e.g.:
 *   define( 'WP_CSM_MONITOR_MIRROR', '/path/to/workspace/logs/wp-csm-monitor.jsonl' );
 *
 * Or filter: add_filter( 'wp_csm_monitor_mirror_path', fn() => '/tmp/csm.jsonl' );
 */
function wp_csm_monitor_mirror_path(): string {
	$default = defined( 'WP_CSM_MONITOR_MIRROR' ) ? (string) WP_CSM_MONITOR_MIRROR : '';
	/**
	 * Filters the optional secondary log path.
	 *
	 * @param string $path Absolute filesystem path, or empty to disable mirroring.
	 */
	return (string) apply_filters( 'wp_csm_monitor_mirror_path', $default );
}

/**
 * Append one or more JSONL records to the log file(s).
 *
 * @param array<int,array<string,mixed>> $records Records to append.
 * @return true|\WP_Error
 */
function wp_csm_monitor_append_records( array $records ) {
	if ( empty( $records ) ) {
		return true;
	}

	$lines = '';
	foreach ( $records as $record ) {
		$json = wp_json_encode( $record );
		if ( false === $json ) {
			continue;
		}
		$lines .= $json . "\n";
	}

	if ( '' === $lines ) {
		return true;
	}

	$primary = wp_csm_monitor_log_path();
	$result  = file_put_contents( $primary, $lines, FILE_APPEND | LOCK_EX );
	if ( false === $result ) {
		return new WP_Error( 'csm_log_write_failed', 'Could not write CSM monitor log.', array( 'status' => 500 ) );
	}

	$size = file_exists( $primary ) ? filesize( $primary ) : 0;
	if ( $size && $size > 5 * 1024 * 1024 ) {
		@rename( $primary, $primary . '.prev' );
	}

	$mirror = wp_csm_monitor_mirror_path();
	if ( $mirror ) {
		$mirror_dir = dirname( $mirror );
		if ( ! is_dir( $mirror_dir ) ) {
			@mkdir( $mirror_dir, 0755, true );
		}
		if ( is_dir( $mirror_dir ) && is_writable( $mirror_dir ) ) {
			@file_put_contents( $mirror, $lines, FILE_APPEND | LOCK_EX );
			$m_size = file_exists( $mirror ) ? filesize( $mirror ) : 0;
			if ( $m_size && $m_size > 5 * 1024 * 1024 ) {
				@rename( $mirror, $mirror . '.prev' );
			}
		}
	}

	return true;
}

/**
 * PHP-side CSM diagnostics for the Values tab.
 *
 * @return array<string,mixed>
 */
function wp_csm_monitor_collect_diagnostics(): array {
	$host           = strtolower( (string) strtok( $_SERVER['HTTP_HOST'] ?? '', ':' ) );
	$secure_default = ( is_ssl() || 'localhost' === $host || str_ends_with( $host, '.localhost' ) );
	$enabled        = function_exists( 'wp_is_client_side_media_processing_enabled' )
		? wp_is_client_side_media_processing_enabled()
		: false;

	$chromium = function_exists( 'wp_get_chromium_major_version' )
		? wp_get_chromium_major_version()
		: null;

	$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;

	$image_sizes = array();
	if ( function_exists( 'wp_get_registered_image_subsizes' ) ) {
		foreach ( wp_get_registered_image_subsizes() as $name => $size ) {
			$image_sizes[ $name ] = $size;
		}
	}

	return array(
		'collectedAt'    => gmdate( 'c' ),
		'php'            => array(
			'wp_is_client_side_media_processing_enabled' => $enabled,
			'filter'                                    => 'wp_client_side_media_processing_enabled',
			'secureContextDefault'                      => $secure_default,
			'is_ssl'                                    => is_ssl(),
			'http_host'                                 => $host,
			'chromiumMajor'                             => $chromium,
			'dipEligible'                               => ( null !== $chromium && $chromium >= 137 ),
			'dipHeader'                                 => 'Document-Isolation-Policy: isolate-and-credentialless',
			'can_upload_files'                          => current_user_can( 'upload_files' ),
			'screen_id'                                 => $screen ? $screen->id : null,
			'is_block_editor'                           => $screen ? (bool) $screen->is_block_editor() : null,
			'pagenow'                                   => isset( $GLOBALS['pagenow'] ) ? (string) $GLOBALS['pagenow'] : '',
			'is_block_theme'                            => function_exists( 'wp_is_block_theme' ) ? wp_is_block_theme() : null,
		),
		'restIndexMedia' => array(
			'image_sizes'          => $image_sizes,
			'image_size_threshold' => (int) apply_filters( 'big_image_size_threshold', 2560, array( 0, 0 ), '', 0 ),
			'image_strip_meta'     => (bool) apply_filters( 'image_strip_meta', true ),
			'image_max_bit_depth'  => (int) apply_filters( 'image_max_bit_depth', 16, 16 ),
			'note'                 => 'Same fields REST index exposes when CSM is enabled + user can upload.',
		),
		'relatedFilters' => array(
			'wp_client_side_media_processing_enabled' => $enabled,
			'big_image_size_threshold'                => (int) apply_filters( 'big_image_size_threshold', 2560, array( 0, 0 ), '', 0 ),
			'image_strip_meta'                        => (bool) apply_filters( 'image_strip_meta', true ),
			'image_max_bit_depth'                     => (int) apply_filters( 'image_max_bit_depth', 16, 16 ),
			'image_editor_output_format'              => apply_filters( 'image_editor_output_format', array(), '', '' ),
		),
	);
}

add_action(
	'rest_api_init',
	static function (): void {
		register_rest_route(
			'wp-csm-monitor/v1',
			'/diagnostics',
			array(
				'methods'             => 'GET',
				'permission_callback' => static function () {
					return current_user_can( 'upload_files' );
				},
				'callback'            => static function () {
					return rest_ensure_response( wp_csm_monitor_collect_diagnostics() );
				},
			)
		);

		register_rest_route(
			'wp-csm-monitor/v1',
			'/log',
			array(
				'methods'             => 'POST',
				'permission_callback' => static function () {
					return current_user_can( 'upload_files' );
				},
				'callback'            => static function ( WP_REST_Request $request ) {
					$payload = $request->get_json_params();
					if ( ! is_array( $payload ) ) {
						return new WP_Error( 'csm_log_invalid', 'Expected JSON body.', array( 'status' => 400 ) );
					}

					$records = isset( $payload['records'] ) && is_array( $payload['records'] )
						? $payload['records']
						: array( $payload );

					$normalized = array();
					foreach ( $records as $record ) {
						if ( ! is_array( $record ) ) {
							continue;
						}
						$record['server_received_at'] = gmdate( 'c' );
						$record['user_id']            = get_current_user_id();
						$normalized[]                 = $record;
					}

					$write = wp_csm_monitor_append_records( $normalized );
					if ( is_wp_error( $write ) ) {
						return $write;
					}

					return rest_ensure_response(
						array(
							'ok'     => true,
							'count'  => count( $normalized ),
							'path'   => wp_csm_monitor_log_path(),
							'mirror' => wp_csm_monitor_mirror_path(),
						)
					);
				},
			)
		);

		register_rest_route(
			'wp-csm-monitor/v1',
			'/log',
			array(
				'methods'             => 'DELETE',
				'permission_callback' => static function () {
					return current_user_can( 'upload_files' );
				},
				'callback'            => static function () {
					foreach ( array( wp_csm_monitor_log_path(), wp_csm_monitor_mirror_path() ) as $path ) {
						if ( ! $path ) {
							continue;
						}
						if ( file_exists( $path ) ) {
							@unlink( $path );
						}
						if ( file_exists( $path . '.prev' ) ) {
							@unlink( $path . '.prev' );
						}
					}
					return rest_ensure_response( array( 'ok' => true ) );
				},
			)
		);
	}
);

add_action(
	'enqueue_block_editor_assets',
	static function (): void {
		if ( ! current_user_can( 'upload_files' ) ) {
			return;
		}

		$js_path = WP_CSM_MONITOR_DIR . 'monitor.js';
		$js_url  = WP_CSM_MONITOR_URL . 'monitor.js';

		if ( ! file_exists( $js_path ) ) {
			return;
		}

		$handle = 'wp-csm-monitor';

		wp_enqueue_script(
			$handle,
			$js_url,
			array( 'wp-data', 'wp-api-fetch', 'wp-dom-ready', 'wp-upload-media' ),
			(string) filemtime( $js_path ),
			array(
				'in_footer' => true,
			)
		);

		$enabled  = function_exists( 'wp_is_client_side_media_processing_enabled' )
			? wp_is_client_side_media_processing_enabled()
			: false;
		$chromium = function_exists( 'wp_get_chromium_major_version' )
			? wp_get_chromium_major_version()
			: null;
		$host     = strtolower( ( string ) strtok( $_SERVER['HTTP_HOST'] ?? '', ':' ) );

		wp_add_inline_script(
			$handle,
			'window.__wpCsmMonitor = ' . wp_json_encode(
				array(
					'phpEnabled'    => (bool) $enabled,
					'siteUrl'       => home_url( '/' ),
					'isSsl'         => is_ssl(),
					'httpHost'      => $host,
					'chromiumMajor' => $chromium,
					'dipEligible'   => ( null !== $chromium && $chromium >= 137 ),
					'canDelete'     => current_user_can( 'delete_posts' ),
					'logPath'       => wp_csm_monitor_log_path(),
					'mirrorPath'    => wp_csm_monitor_mirror_path(),
					'version'       => WP_CSM_MONITOR_VERSION,
				)
			) . ';',
			'before'
		);
	}
);
