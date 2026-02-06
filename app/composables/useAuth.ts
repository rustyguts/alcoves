export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  role: string;
}

export function useAuth() {
  const user = useState<AuthUser | null>("auth-user", () => null);

  async function fetchUser() {
    try {
      user.value = await $fetch<AuthUser>("/api/auth/me");
    } catch {
      user.value = null;
    }
  }

  async function login(email: string, password: string) {
    const data = await $fetch<AuthUser>("/api/auth/login", {
      method: "POST",
      body: { email, password },
    });
    user.value = data;
    return data;
  }

  async function register(name: string, email: string, password: string) {
    const data = await $fetch<AuthUser>("/api/auth/register", {
      method: "POST",
      body: { name, email, password },
    });
    user.value = data;
    return data;
  }

  async function logout() {
    await $fetch("/api/auth/logout", { method: "POST" });
    user.value = null;
    await navigateTo("/login");
  }

  async function updateProfile(updates: { displayName?: string; avatarUrl?: string }) {
    const data = await $fetch<AuthUser>("/api/auth/me", {
      method: "PATCH",
      body: updates,
    });
    user.value = data;
    return data;
  }

  return { user, fetchUser, login, register, logout, updateProfile };
}
