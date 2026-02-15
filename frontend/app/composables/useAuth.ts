import { ref, computed } from "vue";
import { useRouter } from "vue-router";
import { apiFetch } from "~/utils/api-fetch";

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  role: string;
}

interface AuthState {
  user: AuthUser | null;
}

const authState = ref<AuthState>({ user: null });

export function useAuth() {
  const router = useRouter();

  const user = computed(() => authState.value.user);
  const loggedIn = computed(() => !!authState.value.user);

  async function fetchSession() {
    try {
      const data = await apiFetch<{ user?: AuthUser }>("/api/_auth/session");
      authState.value.user = data.user || null;
    } catch {
      authState.value.user = null;
    }
  }

  function clearSession() {
    authState.value.user = null;
  }

  async function login(email: string, password: string) {
    await apiFetch("/api/auth/login", {
      method: "POST",
      body: { email, password },
    });
    await fetchSession();
  }

  async function register(name: string, email: string, password: string) {
    await apiFetch("/api/auth/register", {
      method: "POST",
      body: { name, email, password },
    });
    await fetchSession();
  }

  async function logout() {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } finally {
      clearSession();
      router.replace("/login");
    }
  }

  async function updateProfile(updates: { displayName?: string }) {
    const data = await apiFetch<AuthUser>("/api/auth/me", {
      method: "PATCH",
      body: updates,
    });
    await fetchSession();
    return data;
  }

  async function uploadAvatar(file: File) {
    const formData = new FormData();
    formData.append("avatar", file);

    const data = await apiFetch<AuthUser>("/api/auth/me/avatar", {
      method: "POST",
      body: formData,
    });
    await fetchSession();
    return data;
  }

  return { user, loggedIn, login, register, logout, updateProfile, uploadAvatar, fetchSession, clearSession };
}
