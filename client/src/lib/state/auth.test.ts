import { describe, it, expect, vi, beforeEach } from 'vitest';

const apiMock = vi.hoisted(() => ({
	auth: {
		session: vi.fn(),
		login: vi.fn(),
		register: vi.fn(),
		logout: vi.fn(),
		updateMe: vi.fn(),
		uploadAvatar: vi.fn()
	}
}));
const goto = vi.hoisted(() => vi.fn());

vi.mock('$lib/api', () => ({ api: apiMock }));
vi.mock('$app/navigation', () => ({ goto }));

import { auth } from './auth.svelte';

const USER = { id: 'u1', email: 'a@b.c', displayName: 'A', avatarUrl: null, role: 'owner' };

beforeEach(() => {
	vi.clearAllMocks();
	auth.setUser(null);
});

describe('auth store', () => {
	it('tracks loggedIn from setUser', () => {
		expect(auth.loggedIn).toBe(false);
		auth.setUser(USER);
		expect(auth.loggedIn).toBe(true);
		expect(auth.user).toEqual(USER);
	});

	it('fetchSession sets the user from the session endpoint', async () => {
		apiMock.auth.session.mockResolvedValue({ user: USER });
		await auth.fetchSession();
		expect(auth.user).toEqual(USER);
	});

	it('fetchSession clears the user when there is no session', async () => {
		auth.setUser(USER);
		apiMock.auth.session.mockResolvedValue({});
		await auth.fetchSession();
		expect(auth.user).toBeNull();
	});

	it('fetchSession swallows errors and clears the user', async () => {
		auth.setUser(USER);
		apiMock.auth.session.mockRejectedValue(new Error('down'));
		await auth.fetchSession();
		expect(auth.user).toBeNull();
	});

	it('login posts credentials then re-reads the session', async () => {
		apiMock.auth.login.mockResolvedValue(undefined);
		apiMock.auth.session.mockResolvedValue({ user: USER });
		await auth.login('a@b.c', 'pw');
		expect(apiMock.auth.login).toHaveBeenCalledWith({ email: 'a@b.c', password: 'pw' });
		expect(auth.user).toEqual(USER);
	});

	it('register posts the form then re-reads the session', async () => {
		apiMock.auth.register.mockResolvedValue(undefined);
		apiMock.auth.session.mockResolvedValue({ user: USER });
		await auth.register('A', 'a@b.c', 'pw', 'tok');
		expect(apiMock.auth.register).toHaveBeenCalledWith({
			name: 'A',
			email: 'a@b.c',
			password: 'pw',
			inviteToken: 'tok'
		});
		expect(auth.user).toEqual(USER);
	});

	it('logout clears the user and navigates to /login even if the API call fails', async () => {
		auth.setUser(USER);
		apiMock.auth.logout.mockRejectedValue(new Error('boom'));
		await auth.logout();
		expect(auth.user).toBeNull();
		expect(goto).toHaveBeenCalledWith('/login');
	});

	it('updateProfile patches then refreshes and returns the data', async () => {
		const updated = { ...USER, displayName: 'New' };
		apiMock.auth.updateMe.mockResolvedValue(updated);
		apiMock.auth.session.mockResolvedValue({ user: updated });
		const result = await auth.updateProfile({ displayName: 'New' });
		expect(apiMock.auth.updateMe).toHaveBeenCalledWith({ displayName: 'New' });
		expect(result).toEqual(updated);
		expect(auth.user).toEqual(updated);
	});

	it('uploadAvatar sends multipart form data then refreshes', async () => {
		apiMock.auth.uploadAvatar.mockResolvedValue(USER);
		apiMock.auth.session.mockResolvedValue({ user: USER });
		const file = new File(['x'], 'a.png', { type: 'image/png' });
		await auth.uploadAvatar(file);
		const sent = apiMock.auth.uploadAvatar.mock.calls[0][0] as FormData;
		expect(sent).toBeInstanceOf(FormData);
		expect(sent.get('avatar')).toBeInstanceOf(File);
	});
});
