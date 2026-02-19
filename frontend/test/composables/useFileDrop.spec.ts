import { ref } from "vue";
import { extractDroppedFiles, hasFilePayload, useFileDrop } from "~/composables/useFileDrop";

// ---------------------------------------------------------------------------
// Helpers to build realistic DataTransfer / DragEvent fakes
// ---------------------------------------------------------------------------

interface MockFileEntry {
  file: File;
  isDirectory?: boolean;
}

/**
 * Builds a minimal DataTransfer-like object.
 *
 * Supports three "modes" that mirror real browser behavior:
 * - `standard`  : both `items` (with webkitGetAsEntry) and `files` populated
 * - `filesOnly` : only `files` (FileList), no `items` — simulates Firefox < 50
 * - `itemsOnly` : only `items`, empty `files` — simulates edge cases
 */
function createDataTransfer(
  entries: MockFileEntry[],
  mode: "standard" | "filesOnly" | "itemsOnly" = "standard",
): DataTransfer {
  const fileArray = entries.filter((e) => !e.isDirectory).map((e) => e.file);
  const allEntries = entries;

  // Build a FileList-like object
  const fileList = {
    length: mode === "itemsOnly" ? 0 : fileArray.length,
    item(i: number) {
      return mode === "itemsOnly" ? null : (fileArray[i] ?? null);
    },
    [Symbol.iterator]() {
      let idx = 0;
      const files = mode === "itemsOnly" ? [] : fileArray;
      return {
        next() {
          if (idx < files.length) return { value: files[idx++], done: false };
          return { value: undefined, done: true };
        },
      };
    },
  } as unknown as FileList;

  // Allow indexed access (fileList[0], fileList[1], …)
  if (mode !== "itemsOnly") {
    for (let i = 0; i < fileArray.length; i++) {
      (fileList as Record<number, File>)[i] = fileArray[i]!;
    }
  }

  // Build a DataTransferItemList-like object
  const items =
    mode === "filesOnly"
      ? undefined
      : ({
          length: allEntries.length,
          [Symbol.iterator]() {
            let idx = 0;
            return {
              next() {
                if (idx < allEntries.length) {
                  const entry = allEntries[idx]!;
                  idx++;
                  const item = {
                    kind: "file" as const,
                    type: entry.file.type,
                    getAsFile: () => entry.file,
                    webkitGetAsEntry: () => ({
                      isFile: !entry.isDirectory,
                      isDirectory: !!entry.isDirectory,
                      name: entry.file.name,
                    }),
                  };
                  return { value: item, done: false };
                }
                return { value: undefined, done: true };
              },
            };
          },
        } as unknown as DataTransferItemList);

  // Allow indexed access (items[0], items[1], …)
  if (items && mode !== "filesOnly") {
    for (let i = 0; i < allEntries.length; i++) {
      const entry = allEntries[i]!;
      (items as Record<number, unknown>)[i] = {
        kind: "file" as const,
        type: entry.file.type,
        getAsFile: () => entry.file,
        webkitGetAsEntry: () => ({
          isFile: !entry.isDirectory,
          isDirectory: !!entry.isDirectory,
          name: entry.file.name,
        }),
      };
    }
  }

  return {
    files: fileList,
    items: items as DataTransferItemList,
    types: ["Files"],
    dropEffect: "none",
    effectAllowed: "uninitialized",
  } as unknown as DataTransfer;
}

/**
 * Creates a DataTransfer for browsers where webkitGetAsEntry is not available.
 */
function createDataTransferNoWebkit(files: File[]): DataTransfer {
  const fileList = {
    length: files.length,
    item(i: number) {
      return files[i] ?? null;
    },
    [Symbol.iterator]() {
      let idx = 0;
      return {
        next() {
          if (idx < files.length) return { value: files[idx++], done: false };
          return { value: undefined, done: true };
        },
      };
    },
  } as unknown as FileList;

  for (let i = 0; i < files.length; i++) {
    (fileList as Record<number, File>)[i] = files[i]!;
  }

  const items = {
    length: files.length,
    [Symbol.iterator]() {
      let idx = 0;
      return {
        next() {
          if (idx < files.length) {
            const file = files[idx]!;
            idx++;
            return {
              value: {
                kind: "file" as const,
                type: file.type,
                getAsFile: () => file,
                // No webkitGetAsEntry
              },
              done: false,
            };
          }
          return { value: undefined, done: true };
        },
      };
    },
  } as unknown as DataTransferItemList;

  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    (items as Record<number, unknown>)[i] = {
      kind: "file" as const,
      type: file.type,
      getAsFile: () => file,
    };
  }

  return {
    files: fileList,
    items,
    types: ["Files"],
    dropEffect: "none",
    effectAllowed: "uninitialized",
  } as unknown as DataTransfer;
}

function createDragEvent(
  type: string,
  dataTransfer?: DataTransfer,
): DragEvent {
  const prevented = { value: false };
  return {
    type,
    dataTransfer: dataTransfer ?? null,
    preventDefault: () => {
      prevented.value = true;
    },
    get defaultPrevented() {
      return prevented.value;
    },
  } as unknown as DragEvent;
}

function createDragEventWithTypes(type: string, types: string[]): DragEvent {
  return {
    type,
    dataTransfer: { types },
    preventDefault: vi.fn(),
  } as unknown as DragEvent;
}

// ---------------------------------------------------------------------------
// Tests: extractDroppedFiles
// ---------------------------------------------------------------------------

describe("extractDroppedFiles", () => {
  it("extracts files from dataTransfer.files (standard browser)", () => {
    const file1 = new File(["hello"], "hello.txt", { type: "text/plain" });
    const file2 = new File(["world"], "world.jpg", { type: "image/jpeg" });

    const dt = createDataTransfer([{ file: file1 }, { file: file2 }]);
    const result = extractDroppedFiles(dt);

    expect(result).toHaveLength(2);
    expect(result[0]!.name).toBe("hello.txt");
    expect(result[0]!.size).toBe(5);
    expect(result[1]!.name).toBe("world.jpg");
    expect(result[1]!.size).toBe(5);
  });

  it("preserves original file size and content", () => {
    const content = "a".repeat(1024);
    const file = new File([content], "big.txt", { type: "text/plain" });

    const dt = createDataTransfer([{ file }]);
    const result = extractDroppedFiles(dt);

    expect(result).toHaveLength(1);
    expect(result[0]!.size).toBe(1024);
    expect(result[0]!.name).toBe("big.txt");
  });

  it("filters out directories detected via webkitGetAsEntry", () => {
    const file = new File(["data"], "photo.png", { type: "image/png" });
    const dirFile = new File([], "my-folder", { type: "" });

    const dt = createDataTransfer([
      { file, isDirectory: false },
      { file: dirFile, isDirectory: true },
    ]);
    const result = extractDroppedFiles(dt);

    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("photo.png");
  });

  it("returns all files when webkitGetAsEntry is not available", () => {
    const file1 = new File(["aaa"], "a.txt", { type: "text/plain" });
    const file2 = new File(["bbb"], "b.txt", { type: "text/plain" });

    const dt = createDataTransferNoWebkit([file1, file2]);
    const result = extractDroppedFiles(dt);

    expect(result).toHaveLength(2);
    expect(result[0]!.name).toBe("a.txt");
    expect(result[1]!.name).toBe("b.txt");
  });

  it("handles empty drop (no files)", () => {
    const dt = createDataTransfer([]);
    const result = extractDroppedFiles(dt);

    expect(result).toHaveLength(0);
  });

  it("handles a single file drop", () => {
    const file = new File(["single"], "only.pdf", { type: "application/pdf" });

    const dt = createDataTransfer([{ file }]);
    const result = extractDroppedFiles(dt);

    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("only.pdf");
    expect(result[0]!.size).toBe(6);
  });

  it("handles files with special characters in names", () => {
    const file = new File(["x"], "résumé (final) [2024].docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    const dt = createDataTransfer([{ file }]);
    const result = extractDroppedFiles(dt);

    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("résumé (final) [2024].docx");
  });

  it("handles many files dropped at once", () => {
    const entries: MockFileEntry[] = Array.from({ length: 50 }, (_, i) => ({
      file: new File([`content-${i}`], `file-${i}.txt`, { type: "text/plain" }),
    }));

    const dt = createDataTransfer(entries);
    const result = extractDroppedFiles(dt);

    expect(result).toHaveLength(50);
    for (let i = 0; i < 50; i++) {
      expect(result[i]!.name).toBe(`file-${i}.txt`);
    }
  });

  it("handles mixed files and directories", () => {
    const entries: MockFileEntry[] = [
      { file: new File(["a"], "photo.jpg", { type: "image/jpeg" }), isDirectory: false },
      { file: new File([], "Documents", { type: "" }), isDirectory: true },
      { file: new File(["b"], "video.mp4", { type: "video/mp4" }), isDirectory: false },
      { file: new File([], "Downloads", { type: "" }), isDirectory: true },
      { file: new File(["c"], "music.mp3", { type: "audio/mpeg" }), isDirectory: false },
    ];

    const dt = createDataTransfer(entries);
    const result = extractDroppedFiles(dt);

    expect(result).toHaveLength(3);
    expect(result.map((f) => f.name)).toEqual(["photo.jpg", "video.mp4", "music.mp3"]);
  });

  it("handles zero-byte files that are NOT directories", () => {
    // A legitimate empty file should not be filtered out just because its size is 0.
    const emptyFile = new File([], "empty.txt", { type: "text/plain" });

    const dt = createDataTransfer([{ file: emptyFile, isDirectory: false }]);
    const result = extractDroppedFiles(dt);

    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("empty.txt");
    expect(result[0]!.size).toBe(0);
  });

  it("works when dataTransfer.items is undefined (filesOnly mode)", () => {
    const file = new File(["data"], "test.txt", { type: "text/plain" });

    const dt = createDataTransfer([{ file }], "filesOnly");
    const result = extractDroppedFiles(dt);

    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("test.txt");
    expect(result[0]!.size).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Tests: hasFilePayload
// ---------------------------------------------------------------------------

describe("hasFilePayload", () => {
  it("returns true when types include 'Files'", () => {
    const event = createDragEventWithTypes("dragover", ["Files"]);
    expect(hasFilePayload(event)).toBe(true);
  });

  it("returns true when types include 'Files' among other types", () => {
    const event = createDragEventWithTypes("dragover", ["text/plain", "Files"]);
    expect(hasFilePayload(event)).toBe(true);
  });

  it("returns false when types do not include 'Files'", () => {
    const event = createDragEventWithTypes("dragover", ["text/plain", "text/html"]);
    expect(hasFilePayload(event)).toBe(false);
  });

  it("returns false when types is empty", () => {
    const event = createDragEventWithTypes("dragover", []);
    expect(hasFilePayload(event)).toBe(false);
  });

  it("returns false when dataTransfer is null", () => {
    const event = { type: "dragover", dataTransfer: null } as unknown as DragEvent;
    expect(hasFilePayload(event)).toBe(false);
  });

  it("returns false when dataTransfer is undefined", () => {
    const event = { type: "dragover" } as unknown as DragEvent;
    expect(hasFilePayload(event)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: useFileDrop composable
// ---------------------------------------------------------------------------

describe("useFileDrop", () => {
  it("calls onDrop with extracted files on a valid drop", () => {
    const onDrop = vi.fn();
    const { handleDrop } = useFileDrop({ onDrop });

    const file = new File(["hello"], "hello.txt", { type: "text/plain" });
    const dt = createDataTransfer([{ file }]);
    const event = createDragEvent("drop", dt);

    handleDrop(event);

    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onDrop).toHaveBeenCalledWith([file]);
  });

  it("does not call onDrop when dropping an empty payload", () => {
    const onDrop = vi.fn();
    const { handleDrop } = useFileDrop({ onDrop });

    const dt = createDataTransfer([]);
    const event = createDragEvent("drop", dt);

    handleDrop(event);

    expect(onDrop).not.toHaveBeenCalled();
  });

  it("does not call onDrop when enabled is false", () => {
    const onDrop = vi.fn();
    const enabled = ref(false);
    const { handleDrop } = useFileDrop({ enabled, onDrop });

    const file = new File(["hello"], "hello.txt", { type: "text/plain" });
    const dt = createDataTransfer([{ file }]);
    const event = createDragEvent("drop", dt);

    handleDrop(event);

    expect(onDrop).not.toHaveBeenCalled();
  });

  it("tracks isOverDropZone through dragenter/dragleave cycle", () => {
    const onDrop = vi.fn();
    const { isOverDropZone, handleDragEnter, handleDragLeave } = useFileDrop({ onDrop });

    expect(isOverDropZone.value).toBe(false);

    // Drag enter
    const enterDt = createDataTransfer([{ file: new File(["x"], "x.txt") }]);
    handleDragEnter(createDragEvent("dragenter", enterDt));

    expect(isOverDropZone.value).toBe(true);

    // Drag leave
    const leaveDt = createDataTransfer([{ file: new File(["x"], "x.txt") }]);
    handleDragLeave(createDragEvent("dragleave", leaveDt));

    expect(isOverDropZone.value).toBe(false);
  });

  it("handles nested element enter/leave correctly via depth counter", () => {
    const onDrop = vi.fn();
    const { isOverDropZone, dragDepth, handleDragEnter, handleDragLeave } = useFileDrop({
      onDrop,
    });

    const makeDt = () => createDataTransfer([{ file: new File(["x"], "x.txt") }]);

    // Enter outer element
    handleDragEnter(createDragEvent("dragenter", makeDt()));
    expect(dragDepth.value).toBe(1);
    expect(isOverDropZone.value).toBe(true);

    // Enter inner element (child fires another dragenter)
    handleDragEnter(createDragEvent("dragenter", makeDt()));
    expect(dragDepth.value).toBe(2);
    expect(isOverDropZone.value).toBe(true);

    // Leave inner element
    handleDragLeave(createDragEvent("dragleave", makeDt()));
    expect(dragDepth.value).toBe(1);
    expect(isOverDropZone.value).toBe(true); // still inside outer

    // Leave outer element
    handleDragLeave(createDragEvent("dragleave", makeDt()));
    expect(dragDepth.value).toBe(0);
    expect(isOverDropZone.value).toBe(false);
  });

  it("resets state on drop", () => {
    const onDrop = vi.fn();
    const { isOverDropZone, dragDepth, handleDragEnter, handleDrop } = useFileDrop({ onDrop });

    const file = new File(["x"], "x.txt", { type: "text/plain" });
    const dt = createDataTransfer([{ file }]);

    // Simulate drag enter first
    handleDragEnter(createDragEvent("dragenter", dt));
    handleDragEnter(createDragEvent("dragenter", dt));
    expect(dragDepth.value).toBe(2);
    expect(isOverDropZone.value).toBe(true);

    // Drop
    handleDrop(createDragEvent("drop", dt));

    expect(dragDepth.value).toBe(0);
    expect(isOverDropZone.value).toBe(false);
  });

  it("prevents default on dragover for valid file payloads", () => {
    const onDrop = vi.fn();
    const { handleDragOver } = useFileDrop({ onDrop });

    const dt = createDataTransfer([{ file: new File(["x"], "x.txt") }]);
    const event = createDragEvent("dragover", dt);

    handleDragOver(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("sets dropEffect to copy on dragover", () => {
    const onDrop = vi.fn();
    const { handleDragOver } = useFileDrop({ onDrop });

    const dt = createDataTransfer([{ file: new File(["x"], "x.txt") }]);
    const event = createDragEvent("dragover", dt);

    handleDragOver(event);

    expect(event.dataTransfer!.dropEffect).toBe("copy");
  });

  it("ignores dragenter when event does not carry files", () => {
    const onDrop = vi.fn();
    const { isOverDropZone, handleDragEnter } = useFileDrop({ onDrop });

    // Internal drag (no "Files" type)
    const event = createDragEventWithTypes("dragenter", ["text/plain"]);
    handleDragEnter(event as unknown as DragEvent);

    expect(isOverDropZone.value).toBe(false);
  });

  it("ignores all events when enabled is false", () => {
    const onDrop = vi.fn();
    const enabled = ref(false);
    const { isOverDropZone, handleDragEnter, handleDragOver, handleDragLeave, handleDrop } =
      useFileDrop({ enabled, onDrop });

    const dt = createDataTransfer([{ file: new File(["x"], "x.txt") }]);

    handleDragEnter(createDragEvent("dragenter", dt));
    expect(isOverDropZone.value).toBe(false);

    handleDragOver(createDragEvent("dragover", dt));
    handleDragLeave(createDragEvent("dragleave", dt));
    handleDrop(createDragEvent("drop", dt));

    expect(onDrop).not.toHaveBeenCalled();
  });

  it("respects enabled becoming true after initial false", () => {
    const onDrop = vi.fn();
    const enabled = ref(false);
    const { handleDrop } = useFileDrop({ enabled, onDrop });

    const file = new File(["hello"], "hello.txt", { type: "text/plain" });
    const dt = createDataTransfer([{ file }]);

    // Drop while disabled — ignored
    handleDrop(createDragEvent("drop", dt));
    expect(onDrop).not.toHaveBeenCalled();

    // Enable and drop again
    enabled.value = true;
    handleDrop(createDragEvent("drop", dt));
    expect(onDrop).toHaveBeenCalledTimes(1);
  });

  it("prevents default on drop", () => {
    const onDrop = vi.fn();
    const { handleDrop } = useFileDrop({ onDrop });

    const file = new File(["x"], "x.txt");
    const dt = createDataTransfer([{ file }]);
    const event = createDragEvent("drop", dt);

    handleDrop(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("prevents default on dragenter", () => {
    const onDrop = vi.fn();
    const { handleDragEnter } = useFileDrop({ onDrop });

    const dt = createDataTransfer([{ file: new File(["x"], "x.txt") }]);
    const event = createDragEvent("dragenter", dt);

    handleDragEnter(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("dropZoneProps contains all required event handlers", () => {
    const onDrop = vi.fn();
    const { dropZoneProps } = useFileDrop({ onDrop });

    expect(dropZoneProps).toHaveProperty("onDragenter");
    expect(dropZoneProps).toHaveProperty("onDragover");
    expect(dropZoneProps).toHaveProperty("onDragleave");
    expect(dropZoneProps).toHaveProperty("onDrop");
    expect(typeof dropZoneProps.onDragenter).toBe("function");
    expect(typeof dropZoneProps.onDragover).toBe("function");
    expect(typeof dropZoneProps.onDragleave).toBe("function");
    expect(typeof dropZoneProps.onDrop).toBe("function");
  });

  it("does not call onDrop when dataTransfer is null", () => {
    const onDrop = vi.fn();
    const { handleDrop } = useFileDrop({ onDrop });

    const event = createDragEvent("drop");
    // dataTransfer is null by default
    handleDrop(event);

    expect(onDrop).not.toHaveBeenCalled();
  });

  it("dragDepth never goes below zero", () => {
    const onDrop = vi.fn();
    const { dragDepth, handleDragLeave } = useFileDrop({ onDrop });

    const dt = createDataTransfer([{ file: new File(["x"], "x.txt") }]);

    // Leave without entering first
    handleDragLeave(createDragEvent("dragleave", dt));
    handleDragLeave(createDragEvent("dragleave", dt));

    expect(dragDepth.value).toBe(0);
  });

  it("handles multiple sequential drops", () => {
    const onDrop = vi.fn();
    const { handleDrop } = useFileDrop({ onDrop });

    const file1 = new File(["first"], "first.txt");
    const file2 = new File(["second"], "second.txt");

    handleDrop(createDragEvent("drop", createDataTransfer([{ file: file1 }])));
    handleDrop(createDragEvent("drop", createDataTransfer([{ file: file2 }])));

    expect(onDrop).toHaveBeenCalledTimes(2);
    expect(onDrop).toHaveBeenNthCalledWith(1, [file1]);
    expect(onDrop).toHaveBeenNthCalledWith(2, [file2]);
  });
});
