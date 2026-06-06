import { describe, it, expect, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import LibraryEmptyState from './LibraryEmptyState.svelte';

describe('LibraryEmptyState', () => {
	it('renders title and description', async () => {
		const screen = render(LibraryEmptyState, {
			props: {
				showTrashed: false,
				title: 'No files yet',
				description: 'Upload files to get started',
				canManageLibrary: false
			}
		});
		await expect.element(screen.getByText('No files yet')).toBeInTheDocument();
		await expect.element(screen.getByText('Upload files to get started')).toBeInTheDocument();
	});

	it('shows action buttons when canManageLibrary and not trashed', async () => {
		const screen = render(LibraryEmptyState, {
			props: {
				showTrashed: false,
				title: 'Empty',
				description: 'Nothing here',
				canManageLibrary: true
			}
		});
		await expect.element(screen.getByText('Create folder')).toBeInTheDocument();
		await expect.element(screen.getByText('Upload files')).toBeInTheDocument();
	});

	it('hides action buttons when canManageLibrary is false', () => {
		const screen = render(LibraryEmptyState, {
			props: {
				showTrashed: false,
				title: 'Empty',
				description: 'Nothing here',
				canManageLibrary: false
			}
		});
		expect(screen.container.querySelectorAll('button')).toHaveLength(0);
	});

	it('hides action buttons when showTrashed is true', () => {
		const screen = render(LibraryEmptyState, {
			props: {
				showTrashed: true,
				title: 'Trash empty',
				description: 'No deleted files',
				canManageLibrary: true
			}
		});
		expect(screen.container.querySelectorAll('button')).toHaveLength(0);
	});

	it('renders the trash icon when showTrashed is true', () => {
		const screen = render(LibraryEmptyState, {
			props: {
				showTrashed: true,
				title: 'Trash empty',
				description: 'No deleted files',
				canManageLibrary: false
			}
		});
		expect(screen.container.querySelector('svg')).not.toBeNull();
	});

	it('calls oncreateFolder when the create folder button is clicked', async () => {
		const oncreateFolder = vi.fn();
		const screen = render(LibraryEmptyState, {
			props: {
				showTrashed: false,
				title: 'Empty',
				description: 'Desc',
				canManageLibrary: true,
				oncreateFolder
			}
		});
		await screen.getByText('Create folder').click();
		expect(oncreateFolder).toHaveBeenCalledTimes(1);
	});

	it('calls onuploadFiles when the upload button is clicked', async () => {
		const onuploadFiles = vi.fn();
		const screen = render(LibraryEmptyState, {
			props: {
				showTrashed: false,
				title: 'Empty',
				description: 'Desc',
				canManageLibrary: true,
				onuploadFiles
			}
		});
		await screen.getByText('Upload files').click();
		expect(onuploadFiles).toHaveBeenCalledTimes(1);
	});
});
