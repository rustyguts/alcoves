<script setup lang="ts">
interface Props {
  boxClass?: string;
}

withDefaults(defineProps<Props>(), {
  boxClass: "",
});

const open = defineModel<boolean>("open", { default: false });

function closeModal() {
  open.value = false;
}
</script>

<template>
  <dialog class="modal" :class="{ 'modal-open': open }">
    <div class="modal-box" :class="boxClass">
      <slot />
    </div>
    <form method="dialog" class="modal-backdrop" @click="closeModal">
      <button>close</button>
    </form>
  </dialog>
</template>
