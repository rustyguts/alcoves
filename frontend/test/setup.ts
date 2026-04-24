import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/vue";
import { config as vtuConfig } from "@vue/test-utils";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

if (!globalThis.matchMedia) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

// Global stubs for Nuxt UI components — the Vite plugin that auto-registers
// them is not active in vitest, so we provide lightweight stand-ins so tests
// don't blow up on unresolved components. Individual tests can override.
const nuxtUiStubs = {
  UIcon: { name: "UIcon", template: "<i :data-icon='name' />", props: ["name"] },
  UButton: {
    name: "UButton",
    template:
      "<a v-if='to' :href='typeof to === \"string\" ? to : \"#\"' :data-color='color' :data-variant='variant' :data-size='size' :data-icon='icon' @click=\"$emit('click', $event)\"><slot name='leading' /><slot /><slot name='trailing' /></a><button v-else :disabled='disabled || loading' :data-color='color' :data-variant='variant' :data-size='size' :data-block='block' :data-loading='loading' :data-icon='icon' @click=\"$emit('click', $event)\"><slot name='leading' /><slot /><slot name='trailing' /></button>",
    props: [
      "color",
      "variant",
      "size",
      "icon",
      "leadingIcon",
      "trailingIcon",
      "square",
      "block",
      "loading",
      "disabled",
      "to",
      "external",
      "type",
    ],
    emits: ["click"],
  },
  UInput: {
    template:
      "<input :value='modelValue' :placeholder='placeholder' :type='type || \"text\"' :disabled='disabled' :data-icon='icon' @input=\"$emit('update:modelValue', $event.target.value)\" />",
    props: ["modelValue", "placeholder", "type", "icon", "size", "ui", "disabled", "autofocus"],
    emits: ["update:modelValue"],
  },
  UTextarea: {
    template:
      "<textarea :value='modelValue' :placeholder='placeholder' :disabled='disabled' @input=\"$emit('update:modelValue', $event.target.value)\" />",
    props: ["modelValue", "placeholder", "disabled", "rows", "size"],
    emits: ["update:modelValue"],
  },
  USelect: {
    template:
      "<select :disabled='disabled' :value='modelValue' @change=\"$emit('update:modelValue', $event.target.value)\"><option v-for='i in items' :key='typeof i === \"object\" ? i.value : i' :value='typeof i === \"object\" ? i.value : i'>{{ typeof i === \"object\" ? i.label : i }}</option></select>",
    props: ["modelValue", "items", "disabled", "size", "class"],
    emits: ["update:modelValue"],
  },
  USelectMenu: {
    template:
      "<select :disabled='disabled' :value='modelValue' @change=\"$emit('update:modelValue', $event.target.value)\"><option v-for='i in items' :key='typeof i === \"object\" ? i.value : i' :value='typeof i === \"object\" ? i.value : i'>{{ typeof i === \"object\" ? i.label : i }}</option></select>",
    props: ["modelValue", "items", "disabled", "size"],
    emits: ["update:modelValue"],
  },
  UCheckbox: {
    template:
      "<input type='checkbox' :checked='modelValue' @change=\"$emit('update:modelValue', $event.target.checked)\" />",
    props: ["modelValue", "disabled", "label"],
    emits: ["update:modelValue"],
  },
  USwitch: {
    template:
      "<input type='checkbox' role='switch' :checked='modelValue' @change=\"$emit('update:modelValue', $event.target.checked)\" />",
    props: ["modelValue", "disabled", "label"],
    emits: ["update:modelValue"],
  },
  UCard: {
    template:
      "<section class='u-card'><header v-if='$slots.header'><slot name='header'/></header><div><slot/></div><footer v-if='$slots.footer'><slot name='footer'/></footer></section>",
    props: ["ui"],
  },
  UAlert: {
    template:
      "<div class='u-alert' :data-color='color'><div v-if='title'>{{ title }}</div><div v-if='description'>{{ description }}</div><slot/></div>",
    props: ["color", "variant", "icon", "title", "description"],
  },
  UBadge: {
    template: "<span class='u-badge' :data-color='color' :data-variant='variant'><slot/></span>",
    props: ["color", "variant", "size", "icon"],
  },
  UAvatar: {
    template:
      "<div class='u-avatar'><img v-if='src' :src='src' :alt='alt' /><span v-else>{{ text }}</span></div>",
    props: ["src", "alt", "text", "size"],
  },
  USeparator: { template: "<hr class='u-separator' />", props: ["label", "orientation"] },
  USkeleton: { template: "<div class='u-skeleton' />" },
  UProgress: {
    template: "<progress :value='modelValue' :max='max' />",
    props: ["modelValue", "max", "color", "size"],
  },
  UTooltip: { template: "<div class='u-tooltip'><slot/></div>", props: ["text"] },
  UModal: {
    template:
      "<div v-if='open' class='u-modal'><header v-if='title || $slots.header'><slot name='header'>{{ title }}</slot><p v-if='description'>{{ description }}</p></header><slot name='body'/><slot/><footer v-if='$slots.footer'><slot name='footer'/></footer></div>",
    props: ["open", "title", "description", "ui"],
    emits: ["update:open"],
  },
  USlideover: {
    template: "<div v-if='open' class='u-slideover'><slot name='content'/><slot/></div>",
    props: ["open", "side", "ui"],
    emits: ["update:open"],
  },
  UDropdownMenu: {
    template: "<div class='u-dropdown'><slot/></div>",
    props: ["items", "content", "ui"],
  },
  UContextMenu: {
    template: "<div class='u-context-menu'><slot/></div>",
    props: ["items"],
  },
  UNavigationMenu: {
    template:
      "<nav class='u-nav w-full'><a v-for='i in items' :key='(i.label || i.to)' :href='typeof i.to === \"string\" ? i.to : \"#\"'>{{ i.label }}</a></nav>",
    props: ["items", "orientation", "variant"],
  },
  UTabs: {
    template:
      "<div class='u-tabs'><nav><button v-for='t in items' :key='t.value' @click=\"$emit('update:modelValue', t.value)\">{{ t.label }}</button></nav><slot/></div>",
    props: ["items", "modelValue", "defaultValue"],
    emits: ["update:modelValue"],
  },
  UForm: {
    template: "<form @submit.prevent=\"$emit('submit', $event)\"><slot/></form>",
    props: ["state", "schema"],
    emits: ["submit"],
  },
  UFormField: {
    template:
      "<div class='u-form-field'><label v-if='label'>{{ label }}</label><slot/><p v-if='error' class='u-error'>{{ error }}</p><slot name='help'/></div>",
    props: ["label", "name", "required", "error", "help"],
  },
  UTable: {
    template:
      "<table><thead><tr><th v-for='c in columns' :key='c.accessorKey || c.id'>{{ typeof c.header === 'string' ? c.header : '' }}</th></tr></thead><tbody><tr v-for='(r, i) in data' :key='i'></tr></tbody></table>",
    props: ["data", "columns"],
  },
  UApp: { template: "<div><slot/></div>" },
  // Render Teleport content inline so tests can query via wrapper.find
  Teleport: { template: "<div class='teleport-stub'><slot/></div>" },
  Transition: { template: "<div class='transition-stub'><slot/></div>" },
  TransitionGroup: { template: "<div class='transition-group-stub'><slot/></div>" },
};

// Attach a `name` to each stub so `findComponent({ name: 'UButton' })` resolves
const namedStubs = Object.fromEntries(
  Object.entries(nuxtUiStubs).map(([key, stub]) => [key, { name: key, ...stub }]),
);

vtuConfig.global.stubs = {
  ...(vtuConfig.global.stubs ?? {}),
  ...namedStubs,
};
