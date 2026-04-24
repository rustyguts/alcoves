import { useToast as useNuxtUiToast } from "@nuxt/ui/composables/useToast";

export interface Toast {
  id: string | number;
  title: string;
  description?: string;
  color?: "success" | "error" | "warning" | "info" | "neutral" | "primary";
}

export function useToast() {
  const ui = useNuxtUiToast();

  function add(toast: Omit<Toast, "id">) {
    ui.add({
      title: toast.title,
      description: toast.description,
      color: toast.color ?? "neutral",
    });
  }

  function remove(id: string | number) {
    ui.remove(String(id));
  }

  function clear() {
    ui.clear();
  }

  return { toasts: ui.toasts, add, remove, clear };
}
