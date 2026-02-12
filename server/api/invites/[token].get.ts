import { and, eq } from "drizzle-orm";
import { db, schema } from "~~/server/database";

type InviteStatus =
  | "pending"
  | "accepted"
  | "expired"
  | "revoked"
  | "already_member"
  | "not_allowed";

export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, "token")!;
  const userId = await requireUserId(event);

  const [currentUser] = await db
    .select({ id: schema.users.id, email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  if (!currentUser) {
    throw createError({ statusCode: 401, statusMessage: "User not found" });
  }

  const [invite] = await db
    .select({
      id: schema.libraryInvites.id,
      libraryId: schema.libraryInvites.libraryId,
      role: schema.libraryInvites.role,
      invitedEmail: schema.libraryInvites.invitedEmail,
      invitedByUserId: schema.libraryInvites.invitedByUserId,
      acceptedAt: schema.libraryInvites.acceptedAt,
      expiresAt: schema.libraryInvites.expiresAt,
      revokedAt: schema.libraryInvites.revokedAt,
      createdAt: schema.libraryInvites.createdAt,
      libraryName: schema.libraries.name,
      libraryIsDefault: schema.libraries.isDefault,
      ownerId: schema.libraries.ownerId,
      invitedByDisplayName: schema.users.displayName,
      invitedByAvatarUrl: schema.users.avatarUrl,
    })
    .from(schema.libraryInvites)
    .innerJoin(schema.libraries, eq(schema.libraries.id, schema.libraryInvites.libraryId))
    .innerJoin(schema.users, eq(schema.users.id, schema.libraryInvites.invitedByUserId))
    .where(eq(schema.libraryInvites.token, token))
    .limit(1);

  if (!invite) {
    throw createError({ statusCode: 404, statusMessage: "Invite not found" });
  }

  if (invite.libraryIsDefault) {
    throw createError({
      statusCode: 400,
      statusMessage: "Collaboration is disabled for personal libraries",
    });
  }

  let status: InviteStatus = "pending";

  const isEmailInvite = Boolean(invite.invitedEmail);

  if (invite.revokedAt) {
    status = "revoked";
  } else if (isEmailInvite && invite.acceptedAt) {
    status = "accepted";
  } else if (invite.expiresAt && invite.expiresAt.getTime() <= Date.now()) {
    status = "expired";
  } else if (
    invite.invitedEmail &&
    invite.invitedEmail.toLowerCase() !== currentUser.email.toLowerCase()
  ) {
    status = "not_allowed";
  } else if (invite.ownerId === userId) {
    status = "already_member";
  } else {
    const [membership] = await db
      .select({ id: schema.libraryMembers.id })
      .from(schema.libraryMembers)
      .where(
        and(
          eq(schema.libraryMembers.libraryId, invite.libraryId),
          eq(schema.libraryMembers.userId, userId),
        ),
      )
      .limit(1);

    if (membership) {
      status = "already_member";
    }
  }

  return {
    id: invite.id,
    library: {
      id: invite.libraryId,
      name: invite.libraryName,
    },
    role: invite.role,
    invitedEmail: invite.invitedEmail,
    createdAt: invite.createdAt.toISOString(),
    invitedBy: {
      id: invite.invitedByUserId,
      displayName: invite.invitedByDisplayName,
      avatarUrl: invite.invitedByAvatarUrl,
    },
    status,
    canAccept: status === "pending",
  };
});
