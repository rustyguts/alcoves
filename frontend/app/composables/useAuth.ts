import { api } from "~/api";
import type { AuthUser } from "~~/shared/types/api";

export type { AuthUser };

export function useAuth() {
  const user = useState<AuthUser | null>("auth:user", () => null);
  const router = useRouter();

  const loggedIn = computed(() => !!user.value);

  async function fetchSession() {
    try {
      const data = await api.auth.session();
      user.value = data.user || null;
    } catch {
      user.value = null;
    }
  }

  function clearSession() {
    user.value = null;
  }

  async function login(email: string, password: string) {
    await api.auth.login({ email, password });
    await fetchSession();
  }

  async function register(name: string, email: string, password: string, inviteToken?: string) {
    await api.auth.register({ name, email, password, inviteToken });
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
    user: computed(() => user.value),
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
