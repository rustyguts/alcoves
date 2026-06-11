// Single source of truth for every icon used in the app.
//
// Keys are *semantic UI roles*, not glyph names — so a future glyph change
// happens here once instead of being hunted across hundreds of call sites.
//
// Values are @iconify/svelte references (`lineicons:<glyph>`) rendered via
// `<Icon icon={ICONS.close} />` from `@iconify/svelte`. The glyph set ships
// offline through `@iconify-json/lineicons`. Every value is validated against
// the installed set by icons.test.ts.
export const ICONS = {
	// — Navigation & chrome —
	back: 'lineicons:arrow-left',
	arrowRight: 'lineicons:arrow-right',
	arrowDown: 'lineicons:arrow-down',
	arrowUp: 'lineicons:arrow-up',
	chevronDown: 'lineicons:chevron-down',
	chevronUp: 'lineicons:chevron-up',
	chevronLeft: 'lineicons:chevron-left',
	chevronRight: 'lineicons:chevron-right',
	menu: 'lineicons:menu',
	ellipsis: 'lineicons:menu-meatballs-1',
	drag: 'lineicons:menu-meatballs-1', // no grip glyph in Lineicons
	close: 'lineicons:xmark', // was `x` (Twitter/X brand logo)
	dropdownCaret: 'lineicons:chevron-down', // was `sort-high-to-low`
	plus: 'lineicons:plus',
	minus: 'lineicons:minus',
	check: 'lineicons:check',
	reload: 'lineicons:reload',
	search: 'lineicons:search',

	// — Status & feedback —
	loading: 'lineicons:spinner-solid',
	success: 'lineicons:check-circle-1',
	error: 'lineicons:xmark-circle',
	warning: 'lineicons:warning',
	info: 'lineicons:info',
	help: 'lineicons:question-circle',
	live: 'lineicons:radio-button',
	radioButton: 'lineicons:radio-button',
	disconnected: 'lineicons:cross-circle',
	momentReady: 'lineicons:checkmark-circle',

	// — Theme —
	light: 'lineicons:sun',
	dark: 'lineicons:night',
	system: 'lineicons:monitor',
	tip: 'lineicons:bulb',

	// — Files & media —
	file: 'lineicons:empty-file',
	files: 'lineicons:files',
	folder: 'lineicons:folder',
	folderOpen: 'lineicons:folder',
	zip: 'lineicons:file-format-zip',
	presentation: 'lineicons:blackboard', // was `image` for pptx
	image: 'lineicons:image',
	video: 'lineicons:video',
	movie: 'lineicons:camera-movie-1',
	music: 'lineicons:music',
	camera: 'lineicons:camera',
	play: 'lineicons:play',
	stop: 'lineicons:stop',
	download: 'lineicons:download',
	upload: 'lineicons:upload',
	cloudUpload: 'lineicons:cloud-upload',
	listView: 'lineicons:list',
	gridView: 'lineicons:grid',
	edit: 'lineicons:pencil',
	trash: 'lineicons:trash-can',
	restore: 'lineicons:reload', // was `reply`
	move: 'lineicons:move', // was `folder`
	duplicate: 'lineicons:files', // was `clipboard`
	copy: 'lineicons:clipboard',
	tag: 'lineicons:tag',

	// — Library & feature nav —
	library: 'lineicons:library',
	timeline: 'lineicons:calendar-days', // was `alarm-clock`
	location: 'lineicons:map-marker',
	feed: 'lineicons:rss-feed',
	settings: 'lineicons:cog',
	models: 'lineicons:gears-3',
	storage: 'lineicons:harddrive',
	admin: 'lineicons:shield-2-check',

	// — People —
	people: 'lineicons:users', // was `id-card`
	members: 'lineicons:users',
	person: 'lineicons:user-4',
	user: 'lineicons:user',
	mergePeople: 'lineicons:git', // was `link`

	// — AI / editor —
	objectDetection: 'lineicons:crop-2', // was `magnifier`
	transcript: 'lineicons:comment-1-text',
	audioDetect: 'lineicons:volume-high', // was `pulse`
	waveform: 'lineicons:pulse',
	highlights: 'lineicons:star-fat',
	loadPresets: 'lineicons:bookmark', // was `brush`
	snapToPlayhead: 'lineicons:target',
	keyboard: 'lineicons:keyboard',
	save: 'lineicons:save',

	// — Editor transport & timeline —
	pause: 'lineicons:pause',
	split: 'lineicons:scissors-1-vertical',
	snap: 'lineicons:magnet',
	zoomIn: 'lineicons:zoom-in',
	zoomOut: 'lineicons:zoom-out',
	zoomFit: 'lineicons:frame-expand',
	loop: 'lineicons:reload', // no dedicated repeat glyph in Lineicons
	jumpBack: 'lineicons:angle-double-left',
	jumpForward: 'lineicons:angle-double-right',
	volumeOn: 'lineicons:volume-high',
	volumeOff: 'lineicons:volume-mute',
	fullscreen: 'lineicons:full-screen',
	marker: 'lineicons:flag',

	// — Notifications & activity —
	bell: 'lineicons:bell-1',
	fileCreated: 'lineicons:file-plus-circle',
	folderDeleted: 'lineicons:trash-can', // was `folder`

	// — Forms / auth / sharing —
	email: 'lineicons:envelope',
	lock: 'lineicons:lock',
	key: 'lineicons:key',
	appearance: 'lineicons:colour-palette-3',
	shield: 'lineicons:shield-2',
	link: 'lineicons:link',
	external: 'lineicons:arrow-top-right', // was `link`
	hash: 'lineicons:link', // no `#` glyph in Lineicons
	share: 'lineicons:share-2',
	emoji: 'lineicons:emoji-smile',
	signOut: 'lineicons:exit',

	// — Show / hide (no eye-slash glyph in Lineicons) —
	eye: 'lineicons:eye',
	eyeOff: 'lineicons:eye',

	// — Admin job queue —
	jobFace: 'lineicons:users', // was `id-card`
	jobVideo: 'lineicons:video',
	jobThumbnail: 'lineicons:image',
	jobDefault: 'lineicons:layers',
	stateActive: 'lineicons:play',
	stateWaiting: 'lineicons:alarm-clock',
	stateFailed: 'lineicons:xmark-circle',
	stateDelayed: 'lineicons:timer',
	stateCompleted: 'lineicons:check-circle-1',
	stateUnknown: 'lineicons:radio-button',
	retry: 'lineicons:reload',
	emptyQueue: 'lineicons:inbox'
} as const;

export type IconKey = keyof typeof ICONS;
