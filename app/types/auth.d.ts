declare module "#auth-utils" {
  interface User {
    id: string;
    email: string;
    displayName: string;
    avatarUrl: string | null;
    role: string;
  }

  interface UserSession {
    user?: User;
    sessionToken?: string;
  }
}

export {};
