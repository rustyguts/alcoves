<script lang="ts">
	// Test stand-in for MarkdownEditor: the real component dynamic-imports
	// CodeMirror + yCollab in onMount, which needs a real Y.Text — the page
	// test drives a faked provider instead.
	interface Props {
		readonly?: boolean;
		dark?: boolean;
	}
	// The real component also takes ytext/awareness; the mock ignores extras.
	let { readonly = false, dark = false }: Props = $props();
</script>

<div data-testid="markdown-editor-mock" data-readonly={readonly} data-dark={dark}></div>
