<!-- Test-only stub for FilePreview: a marker so the person-detail page test can
     assert the preview opened without pulling in image-proxy / playback plumbing.
     It also forwards `onnavigate` so the page's navigate callback is exercised. -->
<script lang="ts">
	import type { LibraryFile } from '$lib/types/api';

	interface Props {
		file: LibraryFile;
		libraryId: string;
		files: LibraryFile[];
		open?: boolean;
		onnavigate?: (file: LibraryFile) => void;
	}

	let { file, libraryId, files, open = $bindable(false), onnavigate }: Props = $props();
</script>

<div data-testid="preview-stub" data-library-id={libraryId} data-open={open}>
	<span data-testid="preview-file-id">{file?.id}</span>
	<span data-testid="preview-files-count">{files?.length ?? 0}</span>
	<button
		type="button"
		data-testid="preview-navigate"
		onclick={() => onnavigate?.({ ...file, id: 'navigated' } as LibraryFile)}
	>
		navigate
	</button>
</div>
