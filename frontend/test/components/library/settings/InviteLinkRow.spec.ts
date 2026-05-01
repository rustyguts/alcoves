import { mount } from "@vue/test-utils";
import InviteLinkRow from "~/components/library/settings/InviteLinkRow.vue";

const stubs = {
  AppIcon: { template: "<i />", props: ["name", "class"] },
  UserAvatar: { template: "<i />", props: ["displayName", "avatarUrl", "sizeClass"] },
};

function createInvite(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv-1",
    token: "abc123",
    maxUses: null,
    useCount: 3,
    expiresAt: null,
    createdAt: "2024-01-01T00:00:00Z",
    inviteUrl: "https://app.example.com/invites/abc123",
    invitedBy: { id: "u-1", displayName: "Owner", avatarUrl: null },
    uses: [],
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

  it("renders unlimited use label as plural", () => {
    const wrapper = mount(InviteLinkRow, {
      props: { invite: createInvite({ useCount: 3 }), revoking: false },
      global: { stubs },
    });
    expect(wrapper.text()).toContain("3 uses");
  });

  it("renders singular use label", () => {
    const wrapper = mount(InviteLinkRow, {
      props: { invite: createInvite({ useCount: 1 }), revoking: false },
      global: { stubs },
    });
    expect(wrapper.text()).toContain("1 use");
  });

  it("renders capped count when maxUses is set", () => {
    const wrapper = mount(InviteLinkRow, {
      props: { invite: createInvite({ useCount: 2, maxUses: 5 }), revoking: false },
      global: { stubs },
    });
    expect(wrapper.text()).toContain("2 / 5 uses");
  });

  it("flags exhausted invites", () => {
    const wrapper = mount(InviteLinkRow, {
      props: { invite: createInvite({ useCount: 5, maxUses: 5 }), revoking: false },
      global: { stubs },
    });
    expect(wrapper.text()).toContain("Exhausted");
  });

  it("renders Never expires when expiresAt is null", () => {
    const wrapper = mount(InviteLinkRow, {
      props: { invite: createInvite(), revoking: false },
      global: { stubs },
    });
    expect(wrapper.text()).toContain("Never expires");
  });

  it("emits copy with invite URL when copy button is clicked", async () => {
    const invite = createInvite();
    const wrapper = mount(InviteLinkRow, {
      props: { invite, revoking: false },
      global: { stubs },
    });
    const buttons = wrapper.findAll("button");
    // First button is the copy button (uses-toggle button only renders when uses.length > 0)
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

  it("shows Expires copy when expiresAt is set", () => {
    const wrapper = mount(InviteLinkRow, {
      props: {
        invite: createInvite({ expiresAt: "2099-12-31T00:00:00Z" }),
        revoking: false,
      },
      global: { stubs },
    });
    expect(wrapper.text()).toContain("Expires");
  });

  it("flags Expired badge when expiresAt is in the past", () => {
    const wrapper = mount(InviteLinkRow, {
      props: {
        invite: createInvite({ expiresAt: "2000-01-01T00:00:00Z" }),
        revoking: false,
      },
      global: { stubs },
    });
    expect(wrapper.text()).toContain("Expired");
  });

  it("renders use rows when expanded", async () => {
    const invite = createInvite({
      uses: [
        {
          usedAt: "2025-06-01T00:00:00Z",
          user: {
            id: "u-2",
            email: "joiner@example.com",
            displayName: "Joiner",
            avatarUrl: null,
          },
        },
      ],
    });
    const wrapper = mount(InviteLinkRow, {
      props: { invite, revoking: false },
      global: { stubs },
    });

    // First button is the toggle (renders only when uses.length > 0).
    const toggle = wrapper.findAll("button")[0]!;
    await toggle.trigger("click");

    expect(wrapper.text()).toContain("Joiner");
    expect(wrapper.text()).toContain("joiner@example.com");
  });
});
