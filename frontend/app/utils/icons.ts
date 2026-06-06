// Single source of truth for every icon used in the app.
//
// Keys are *semantic UI roles*, not glyph names — so a future glyph change
// happens here once instead of being hunted across hundreds of call sites.
// (That scattering is exactly how `i-lineicons-x`, the Twitter/X brand logo,
// ended up as the Close button.) See docs/internal/icon-audit.md for the
// rationale behind each pick and the full re-audit against the Lineicons set.
//
// `ICONS` is auto-imported (nuxt.config `imports.dirs` includes `utils/**`),
// so templates and scripts can reference `ICONS.close` without importing it.
export const ICONS = {
	// — Navigation & chrome —
	back: "i-lineicons-arrow-left",
	arrowRight: "i-lineicons-arrow-right",
	arrowDown: "i-lineicons-arrow-down",
	arrowUp: "i-lineicons-arrow-up",
	chevronDown: "i-lineicons-chevron-down",
	chevronUp: "i-lineicons-chevron-up",
	chevronLeft: "i-lineicons-chevron-left",
	chevronRight: "i-lineicons-chevron-right",
	menu: "i-lineicons-menu",
	ellipsis: "i-lineicons-menu-meatballs-1",
	drag: "i-lineicons-menu-meatballs-1", // no grip glyph in Lineicons
	close: "i-lineicons-xmark", // was `x` (Twitter/X brand logo)
	dropdownCaret: "i-lineicons-chevron-down", // was `sort-high-to-low`
	plus: "i-lineicons-plus",
	minus: "i-lineicons-minus",
	check: "i-lineicons-check",
	reload: "i-lineicons-reload",
	search: "i-lineicons-search",

	// — Status & feedback —
	loading: "i-lineicons-spinner-solid",
	success: "i-lineicons-check-circle-1",
	error: "i-lineicons-xmark-circle",
	warning: "i-lineicons-warning",
	info: "i-lineicons-info",
	help: "i-lineicons-question-circle",
	live: "i-lineicons-radio-button",
	radioButton: "i-lineicons-radio-button",
	disconnected: "i-lineicons-cross-circle",
	momentReady: "i-lineicons-checkmark-circle",

	// — Theme —
	light: "i-lineicons-sun",
	dark: "i-lineicons-night",
	system: "i-lineicons-monitor",
	tip: "i-lineicons-bulb",

	// — Files & media —
	file: "i-lineicons-empty-file",
	files: "i-lineicons-files",
	folder: "i-lineicons-folder",
	folderOpen: "i-lineicons-folder",
	zip: "i-lineicons-file-format-zip",
	presentation: "i-lineicons-blackboard", // was `image` for pptx
	image: "i-lineicons-image",
	video: "i-lineicons-video",
	movie: "i-lineicons-camera-movie-1",
	music: "i-lineicons-music",
	camera: "i-lineicons-camera",
	play: "i-lineicons-play",
	stop: "i-lineicons-stop",
	download: "i-lineicons-download",
	upload: "i-lineicons-upload",
	cloudUpload: "i-lineicons-cloud-upload",
	listView: "i-lineicons-list",
	gridView: "i-lineicons-grid",
	edit: "i-lineicons-pencil",
	trash: "i-lineicons-trash-can",
	restore: "i-lineicons-reload", // was `reply`
	move: "i-lineicons-move", // was `folder`
	duplicate: "i-lineicons-files", // was `clipboard`
	copy: "i-lineicons-clipboard",
	tag: "i-lineicons-tag",

	// — Library & feature nav —
	library: "i-lineicons-library",
	timeline: "i-lineicons-calendar-days", // was `alarm-clock`
	location: "i-lineicons-map-marker",
	feed: "i-lineicons-rss-feed",
	settings: "i-lineicons-cog",
	models: "i-lineicons-gears-3",
	storage: "i-lineicons-harddrive",
	admin: "i-lineicons-shield-2-check",

	// — People —
	people: "i-lineicons-users", // was `id-card`
	members: "i-lineicons-users",
	person: "i-lineicons-user-4",
	user: "i-lineicons-user",
	mergePeople: "i-lineicons-git", // was `link`

	// — AI / editor —
	objectDetection: "i-lineicons-crop-2", // was `magnifier`
	transcript: "i-lineicons-comment-1-text",
	audioDetect: "i-lineicons-volume-high", // was `pulse`
	waveform: "i-lineicons-pulse",
	highlights: "i-lineicons-star-fat",
	loadPresets: "i-lineicons-bookmark", // was `brush`
	snapToPlayhead: "i-lineicons-target",
	keyboard: "i-lineicons-keyboard",
	save: "i-lineicons-save",

	// — Notifications & activity —
	bell: "i-lineicons-bell-1",
	fileCreated: "i-lineicons-file-plus-circle",
	folderDeleted: "i-lineicons-trash-can", // was `folder`

	// — Forms / auth / sharing —
	email: "i-lineicons-envelope",
	lock: "i-lineicons-lock",
	key: "i-lineicons-key",
	appearance: "i-lineicons-colour-palette-3",
	shield: "i-lineicons-shield-2",
	link: "i-lineicons-link",
	external: "i-lineicons-arrow-top-right", // was `link`
	hash: "i-lineicons-link", // no `#` glyph in Lineicons
	share: "i-lineicons-share-2",
	emoji: "i-lineicons-emoji-smile",
	signOut: "i-lineicons-exit",

	// — Show / hide (no eye-slash glyph in Lineicons) —
	eye: "i-lineicons-eye",
	eyeOff: "i-lineicons-eye",

	// — Admin job queue —
	jobFace: "i-lineicons-users", // was `id-card`
	jobVideo: "i-lineicons-video",
	jobThumbnail: "i-lineicons-image",
	jobDefault: "i-lineicons-layers",
	stateActive: "i-lineicons-play",
	stateWaiting: "i-lineicons-alarm-clock",
	stateFailed: "i-lineicons-xmark-circle",
	stateDelayed: "i-lineicons-timer",
	stateCompleted: "i-lineicons-check-circle-1",
	stateUnknown: "i-lineicons-radio-button",
	retry: "i-lineicons-reload",
	emptyQueue: "i-lineicons-inbox",
} as const;

export type IconKey = keyof typeof ICONS;
