<script lang="ts">
	import { apiUrl } from '$lib/api';
	import {
		type ImageFormat,
		type ImageVariantName,
		type ResolvedTransform,
		proxyQueryString,
		resolveVariant
	} from '$lib/shared/image-variants';

	interface Props {
		libraryId: string;
		fileId: string;
		alt?: string;
		/**
		 * Named variant from the shared registry. Preferred over raw
		 * width/height/quality/format: keeps every call site on the single source of
		 * truth and guarantees a pre-warm cache hit.
		 */
		variant?: ImageVariantName;
		/** Source dims, used to clamp capped variants (card, preview) to the original. */
		sourceWidth?: number | null;
		sourceHeight?: number | null;
		// Explicit overrides (win over the resolved variant value).
		width?: number;
		height?: number;
		format?: ImageFormat;
		quality?: number;
		class?: string;
		onerror?: (event: Event) => void;
		onload?: (event: Event) => void;
	}

	let {
		libraryId,
		fileId,
		alt = '',
		variant,
		sourceWidth,
		sourceHeight,
		width,
		height,
		format,
		quality,
		class: klass,
		onerror,
		onload
	}: Props = $props();

	const resolved = $derived.by<ResolvedTransform>(() => {
		const base: ResolvedTransform = variant
			? resolveVariant(variant, sourceWidth, sourceHeight)
			: { width: 0, height: 0, quality: 80, format: 'jpeg' };
		return {
			width: width ?? base.width,
			height: height ?? base.height,
			quality: quality ?? base.quality,
			format: format ?? base.format
		};
	});

	const proxySrc = $derived(
		apiUrl(`/api/files/proxy/${libraryId}/${fileId}?${proxyQueryString(resolved)}`)
	);

	// Show a neutral placeholder box until the bytes paint, so grids/cards don't
	// flash an empty frame while thumbnails fetch. Reset when the source changes
	// (the component is reused as the preview navigates between files).
	let loaded = $state(false);
	$effect(() => {
		void proxySrc;
		loaded = false;
	});

	function handleLoad(event: Event) {
		loaded = true;
		onload?.(event);
	}
	function handleError(event: Event) {
		loaded = true;
		onerror?.(event);
	}

	const imgClass = $derived([klass, loaded ? '' : 'bg-muted'].filter(Boolean).join(' '));
</script>

<img
	src={proxySrc}
	{alt}
	width={resolved.width || undefined}
	height={resolved.height || undefined}
	class={imgClass}
	loading="lazy"
	decoding="async"
	draggable="false"
	crossorigin="use-credentials"
	onerror={handleError}
	onload={handleLoad}
/>
