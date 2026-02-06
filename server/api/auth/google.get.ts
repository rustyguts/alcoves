import { eq, and, count } from "drizzle-orm";
import { db, schema } from "~~/server/database";

export default defineOAuthGoogleEventHandler({
  config: {
    scope: ["email", "profile", "openid"],
  },
  async onSuccess(event, { user: googleUser }) {
    const googleId = googleUser.sub as string;
    const email = (googleUser.email as string).toLowerCase();
    const name = (googleUser.name as string) || email;
    const avatar = (googleUser.picture as string) || null;

    // Check if this Google account is already linked
    const [existingAccount] = await db
      .select()
      .from(schema.accounts)
      .where(
        and(
          eq(schema.accounts.provider, "google"),
          eq(schema.accounts.providerAccountId, googleId),
        ),
      )
      .limit(1);

    let user;

    if (existingAccount) {
      // Existing Google account — fetch the user
      const [dbUser] = await db
        .select({
          id: schema.users.id,
          email: schema.users.email,
          displayName: schema.users.displayName,
          avatarUrl: schema.users.avatarUrl,
          role: schema.users.role,
        })
        .from(schema.users)
        .where(eq(schema.users.id, existingAccount.userId))
        .limit(1);

      if (!dbUser) {
        return sendRedirect(event, "/login?error=google");
      }
      user = dbUser;
    } else {
      // No linked Google account — check if a user with this email exists
      const [existingUser] = await db
        .select({
          id: schema.users.id,
          email: schema.users.email,
          displayName: schema.users.displayName,
          avatarUrl: schema.users.avatarUrl,
          role: schema.users.role,
        })
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .limit(1);

      if (existingUser) {
        // Link Google account to existing user
        await db.insert(schema.accounts).values({
          userId: existingUser.id,
          provider: "google",
          providerAccountId: googleId,
        });
        user = existingUser;
      } else {
        // Create new user
        const [userCount] = await db.select({ value: count() }).from(schema.users);
        const role = userCount?.value === 0 ? "owner" : "member";

        const [newUser] = await db
          .insert(schema.users)
          .values({
            email,
            displayName: name,
            avatarUrl: avatar,
            role,
          })
          .returning({
            id: schema.users.id,
            email: schema.users.email,
            displayName: schema.users.displayName,
            avatarUrl: schema.users.avatarUrl,
            role: schema.users.role,
          });

        if (!newUser) {
          return sendRedirect(event, "/login?error=google");
        }

        // Create Google account link
        await db.insert(schema.accounts).values({
          userId: newUser.id,
          provider: "google",
          providerAccountId: googleId,
        });

        // Create default library
        await db.insert(schema.libraries).values({
          name: "My Library",
          isDefault: true,
          ownerId: newUser.id,
        });

        user = newUser;
      }
    }

    if (!user) {
      return sendRedirect(event, "/login?error=google");
    }

    // Create database session and set cookie session
    const sessionToken = await createDbSession(user.id, event);
    await setUserSession(event, {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        role: user.role,
      },
      sessionToken,
    });

    return sendRedirect(event, "/");
  },
  onError(event, error) {
    console.error("Google OAuth error:", error);
    return sendRedirect(event, "/login?error=google");
  },
});
