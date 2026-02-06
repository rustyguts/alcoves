const ownerRoutes = ["/settings"];

export default defineNuxtRouteMiddleware(async (to) => {
  const publicRoutes = ["/login", "/register"];
  if (publicRoutes.includes(to.path)) return;

  const { user, fetchUser } = useAuth();

  if (!user.value) {
    await fetchUser();
  }

  if (!user.value) {
    return navigateTo("/login");
  }

  if (ownerRoutes.includes(to.path) && user.value.role !== "owner") {
    return navigateTo("/");
  }
});
