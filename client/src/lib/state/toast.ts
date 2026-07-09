import { toast as sonnerToast } from 'svelte-sonner';

/** Legacy color names accepted by call sites ported from the Nuxt `useToast`. */
export type ToastColor = 'success' | 'error' | 'warning' | 'info' | 'neutral' | 'primary';

export interface ToastOptions {
	title: string;
	description?: string;
	color?: ToastColor;
}

type SonnerMethod = 'success' | 'error' | 'warning' | 'info';

function methodFor(color: ToastColor | undefined): SonnerMethod {
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

/**
 * Imperative toast API, backed by svelte-sonner (`<Toaster>` rendered once
 * in the root layout). `add` mirrors the old `useToast().add({ title,
 * description, color })`.
 */
export const toast = {
	add(opts: ToastOptions) {
		sonnerToast[methodFor(opts.color)](opts.title, { description: opts.description });
	},
	success(title: string, description?: string) {
		sonnerToast.success(title, { description });
	},
	error(title: string, description?: string) {
		sonnerToast.error(title, { description });
	},
	warning(title: string, description?: string) {
		sonnerToast.warning(title, { description });
	},
	info(title: string, description?: string) {
		sonnerToast.info(title, { description });
	}
};
