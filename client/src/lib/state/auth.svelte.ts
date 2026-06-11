import { api } from '$lib/api';
import { goto } from '$app/navigation';
import type { AuthUser } from '$lib/types/api';

/**
 * Auth store. Seeded from the root layout's server `data.user` (SSR-resolved),
 * then kept fresh client-side by the auth actions (login/register call the API
 * then re-read the session). The session itself lives in the HttpOnly cookie;
 * this store only mirrors the resolved user for reactive UI.
 */
class AuthStore {
	user = $state<AuthUser | null>(null);
	readonly loggedIn = $derived(this.user !== null);

	/** Seed/sync from server load data (called by the root layout). */
	setUser(user: AuthUser | null) {
		this.user = user;
	}

	async fetchSession() {
		try {
			const data = await api.auth.session();
			this.user = data.user ?? null;
		} catch {
			this.user = null;
		}
	}

	async login(email: string, password: string) {
		await api.auth.login({ email, password });
		await this.fetchSession();
	}

	async register(name: string, email: string, password: string, inviteToken?: string) {
		await api.auth.register({ name, email, password, inviteToken });
		await this.fetchSession();
	}

	async logout() {
		try {
			await api.auth.logout();
		} catch {
			// Best-effort: clear the local session and navigate regardless.
		}
		this.user = null;
		await goto('/login');
	}

	async updateProfile(updates: { displayName?: string }) {
		const data = await api.auth.updateMe(updates);
		await this.fetchSession();
		return data;
	}

	async uploadAvatar(file: File) {
		const formData = new FormData();
		formData.append('avatar', file);
		const data = await api.auth.uploadAvatar(formData);
		await this.fetchSession();
		return data;
	}
}

export const auth = new AuthStore();
