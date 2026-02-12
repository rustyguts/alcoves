import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "~~/server/database";

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

  const result = await db.transaction(async (tx) => {
    const [invite] = await tx
      .select({
        id: schema.libraryInvites.id,
        libraryId: schema.libraryInvites.libraryId,
        role: schema.libraryInvites.role,
        invitedEmail: schema.libraryInvites.invitedEmail,
        acceptedAt: schema.libraryInvites.acceptedAt,
        expiresAt: schema.libraryInvites.expiresAt,
        revokedAt: schema.libraryInvites.revokedAt,
        libraryName: schema.libraries.name,
        libraryIsDefault: schema.libraries.isDefault,
        ownerId: schema.libraries.ownerId,
      })
      .from(schema.libraryInvites)
      .innerJoin(schema.libraries, eq(schema.libraries.id, schema.libraryInvites.libraryId))
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

    if (invite.revokedAt) {
      throw createError({ statusCode: 400, statusMessage: "Invite has been revoked" });
    }

    const isEmailInvite = Boolean(invite.invitedEmail);

    if (isEmailInvite && invite.acceptedAt) {
      return {
        libraryId: invite.libraryId,
        libraryName: invite.libraryName,
        status: "accepted",
      } as const;
    }

    if (invite.expiresAt && invite.expiresAt.getTime() <= Date.now()) {
      throw createError({ statusCode: 400, statusMessage: "Invite has expired" });
    }

    if (
      invite.invitedEmail &&
      invite.invitedEmail.toLowerCase() !== currentUser.email.toLowerCase()
    ) {
      throw createError({
        statusCode: 403,
        statusMessage: "This invite was created for another email address",
      });
    }

    const isOwner = invite.ownerId === userId;

    const [existingMembership] = await tx
      .select({ id: schema.libraryMembers.id })
      .from(schema.libraryMembers)
      .where(
        and(
          eq(schema.libraryMembers.libraryId, invite.libraryId),
          eq(schema.libraryMembers.userId, userId),
        ),
      )
      .limit(1);

    if (!isOwner && !existingMembership) {
      await tx.insert(schema.libraryMembers).values({
        libraryId: invite.libraryId,
        userId,
        role: invite.role,
      });
    }

    if (isEmailInvite) {
      await tx
        .update(schema.libraryInvites)
        .set({
          acceptedAt: new Date(),
          acceptedByUserId: userId,
        })
        .where(eq(schema.libraryInvites.id, invite.id));
    } else if (!isOwner && !existingMembership) {
      await tx
        .update(schema.libraryInvites)
        .set({
          useCount: sql`${schema.libraryInvites.useCount} + 1`,
        })
        .where(eq(schema.libraryInvites.id, invite.id));
    }

    return {
      libraryId: invite.libraryId,
      libraryName: invite.libraryName,
      status: isOwner || existingMembership ? "already_member" : "joined",
    } as const;
  });

  return result;
});
