import type { AuthUser, Library } from '$lib/types/api';

/**
 * Whether the current user can manage (admin) a library: they own it, or their
 * per-library role is owner/admin. Mirrors the Nuxt layout's `canManageLibrary`.
 */
export function canManageLibrary(
	library: Library | null | undefined,
	user: Pick<AuthUser, 'id'> | null | undefined
): boolean {
	if (!library || !user) return false;
	if (library.ownerId && library.ownerId === user.id) return true;
	return library.currentUserRole === 'owner' || library.currentUserRole === 'admin';
}

/** Whether the user is the instance owner (admin-panel access). */
export function isInstanceOwner(user: Pick<AuthUser, 'role'> | null | undefined): boolean {
	return user?.role === 'owner';
}
