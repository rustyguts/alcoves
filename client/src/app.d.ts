// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { AuthUser } from '$lib/types/api';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			/** Resolved once per request in hooks.server.ts; null when anonymous. */
			user: AuthUser | null;
		}
		interface PageData {
			user?: AuthUser | null;
		}
		// interface PageState {}
		// interface Platform {}
	}

	interface Window {
		/** Set true in the root layout onMount; releases the pre-hydration form guard. */
		__alcovesReady?: boolean;
		__alcovesReleaseFormGuard?: () => void;
	}
}

export {};
