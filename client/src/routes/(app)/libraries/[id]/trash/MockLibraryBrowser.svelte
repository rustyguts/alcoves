<script lang="ts">
	// Test double for LibraryBrowser. It avoids the heavy real component's store +
	// API dependency graph and instead surfaces the props the trash wrapper forwards
	// so the page test can assert library / user / trashed were passed through.
	let {
		library = null,
		user = null,
		trashed = false
	}: {
		library?: { id?: string } | null;
		user?: { id?: string } | null;
		trashed?: boolean;
	} = $props();
</script>

<div
	data-testid="mock-library-browser"
	data-trashed={trashed ? 'true' : 'false'}
	data-library-id={library?.id ?? ''}
	data-user-id={user?.id ?? ''}
>
	mock library browser
</div>
