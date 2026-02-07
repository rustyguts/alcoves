export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  role: string;
}

export function useAuth() {
  const { user, loggedIn, fetch: fetchSession, clear } = useUserSession();

  async function login(email: string, password: string) {
    await $fetch("/api/auth/login", {
      method: "POST",
      body: { email, password },
    });
    await fetchSession();
  }

  async function register(name: string, email: string, password: string) {
    await $fetch("/api/auth/register", {
      method: "POST",
      body: { name, email, password },
    });
    await fetchSession();
  }

  async function logout() {
    try {
      await $fetch("/api/auth/logout", { method: "POST" });
    } finally {
      await clear();
      await navigateTo("/login", { replace: true });
    }
  }

  async function updateProfile(updates: { displayName?: string }) {
    const data = await $fetch<AuthUser>("/api/auth/me", {
      method: "PATCH",
      body: updates,
    });
    await fetchSession();
    return data;
  }

  async function uploadAvatar(file: File) {
    const formData = new FormData();
    formData.append("avatar", file);

    const data = await $fetch<AuthUser>("/api/auth/me/avatar", {
      method: "POST",
      body: formData,
    });
    await fetchSession();
    return data;
  }

  return { user, loggedIn, login, register, logout, updateProfile, uploadAvatar };
}
