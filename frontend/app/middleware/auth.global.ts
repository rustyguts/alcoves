const publicRoutes = ["/login", "/register"];
const ownerRoutes = ["/admin", "/admin/jobs"];

export default defineNuxtRouteMiddleware(async (to) => {
  if (publicRoutes.includes(to.path)) return;
  if (to.path.startsWith("/s/")) return;
  if (to.path.startsWith("/invites/")) return;

  const { loggedIn, user, fetchSession } = useAuth();

  if (!loggedIn.value) {
    await fetchSession();
  }

  if (!loggedIn.value) {
    return navigateTo({ path: "/login", query: { redirect: to.fullPath } });
  }

  if (ownerRoutes.includes(to.path) && user.value?.role !== "owner") {
    return navigateTo("/");
  }
});
