const ownerRoutes = ["/settings"];

export default defineNuxtRouteMiddleware(async (to) => {
  const publicRoutes = ["/login", "/register"];
  if (publicRoutes.includes(to.path)) return;

  const { loggedIn, user, fetch: fetchSession } = useUserSession();

  if (!loggedIn.value) {
    await fetchSession();
  }

  if (!loggedIn.value) {
    return navigateTo({
      path: "/login",
      query: { redirect: to.fullPath },
    });
  }

  if (ownerRoutes.includes(to.path) && user.value?.role !== "owner") {
    return navigateTo("/");
  }
});
