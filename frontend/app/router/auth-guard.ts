import type { Router } from "vue-router";
import { useAuth } from "~/composables/useAuth";

const publicRoutes = ["/login", "/register"];
const ownerRoutes = ["/admin", "/admin/jobs", "/settings"];

export function setupAuthGuard(router: Router) {
  router.beforeEach(async (to) => {
    if (publicRoutes.includes(to.path)) return;

    const { loggedIn, user, fetchSession } = useAuth();

    if (!loggedIn.value) {
      await fetchSession();
    }

    if (!loggedIn.value) {
      return {
        path: "/login",
        query: { redirect: to.fullPath },
      };
    }

    if (ownerRoutes.includes(to.path) && user.value?.role !== "owner") {
      return "/";
    }
  });
}
