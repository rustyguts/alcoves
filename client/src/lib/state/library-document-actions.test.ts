import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	create: vi.fn(),
	goto: vi.fn(),
	toastAdd: vi.fn()
}));

vi.mock('$lib/api', () => ({ api: { documents: { create: mocks.create } } }));
vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$lib/state/toast', () => ({ toast: { add: mocks.toastAdd } }));

import { createLibraryDocumentActions } from './library-document-actions.svelte';

describe('createLibraryDocumentActions', () => {
	beforeEach(() => {
		mocks.create.mockReset();
		mocks.goto.mockReset();
		mocks.toastAdd.mockReset();
	});

	it('opens the modal with a cleared name', () => {
		const actions = createLibraryDocumentActions(
			() => 'lib-1',
			() => null
		);
		actions.createDocumentName = 'leftover';
		actions.openCreateDocumentModal();
		expect(actions.createDocumentOpen).toBe(true);
		expect(actions.createDocumentName).toBe('');
	});

	it('creates the document in the current folder and navigates with ?from=', async () => {
		mocks.create.mockResolvedValue({ id: 'file-9' });
		const actions = createLibraryDocumentActions(
			() => 'lib-1',
			() => 'folder-7'
		);
		actions.createDocumentName = 'Trip Notes';
		await actions.createDocument();

		expect(mocks.create).toHaveBeenCalledWith('lib-1', {
			name: 'Trip Notes',
			folderId: 'folder-7'
		});
		expect(mocks.goto).toHaveBeenCalledWith('/libraries/lib-1/doc/file-9?from=folder-7');
		expect(actions.createDocumentOpen).toBe(false);
	});

	it('navigates without ?from= at the library root', async () => {
		mocks.create.mockResolvedValue({ id: 'file-9' });
		const actions = createLibraryDocumentActions(
			() => 'lib-1',
			() => null
		);
		actions.createDocumentName = 'Notes';
		await actions.createDocument();
		expect(mocks.goto).toHaveBeenCalledWith('/libraries/lib-1/doc/file-9');
	});

	it('does nothing for an empty name', async () => {
		const actions = createLibraryDocumentActions(
			() => 'lib-1',
			() => null
		);
		actions.createDocumentName = '   ';
		await actions.createDocument();
		expect(mocks.create).not.toHaveBeenCalled();
	});

	it('keeps the modal open and toasts on failure', async () => {
		mocks.create.mockRejectedValue(new Error('nope'));
		const actions = createLibraryDocumentActions(
			() => 'lib-1',
			() => null
		);
		actions.openCreateDocumentModal();
		actions.createDocumentName = 'Notes';
		await actions.createDocument();
		expect(actions.createDocumentOpen).toBe(true);
		expect(mocks.toastAdd).toHaveBeenCalled();
		expect(mocks.goto).not.toHaveBeenCalled();
		expect(actions.creatingDocument).toBe(false);
	});
});
