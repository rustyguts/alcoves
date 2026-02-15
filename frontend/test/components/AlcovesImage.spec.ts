import { mount } from "@vue/test-utils";
import AlcovesImage from "~/components/AlcovesImage.vue";

describe("AlcovesImage", () => {
  it("builds a proxy url with deterministic sorted query params", () => {
    const wrapper = mount(AlcovesImage, {
      props: {
        libraryId: "lib-1",
        fileId: "file-1",
        format: "webp",
        width: 640,
        height: 480,
        quality: 80,
        alt: "preview",
      },
    });

    const img = wrapper.get("img");
    expect(img.attributes("src")).toBe(
      "/api/files/proxy/lib-1/file-1?format=webp&height=480&quality=80&width=640",
    );
    expect(img.attributes("alt")).toBe("preview");
  });

  it("uses default format and optional attrs when values are omitted", () => {
    const wrapper = mount(AlcovesImage, {
      props: {
        libraryId: "lib-2",
        fileId: "file-2",
      },
    });

    const img = wrapper.get("img");
    expect(img.attributes("src")).toBe("/api/files/proxy/lib-2/file-2?format=jpeg");
    expect(img.attributes("loading")).toBe("lazy");
    expect(img.attributes("decoding")).toBe("async");
  });

  it("forwards explicit sizing and classes to the img element", () => {
    const wrapper = mount(AlcovesImage, {
      props: {
        libraryId: "lib-3",
        fileId: "file-3",
        width: 300,
        height: 200,
        class: "rounded-md object-cover",
      },
    });

    const img = wrapper.get("img");
    expect(img.attributes("width")).toBe("300");
    expect(img.attributes("height")).toBe("200");
    expect(img.classes()).toEqual(expect.arrayContaining(["rounded-md", "object-cover"]));
  });
});
