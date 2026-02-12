import { mountSuspended } from "@nuxt/test-utils/runtime";
import { defineComponent } from "vue";
import LibraryMemberAvatars from "~/components/LibraryMemberAvatars.vue";

const UAvatarStub = defineComponent({
  name: "UAvatar",
  props: {
    alt: {
      type: String,
      default: "",
    },
  },
  template: `<div class="avatar">{{ alt }}</div>`,
});

const UDropdownMenuStub = defineComponent({
  name: "UDropdownMenu",
  props: {
    items: {
      type: Array,
      default: () => [],
    },
  },
  template: `<div class="dropdown"><slot /></div>`,
});

const UButtonStub = defineComponent({
  name: "UButton",
  props: {
    label: {
      type: String,
      default: "",
    },
  },
  template: `<button>{{ label }}</button>`,
});

const members = [
  { id: "1", displayName: "Ada", avatarUrl: null },
  { id: "2", displayName: "Grace", avatarUrl: null },
  { id: "3", displayName: "Linus", avatarUrl: null },
  { id: "4", displayName: "Margaret", avatarUrl: null },
];

describe("LibraryMemberAvatars", () => {
  async function mountComponent(props?: Partial<{ maxVisible: number; compact: boolean }>) {
    return mountSuspended(LibraryMemberAvatars, {
      props: {
        members,
        ...props,
      },
      global: {
        stubs: {
          UAvatar: UAvatarStub,
          UDropdownMenu: UDropdownMenuStub,
          UButton: UButtonStub,
        },
      },
    });
  }

  it("renders all members and count by default", async () => {
    const wrapper = await mountComponent();

    expect(wrapper.findAll(".avatar")).toHaveLength(4);
    expect(wrapper.text()).toContain("4 members");
    expect(wrapper.find(".dropdown").exists()).toBe(false);
  });

  it("shows overflow dropdown when members exceed maxVisible", async () => {
    const wrapper = await mountComponent({ maxVisible: 2 });

    expect(wrapper.findAll(".avatar")).toHaveLength(2);
    expect(wrapper.find(".dropdown").exists()).toBe(true);
    expect(wrapper.text()).toContain("+2");
  });

  it("hides the member count in compact mode", async () => {
    const wrapper = await mountComponent({ compact: true });

    expect(wrapper.text()).not.toContain("members");
  });
});
