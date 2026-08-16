/**
 * WP Media Utility — realtime client-side vs server-side media panel.
 * Groups activity by image with collapsible rows and status pills.
 */
( function () {
	'use strict';

	const boot = window.__wpMediaUtility || {};
	const MAX_UPLOADS = 100;
	const MAX_EVENTS_PER_UPLOAD = 40;

	const state = {
		collapsed: false,
		tab: 'uploads', // uploads | values
		uploads: {}, // key -> upload group
		uploadOrder: [], // newest first
		pendingCreates: [], // queue correlating create start -> response
		queueSnapshot: [],
		detection: null,
		logBuffer: [],
		logFlushTimer: null,
		loggedSession: false,
		openKeys: {}, // remember expanded dropdowns
		filter: 'all', // all | client | server | error | done
		diagnostics: null,
		diagnosticsLoading: false,
		diagnosticsError: '',
		valuesOpen: {}, // section expand state
		gatesOpen: false,
	};

	let pendingSeq = 0;

	function now() {
		return new Date().toLocaleTimeString();
	}

	function isoNow() {
		return new Date().toISOString();
	}

	function detect() {
		const out = {
			phpEnabled: !! boot.phpEnabled,
			flag: !! window.__clientSideMediaProcessing,
			dipFlag: !! window.__documentIsolationPolicy,
			crossOriginIsolated: !! window.crossOriginIsolated,
			sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
			support: null,
			reason: '',
		};

		try {
			if ( window.wp && wp.uploadMedia && typeof wp.uploadMedia.detectClientSideMediaSupport === 'function' ) {
				const d = wp.uploadMedia.detectClientSideMediaSupport();
				out.support = !!( d && d.supported );
				out.reason = ( d && d.reason ) || '';
			}
		} catch ( e ) {
			out.reason = String( e && e.message ? e.message : e );
		}

		out.ready = out.phpEnabled && out.flag && out.crossOriginIsolated && out.sharedArrayBuffer && out.support === true;
		state.detection = out;
		return out;
	}

	function clientSideStatus( d ) {
		const det = d || state.detection || detect();
		if ( det.ready ) {
			return {
				active: true,
				label: 'CLIENT-SIDE ACTIVE',
				short: 'ACTIVE',
				tone: 'ok',
				detail: 'Uploads can use browser WASM processing',
			};
		}
		const missing = [];
		if ( ! det.phpEnabled ) {
			missing.push( 'PHP off' );
		}
		if ( ! det.flag ) {
			missing.push( 'flag' );
		}
		if ( ! det.crossOriginIsolated ) {
			missing.push( 'COI' );
		}
		if ( ! det.sharedArrayBuffer ) {
			missing.push( 'SAB' );
		}
		if ( det.support !== true ) {
			missing.push( 'detect' );
		}
		return {
			active: false,
			label: 'CLIENT-SIDE OFF',
			short: 'OFF',
			tone: 'bad',
			detail: missing.length ? 'Blocked: ' + missing.join( ', ' ) : ( det.reason || 'Server fallback likely' ),
		};
	}

	function formatVal( val ) {
		if ( val === undefined ) {
			return 'undefined';
		}
		if ( val === null ) {
			return 'null';
		}
		if ( typeof val === 'boolean' ) {
			return val ? 'true' : 'false';
		}
		if ( typeof val === 'object' ) {
			try {
				return JSON.stringify( val, null, 2 );
			} catch ( e ) {
				return String( val );
			}
		}
		return String( val );
	}

	function toneForBool( val ) {
		if ( val === true ) {
			return 'ok';
		}
		if ( val === false ) {
			return 'bad';
		}
		return 'muted';
	}

	function collectClientDiagnostics() {
		const d = detect();
		const status = clientSideStatus( d );
		const conn = ( typeof navigator !== 'undefined' && navigator.connection ) || null;
		let heic = null;
		let blobWorkerOk = null;
		let blobWorkerError = '';

		try {
			if ( window.wp && wp.uploadMedia && typeof wp.uploadMedia.isHeicCanvasSupported === 'function' ) {
				heic = !! wp.uploadMedia.isHeicCanvasSupported();
			}
		} catch ( e ) {
			heic = null;
		}

		try {
			const testBlob = new Blob( [ '' ], { type: 'application/javascript' } );
			const testUrl = URL.createObjectURL( testBlob );
			try {
				const tw = new Worker( testUrl );
				tw.terminate();
				blobWorkerOk = true;
			} finally {
				URL.revokeObjectURL( testUrl );
			}
		} catch ( e ) {
			blobWorkerOk = false;
			blobWorkerError = String( e && e.message ? e.message : e );
		}

		let uploadSettings = null;
		try {
			if ( window.wp && wp.data && typeof wp.data.select === 'function' ) {
				const sel = wp.data.select( 'core/upload-media' );
				if ( sel && typeof sel.getSettings === 'function' ) {
					const s = sel.getSettings() || {};
					uploadSettings = {
						maxConcurrentUploads: s.maxConcurrentUploads,
						maxConcurrentImageProcessing: s.maxConcurrentImageProcessing,
						imageQuality: s.imageQuality,
						imageStripMeta: s.imageStripMeta,
						imageMaxBitDepth: s.imageMaxBitDepth,
						maxUploadFileSize: s.maxUploadFileSize,
						allowedMimeTypes: s.allowedMimeTypes,
						queueStatus: typeof sel.getQueueStatus === 'function' ? sel.getQueueStatus() : undefined,
						hasMediaUpload: typeof s.mediaUpload === 'function',
						hasMediaSideload: typeof s.mediaSideload === 'function',
						hasMediaFinalize: typeof s.mediaFinalize === 'function',
					};
				}
			}
		} catch ( e ) {
			uploadSettings = { error: String( e && e.message ? e.message : e ) };
		}

		return {
			collectedAt: new Date().toISOString(),
			status: {
				label: status.label,
				active: status.active,
				detail: status.detail,
			},
			windowFlags: {
				'__clientSideMediaProcessing': !! window.__clientSideMediaProcessing,
				'__documentIsolationPolicy': !! window.__documentIsolationPolicy,
				'typeof __clientSideMediaProcessing': typeof window.__clientSideMediaProcessing,
				'typeof __documentIsolationPolicy': typeof window.__documentIsolationPolicy,
			},
			isolation: {
				crossOriginIsolated: !! window.crossOriginIsolated,
				'typeof SharedArrayBuffer': typeof SharedArrayBuffer,
				SharedArrayBufferAvailable: typeof SharedArrayBuffer !== 'undefined',
			},
			detection: {
				supported: d.support,
				reason: d.reason || '',
				phpEnabled: d.phpEnabled,
				ready: d.ready,
			},
			browserProbes: {
				'typeof WebAssembly': typeof WebAssembly,
				'typeof Worker': typeof Worker,
				'typeof createImageBitmap': typeof createImageBitmap,
				'typeof OffscreenCanvas': typeof OffscreenCanvas,
				isHeicCanvasSupported: heic,
				blobWorkerOk,
				blobWorkerError: blobWorkerError || undefined,
			},
			navigator: {
				userAgent: navigator.userAgent,
				deviceMemory: 'deviceMemory' in navigator ? navigator.deviceMemory : 'n/a',
				hardwareConcurrency: 'hardwareConcurrency' in navigator ? navigator.hardwareConcurrency : 'n/a',
				saveData: conn ? !! conn.saveData : 'n/a',
				effectiveType: conn && conn.effectiveType ? conn.effectiveType : 'n/a',
				downlink: conn && 'downlink' in conn ? conn.downlink : 'n/a',
			},
			bootFromPhp: {
				phpEnabled: boot.phpEnabled,
				isSsl: boot.isSsl,
				httpHost: boot.httpHost || '',
				chromiumMajor: boot.chromiumMajor ?? null,
				dipEligible: boot.dipEligible ?? null,
				siteUrl: boot.siteUrl || '',
				version: boot.version || '',
			},
			uploadMediaStore: uploadSettings,
			coreDefaultsNoted: {
				note: 'Hardcoded in @wordpress/upload-media (not live-read); for comparison when hacking core.',
				DEFAULT_MAX_CONCURRENT_UPLOADS: 5,
				DEFAULT_MAX_CONCURRENT_IMAGE_PROCESSING: 2,
				BASELINE_MEMORY_BUDGET_GiB: 0.9,
				INTERLACED_MEMORY_BUDGET_GiB: 0.5,
				DEFAULT_OUTPUT_QUALITY: 0.82,
				GIF_CONVERSION_TIMEOUT_MS: 30000,
				minChromiumForDip: 137,
			},
			page: {
				href: location.href,
				origin: location.origin,
				protocol: location.protocol,
			},
		};
	}

	async function loadDiagnostics( force ) {
		if ( state.diagnosticsLoading ) {
			return;
		}
		state.diagnosticsLoading = true;
		state.diagnosticsError = '';
		if ( force && window.wp && wp.uploadMedia && typeof wp.uploadMedia.clearFeatureDetectionCache === 'function' ) {
			try {
				wp.uploadMedia.clearFeatureDetectionCache();
			} catch ( e ) {
				// ignore
			}
		}
		detect();
		const client = collectClientDiagnostics();
		let server = null;
		try {
			if ( window.wp && wp.apiFetch ) {
				server = await wp.apiFetch( { path: '/wp-media-utility/v1/diagnostics' } );
			}
		} catch ( e ) {
			state.diagnosticsError = String( e && e.message ? e.message : e );
		}
		state.diagnostics = {
			client,
			server,
			fetchedAt: new Date().toISOString(),
		};
		state.diagnosticsLoading = false;
		render();
	}

	function classifyUrl( url, method ) {
		const u = String( url || '' );
		const m = String( method || 'GET' ).toUpperCase();
		if ( m === 'GET' || m === 'HEAD' || m === 'OPTIONS' ) {
			return null;
		}
		if ( /\/wp\/v2\/media\/\d+\/sideload\b/.test( u ) ) {
			return { kind: 'sideload', path: 'client' };
		}
		if ( /\/wp\/v2\/media\/\d+\/finalize\b/.test( u ) ) {
			return { kind: 'finalize', path: 'client' };
		}
		// Create = collection POST only (/wp/v2/media or ?query) — never /wp/v2/media/123.
		if ( m === 'POST' && isMediaCollectionUrl( u ) ) {
			return { kind: 'create', path: 'unknown' };
		}
		if ( /vips|wasm|upload-media|video-conversion/.test( u ) ) {
			return { kind: 'asset', path: 'client' };
		}
		return null;
	}

	function isMediaCollectionUrl( url ) {
		const path = String( url || '' )
			.replace( /^https?:\/\/[^/?#]+/i, '' )
			.split( '?' )[ 0 ]
			.replace( /\/+$/, '' );
		return /\/wp\/v2\/media$/.test( path );
	}

	function looksLikeMediaUpload( options ) {
		if ( ! options ) {
			return false;
		}
		if ( options.body instanceof FormData ) {
			const file = options.body.get( 'file' );
			if ( file ) {
				return true;
			}
			if ( options.body.get( 'generate_sub_sizes' ) !== null ) {
				return true;
			}
		}
		if ( options.data && typeof options.data === 'object' && 'generate_sub_sizes' in options.data ) {
			return true;
		}
		return false;
	}

	function dropUpload( key ) {
		if ( ! key || ! state.uploads[ key ] ) {
			return;
		}
		delete state.uploads[ key ];
		state.uploadOrder = state.uploadOrder.filter( ( k ) => k !== key );
		delete state.openKeys[ key ];
		state.pendingCreates = state.pendingCreates.filter( ( k ) => k !== key );
	}

	function mediaIdFromUrl( url ) {
		const m = String( url || '' ).match( /\/wp\/v2\/media\/(\d+)(?:\/|\?|$)/ );
		return m ? m[ 1 ] : null;
	}

	function ensureUpload( key, defaults ) {
		if ( ! state.uploads[ key ] ) {
			state.uploads[ key ] = {
				key,
				mediaId: defaults.mediaId || null,
				name: defaults.name || 'Uploading…',
				path: defaults.path || 'unknown',
				sizes: [],
				events: [],
				error: '',
				startedAt: now(),
				updatedAt: now(),
			};
			state.uploadOrder.unshift( key );
			if ( state.openKeys[ key ] === undefined ) {
				state.openKeys[ key ] = true; // newest open by default
			}
			while ( state.uploadOrder.length > MAX_UPLOADS ) {
				const old = state.uploadOrder.pop();
				delete state.uploads[ old ];
				delete state.openKeys[ old ];
			}
		}
		return state.uploads[ key ];
	}

	function rekeyUpload( oldKey, newKey ) {
		if ( oldKey === newKey || ! state.uploads[ oldKey ] ) {
			return state.uploads[ newKey ] || state.uploads[ oldKey ];
		}
		if ( state.uploads[ newKey ] ) {
			// Merge into existing.
			const a = state.uploads[ newKey ];
			const b = state.uploads[ oldKey ];
			a.events = b.events.concat( a.events ).slice( 0, MAX_EVENTS_PER_UPLOAD );
			a.sizes = Array.from( new Set( b.sizes.concat( a.sizes ) ) );
			if ( b.name && a.name === 'Uploading…' ) {
				a.name = b.name;
			}
			if ( b.path && b.path !== 'unknown' ) {
				a.path = b.path;
			}
			delete state.uploads[ oldKey ];
			state.uploadOrder = state.uploadOrder.filter( ( k ) => k !== oldKey );
			if ( state.openKeys[ oldKey ] ) {
				state.openKeys[ newKey ] = true;
			}
			delete state.openKeys[ oldKey ];
			return a;
		}
		const u = state.uploads[ oldKey ];
		u.key = newKey;
		u.mediaId = String( newKey ).replace( /^#/, '' );
		state.uploads[ newKey ] = u;
		delete state.uploads[ oldKey ];
		state.uploadOrder = state.uploadOrder.map( ( k ) => ( k === oldKey ? newKey : k ) );
		state.openKeys[ newKey ] = state.openKeys[ oldKey ] !== false;
		delete state.openKeys[ oldKey ];
		return u;
	}

	function deriveStatus( upload ) {
		if ( upload.error ) {
			return { label: 'ERROR', tone: 'bad', filter: 'error' };
		}
		const kinds = upload.events.map( ( e ) => e.kind );
		const hasFinalize = kinds.includes( 'finalize' );
		const hasSideload = kinds.includes( 'sideload' );
		const hasCreate = kinds.includes( 'create' );
		if ( upload.path === 'client' && hasFinalize ) {
			return { label: 'CLIENT DONE', tone: 'ok', filter: 'done' };
		}
		if ( upload.path === 'server' && hasCreate && ! hasSideload ) {
			return { label: 'SERVER', tone: 'warn', filter: 'server' };
		}
		if ( upload.path === 'client' && hasSideload && ! hasFinalize ) {
			return { label: 'CLIENT…', tone: 'ok', filter: 'client' };
		}
		if ( upload.path === 'client' ) {
			return { label: 'CLIENT', tone: 'ok', filter: 'client' };
		}
		if ( hasCreate ) {
			return { label: 'UPLOADING', tone: 'muted', filter: 'all' };
		}
		return { label: 'PENDING', tone: 'muted', filter: 'all' };
	}

	function getUploadList() {
		return state.uploadOrder
			.map( ( key ) => state.uploads[ key ] )
			.filter( Boolean );
	}

	function matchesFilter( upload ) {
		if ( state.filter === 'all' ) {
			return true;
		}
		const st = deriveStatus( upload );
		if ( state.filter === 'client' ) {
			return upload.path === 'client' || st.filter === 'client' || st.filter === 'done';
		}
		if ( state.filter === 'server' ) {
			return upload.path === 'server' || st.filter === 'server';
		}
		if ( state.filter === 'error' ) {
			return st.filter === 'error';
		}
		if ( state.filter === 'done' ) {
			return st.filter === 'done';
		}
		return true;
	}

	function computeStats() {
		const list = getUploadList();
		const stats = {
			total: list.length,
			clientDone: 0,
			clientActive: 0,
			server: 0,
			error: 0,
			other: 0,
		};
		list.forEach( ( u ) => {
			const st = deriveStatus( u );
			if ( st.filter === 'done' ) {
				stats.clientDone += 1;
			} else if ( st.filter === 'server' ) {
				stats.server += 1;
			} else if ( st.filter === 'error' ) {
				stats.error += 1;
			} else if ( st.filter === 'client' || u.path === 'client' ) {
				stats.clientActive += 1;
			} else {
				stats.other += 1;
			}
		} );
		return stats;
	}

	function buildExportPayload() {
		const d = state.detection || detect();
		const stats = computeStats();
		return {
			exportedAt: new Date().toISOString(),
			page: location.href,
			userAgent: navigator.userAgent,
			mode: clientSideStatus( d ).label,
			clientSideActive: !! d.ready,
			gates: {
				phpEnabled: d.phpEnabled,
				flag: d.flag,
				dipFlag: d.dipFlag,
				crossOriginIsolated: d.crossOriginIsolated,
				sharedArrayBuffer: d.sharedArrayBuffer,
				support: d.support,
				reason: d.reason,
			},
			stats,
			filter: state.filter,
			diagnostics: state.diagnostics,
			uploads: getUploadList().map( ( u ) => {
				const st = deriveStatus( u );
				return {
					mediaId: u.mediaId,
					name: u.name,
					path: u.path,
					status: st.label,
					sizes: u.sizes.slice(),
					error: u.error || '',
					startedAt: u.startedAt,
					updatedAt: u.updatedAt,
					events: u.events.map( ( e ) => ( {
						t: e.t,
						phase: e.phase,
						kind: e.kind,
						path: e.path,
						note: e.note,
						size: e.size || '',
						ms: e.ms,
						url: e.url,
					} ) ),
				};
			} ),
		};
	}

	function downloadBlob( filename, mime, content ) {
		const blob = new Blob( [ content ], { type: mime } );
		const url = URL.createObjectURL( blob );
		const a = document.createElement( 'a' );
		a.href = url;
		a.download = filename;
		document.body.appendChild( a );
		a.click();
		a.remove();
		setTimeout( () => URL.revokeObjectURL( url ), 1000 );
	}

	function exportSession( format ) {
		const payload = buildExportPayload();
		const stamp = new Date().toISOString().replace( /[:.]/g, '-' );
		if ( format === 'csv' ) {
			const rows = [
				[ 'mediaId', 'name', 'status', 'path', 'sizes', 'error', 'events' ].join( ',' ),
			];
			payload.uploads.forEach( ( u ) => {
				const cells = [
					u.mediaId || '',
					'"' + String( u.name ).replace( /"/g, '""' ) + '"',
					u.status,
					u.path,
					'"' + u.sizes.join( '|' ) + '"',
					'"' + String( u.error || '' ).replace( /"/g, '""' ) + '"',
					String( u.events.length ),
				];
				rows.push( cells.join( ',' ) );
			} );
			downloadBlob( 'wp-media-utility-' + stamp + '.csv', 'text/csv;charset=utf-8', rows.join( '\n' ) );
			queueLog( { type: 'meta', note: 'exported csv · ' + payload.uploads.length + ' uploads' } );
			return;
		}
		downloadBlob(
			'wp-media-utility-' + stamp + '.json',
			'application/json;charset=utf-8',
			JSON.stringify( payload, null, 2 )
		);
		queueLog( { type: 'meta', note: 'exported json · ' + payload.uploads.length + ' uploads' } );
	}

	function clearSession() {
		const ok = window.confirm( 'Clear this session’s on-screen results? (Does not delete media or disk logs.)' );
		if ( ! ok ) {
			return;
		}
		state.uploads = {};
		state.uploadOrder = [];
		state.pendingCreates = [];
		state.queueSnapshot = [];
		state.openKeys = {};
		queueLog( { type: 'meta', note: 'session UI cleared' } );
		render();
	}

	function setAllOpen( open ) {
		state.uploadOrder.forEach( ( key ) => {
			state.openKeys[ key ] = open;
		} );
		render();
	}

	function queueLog( record ) {
		state.logBuffer.push( {
			ts: isoNow(),
			page: location.href,
			...record,
		} );
		if ( state.logFlushTimer ) {
			return;
		}
		state.logFlushTimer = setTimeout( flushLog, 400 );
	}

	function flushLog() {
		state.logFlushTimer = null;
		if ( ! state.logBuffer.length || ! window.wp || ! wp.apiFetch ) {
			return;
		}
		const records = state.logBuffer.splice( 0, state.logBuffer.length );
		wp.apiFetch( {
			path: '/wp-media-utility/v1/log',
			method: 'POST',
			data: { records },
		} ).catch( ( e ) => {
			console.warn( '[wp-media-utility] log write failed', e );
			state.logBuffer = records.concat( state.logBuffer );
		} );
	}

	function addEventToUpload( key, evt ) {
		const upload = ensureUpload( key, {
			mediaId: evt.mediaId || null,
			name: evt.name || 'Uploading…',
			path: evt.path || 'unknown',
		} );
		if ( evt.name && ( upload.name === 'Uploading…' || ! upload.name ) ) {
			upload.name = evt.name;
		}
		if ( evt.path && evt.path !== 'unknown' ) {
			upload.path = evt.path;
		}
		if ( evt.mediaId ) {
			upload.mediaId = String( evt.mediaId );
		}
		if ( evt.size && upload.sizes.indexOf( evt.size ) === -1 ) {
			upload.sizes.push( evt.size );
		}
		if ( evt.phase === 'err' ) {
			upload.error = evt.note || 'error';
		}
		upload.updatedAt = now();
		upload.events.unshift( {
			t: now(),
			phase: evt.phase,
			kind: evt.kind,
			path: evt.path,
			note: evt.note,
			url: evt.url,
			size: evt.size || '',
			ms: evt.ms || null,
		} );
		if ( upload.events.length > MAX_EVENTS_PER_UPLOAD ) {
			upload.events.length = MAX_EVENTS_PER_UPLOAD;
		}

		queueLog( {
			type: 'rest',
			mediaId: upload.mediaId,
			name: upload.name,
			phase: evt.phase,
			kind: evt.kind,
			path: evt.path,
			note: evt.note,
			url: evt.url,
			size: evt.size || '',
			status: deriveStatus( upload ).label,
		} );
		render();
	}

	function pathLabel( path ) {
		if ( path === 'client' ) {
			return 'CLIENT';
		}
		if ( path === 'server' ) {
			return 'SERVER';
		}
		return '…';
	}

	function pathTip( path ) {
		if ( path === 'client' ) {
			return 'Browser/WASM path (generate_sub_sizes=false → sideload → finalize)';
		}
		if ( path === 'server' ) {
			return 'Classic server Imagick/GD path (generate_sub_sizes=true or fallback)';
		}
		return 'Path not determined yet';
	}

	function statusTip( label ) {
		const tips = {
			'CLIENT DONE': 'Client finished: create(false) → sideload(s) → finalize',
			'CLIENT…': 'Client path in progress (sideloads, waiting for finalize)',
			CLIENT: 'Client path detected',
			SERVER: 'Server generated sub-sizes (no client sideload/finalize)',
			ERROR: 'Upload or processing error',
			UPLOADING: 'Create request seen; waiting for more events',
			PENDING: 'Queued / waiting',
		};
		return tips[ label ] || label;
	}

	function gateTip( shortKey ) {
		const tips = {
			PHP: 'wp_is_client_side_media_processing_enabled() (PHP)',
			flag: 'window.__clientSideMediaProcessing from core',
			DIP: 'window.__documentIsolationPolicy (Chromium ≥137)',
			COI: 'window.crossOriginIsolated (required for SharedArrayBuffer)',
			SAB: 'typeof SharedArrayBuffer !== "undefined"',
			detect: 'wp.uploadMedia.detectClientSideMediaSupport().supported',
		};
		return tips[ shortKey ] || shortKey;
	}

	function installFetchTap() {
		if ( window.wp && wp.apiFetch && typeof wp.apiFetch.use === 'function' ) {
			wp.apiFetch.use( ( options, next ) => {
				const url = options.url || options.path || '';
				if ( String( url ).indexOf( '/wp-media-utility/v1/' ) !== -1 ) {
					return next( options );
				}
				const method = options.method || 'GET';
				const classified = classifyUrl( url, method );
				const started = performance.now();
				let pendingKey = null;
				let fileName = '';
				let imageSize = '';
				let pathHint = classified ? classified.path : 'unknown';

				if ( classified ) {
					if ( options.body instanceof FormData ) {
						const g = options.body.get( 'generate_sub_sizes' );
						if ( g !== null && g !== undefined ) {
							pathHint = String( g ) === 'false' || g === false ? 'client' : 'server';
						}
						const size = options.body.get( 'image_size' );
						if ( size ) {
							imageSize = String( size );
						}
						const file = options.body.get( 'file' );
						if ( file && file.name ) {
							fileName = file.name;
						}
					} else if ( options.data && typeof options.data === 'object' ) {
						if ( 'generate_sub_sizes' in options.data ) {
							pathHint = options.data.generate_sub_sizes === false ? 'client' : 'server';
						}
					}

					const idFromUrl = mediaIdFromUrl( url );
					if ( classified.kind === 'create' ) {
						// Ignore non-upload POSTs to /media (metadata probes, empty posts, etc.).
						if ( ! looksLikeMediaUpload( options ) ) {
							return next( options );
						}
						pendingKey = 'pending-' + ++pendingSeq;
						state.pendingCreates.push( pendingKey );
						addEventToUpload( pendingKey, {
							phase: 'start',
							kind: 'create',
							path: pathHint,
							name: fileName || 'Uploading…',
							note:
								'create' +
								( pathHint !== 'unknown' ? ' · generate_sub_sizes=' + ( pathHint === 'client' ? 'false' : 'true' ) : '' ),
							url: String( url ).replace( /^https?:\/\/[^/]+/, '' ),
						} );
					} else if ( idFromUrl ) {
						addEventToUpload( idFromUrl, {
							phase: 'start',
							kind: classified.kind,
							path: pathHint === 'unknown' ? 'client' : pathHint,
							mediaId: idFromUrl,
							size: imageSize,
							note:
								classified.kind +
								( imageSize ? ' · size=' + imageSize : '' ),
							url: String( url ).replace( /^https?:\/\/[^/]+/, '' ),
						} );
					}
				}

				return next( options ).then(
					( result ) => {
						const ms = Math.round( performance.now() - started );
						if ( classified && classified.kind === 'create' && pendingKey ) {
							const mediaId = result && result.id ? String( result.id ) : null;
							if ( ! mediaId ) {
								dropUpload( pendingKey );
								render();
								return result;
							}
							const name =
								( result && ( result.source_url || result.title?.raw || result.title?.rendered ) ) ||
								fileName ||
								'Media #' + mediaId;
							let displayName = fileName;
							if ( ! displayName && result && result.source_url ) {
								displayName = String( result.source_url ).split( '/' ).pop();
							}
							if ( ! displayName ) {
								displayName = name;
							}
							rekeyUpload( pendingKey, mediaId );
							state.pendingCreates = state.pendingCreates.filter( ( k ) => k !== pendingKey );
							addEventToUpload( mediaId, {
								phase: 'ok',
								kind: 'create',
								path: pathHint,
								mediaId,
								name: displayName,
								note: 'create · ' + ms + 'ms',
								url: String( url ).replace( /^https?:\/\/[^/]+/, '' ),
								ms,
							} );
						} else if ( classified ) {
							const idFromUrl = mediaIdFromUrl( url );
							if ( idFromUrl ) {
								addEventToUpload( idFromUrl, {
									phase: 'ok',
									kind: classified.kind,
									path: pathHint === 'unknown' ? 'client' : pathHint,
									mediaId: idFromUrl,
									size: imageSize,
									note:
										classified.kind +
										' · ' +
										ms +
										'ms' +
										( imageSize ? ' · ' + imageSize : '' ),
									url: String( url ).replace( /^https?:\/\/[^/]+/, '' ),
									ms,
								} );
							}
						}
						return result;
					},
					( err ) => {
						if ( classified ) {
							const idFromUrl = mediaIdFromUrl( url );
							if ( pendingKey && ! idFromUrl ) {
								dropUpload( pendingKey );
								render();
							} else {
								const key = pendingKey || idFromUrl;
								if ( key ) {
									addEventToUpload( key, {
										phase: 'err',
										kind: classified.kind,
										path: pathHint,
										mediaId: idFromUrl,
										name: fileName,
										note: ( err && err.message ) || 'request failed',
										url: String( url ).replace( /^https?:\/\/[^/]+/, '' ),
									} );
								}
								if ( pendingKey ) {
									state.pendingCreates = state.pendingCreates.filter( ( k ) => k !== pendingKey );
								}
							}
						}
						throw err;
					}
				);
			} );
		}

		const origFetch = window.fetch.bind( window );
		window.fetch = function tappedFetch( input, init ) {
			const url = typeof input === 'string' ? input : ( input && input.url ) || '';
			const method = ( init && init.method ) || ( input && input.method ) || 'GET';
			const classified = classifyUrl( url, method );
			if ( classified && classified.kind === 'asset' ) {
				// Global asset — attach to most recent upload if any.
				const key = state.uploadOrder[ 0 ] || 'assets';
				addEventToUpload( key, {
					phase: 'asset',
					kind: 'asset',
					path: 'client',
					name: state.uploads[ key ]?.name,
					note: 'loading processor asset',
					url: String( url ).replace( /^https?:\/\/[^/]+/, '' ).slice( 0, 120 ),
				} );
			}
			return origFetch( input, init );
		};
	}

	function subscribeUploadStore() {
		if ( ! window.wp || ! wp.data || ! wp.uploadMedia ) {
			return;
		}
		const store = wp.uploadMedia.store;
		if ( ! store ) {
			return;
		}

		let prevIds = '';
		wp.data.subscribe( () => {
			try {
				const select = wp.data.select( store );
				if ( ! select || typeof select.getItems !== 'function' ) {
					return;
				}
				const items = select.getItems() || [];
				const snap = items.map( ( item ) => {
					const op = Array.isArray( item.operations?.[ 0 ] )
						? item.operations[ 0 ][ 0 ]
						: item.operations?.[ 0 ];
					const attachmentId = item.attachment?.id ? String( item.attachment.id ) : null;
					const name = item.file?.name || item.attachment?.filename || '#' + item.id;
					if ( attachmentId && state.uploads[ attachmentId ] ) {
						state.uploads[ attachmentId ].name = name;
						state.uploads[ attachmentId ].queueOp = item.currentOperation || op || '';
						state.uploads[ attachmentId ].queueStatus = item.status || '';
					}
					return {
						id: item.id,
						attachmentId,
						name,
						status: item.status,
						currentOperation: item.currentOperation || op || '—',
						error: item.error ? ( item.error.message || String( item.error ) ) : '',
					};
				} );
				const sig = JSON.stringify( snap );
				if ( sig !== prevIds ) {
					prevIds = sig;
					state.queueSnapshot = snap;
					if ( snap.length ) {
						queueLog( { type: 'queue', items: snap } );
					}
					render();
				}
			} catch ( e ) {
				// ignore
			}
		} );
	}

	function el( tag, attrs, children ) {
		const node = document.createElement( tag );
		if ( attrs ) {
			Object.keys( attrs ).forEach( ( k ) => {
				if ( k === 'className' ) {
					node.className = attrs[ k ];
				} else if ( k === 'text' ) {
					node.textContent = attrs[ k ];
				} else if ( k.startsWith( 'on' ) && typeof attrs[ k ] === 'function' ) {
					node.addEventListener( k.slice( 2 ).toLowerCase(), attrs[ k ] );
				} else if ( attrs[ k ] !== undefined && attrs[ k ] !== null ) {
					node.setAttribute( k, attrs[ k ] );
				}
			} );
		}
		( children || [] ).forEach( ( c ) => {
			if ( c == null || c === false ) {
				return;
			}
			node.appendChild( typeof c === 'string' ? document.createTextNode( c ) : c );
		} );
		return node;
	}

	function pill( text, tone, tip ) {
		const attrs = { className: 'csm-pill csm-pill--' + tone, text };
		if ( tip ) {
			attrs.title = tip;
		}
		return el( 'span', attrs );
	}

	function yn( val ) {
		if ( val === null || val === undefined ) {
			return 'n/a';
		}
		return val ? 'yes' : 'no';
	}

	function buildReport() {
		const d = state.detection || detect();
		const stats = computeStats();
		const lines = [];
		lines.push( 'WP Media Utility' );
		lines.push( 'Time: ' + new Date().toISOString() );
		lines.push( 'URL: ' + location.href );
		lines.push( '' );
		lines.push( 'Mode: ' + clientSideStatus( d ).label );
		lines.push( 'Client-side active: ' + yn( d.ready ) );
		lines.push( 'PHP enabled: ' + yn( d.phpEnabled ) );
		lines.push( '__clientSideMediaProcessing: ' + yn( d.flag ) );
		lines.push( '__documentIsolationPolicy: ' + yn( d.dipFlag ) );
		lines.push( 'crossOriginIsolated: ' + yn( d.crossOriginIsolated ) );
		lines.push( 'SharedArrayBuffer: ' + yn( d.sharedArrayBuffer ) );
		lines.push( 'detectClientSideMediaSupport: ' + yn( d.support ) );
		if ( d.reason ) {
			lines.push( 'Reason: ' + d.reason );
		}
		lines.push( '' );
		lines.push(
			'Stats: total=' +
				stats.total +
				' clientDone=' +
				stats.clientDone +
				' clientActive=' +
				stats.clientActive +
				' server=' +
				stats.server +
				' error=' +
				stats.error
		);
		lines.push( '' );
		lines.push( 'Uploads (' + state.uploadOrder.length + ')' );
		state.uploadOrder.forEach( ( key ) => {
			const u = state.uploads[ key ];
			if ( ! u ) {
				return;
			}
			const st = deriveStatus( u );
			lines.push(
				'- #' +
					( u.mediaId || '?' ) +
					' ' +
					u.name +
					' [' +
					st.label +
					'] path=' +
					u.path +
					( u.sizes.length ? ' sizes=' + u.sizes.join( ',' ) : '' )
			);
			u.events.forEach( ( evt ) => {
				lines.push(
					'    [' +
						evt.t +
						'] ' +
						pathLabel( evt.path ) +
						' · ' +
						( evt.note || evt.kind )
				);
			} );
		} );
		return lines.join( '\n' );
	}

	async function copyReport( button ) {
		const text = buildReport();
		const label = button.textContent;
		try {
			if ( navigator.clipboard && navigator.clipboard.writeText ) {
				await navigator.clipboard.writeText( text );
			} else {
				const ta = document.createElement( 'textarea' );
				ta.value = text;
				ta.setAttribute( 'readonly', '' );
				ta.style.position = 'fixed';
				ta.style.left = '-9999px';
				document.body.appendChild( ta );
				ta.select();
				document.execCommand( 'copy' );
				document.body.removeChild( ta );
			}
			button.textContent = 'Copied';
		} catch ( e ) {
			button.textContent = 'Failed';
		}
		setTimeout( () => {
			if ( button.isConnected ) {
				button.textContent = label;
			}
		}, 1200 );
	}

	async function clearDiskLog( button ) {
		const ok = window.confirm( 'Clear the on-disk CSM monitor log files?' );
		if ( ! ok ) {
			return;
		}
		const label = button.textContent;
		button.disabled = true;
		try {
			await wp.apiFetch( { path: '/wp-media-utility/v1/log', method: 'DELETE' } );
			button.textContent = 'Cleared';
			queueLog( { type: 'meta', note: 'disk log cleared' } );
		} catch ( e ) {
			button.textContent = 'Failed';
		}
		setTimeout( () => {
			if ( button.isConnected ) {
				button.disabled = false;
				button.textContent = label;
			}
		}, 1200 );
	}

	async function wipeMediaLibrary( button ) {
		if ( boot.canDelete === false ) {
			window.alert( 'Current user cannot delete media.' );
			return;
		}
		const ok = window.confirm(
			'Delete ALL media library items?\n\nThis removes attachments so you can re-upload the same test files.'
		);
		if ( ! ok ) {
			return;
		}
		button.disabled = true;
		button.textContent = 'Wiping…';
		const deleted = [];
		const failed = [];
		try {
			let page = 1;
			const ids = [];
			for ( ;; ) {
				const batch = await wp.apiFetch( {
					path: '/wp/v2/media?per_page=100&page=' + page + '&context=edit',
				} );
				if ( ! Array.isArray( batch ) || ! batch.length ) {
					break;
				}
				batch.forEach( ( item ) => item?.id && ids.push( item.id ) );
				if ( batch.length < 100 || page > 50 ) {
					break;
				}
				page += 1;
			}
			for ( let i = 0; i < ids.length; i++ ) {
				try {
					await wp.apiFetch( {
						path: '/wp/v2/media/' + ids[ i ] + '?force=true',
						method: 'DELETE',
					} );
					deleted.push( ids[ i ] );
				} catch ( e ) {
					failed.push( ids[ i ] );
				}
				button.textContent = deleted.length + '/' + ids.length;
			}
			state.uploads = {};
			state.uploadOrder = [];
			state.queueSnapshot = [];
			queueLog( {
				type: 'meta',
				note: 'Wiped media · deleted ' + deleted.length + ( failed.length ? ' · failed ' + failed.length : '' ),
			} );
		} catch ( e ) {
			window.alert( 'Wipe failed: ' + ( ( e && e.message ) || e ) );
		}
		render();
	}

	function renderUploadGroup( key ) {
		const u = state.uploads[ key ];
		if ( ! u ) {
			return null;
		}
		const st = deriveStatus( u );
		const open = state.openKeys[ key ] !== false;

		const tags = el( 'div', { className: 'csm-upload__tags' }, [
			pill( st.label, st.tone, statusTip( st.label ) ),
			pill( pathLabel( u.path ), u.path === 'client' ? 'ok' : u.path === 'server' ? 'warn' : 'muted', pathTip( u.path ) ),
			u.sizes.length ? pill( u.sizes.length + ' sizes', 'muted', 'Client-generated sub-sizes / scaled variants seen so far' ) : null,
		] );

		const titleBits = [];
		if ( u.mediaId ) {
			titleBits.push( el( 'span', { className: 'csm-upload__id', text: '#' + u.mediaId, title: 'Attachment ID ' + u.mediaId } ) );
		}
		titleBits.push( el( 'span', { className: 'csm-upload__name', text: u.name || 'Uploading…', title: u.name || '' } ) );

		const summary = el(
			'button',
			{
				className: 'csm-upload__summary',
				type: 'button',
				title: open ? 'Collapse event details' : 'Expand event details',
				onClick: () => {
					state.openKeys[ key ] = ! open;
					render();
				},
			},
			[
				el( 'span', { className: 'csm-upload__chevron', text: open ? '▾' : '▸' } ),
				el( 'span', { className: 'csm-upload__title' }, titleBits ),
				tags,
			]
		);

		const bodyChildren = [];
		if ( open ) {
			if ( u.sizes.length ) {
				bodyChildren.push(
					el( 'div', { className: 'csm-upload__sizes' }, [
						el( 'span', { className: 'csm-upload__sizes-label', text: 'Sizes' } ),
						...u.sizes.map( ( s ) => pill( s, 'ok' ) ),
					] )
				);
			}
			if ( u.queueOp || u.queueStatus ) {
				bodyChildren.push(
					el( 'div', {
						className: 'csm-upload__queue',
						text: 'Queue: ' + ( u.queueStatus || '' ) + ( u.queueOp ? ' · ' + u.queueOp : '' ),
					} )
				);
			}
			if ( u.error ) {
				bodyChildren.push( el( 'div', { className: 'csm-upload__err', text: u.error } ) );
			}
			const feed = el( 'div', { className: 'csm-upload__events' } );
			u.events.forEach( ( evt ) => {
				feed.appendChild(
					el( 'div', { className: 'csm-event' }, [
						el( 'div', { className: 'csm-event__top' }, [
							pill( pathLabel( evt.path ), evt.path === 'client' ? 'ok' : evt.path === 'server' ? 'warn' : 'muted' ),
							pill( evt.kind, 'muted' ),
							el( 'span', { className: 'csm-event__time', text: evt.t } ),
						] ),
						el( 'div', { className: 'csm-event__note', text: evt.note || evt.kind } ),
					] )
				);
			} );
			bodyChildren.push( feed );
		}

		return el( 'div', { className: 'csm-upload' + ( open ? ' is-open' : '' ) }, [
			summary,
			open ? el( 'div', { className: 'csm-upload__body' }, bodyChildren ) : null,
		] );
	}

	function kvRow( key, value, tone ) {
		const isObj = value !== null && typeof value === 'object';
		const display = formatVal( value );
		let valueTone = tone;
		if ( ! valueTone ) {
			if ( typeof value === 'boolean' ) {
				valueTone = toneForBool( value );
			} else {
				valueTone = 'muted';
			}
		}
		return el( 'div', { className: 'csm-kv' }, [
			el( 'div', { className: 'csm-kv__key', text: key } ),
			isObj
				? el( 'pre', { className: 'csm-kv__pre', text: display } )
				: el( 'div', { className: 'csm-kv__val csm-kv__val--' + valueTone, text: display } ),
		] );
	}

	function valuesSection( id, title, rows ) {
		const open = state.valuesOpen[ id ] !== false;
		const head = el(
			'button',
			{
				className: 'csm-values__section-head',
				type: 'button',
				title: open ? 'Collapse this section' : 'Expand this section',
				onClick: () => {
					state.valuesOpen[ id ] = ! open;
					render();
				},
			},
			[
				el( 'span', { text: open ? '▾ ' : '▸ ' } ),
				el( 'span', { text: title } ),
			]
		);
		const body = open
			? el(
					'div',
					{ className: 'csm-values__section-body' },
					( rows || [] ).map( ( r ) => kvRow( r[ 0 ], r[ 1 ], r[ 2 ] ) )
			  )
			: null;
		return el( 'div', { className: 'csm-values__section' }, [ head, body ] );
	}

	function renderValuesTab( root ) {
		const toolbar = el( 'div', { className: 'csm-values__toolbar' }, [
			el( 'button', {
				className: 'csm-monitor__toggle',
				type: 'button',
				text: state.diagnosticsLoading ? 'Refreshing…' : 'Refresh',
				title: 'Re-read PHP filters, window flags, REST image settings, and clear detectClientSideMediaSupport cache',
				disabled: state.diagnosticsLoading || undefined,
				onClick: () => loadDiagnostics( true ),
			} ),
			el( 'span', {
				className: 'csm-values__meta',
				text: state.diagnostics && state.diagnostics.fetchedAt
					? 'Updated ' + new Date( state.diagnostics.fetchedAt ).toLocaleTimeString()
					: 'Loading live flags / filters…',
			} ),
		] );
		root.appendChild( toolbar );

		if ( state.diagnosticsError ) {
			root.appendChild(
				el( 'div', {
					className: 'csm-monitor__reason',
					text: 'Server diagnostics: ' + state.diagnosticsError,
				} )
			);
		}

		if ( ! state.diagnostics ) {
			root.appendChild(
				el( 'div', {
					className: 'csm-monitor__empty',
					text: state.diagnosticsLoading
						? 'Collecting PHP + browser values…'
						: 'No diagnostics yet — click Refresh.',
				} )
			);
			return;
		}

		const c = state.diagnostics.client || {};
		const s = state.diagnostics.server || {};
		const php = s.php || {};
		const rest = s.restIndexMedia || {};
		const filters = s.relatedFilters || {};

		root.appendChild(
			valuesSection( 'status', 'Status', [
				[ 'label', c.status && c.status.label ],
				[ 'active', c.status && c.status.active ],
				[ 'detail', c.status && c.status.detail ],
			] )
		);

		root.appendChild(
			valuesSection( 'window', 'Window flags (JS globals from core)', [
				[ '__clientSideMediaProcessing', c.windowFlags && c.windowFlags.__clientSideMediaProcessing ],
				[ '__documentIsolationPolicy', c.windowFlags && c.windowFlags.__documentIsolationPolicy ],
				[ 'typeof __clientSideMediaProcessing', c.windowFlags && c.windowFlags[ 'typeof __clientSideMediaProcessing' ] ],
				[ 'typeof __documentIsolationPolicy', c.windowFlags && c.windowFlags[ 'typeof __documentIsolationPolicy' ] ],
			] )
		);

		root.appendChild(
			valuesSection( 'isolation', 'Isolation / SharedArrayBuffer', [
				[ 'crossOriginIsolated', c.isolation && c.isolation.crossOriginIsolated ],
				[ 'SharedArrayBuffer available', c.isolation && c.isolation.SharedArrayBufferAvailable ],
				[ 'typeof SharedArrayBuffer', c.isolation && c.isolation[ 'typeof SharedArrayBuffer' ] ],
			] )
		);

		root.appendChild(
			valuesSection( 'detect', 'detectClientSideMediaSupport()', [
				[ 'supported', c.detection && c.detection.supported ],
				[ 'reason', ( c.detection && c.detection.reason ) || '(none)' ],
				[ 'phpEnabled (boot)', c.detection && c.detection.phpEnabled ],
				[ 'ready (all gates)', c.detection && c.detection.ready ],
			] )
		);

		root.appendChild(
			valuesSection( 'probes', 'Browser probes', Object.entries( c.browserProbes || {} ) )
		);

		root.appendChild(
			valuesSection( 'nav', 'Navigator / network', Object.entries( c.navigator || {} ) )
		);

		root.appendChild(
			valuesSection( 'boot', 'Boot from PHP (enqueue)', Object.entries( c.bootFromPhp || {} ) )
		);

		root.appendChild(
			valuesSection( 'php', 'PHP (live via /wp-media-utility/v1/diagnostics)', Object.entries( php ) )
		);

		root.appendChild(
			valuesSection( 'filters', 'Related filter results (live)', Object.entries( filters ) )
		);

		const restRows = Object.entries( rest ).filter( ( [ k ] ) => k !== 'image_sizes' );
		restRows.push( [ 'image_sizes (count)', rest.image_sizes ? Object.keys( rest.image_sizes ).length : 0 ] );
		restRows.push( [ 'image_sizes', rest.image_sizes || {} ] );
		root.appendChild(
			valuesSection( 'rest', 'REST index media settings (same as client reads)', restRows )
		);

		root.appendChild(
			valuesSection( 'store', 'core/upload-media store settings', Object.entries( c.uploadMediaStore || { '(unavailable)': true } ) )
		);

		root.appendChild(
			valuesSection( 'defaults', 'Core hardcoded defaults (reference)', Object.entries( c.coreDefaultsNoted || {} ) )
		);

		root.appendChild(
			el( 'div', {
				className: 'csm-monitor__hint',
				text: 'Refresh clears detectClientSideMediaSupport cache, then re-reads window flags, PHP filters, and REST image settings — useful after hacking core.',
			} )
		);
	}

	function renderTabs( root ) {
		const bar = el( 'div', { className: 'csm-monitor__tabs' } );
		const tabTips = {
			uploads: 'Live upload pipeline: create → sideload → finalize',
			values: 'Live flags, filters, REST image settings, and browser probes',
		};
		[
			[ 'uploads', 'Uploads' ],
			[ 'values', 'Values' ],
		].forEach( ( [ id, label ] ) => {
			bar.appendChild(
				el( 'button', {
					className: 'csm-tab' + ( state.tab === id ? ' is-active' : '' ),
					type: 'button',
					text: label,
					title: tabTips[ id ] || label,
					onClick: () => {
						state.tab = id;
						if ( id === 'values' && ! state.diagnostics && ! state.diagnosticsLoading ) {
							loadDiagnostics( false );
						} else {
							render();
						}
					},
				} )
			);
		} );
		root.appendChild( bar );
	}

	function render() {
		injectStyles();
		const root = document.getElementById( 'wp-media-utility' );
		if ( ! root ) {
			return;
		}
		const d = detect();
		const status = clientSideStatus( d );
		const scroll = root.scrollTop;

		root.innerHTML = '';
		root.className =
			'csm-monitor' +
			( state.collapsed ? ' is-collapsed' : '' ) +
			( status.active ? ' is-csm-active' : ' is-csm-off' );

		const headerActions = el( 'div', { className: 'csm-monitor__actions' }, [
			el( 'button', {
				className: 'csm-monitor__toggle',
				type: 'button',
				text: 'Export',
				title: 'Download session JSON (gates, stats, uploads). Hold Shift for CSV summary.',
				onClick: ( e ) => exportSession( e.shiftKey ? 'csv' : 'json' ),
			} ),
			el( 'button', {
				className: 'csm-monitor__toggle',
				type: 'button',
				text: 'Copy',
				title: 'Copy a plain-text report to the clipboard',
				onClick: ( e ) => copyReport( e.currentTarget ),
			} ),
			el( 'button', {
				className: 'csm-monitor__toggle',
				type: 'button',
				text: 'Clear',
				title: 'Clear on-screen results only (keeps media library and disk logs)',
				onClick: () => clearSession(),
			} ),
			el( 'button', {
				className: 'csm-monitor__toggle',
				type: 'button',
				text: 'Clear log',
				title: 'Delete on-disk JSONL log files (uploads/wp-media-utility.jsonl and mirror)',
				onClick: ( e ) => clearDiskLog( e.currentTarget ),
			} ),
			el( 'button', {
				className: 'csm-monitor__toggle csm-monitor__toggle--danger',
				type: 'button',
				text: 'Wipe',
				title: 'Delete ALL media library items on this site (for throwaway test sites)',
				onClick: ( e ) => wipeMediaLibrary( e.currentTarget ),
			} ),
		] );

		root.appendChild(
			el( 'div', { className: 'csm-monitor__header' }, [
				el( 'div', { className: 'csm-monitor__title-row' }, [
					el( 'div', {
						className: 'csm-monitor__title',
						text: 'WP Media Utility',
						title: 'WP Media Utility — WordPress 7.1 client-side media testing utility',
					} ),
					boot.version
						? el( 'span', {
								className: 'csm-monitor__ver',
								text: 'v' + boot.version,
								title: 'Plugin version ' + boot.version,
						  } )
						: null,
					el( 'div', {
						className: 'csm-monitor__status csm-monitor__status--' + status.tone,
						text: status.short,
						title: status.label + ' — ' + status.detail,
					} ),
					el( 'button', {
						className: 'csm-monitor__toggle csm-monitor__toggle--hide',
						type: 'button',
						text: state.collapsed ? 'Show' : 'Hide',
						title: state.collapsed ? 'Expand the monitor panel' : 'Collapse to a compact status bar',
						onClick: () => {
							state.collapsed = ! state.collapsed;
							render();
						},
					} ),
				] ),
				state.collapsed ? null : headerActions,
			] )
		);

		if ( state.collapsed ) {
			const s = computeStats();
			root.appendChild(
				el( 'div', { className: 'csm-monitor__mini' }, [
					pill( status.label, status.tone, status.label + ' — ' + status.detail ),
					s.total ? pill( s.total + ' imgs', 'muted', 'Uploads in this session' ) : null,
					s.clientDone ? pill( s.clientDone + ' done', 'ok', 'CLIENT DONE count' ) : null,
					s.server ? pill( s.server + ' srv', 'warn', 'Server fallback count' ) : null,
					s.error ? pill( s.error + ' err', 'bad', 'Error count' ) : null,
				] )
			);
			return;
		}

		if ( ! status.active ) {
			root.appendChild(
				el( 'div', { className: 'csm-monitor__mode' }, [
					pill( status.label, status.tone ),
					el( 'span', { className: 'csm-monitor__mode-detail', text: status.detail } ),
				] )
			);
		}

		renderTabs( root );

		if ( state.tab === 'values' ) {
			root.classList.add( 'is-values-tab' );
			renderValuesTab( root );
			root.scrollTop = scroll;
			return;
		}

		const gateItems = [
			[ 'PHP', d.phpEnabled ],
			[ 'flag', d.flag ],
			[ 'DIP', d.dipFlag ],
			[ 'COI', d.crossOriginIsolated ],
			[ 'SAB', d.sharedArrayBuffer ],
			[ 'detect', d.support ],
		];
		const gatesWrap = el( 'div', { className: 'csm-monitor__gates-wrap' } );
		gatesWrap.appendChild(
			el( 'button', {
				className: 'csm-gates-toggle',
				type: 'button',
				text: state.gatesOpen ? '▾ Gates' : '▸ Gates',
				title: state.gatesOpen
					? 'Hide full gate names'
					: 'Show full gate names (PHP / flag / DIP / COI / SAB / detect)',
				onClick: () => {
					state.gatesOpen = ! state.gatesOpen;
					render();
				},
			} )
		);
		const gatePills = el( 'div', { className: 'csm-monitor__gates-pills' } );
		gateItems.forEach( ( [ label, val ] ) => {
			gatePills.appendChild(
				pill(
					label + ':' + ( val === null ? '?' : val ? 'yes' : 'no' ),
					val ? 'ok' : val === null ? 'muted' : 'bad',
					gateTip( label ) + ' → ' + ( val === null ? 'n/a' : val ? 'yes' : 'no' )
				)
			);
		} );
		gatesWrap.appendChild( gatePills );
		if ( state.gatesOpen ) {
			const gates = el( 'div', { className: 'csm-monitor__gates' } );
			[
				[ 'PHP enabled', d.phpEnabled, 'PHP' ],
				[ '__clientSideMediaProcessing', d.flag, 'flag' ],
				[ '__documentIsolationPolicy', d.dipFlag, 'DIP' ],
				[ 'crossOriginIsolated', d.crossOriginIsolated, 'COI' ],
				[ 'SharedArrayBuffer', d.sharedArrayBuffer, 'SAB' ],
				[ 'detectClientSideMediaSupport', d.support, 'detect' ],
			].forEach( ( [ label, val, tipKey ] ) => {
				gates.appendChild(
					el( 'div', { className: 'csm-gate', title: gateTip( tipKey ) }, [
						el( 'span', { className: 'csm-gate__label', text: label } ),
						pill(
							val === null ? 'n/a' : val ? 'yes' : 'no',
							val ? 'ok' : val === null ? 'muted' : 'bad',
							gateTip( tipKey )
						),
					] )
				);
			} );
			gatesWrap.appendChild( gates );
		}
		root.appendChild( gatesWrap );

		if ( d.reason ) {
			root.appendChild(
				el( 'div', {
					className: 'csm-monitor__reason',
					text: d.reason,
					title: 'Reason from detectClientSideMediaSupport()',
				} )
			);
		}

		const stats = computeStats();
		if ( stats.total ) {
			root.appendChild(
				el( 'div', { className: 'csm-monitor__stats' }, [
					pill( stats.total + ' total', 'muted', 'Uploads tracked in this session' ),
					pill( stats.clientDone + ' done', 'ok', 'Finished client path (finalize completed)' ),
					stats.clientActive
						? pill( stats.clientActive + ' active', 'ok', 'Client path still in progress' )
						: null,
					stats.server
						? pill( stats.server + ' server', 'warn', 'Fell back to server-side sub-size generation' )
						: null,
					stats.error ? pill( stats.error + ' error', 'bad', 'Uploads that reported an error' ) : null,
					stats.other ? pill( stats.other + ' other', 'muted', 'Pending / unclassified uploads' ) : null,
				] )
			);
		}

		const filterBar = el( 'div', { className: 'csm-monitor__filters' } );
		const filterTips = {
			all: 'Show every tracked upload',
			done: 'Only CLIENT DONE (finalize completed)',
			client: 'Client path uploads (in progress or done)',
			server: 'Server-fallback uploads',
			error: 'Uploads with errors',
		};
		[
			[ 'all', 'All' ],
			[ 'done', 'Done' ],
			[ 'client', 'Client' ],
			[ 'server', 'Server' ],
			[ 'error', 'Error' ],
		].forEach( ( [ key, label ] ) => {
			filterBar.appendChild(
				el( 'button', {
					className: 'csm-filter' + ( state.filter === key ? ' is-active' : '' ),
					type: 'button',
					text: label,
					title: filterTips[ key ] || label,
					onClick: () => {
						state.filter = key;
						render();
					},
				} )
			);
		} );
		root.appendChild( filterBar );

		root.appendChild(
			el( 'div', { className: 'csm-monitor__list-tools' }, [
				el( 'span', {
					className: 'csm-monitor__section-inline',
					text:
						'Uploads (' +
						getUploadList().filter( matchesFilter ).length +
						( state.filter !== 'all' ? ' / ' + stats.total : '' ) +
						')',
					title: 'Visible uploads' + ( state.filter !== 'all' ? ' matching current filter' : '' ),
				} ),
				el( 'button', {
					className: 'csm-filter csm-filter--tool',
					type: 'button',
					text: 'Expand',
					title: 'Expand all upload rows to show event detail',
					onClick: () => setAllOpen( true ),
				} ),
				el( 'button', {
					className: 'csm-filter csm-filter--tool',
					type: 'button',
					text: 'Collapse',
					title: 'Collapse all upload rows',
					onClick: () => setAllOpen( false ),
				} ),
			] )
		);

		const visible = getUploadList().filter( matchesFilter );

		if ( ! state.uploadOrder.length ) {
			root.appendChild(
				el( 'div', {
					className: 'csm-monitor__empty',
					text: 'Idle — upload or drop files in the block editor.',
				} )
			);
		} else if ( ! visible.length ) {
			root.appendChild(
				el( 'div', {
					className: 'csm-monitor__empty',
					text: 'No uploads match this filter.',
				} )
			);
		} else {
			const list = el( 'div', { className: 'csm-monitor__uploads' } );
			visible.forEach( ( u ) => {
				const node = renderUploadGroup( u.key );
				if ( node ) {
					list.appendChild( node );
				}
			} );
			root.appendChild( list );
		}

		root.appendChild(
			el( 'div', {
				className: 'csm-monitor__hint',
				text: 'CLIENT DONE = create(false) → sideload(s) → finalize · Shift+Export = CSV',
			} )
		);

		root.scrollTop = scroll;
	}

	function injectStyles() {
		let css = document.getElementById( 'wp-wp-media-utility-style' );
		if ( ! css ) {
			css = document.createElement( 'style' );
			css.id = 'wp-wp-media-utility-style';
			document.head.appendChild( css );
		}
		css.textContent = `
			.csm-monitor {
				position: fixed; right: 16px; bottom: 16px; z-index: 100000;
				width: 420px; max-height: min(78vh, 760px); overflow: auto;
				background: #141414; color: #f2f2f2; border: 1px solid #333;
				font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
				box-shadow: 0 8px 28px rgba(0,0,0,0.45);
			}
			.csm-monitor.is-values-tab { width: 480px; }
			.csm-monitor.is-collapsed { width: 260px; max-height: none; box-shadow: none; }
			.csm-monitor__header {
				display: flex; flex-direction: column; gap: 8px;
				padding: 10px 12px; border-bottom: 1px solid #2a2a2a;
				position: sticky; top: 0; background: #141414; z-index: 2;
			}
			.csm-monitor__title-row {
				display: flex; align-items: center; gap: 8px; min-width: 0;
			}
			.csm-monitor__title-row .csm-monitor__status { margin-left: auto; }
			.csm-monitor__title {
				font-weight: 700; letter-spacing: 0.02em; min-width: 0;
				white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
			}
			.csm-monitor__ver { color: #777; font-size: 10px; flex-shrink: 0; }
			.csm-monitor__status {
				font-size: 10px; font-weight: 700; letter-spacing: 0.06em;
				padding: 2px 7px; border: 1px solid #555; flex-shrink: 0;
			}
			.csm-monitor__status--ok { color: #b6f2c4; border-color: #2f6b3c; background: #16301c; }
			.csm-monitor__status--bad { color: #ffb4b4; border-color: #7a2a2a; background: #2a1212; }
			.csm-monitor__status--warn { color: #ffe2a8; border-color: #7a5a18; background: #2a210c; }
			.csm-monitor.is-csm-active { border-color: #2f6b3c; }
			.csm-monitor.is-csm-off { border-color: #7a2a2a; }
			.csm-monitor__mode {
				display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
				padding: 8px 12px; border-bottom: 1px solid #2a2a2a;
			}
			.csm-monitor__mode-detail { color: #9a9a9a; font-size: 11px; }
			.csm-monitor__actions {
				display: flex; gap: 5px; align-items: center; flex-wrap: wrap;
				justify-content: flex-start;
			}
			.csm-monitor__toggle {
				background: #1f1f1f; border: 1px solid #444; color: #ddd;
				padding: 4px 8px; cursor: pointer; font: inherit; font-size: 11px;
			}
			.csm-monitor__toggle:hover { border-color: #666; color: #fff; }
			.csm-monitor__toggle:disabled { opacity: 0.6; cursor: default; }
			.csm-monitor__toggle--danger { color: #ffb4b4; border-color: #7a2a2a; margin-left: auto; }
			.csm-monitor__toggle--hide { flex-shrink: 0; }
			.csm-monitor__mini, .csm-monitor__gates,
			.csm-monitor__uploads, .csm-monitor__hint, .csm-monitor__reason,
			.csm-monitor__empty, .csm-monitor__section,
			.csm-monitor__stats, .csm-monitor__filters,
			.csm-monitor__gates-wrap, .csm-monitor__list-tools { padding: 8px 12px; }
			.csm-monitor__gates-wrap {
				display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
				border-bottom: 1px solid #2a2a2a;
			}
			.csm-gates-toggle {
				background: transparent; border: 0; color: #9a9a9a; cursor: pointer;
				font: inherit; font-size: 10px; letter-spacing: 0.05em; text-transform: uppercase;
				padding: 0; margin-right: 2px;
			}
			.csm-monitor__gates-pills { display: flex; flex-wrap: wrap; gap: 4px; flex: 1; }
			.csm-monitor__gates { width: 100%; padding: 4px 0 0; }
			.csm-monitor__stats {
				display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
				border-bottom: 1px solid #2a2a2a;
			}
			.csm-monitor__filters {
				display: flex; flex-wrap: wrap; gap: 4px; align-items: center;
				padding-top: 8px; padding-bottom: 4px;
			}
			.csm-monitor__list-tools {
				display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
				padding-top: 2px; padding-bottom: 6px;
			}
			.csm-monitor__section-inline {
				color: #9a9a9a; text-transform: uppercase; font-size: 10px;
				letter-spacing: 0.06em; margin-right: auto;
			}
			.csm-filter {
				background: #1a1a1a; border: 1px solid #3a3a3a; color: #bbb;
				padding: 3px 8px; cursor: pointer; font: inherit; font-size: 10px;
			}
			.csm-filter:hover { border-color: #555; color: #eee; }
			.csm-filter.is-active { color: #fff; border-color: #6a6a6a; background: #2a2a2a; }
			.csm-filter--tool { color: #888; }
			.csm-monitor__section {
				border-top: 1px solid #2a2a2a; color: #9a9a9a;
				text-transform: uppercase; font-size: 10px; letter-spacing: 0.06em; padding-bottom: 4px;
			}
			.csm-monitor__reason { color: #e6b84d; border-bottom: 1px solid #2a2a2a; }
			.csm-monitor__empty { color: #777; }
			.csm-monitor__hint { color: #777; border-top: 1px solid #2a2a2a; font-size: 11px; }
			.csm-gate { display: flex; justify-content: space-between; gap: 8px; padding: 3px 0; }
			.csm-gate__label { color: #bdbdbd; }
			.csm-pill {
				display: inline-block; padding: 1px 6px; border: 1px solid #555;
				font-size: 10px; letter-spacing: 0.04em; white-space: nowrap;
			}
			.csm-pill[title], .csm-monitor__status[title], .csm-gate[title] { cursor: help; }
			.csm-monitor__toggle[title], .csm-filter[title], .csm-tab[title],
			.csm-gates-toggle[title], .csm-upload__summary[title] { cursor: pointer; }
			.csm-pill--ok { color: #b6f2c4; border-color: #2f6b3c; background: #16301c; }
			.csm-pill--warn { color: #ffe2a8; border-color: #7a5a18; background: #2a210c; }
			.csm-pill--bad { color: #ffb4b4; border-color: #7a2a2a; background: #2a1212; }
			.csm-pill--muted { color: #aaa; border-color: #444; background: #1c1c1c; }
			.csm-upload { border-top: 1px solid #242424; }
			.csm-upload__summary {
				width: 100%; display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
				background: transparent; border: 0; color: inherit; text-align: left;
				padding: 8px 12px; cursor: pointer;
			}
			.csm-upload__summary:hover { background: #1a1a1a; }
			.csm-upload__chevron { color: #888; width: 12px; flex-shrink: 0; }
			.csm-upload__title {
				flex: 1 1 140px; min-width: 0; display: flex; align-items: center; gap: 6px;
			}
			.csm-upload__id { color: #8ab4ff; flex-shrink: 0; font-weight: 600; }
			.csm-upload__name {
				min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
				font-weight: 600; color: #eee;
			}
			.csm-upload__tags { display: flex; flex-wrap: wrap; gap: 4px; }
			.csm-upload__body { padding: 0 12px 8px 28px; }
			.csm-upload__sizes { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; margin-bottom: 6px; }
			.csm-upload__sizes-label { color: #888; margin-right: 4px; }
			.csm-upload__queue { color: #888; margin-bottom: 6px; font-size: 11px; }
			.csm-upload__err { color: #ffb4b4; margin-bottom: 6px; }
			.csm-event { padding: 5px 0; border-top: 1px solid #242424; }
			.csm-event__top { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 2px; }
			.csm-event__note { color: #ccc; }
			.csm-event__time { color: #777; font-size: 11px; margin-left: auto; }
			.csm-monitor__mini { display: flex; gap: 6px; flex-wrap: wrap; }
			.csm-monitor__tabs {
				display: flex; gap: 0; border-bottom: 1px solid #2a2a2a;
			}
			.csm-tab {
				flex: 1; background: #121212; border: 0; border-right: 1px solid #2a2a2a;
				color: #888; padding: 8px; cursor: pointer; font: inherit; font-size: 11px;
				letter-spacing: 0.04em; text-transform: uppercase;
			}
			.csm-tab:last-child { border-right: 0; }
			.csm-tab:hover { color: #ccc; }
			.csm-tab.is-active { color: #fff; background: #1c1c1c; }
			.csm-values__toolbar {
				display: flex; align-items: center; gap: 8px; padding: 8px 12px;
				border-bottom: 1px solid #2a2a2a;
			}
			.csm-values__meta { color: #777; font-size: 11px; }
			.csm-values__section { border-bottom: 1px solid #242424; }
			.csm-values__section-head {
				width: 100%; text-align: left; background: transparent; border: 0;
				color: #cfcfcf; padding: 8px 12px; cursor: pointer; font: inherit;
				font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase;
			}
			.csm-values__section-head:hover { background: #1a1a1a; }
			.csm-values__section-body { padding: 0 12px 8px; }
			.csm-kv { padding: 4px 0; border-top: 1px solid #222; }
			.csm-kv__key { color: #8a8a8a; font-size: 10px; margin-bottom: 2px; word-break: break-all; }
			.csm-kv__val { color: #e8e8e8; word-break: break-word; white-space: pre-wrap; }
			.csm-kv__val--ok { color: #b6f2c4; }
			.csm-kv__val--bad { color: #ffb4b4; }
			.csm-kv__val--muted { color: #ccc; }
			.csm-kv__pre {
				margin: 0; padding: 6px; background: #0f0f0f; border: 1px solid #2a2a2a;
				color: #cfcfcf; white-space: pre-wrap; word-break: break-word;
				max-height: 160px; overflow: auto; font: inherit; font-size: 10px;
			}
		`;
	}

	function mount() {
		injectStyles();
		let root = document.getElementById( 'wp-media-utility' );
		if ( ! root ) {
			root = document.createElement( 'div' );
			root.id = 'wp-media-utility';
			document.body.appendChild( root );
		}
		detect();
		installFetchTap();
		subscribeUploadStore();
		if ( ! state.loggedSession ) {
			state.loggedSession = true;
			const d = state.detection || detect();
			queueLog( {
				type: 'session',
				mode: clientSideStatus( d ).label,
				clientSideActive: !! d.ready,
				gates: {
					phpEnabled: d.phpEnabled,
					flag: d.flag,
					dipFlag: d.dipFlag,
					crossOriginIsolated: d.crossOriginIsolated,
					sharedArrayBuffer: d.sharedArrayBuffer,
					support: d.support,
					reason: d.reason,
				},
				logPath: boot.logPath || '',
				mirrorPath: boot.mirrorPath || '',
			} );
		}
		render();
		setTimeout( () => {
			detect();
			render();
			flushLog();
		}, 1000 );
		setInterval( () => {
			const prev = state.detection && state.detection.ready;
			const d = detect();
			if ( prev !== d.ready && state.tab === 'uploads' ) {
				render();
			}
			flushLog();
		}, 5000 );
		window.addEventListener( 'beforeunload', flushLog );
	}

	if ( window.wp && wp.domReady ) {
		wp.domReady( mount );
	} else {
		document.addEventListener( 'DOMContentLoaded', mount );
	}
} )();
