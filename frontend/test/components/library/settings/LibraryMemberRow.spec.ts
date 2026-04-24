import { mount } from "@vue/test-utils";
import LibraryMemberRow from "~/components/library/settings/LibraryMemberRow.vue";

const stubs = {
  UserAvatar: {
    template: '<div class="avatar-stub">{{ displayName }}</div>',
    props: ["displayName", "avatarUrl", "sizeClass"],
  },
  UBadge: {
    template: '<span class="u-badge" :data-color="color"><slot /></span>',
    props: ["color", "variant", "size"],
  },
  USelect: {
    template:
      "<select :disabled='disabled' :value='modelValue' @change=\"$emit('update:modelValue', $event.target.value)\"><option v-for='i in items' :key='i.value' :value='i.value'>{{ i.label }}</option></select>",
    props: ["modelValue", "items", "disabled"],
    emits: ["update:modelValue"],
  },
  UButton: {
    template:
      "<button :disabled='disabled || loading' :data-icon='icon' :data-color='color' :data-loading='loading' @click=\"$emit('click', $event)\"><slot /></button>",
    props: ["color", "variant", "size", "icon", "square", "loading", "disabled"],
    emits: ["click"],
  },
};

const roleOptions = [
  { label: "Admin", value: "admin" as const },
  { label: "Viewer", value: "viewer" as const },
];

function createMember(overrides: Record<string, unknown> = {}) {
  return {
    id: "mem-1",
    userId: "u-1",
    role: "admin" as const,
    isOwner: false,
    createdAt: "2024-01-01T00:00:00Z",
    user: {
      id: "u-1",
      email: "alice@example.com",
      displayName: "Alice",
      avatarUrl: null,
    },
    ...overrides,
  };
}

describe("LibraryMemberRow", () => {
  function mountRow(props: Record<string, unknown> = {}) {
    return mount(LibraryMemberRow, {
      props: {
        member: createMember(),
        roleDraft: "admin" as const,
        updatingRole: false,
        removing: false,
        roleOptions,
        ...props,
      },
      global: { stubs },
    });
  }

  it("renders member display name and email", () => {
    const wrapper = mountRow();
    expect(wrapper.text()).toContain("Alice");
    expect(wrapper.text()).toContain("alice@example.com");
  });

  it("renders UserAvatar with member info", () => {
    const wrapper = mountRow();
    expect(wrapper.find(".avatar-stub").text()).toContain("Alice");
  });

  it("shows owner badge for owner role", () => {
    const wrapper = mountRow({ member: createMember({ role: "owner" }) });
    expect(wrapper.find(".u-badge").text()).toContain("owner");
  });

  it("does not show role select for owner role", () => {
    const wrapper = mountRow({ member: createMember({ role: "owner" }) });
    expect(wrapper.find("select").exists()).toBe(false);
  });

  it("shows role select for non-owner roles", () => {
    const wrapper = mountRow();
    expect(wrapper.find("select").exists()).toBe(true);
    const options = wrapper.findAll("option");
    expect(options).toHaveLength(2);
    expect(options[0]!.text()).toBe("Admin");
    expect(options[1]!.text()).toBe("Viewer");
  });

  it("emits updateRole when role select changes", async () => {
    const member = createMember();
    const wrapper = mountRow({ member });
    const select = wrapper.find("select");
    await select.setValue("viewer");
    expect(wrapper.emitted("updateRole")).toBeDefined();
  });

  it("disables role select when updatingRole is true", () => {
    const wrapper = mountRow({ updatingRole: true });
    expect(wrapper.find("select").attributes("disabled")).toBeDefined();
  });

  it("renders remove button for non-owners", () => {
    const wrapper = mountRow();
    const buttons = wrapper.findAll("button");
    expect(buttons.length).toBeGreaterThan(0);
  });

  it("does not render remove button for owners", () => {
    const wrapper = mountRow({ member: createMember({ role: "owner" }) });
    const buttons = wrapper.findAll("button");
    expect(buttons.length).toBe(0);
  });

  it("emits remove when remove button is clicked", async () => {
    const member = createMember();
    const wrapper = mountRow({ member });
    const buttons = wrapper.findAll("button");
    const removeBtn = buttons.find((b) => b.attributes("data-color") === "error");
    await removeBtn?.trigger("click");
    expect(wrapper.emitted("remove")).toBeDefined();
  });

  it("disables remove button when removing is true", () => {
    const wrapper = mountRow({ removing: true });
    const buttons = wrapper.findAll("button");
    const removeBtn = buttons.find((b) => b.attributes("data-color") === "error");
    expect(removeBtn?.attributes("disabled")).toBeDefined();
  });

  it("marks loading on remove button when removing", () => {
    const wrapper = mountRow({ removing: true });
    const buttons = wrapper.findAll("button");
    const removeBtn = buttons.find((b) => b.attributes("data-color") === "error");
    expect(removeBtn?.attributes("data-loading")).toBe("true");
  });

  it("does not mark loading when not removing", () => {
    const wrapper = mountRow({ removing: false });
    const buttons = wrapper.findAll("button");
    const removeBtn = buttons.find((b) => b.attributes("data-color") === "error");
    expect(removeBtn?.attributes("data-loading")).toBe("false");
  });
});
