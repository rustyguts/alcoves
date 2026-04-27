import { onMounted, onBeforeUnmount, type Ref } from "vue";

export interface EditorShortcutHandlers {
  hasSelection: Ref<boolean>;
  onSetStart: () => void;
  onSetEnd: () => void;
  onCreate: () => void;
  onTogglePlay: () => void;
}

/**
 * Editor keyboard shortcuts: I/O set in/out points on the selected moment,
 * M creates a new 5s moment at the playhead, Space toggles playback. Skips
 * when focus is in a text input so it doesn't hijack typing.
 */
export function useEditorShortcuts(handlers: EditorShortcutHandlers) {
  function onKeydown(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null;
    if (target && /input|textarea|select/i.test(target.tagName)) return;
    if (e.key === "i" || e.key === "I") {
      if (handlers.hasSelection.value) handlers.onSetStart();
      e.preventDefault();
    } else if (e.key === "o" || e.key === "O") {
      if (handlers.hasSelection.value) handlers.onSetEnd();
      e.preventDefault();
    } else if (e.key === "m" || e.key === "M") {
      handlers.onCreate();
      e.preventDefault();
    } else if (e.key === " ") {
      handlers.onTogglePlay();
      e.preventDefault();
    }
  }

  onMounted(() => {
    if (!import.meta.client) return;
    window.addEventListener("keydown", onKeydown);
  });
  onBeforeUnmount(() => {
    if (!import.meta.client) return;
    window.removeEventListener("keydown", onKeydown);
  });
}
