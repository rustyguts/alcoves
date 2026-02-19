import { mount } from "@vue/test-utils";
import InviteLinkRow from "~/components/library/settings/InviteLinkRow.vue";

const stubs = {
  AppIcon: { template: "<i />", props: ["name", "class"] },
};

function createInvite(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv-1",
    invitedEmail: null,
    role: "viewer" as const,
    useCount: 3,
    createdAt: "2024-01-01T00:00:00Z",
    inviteUrl: "https://app.example.com/invites/abc123",
    invitedBy: { id: "u-1", email: "owner@example.com", displayName: "Owner" },
    ...overrides,
  };
}

describe("InviteLinkRow", () => {
  it("renders invite URL", () => {
    const wrapper = mount(InviteLinkRow, {
      props: { invite: createInvite(), revoking: false },
      global: { stubs },
    });
    expect(wrapper.text()).toContain("https://app.example.com/invites/abc123");
  });

  it("renders use count with plural form", () => {
    const wrapper = mount(InviteLinkRow, {
      props: { invite: createInvite({ useCount: 3 }), revoking: false },
      global: { stubs },
    });
    expect(wrapper.text()).toContain("Used 3 times");
  });

  it("renders use count with singular form", () => {
    const wrapper = mount(InviteLinkRow, {
      props: { invite: createInvite({ useCount: 1 }), revoking: false },
      global: { stubs },
    });
    expect(wrapper.text()).toContain("Used 1 time");
  });

  it("renders zero use count", () => {
    const wrapper = mount(InviteLinkRow, {
      props: { invite: createInvite({ useCount: 0 }), revoking: false },
      global: { stubs },
    });
    expect(wrapper.text()).toContain("Used 0 times");
  });

  it("emits copy with invite URL when copy button is clicked", async () => {
    const invite = createInvite();
    const wrapper = mount(InviteLinkRow, {
      props: { invite, revoking: false },
      global: { stubs },
    });
    const buttons = wrapper.findAll("button");
    await buttons[0]!.trigger("click");
    expect(wrapper.emitted("copy")![0]).toEqual(["https://app.example.com/invites/abc123"]);
  });

  it("emits revoke with invite ID when revoke button is clicked", async () => {
    const invite = createInvite();
    const wrapper = mount(InviteLinkRow, {
      props: { invite, revoking: false },
      global: { stubs },
    });
    const buttons = wrapper.findAll("button");
    const revokeBtn = buttons[buttons.length - 1]!;
    await revokeBtn.trigger("click");
    expect(wrapper.emitted("revoke")![0]).toEqual(["inv-1"]);
  });

  it("disables revoke button when revoking", () => {
    const wrapper = mount(InviteLinkRow, {
      props: { invite: createInvite(), revoking: true },
      global: { stubs },
    });
    const buttons = wrapper.findAll("button");
    const revokeBtn = buttons[buttons.length - 1]!;
    expect(revokeBtn.attributes("disabled")).toBeDefined();
  });

  it("shows loading spinner when revoking", () => {
    const wrapper = mount(InviteLinkRow, {
      props: { invite: createInvite(), revoking: true },
      global: { stubs },
    });
    expect(wrapper.find(".loading").exists()).toBe(true);
  });

  it("does not show loading spinner when not revoking", () => {
    const wrapper = mount(InviteLinkRow, {
      props: { invite: createInvite(), revoking: false },
      global: { stubs },
    });
    expect(wrapper.find(".loading").exists()).toBe(false);
  });
});
