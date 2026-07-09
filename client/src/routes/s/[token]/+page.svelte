<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const meta = $derived(data.meta);
	const hasVideo = $derived(Boolean(meta.videoUrl));
</script>

<svelte:head>
	<title>{meta.title} · Alcoves</title>
	<meta name="description" content={meta.description} />

	<meta property="og:title" content={meta.title} />
	<meta property="og:description" content={meta.description} />
	<meta property="og:type" content="video.other" />
	<meta property="og:url" content={meta.shareUrl} />
	{#if meta.videoUrl}
		<meta property="og:video" content={meta.videoUrl} />
		<meta property="og:video:type" content="video/mp4" />
		<meta property="og:video:width" content="1920" />
		<meta property="og:video:height" content="1080" />
	{/if}
	{#if meta.thumbnailUrl}
		<meta property="og:image" content={meta.thumbnailUrl} />
	{/if}

	<meta name="twitter:card" content="player" />
	<meta name="twitter:title" content={meta.title} />
	<meta name="twitter:description" content={meta.description} />
	<meta name="twitter:player" content={meta.shareUrl} />
	{#if meta.videoUrl}
		<meta name="twitter:player:width" content="1920" />
		<meta name="twitter:player:height" content="1080" />
	{/if}
	{#if meta.thumbnailUrl}
		<meta name="twitter:image" content={meta.thumbnailUrl} />
	{/if}
</svelte:head>

<div class="flex min-h-dvh flex-col bg-background text-foreground">
	<header class="flex items-center gap-3 px-5 py-4">
		<span class="font-bold tracking-tight">Alcoves</span>
		<span class="text-muted-foreground">· shared moment</span>
	</header>

	<main class="flex flex-1 flex-col items-center gap-4 px-4 py-6">
		<div class="w-full max-w-5xl">
			<h1 class="mb-1 text-2xl font-semibold">{meta.title}</h1>
			{#if meta.description}
				<p class="mb-3 whitespace-pre-wrap text-muted-foreground">{meta.description}</p>
			{/if}
		</div>

		{#if hasVideo}
			<div class="aspect-video w-full max-w-5xl overflow-hidden rounded-xl bg-black shadow-2xl">
				<!-- svelte-ignore a11y_media_has_caption -->
				<video
					class="block h-full w-full"
					controls
					preload="metadata"
					poster={meta.thumbnailUrl}
					src={meta.videoUrl}
				></video>
			</div>
		{:else}
			<div
				class="w-full max-w-5xl rounded-xl border border-dashed p-8 text-center text-muted-foreground"
			>
				<strong class="block text-foreground">Still processing.</strong>
				The encoded clip isn't ready yet. Refresh in a moment.
			</div>
		{/if}
	</main>

	<footer class="py-4 text-center text-sm text-muted-foreground">
		<a href={meta.appUrl} class="text-primary hover:underline">View on Alcoves</a>
	</footer>
</div>
