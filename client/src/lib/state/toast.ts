import { createToaster } from '@skeletonlabs/skeleton-svelte';

/**
 * App-wide Skeleton toaster singleton. Rendered ONCE via `<Toast.Group {toaster}>`
 * in the root layout, and triggered from anywhere through the `toast` helpers.
 */
export const toaster = createToaster({ placement: 'bottom-end' });

/** Legacy color names accepted by call sites ported from the Nuxt `useToast`. */
export type ToastColor = 'success' | 'error' | 'warning' | 'info' | 'neutral' | 'primary';

export interface ToastOptions {
	title: string;
	description?: string;
	color?: ToastColor;
}

type ToasterMethod = 'success' | 'error' | 'warning' | 'info';

function methodFor(color: ToastColor | undefined): ToasterMethod {
	switch (color) {
		case 'success':
		case 'error':
		case 'warning':
			return color;
		default:
			// info / neutral / primary / undefined all map to the neutral "info" toast.
			return 'info';
	}
}

/** Imperative toast API. `add` mirrors the old `useToast().add({ title, description, color })`. */
export const toast = {
	add(opts: ToastOptions) {
		toaster[methodFor(opts.color)]({ title: opts.title, description: opts.description });
	},
	success(title: string, description?: string) {
		toaster.success({ title, description });
	},
	error(title: string, description?: string) {
		toaster.error({ title, description });
	},
	warning(title: string, description?: string) {
		toaster.warning({ title, description });
	},
	info(title: string, description?: string) {
		toaster.info({ title, description });
	}
};
