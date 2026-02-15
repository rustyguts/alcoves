import { ref, type Ref } from "vue";

export interface Toast {
  id: number;
  title: string;
  description?: string;
  color?: "success" | "error" | "warning" | "info" | "neutral" | "primary";
}

const toasts: Ref<Toast[]> = ref([]);
let nextId = 0;

export function useToast() {
  function add(toast: Omit<Toast, "id">) {
    const id = nextId++;
    toasts.value.push({ ...toast, id });
    setTimeout(() => {
      remove(id);
    }, 4000);
  }

  function remove(id: number) {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }

  function clear() {
    toasts.value = [];
  }

  return { toasts, add, remove, clear };
}
