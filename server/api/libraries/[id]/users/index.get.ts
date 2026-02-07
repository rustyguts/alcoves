import { and, asc, eq, gt, isNull, or } from "drizzle-orm";
import { db, schema } from "~~/server/database";
import { requireLibraryAccess } from "~~/server/utils/libraries";

export default defineEventHandler(async (event) => {
  const libraryId = getRouterParam(event, "id")!;
  const access = await requireLibraryAccess(event, libraryId);

  const [owner] = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      displayName: schema.users.displayName,
      avatarUrl: schema.users.avatarUrl,
      createdAt: schema.libraries.createdAt,
    })
    .from(schema.libraries)
    .innerJoin(schema.users, eq(schema.users.id, schema.libraries.ownerId))
    .where(eq(schema.libraries.id, libraryId))
    .limit(1);

  if (!owner) {
    throw createError({ statusCode: 404, statusMessage: "Library not found" });
  }

  const memberRows = access.isDefault
    ? []
    : await db
        .select({
          id: schema.libraryMembers.id,
          userId: schema.libraryMembers.userId,
          role: schema.libraryMembers.role,
          createdAt: schema.libraryMembers.createdAt,
          email: schema.users.email,
          displayName: schema.users.displayName,
          avatarUrl: schema.users.avatarUrl,
        })
        .from(schema.libraryMembers)
        .innerJoin(schema.users, eq(schema.users.id, schema.libraryMembers.userId))
        .where(eq(schema.libraryMembers.libraryId, libraryId))
        .orderBy(asc(schema.users.displayName));

  const ownerMember = {
    id: `owner-${owner.id}`,
    userId: owner.id,
    role: "owner" as const,
    isOwner: true,
    createdAt: owner.createdAt.toISOString(),
    user: {
      id: owner.id,
      email: owner.email,
      displayName: owner.displayName,
      avatarUrl: owner.avatarUrl,
    },
  };

  const members = [
    ownerMember,
    ...memberRows
      .filter((member) => member.userId !== owner.id)
      .map((member) => ({
        id: member.id,
        userId: member.userId,
        role: member.role,
        isOwner: false,
        createdAt: member.createdAt.toISOString(),
        user: {
          id: member.userId,
          email: member.email,
          displayName: member.displayName,
          avatarUrl: member.avatarUrl,
        },
      })),
  ];

  const pendingInvites =
    access.isAdmin && !access.isDefault
      ? await db
          .select({
            id: schema.libraryInvites.id,
            invitedEmail: schema.libraryInvites.invitedEmail,
            role: schema.libraryInvites.role,
            useCount: schema.libraryInvites.useCount,
            token: schema.libraryInvites.token,
            createdAt: schema.libraryInvites.createdAt,
            invitedByUserId: schema.libraryInvites.invitedByUserId,
            invitedByDisplayName: schema.users.displayName,
            invitedByAvatarUrl: schema.users.avatarUrl,
          })
          .from(schema.libraryInvites)
          .innerJoin(schema.users, eq(schema.users.id, schema.libraryInvites.invitedByUserId))
          .where(
            and(
              eq(schema.libraryInvites.libraryId, libraryId),
              isNull(schema.libraryInvites.acceptedAt),
              isNull(schema.libraryInvites.revokedAt),
              or(
                isNull(schema.libraryInvites.expiresAt),
                gt(schema.libraryInvites.expiresAt, new Date()),
              ),
            ),
          )
          .orderBy(asc(schema.libraryInvites.createdAt))
      : [];

  const origin = getRequestURL(event).origin;

  return {
    libraryId,
    canManageUsers: access.isAdmin && !access.isDefault,
    members,
    pendingInvites: pendingInvites.map((invite) => ({
      id: invite.id,
      invitedEmail: invite.invitedEmail,
      role: invite.role,
      useCount: invite.useCount,
      createdAt: invite.createdAt.toISOString(),
      inviteUrl: `${origin}/invites/${invite.token}`,
      invitedBy: {
        id: invite.invitedByUserId,
        displayName: invite.invitedByDisplayName,
        avatarUrl: invite.invitedByAvatarUrl,
      },
    })),
  };
});
