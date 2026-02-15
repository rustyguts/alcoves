import { mount } from "@vue/test-utils";
import LibraryMemberAvatars from "~/components/LibraryMemberAvatars.vue";

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
    });
  }

  it("renders all members and count by default", () => {
    const wrapper = mountComponent();

    // Each visible member renders a .rounded-full div
    expect(wrapper.findAll(".rounded-full")).toHaveLength(4);
    expect(wrapper.text()).toContain("4 members");
    // No overflow dropdown when all fit (maxVisible defaults to 5)
    expect(wrapper.find("details.dropdown").exists()).toBe(false);
  });

  it("shows overflow dropdown when members exceed maxVisible", () => {
    const wrapper = mountComponent({ maxVisible: 2 });

    // Only 2 visible member avatars in the avatar stack (not counting dropdown avatars)
    const avatarStack = wrapper.find(".-space-x-2");
    expect(avatarStack.findAll(".rounded-full")).toHaveLength(2);
    expect(wrapper.find("details.dropdown").exists()).toBe(true);
    expect(wrapper.text()).toContain("+2");
  });

  it("hides the member count in compact mode", () => {
    const wrapper = mountComponent({ compact: true });

    expect(wrapper.text()).not.toContain("members");
  });
});
