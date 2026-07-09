<script lang="ts">
	/**
	 * CheckedStateHarness — mounts the state-variant-styled primitives
	 * (Checkbox, RadioGroup, FieldLabel-wrapping-a-Checkbox, Tabs, Slider,
	 * an open Dialog) in their meaningful states. Used ONLY by
	 * checked-state.svelte.test.ts, the computed-style regression net for the
	 * dead-variant family of bugs: registry classes targeting bare
	 * `data-checked:`/`data-active:`/`data-open:`/`data-vertical:` attributes
	 * that the installed bits-ui 2.18.x never emits (it emits
	 * `data-state="…"` / `data-orientation="…"` instead — see the deviation
	 * comments in ui/switch/switch.svelte and the other edited primitives).
	 * Not imported by app code.
	 */
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as RadioGroup from '$lib/components/ui/radio-group/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Slider } from '$lib/components/ui/slider/index.js';
	import * as ScrollArea from '$lib/components/ui/scroll-area/index.js';
</script>

<div data-testid="checkbox-checked"><Checkbox checked={true} /></div>
<div data-testid="checkbox-unchecked"><Checkbox checked={false} /></div>

<RadioGroup.Root value="a">
	<div data-testid="radio-checked"><RadioGroup.Item value="a" /></div>
	<div data-testid="radio-unchecked"><RadioGroup.Item value="b" /></div>
</RadioGroup.Root>

<div data-testid="field-label-checked">
	<Field.Label>
		<Checkbox checked={true} />
		Checked choice card
	</Field.Label>
</div>
<div data-testid="field-label-unchecked">
	<Field.Label>
		<Checkbox checked={false} />
		Unchecked choice card
	</Field.Label>
</div>

<div data-testid="tabs">
	<Tabs.Root value="a">
		<Tabs.List>
			<Tabs.Trigger value="a">Active tab</Tabs.Trigger>
			<Tabs.Trigger value="b">Inactive tab</Tabs.Trigger>
		</Tabs.List>
		<Tabs.Content value="a">Tab A content</Tabs.Content>
	</Tabs.Root>
</div>

<div data-testid="slider" style="width: 200px">
	<Slider type="single" value={50} />
</div>

<!-- type="always" keeps the scrollbar mounted (default hover-type unmounts it
     while idle), so the orientation-gated width classes are assertable. -->
<div data-testid="scroll-area" style="height: 80px; width: 200px">
	<ScrollArea.Root type="always" class="h-full w-full">
		<div style="height: 400px">Tall content forcing vertical overflow</div>
	</ScrollArea.Root>
</div>

<Dialog.Root open>
	<Dialog.Content>
		<Dialog.Title>Harness dialog</Dialog.Title>
		<Dialog.Description>Animation probe</Dialog.Description>
	</Dialog.Content>
</Dialog.Root>
