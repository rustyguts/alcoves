import { ref, computed } from "vue";
import { useRouter } from "vue-router";
import { api } from "~/api";
import type { AuthUser } from "~~/shared/types/api";

export type { AuthUser };

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
      const data = await api.auth.session();
      authState.value.user = data.user || null;
    } catch {
      authState.value.user = null;
    }
  }

  function clearSession() {
    authState.value.user = null;
  }

  async function login(email: string, password: string) {
    await api.auth.login({ email, password });
    await fetchSession();
  }

  async function register(name: string, email: string, password: string) {
    await api.auth.register({ name, email, password });
    await fetchSession();
  }

  async function logout() {
    try {
      await api.auth.logout();
    } finally {
      clearSession();
      router.replace("/login");
    }
  }

  async function updateProfile(updates: { displayName?: string }) {
    const data = await api.auth.updateMe(updates);
    await fetchSession();
    return data;
  }

  async function uploadAvatar(file: File) {
    const formData = new FormData();
    formData.append("avatar", file);

    const data = await api.auth.uploadAvatar(formData);
    await fetchSession();
    return data;
  }

  return {
    user,
    loggedIn,
    login,
    register,
    logout,
    updateProfile,
    uploadAvatar,
    fetchSession,
    clearSession,
  };
}
