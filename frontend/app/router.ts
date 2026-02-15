import { createRouter, createWebHistory } from "vue-router";
import { setupAuthGuard } from "~/router/auth-guard";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      component: () => import("~/pages/index.vue"),
      meta: { layout: "dashboard" },
    },
    {
      path: "/login",
      component: () => import("~/pages/login.vue"),
    },
    {
      path: "/register",
      component: () => import("~/pages/register.vue"),
    },
    {
      path: "/profile",
      component: () => import("~/pages/profile.vue"),
      meta: { layout: "dashboard" },
    },
    {
      path: "/settings",
      component: () => import("~/pages/settings.vue"),
      meta: { layout: "dashboard" },
    },
    {
      path: "/search",
      component: () => import("~/pages/search.vue"),
      meta: { layout: "dashboard" },
    },
    {
      path: "/admin",
      component: () => import("~/pages/admin/index.vue"),
      meta: { layout: "dashboard" },
    },
    {
      path: "/admin/jobs",
      component: () => import("~/pages/admin/jobs.vue"),
      meta: { layout: "dashboard" },
    },
    {
      path: "/invites/:token",
      component: () => import("~/pages/invites/[token].vue"),
      meta: { layout: "dashboard" },
    },
    {
      path: "/libraries/:id",
      component: () => import("~/pages/libraries/[id]/index.vue"),
      meta: { layout: "dashboard" },
    },
    {
      path: "/libraries/:id/settings",
      component: () => import("~/pages/libraries/[id]/settings.vue"),
      meta: { layout: "dashboard" },
    },
    {
      path: "/libraries/:id/people",
      component: () => import("~/pages/libraries/[id]/people.vue"),
      meta: { layout: "dashboard" },
    },
    {
      path: "/libraries/:id/tags",
      component: () => import("~/pages/libraries/[id]/tags.vue"),
      meta: { layout: "dashboard" },
    },
  ],
});

setupAuthGuard(router);

export default router;
