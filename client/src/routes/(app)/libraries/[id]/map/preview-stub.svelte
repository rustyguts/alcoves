<!-- Test-only stub for FilePreview: a marker that surfaces the file/files it was
     handed and a button to drive the page's onNavigate handler, without pulling
     in image-proxy / playback plumbing. -->
<script lang="ts">
	import type { LibraryFile } from '$lib/types/api';

	interface Props {
		file: LibraryFile;
		files: LibraryFile[];
		open?: boolean;
		onnavigate?: (file: LibraryFile) => void;
	}

	let { file, files, open = $bindable(false), onnavigate }: Props = $props();
</script>

<div data-testid="preview-stub" data-open={open} data-file-id={file.id} data-count={files.length}>
	{#if files.length > 1}
		<button type="button" data-testid="preview-next" onclick={() => onnavigate?.(files[1]!)}>
			next
		</button>
	{/if}
</div>
