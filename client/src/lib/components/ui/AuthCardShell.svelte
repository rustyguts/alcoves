<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import AppIcon from '$lib/components/ui/AppIcon.svelte';
	import { ICONS } from '$lib/utils/icons';

	interface Props {
		title: string;
		subtitle: string;
		error?: string;
		children?: Snippet;
		footer?: Snippet;
	}

	let { title, subtitle, error = '', children, footer }: Props = $props();
</script>

<div class="flex min-h-svh items-center justify-center bg-background p-4">
	<div class="w-full max-w-md">
		<!-- The auth box is intentionally elevated (a focused, floating panel),
			 unlike the flat surfaces used for in-page content. -->
		<Card.Root class="shadow-lg">
			<Card.Header class="flex flex-col items-center gap-3 text-center">
				<img src="/logo.webp" alt="Alcoves" width="72" height="72" class="rounded-xl" />
				<Card.Title role="heading" aria-level={2} class="text-2xl font-bold">{title}</Card.Title>
				<Card.Description class="text-center">{subtitle}</Card.Description>
			</Card.Header>

			<Card.Content class="flex flex-col gap-4">
				{#if error}
					<Alert.Root variant="destructive">
						<AppIcon name={ICONS.error} class="size-4 shrink-0" />
						<Alert.Description>{error}</Alert.Description>
					</Alert.Root>
				{/if}

				{@render children?.()}
			</Card.Content>

			{#if footer}
				<Card.Footer class="border-t">
					{@render footer()}
				</Card.Footer>
			{/if}
		</Card.Root>
	</div>
</div>
