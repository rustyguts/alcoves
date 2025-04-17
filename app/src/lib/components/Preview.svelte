<script lang="ts">
  import { onMount } from "svelte";
  import { fade } from "svelte/transition";

  interface Asset {
    id: string;
    cTime: string;
    description?: string;
  }

  const { asset, onClose } = $props<{
    asset: Asset | null;
    onClose: () => void;
  }>();

  let modalElement: HTMLDialogElement;

  // When asset changes and is not null, show the modal
  $effect(() => {
    if (asset && modalElement) {
      modalElement.showModal();
    }
  });

  // Handle modal close event
  function handleClose() {
    if (modalElement) {
      modalElement.close();
      onClose();
    }
  }
</script>

<dialog
  id="previewModal"
  class="modal w-full max-w-none max-h-none h-screen inset-0 p-0 m-0 bg-black"
  bind:this={modalElement}
>
  {#if asset}
    <div
      class="fixed inset-0 flex flex-col items-center justify-center bg-black p-0 m-0"
    >
      <form method="dialog" class="absolute right-4 top-4 z-10">
        <button
          class="btn btn-sm btn-circle btn-ghost text-white bg-black/50 hover:bg-black/70"
          onclick={handleClose}
          aria-label="Close preview">✕</button
        >
      </form>

      <div class="flex flex-col items-center justify-center h-screen w-full">
        <img
          src={`/api/proxy/${asset.id}.jpg?quality=original`}
          alt={asset.description || asset.id}
          class="max-h-screen max-w-screen object-contain"
        />

        {#if asset.description}
          <div
            class="w-full p-3 bg-black/70 text-white absolute bottom-0 left-0"
          >
            <p class="text-base">{asset.description}</p>
          </div>
        {/if}
      </div>
    </div>

    <form method="dialog" class="modal-backdrop bg-black opacity-100">
      <button onclick={handleClose}>close</button>
    </form>
  {/if}
</dialog>

<style>
  /* Ensure the dialog takes up the full screen with no gaps */
  dialog::backdrop {
    background-color: black;
  }

  dialog.modal {
    margin: 0;
    padding: 0;
    border: none;
    max-width: 100vw;
    max-height: 100vh;
    width: 100vw;
    height: 100vh;
    border-radius: 0;
    background-color: black;
  }
</style>
