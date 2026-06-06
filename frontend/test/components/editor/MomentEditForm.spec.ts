import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import MomentEditForm from "~/components/editor/MomentEditForm.vue";
import type { Moment } from "~~/shared/types/api";

function makeMoment(over: Partial<Moment> = {}): Moment {
  return {
    id: "m1",
    libraryId: "lib1",
    fileId: "file1",
    name: "Clip",
    description: "notes",
    startSeconds: 1,
    endSeconds: 3,
    exportStatus: null,
    tags: [],
    ...over,
  } as Moment;
}

function mountForm(over: Record<string, unknown> = {}) {
  return mount(MomentEditForm, {
    props: { moment: makeMoment(), currentTime: 2, duration: 10, ...over },
  });
}

const byIcon = (wrapper: ReturnType<typeof mountForm>, icon: string) =>
  wrapper.findAll(`[data-icon='${icon}']`);

describe("MomentEditForm", () => {
  it("renders nothing when there is no moment", () => {
    const wrapper = mount(MomentEditForm, {
      props: { moment: null, currentTime: 0, duration: 10 },
    });
    expect(wrapper.text()).toBe("");
  });

  it("populates fields from the moment", () => {
    const wrapper = mountForm();
    expect((wrapper.find("input").element as HTMLInputElement).value).toBe("Clip");
    expect((wrapper.find("textarea").element as HTMLTextAreaElement).value).toBe("notes");
  });

  it("re-populates when the moment prop changes", async () => {
    const wrapper = mountForm();
    await wrapper.setProps({ moment: makeMoment({ id: "m2", name: "Renamed" }) });
    expect((wrapper.find("input").element as HTMLInputElement).value).toBe("Renamed");
  });

  it("emits save with the current field values", async () => {
    const wrapper = mountForm();
    const save = wrapper.findAll("button").find((b) => b.text().includes("Save"));
    await save!.trigger("click");
    expect(wrapper.emitted("save")?.[0]).toEqual([
      { name: "Clip", description: "notes", startSeconds: 1, endSeconds: 3 },
    ]);
  });

  it("clamps start ≥ 0 and end > start on save", async () => {
    const wrapper = mountForm();
    const inputs = wrapper.findAll("input");
    // inputs: [name, start, end]
    await inputs[1]!.setValue("-5");
    await inputs[2]!.setValue("0");
    const save = wrapper.findAll("button").find((b) => b.text().includes("Save"));
    await save!.trigger("click");
    const patch = wrapper.emitted("save")?.[0]?.[0] as { startSeconds: number; endSeconds: number };
    expect(patch.startSeconds).toBe(0);
    expect(patch.endSeconds).toBeCloseTo(0.001);
  });

  it("emits delete with the moment id", async () => {
    const wrapper = mountForm();
    const del = wrapper.findAll("button").find((b) => b.text().includes("Delete"));
    await del!.trigger("click");
    expect(wrapper.emitted("delete")?.[0]).toEqual(["m1"]);
  });

  it("emits export/download/share/close from the header actions", async () => {
    const wrapper = mountForm();
    await wrapper.findAll("button").find((b) => b.text().includes("Reprocess"))!.trigger("click");
    await byIcon(wrapper, "i-lineicons-download")[0]!.trigger("click");
    await byIcon(wrapper, "i-lineicons-share-2")[0]!.trigger("click");
    await byIcon(wrapper, "i-lineicons-xmark")[0]!.trigger("click");
    expect(wrapper.emitted("export")?.[0]).toEqual(["m1"]);
    expect(wrapper.emitted("download")?.[0]).toEqual(["m1"]);
    expect(wrapper.emitted("share")?.[0]).toEqual(["m1"]);
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("emits set-to-playhead for start and end", async () => {
    const wrapper = mountForm();
    const crosshairs = byIcon(wrapper, "i-lineicons-target");
    await crosshairs[0]!.trigger("click");
    await crosshairs[1]!.trigger("click");
    expect(wrapper.emitted("set-to-playhead")).toEqual([["start"], ["end"]]);
  });

  it("disables reprocess while an export is in flight", () => {
    const wrapper = mountForm({ moment: makeMoment({ exportStatus: "processing" }) });
    const reprocess = wrapper
      .findAll("button")
      .find((b) => b.text().includes("Reprocess"));
    expect(reprocess!.attributes("disabled")).toBeDefined();
  });
});
