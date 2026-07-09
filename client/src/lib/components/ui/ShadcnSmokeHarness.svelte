<script lang="ts">
	/**
	 * ShadcnSmokeHarness — mounts a minimal, valid composition of every
	 * vendored shadcn-svelte primitive in one tree. Used ONLY by
	 * shadcn-smoke.svelte.test.ts to catch Svelte 5 / SSR-breakage
	 * regressions in the vendored registry code cheaply, without needing a
	 * bespoke test per primitive. Not imported by app code.
	 */
	import * as Alert from '$lib/components/ui/alert/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import * as Avatar from '$lib/components/ui/avatar/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Breadcrumb from '$lib/components/ui/breadcrumb/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as ButtonGroup from '$lib/components/ui/button-group/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Collapsible from '$lib/components/ui/collapsible/index.js';
	import * as Command from '$lib/components/ui/command/index.js';
	import * as ContextMenu from '$lib/components/ui/context-menu/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as Empty from '$lib/components/ui/empty/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as InputGroup from '$lib/components/ui/input-group/index.js';
	import * as Item from '$lib/components/ui/item/index.js';
	import * as Kbd from '$lib/components/ui/kbd/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { Progress } from '$lib/components/ui/progress/index.js';
	import * as RadioGroup from '$lib/components/ui/radio-group/index.js';
	import * as ScrollArea from '$lib/components/ui/scroll-area/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Separator from '$lib/components/ui/separator/index.js';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { Slider } from '$lib/components/ui/slider/index.js';
	import { Toaster } from '$lib/components/ui/sonner/index.js';
	import { Spinner } from '$lib/components/ui/spinner/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { Toggle } from '$lib/components/ui/toggle/index.js';
	import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
</script>

<div data-testid="shadcn-smoke-harness">
	<Button>Button</Button>
	<Badge>Badge</Badge>
	<Input placeholder="Input" />
	<Textarea placeholder="Textarea" />
	<Label for="smoke-input">Label</Label>
	<Separator.Root />
	<Skeleton class="h-4 w-full" />
	<Switch />
	<Checkbox />
	<Progress value={50} />
	<Spinner />
	<Kbd.Root>K</Kbd.Root>
	<Toggle>Toggle</Toggle>

	<RadioGroup.Root value="a">
		<RadioGroup.Item value="a" id="smoke-radio-a" />
	</RadioGroup.Root>

	<ToggleGroup.Root type="single" value="a">
		<ToggleGroup.Item value="a">A</ToggleGroup.Item>
	</ToggleGroup.Root>

	<Slider type="single" value={50} />

	<ScrollArea.Root class="h-10">Scrollable content</ScrollArea.Root>

	<Collapsible.Root>
		<Collapsible.Trigger>Toggle</Collapsible.Trigger>
		<Collapsible.Content>Collapsible content</Collapsible.Content>
	</Collapsible.Root>

	<Alert.Root>
		<Alert.Title>Alert title</Alert.Title>
		<Alert.Description>Alert description</Alert.Description>
	</Alert.Root>

	<Avatar.Root>
		<Avatar.Fallback>AB</Avatar.Fallback>
	</Avatar.Root>

	<Breadcrumb.Root>
		<Breadcrumb.List>
			<Breadcrumb.Item>
				<Breadcrumb.Page>Home</Breadcrumb.Page>
			</Breadcrumb.Item>
		</Breadcrumb.List>
	</Breadcrumb.Root>

	<ButtonGroup.Root>
		<Button>One</Button>
		<Button>Two</Button>
	</ButtonGroup.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title>Card title</Card.Title>
			<Card.Description>Card description</Card.Description>
		</Card.Header>
		<Card.Content>Card content</Card.Content>
		<Card.Footer>Card footer</Card.Footer>
	</Card.Root>

	<Empty.Root>
		<Empty.Header>
			<Empty.Title>Nothing here</Empty.Title>
			<Empty.Description>Empty description</Empty.Description>
		</Empty.Header>
	</Empty.Root>

	<Field.Field>
		<Field.Label for="smoke-field-input">Field label</Field.Label>
		<Input id="smoke-field-input" />
		<Field.Description>Field description</Field.Description>
	</Field.Field>

	<InputGroup.Root>
		<InputGroup.Input placeholder="Input group" />
		<InputGroup.Text>Suffix</InputGroup.Text>
	</InputGroup.Root>

	<Item.Root>
		<Item.Content>
			<Item.Title>Item title</Item.Title>
			<Item.Description>Item description</Item.Description>
		</Item.Content>
	</Item.Root>

	<Table.Root>
		<Table.Header>
			<Table.Row>
				<Table.Head>Column</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			<Table.Row>
				<Table.Cell>Value</Table.Cell>
			</Table.Row>
		</Table.Body>
	</Table.Root>

	<Tabs.Root value="a">
		<Tabs.List>
			<Tabs.Trigger value="a">Tab A</Tabs.Trigger>
		</Tabs.List>
		<Tabs.Content value="a">Tab A content</Tabs.Content>
	</Tabs.Root>

	<Dialog.Root open>
		<Dialog.Trigger>Open dialog</Dialog.Trigger>
		<Dialog.Content>
			<Dialog.Title>Dialog title</Dialog.Title>
			<Dialog.Description>Dialog description</Dialog.Description>
		</Dialog.Content>
	</Dialog.Root>

	<AlertDialog.Root open>
		<AlertDialog.Trigger>Open alert dialog</AlertDialog.Trigger>
		<AlertDialog.Content>
			<AlertDialog.Title>Confirm smoke action</AlertDialog.Title>
			<AlertDialog.Description>Alert dialog description</AlertDialog.Description>
			<AlertDialog.Action>OK</AlertDialog.Action>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
		</AlertDialog.Content>
	</AlertDialog.Root>

	<Sheet.Root open>
		<Sheet.Trigger>Open sheet</Sheet.Trigger>
		<Sheet.Content>
			<Sheet.Title>Sheet title</Sheet.Title>
			<Sheet.Description>Sheet description</Sheet.Description>
		</Sheet.Content>
	</Sheet.Root>

	<Popover.Root open>
		<Popover.Trigger>Open popover</Popover.Trigger>
		<Popover.Content>Popover content</Popover.Content>
	</Popover.Root>

	<Tooltip.Provider>
		<Tooltip.Root open>
			<Tooltip.Trigger>Hover me</Tooltip.Trigger>
			<Tooltip.Content>Tooltip content</Tooltip.Content>
		</Tooltip.Root>
	</Tooltip.Provider>

	<DropdownMenu.Root open>
		<DropdownMenu.Trigger>Open menu</DropdownMenu.Trigger>
		<DropdownMenu.Content>
			<DropdownMenu.Item>Item</DropdownMenu.Item>
		</DropdownMenu.Content>
	</DropdownMenu.Root>

	<ContextMenu.Root>
		<ContextMenu.Trigger>Right-click me</ContextMenu.Trigger>
		<ContextMenu.Content>
			<ContextMenu.Item>Item</ContextMenu.Item>
		</ContextMenu.Content>
	</ContextMenu.Root>

	<Select.Root type="single" open value="a">
		<Select.Trigger>Select</Select.Trigger>
		<Select.Content>
			<Select.Item value="a" label="Option A" />
		</Select.Content>
	</Select.Root>

	<Command.Root>
		<Command.Input placeholder="Search" />
		<Command.List>
			<Command.Empty>No results</Command.Empty>
			<Command.Group heading="Group">
				<Command.Item>Command item</Command.Item>
			</Command.Group>
		</Command.List>
	</Command.Root>

	<Sidebar.Provider>
		<Sidebar.Root>
			<Sidebar.Header>Header</Sidebar.Header>
			<Sidebar.Content>
				<Sidebar.Menu>
					<Sidebar.MenuItem>
						<Sidebar.MenuButton>Menu item</Sidebar.MenuButton>
					</Sidebar.MenuItem>
				</Sidebar.Menu>
			</Sidebar.Content>
			<Sidebar.Footer>Footer</Sidebar.Footer>
		</Sidebar.Root>
		<Sidebar.Inset>
			<Sidebar.Trigger />
			Inset content
		</Sidebar.Inset>
	</Sidebar.Provider>

	<Toaster />
</div>
