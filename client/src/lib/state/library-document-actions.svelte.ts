import { goto } from '$app/navigation';
import { api } from '$lib/api';
import { toast } from '$lib/state/toast';

/**
 * "New Document" action for the library explorer: creates an empty markdown
 * file (via the documents API) and navigates straight into the collaborative
 * editor. Follows the `createLibraryFolderActions` conventions — getter
 * inputs, modal state exposed via getters/setters, no `$effect` inside.
 */
export function createLibraryDocumentActions(
	getLibraryId: () => string,
	getCurrentFolderId: () => string | null
) {
	let createDocumentOpen = $state(false);
	let createDocumentName = $state('');
	let creatingDocument = $state(false);

	function openCreateDocumentModal() {
		createDocumentName = '';
		createDocumentOpen = true;
	}

	async function createDocument() {
		const name = createDocumentName.trim();
		if (!name) return;

		creatingDocument = true;
		try {
			const folderId = getCurrentFolderId();
			const file = await api.documents.create(getLibraryId(), { name, folderId });
			createDocumentOpen = false;
			createDocumentName = '';
			const from = folderId ? `?from=${encodeURIComponent(folderId)}` : '';
			await goto(`/libraries/${getLibraryId()}/doc/${file.id}${from}`);
		} catch {
			toast.add({ title: 'Failed to create document', color: 'error' });
		} finally {
			creatingDocument = false;
		}
	}

	return {
		get createDocumentOpen() {
			return createDocumentOpen;
		},
		set createDocumentOpen(value: boolean) {
			createDocumentOpen = value;
		},
		get createDocumentName() {
			return createDocumentName;
		},
		set createDocumentName(value: string) {
			createDocumentName = value;
		},
		get creatingDocument() {
			return creatingDocument;
		},
		openCreateDocumentModal,
		createDocument
	};
}
