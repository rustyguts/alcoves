<script lang="ts">
	/**
	 * UserAvatarTableHarness — mounts UserAvatar inside a real
	 * <table><tbody><tr><td> at every constrained size, mirroring
	 * LibraryEntriesTable's owner-avatar column: the exact repro site of the
	 * elongation bug (a free-form `sizeClass="w-6"` inside a table cell, with
	 * a tinted `bgClass` and `tooltip` wrapper). Used ONLY by
	 * UserAvatar.svelte.test.ts's computed-style regression net. Not imported
	 * by app code.
	 */
	import UserAvatar from './UserAvatar.svelte';

	const sizes = ['xs', 'sm', 'md', 'lg'] as const;
</script>

<table>
	<tbody>
		<tr>
			{#each sizes as size (size)}
				<td data-testid={`cell-${size}`}>
					<UserAvatar
						displayName="Alice Example"
						avatarUrl={null}
						{size}
						bgClass="bg-primary/10 text-primary"
						tooltip
					/>
				</td>
			{/each}
		</tr>
	</tbody>
</table>
