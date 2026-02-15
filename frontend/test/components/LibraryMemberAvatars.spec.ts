import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import LibraryMemberAvatars from "~/components/LibraryMemberAvatars.vue";

const AvatarStub = defineComponent({
  name: "Avatar",
  props: {
    alt: {
      type: String,
      default: "",
    },
  },
  template: `<div class="avatar">{{ alt }}</div>`,
});

const DropdownMenuStub = defineComponent({
  name: "DropdownMenu",
  props: {
    items: {
      type: Array,
      default: () => [],
    },
  },
  template: `<div class="dropdown"><slot /></div>`,
});

const ButtonStub = defineComponent({
  name: "Button",
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
  function mountComponent(props?: Partial<{ maxVisible: number; compact: boolean }>) {
    return mount(LibraryMemberAvatars, {
      props: {
        members,
        ...props,
      },
      global: {
        stubs: {
          Avatar: AvatarStub,
          DropdownMenu: DropdownMenuStub,
          Button: ButtonStub,
        },
      },
    });
  }

  it("renders all members and count by default", () => {
    const wrapper = mountComponent();

    expect(wrapper.findAll(".avatar")).toHaveLength(4);
    expect(wrapper.text()).toContain("4 members");
    expect(wrapper.find(".dropdown").exists()).toBe(false);
  });

  it("shows overflow dropdown when members exceed maxVisible", () => {
    const wrapper = mountComponent({ maxVisible: 2 });

    expect(wrapper.findAll(".avatar")).toHaveLength(2);
    expect(wrapper.find(".dropdown").exists()).toBe(true);
    expect(wrapper.text()).toContain("+2");
  });

  it("hides the member count in compact mode", () => {
    const wrapper = mountComponent({ compact: true });

    expect(wrapper.text()).not.toContain("members");
  });
});
