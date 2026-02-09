import { and, eq, gt, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "~~/server/database";
import { generateInviteToken, normalizeEmail, parseInviteRole } from "~~/server/utils/invites";
import { requireCollaborativeLibraryAdmin } from "~~/server/domain/library/access";
import { parseBodyWithSchema } from "~~/server/utils/validation";

const inviteEmailSchema = z.object({
  email: z.email("Valid email is required"),
  role: z.enum(["admin", "viewer"]).optional(),
});

export default defineEventHandler(async (event) => {
  const libraryId = getRouterParam(event, "id")!;
  const access = await requireCollaborativeLibraryAdmin(event, libraryId);
  const body = await parseBodyWithSchema(event, inviteEmailSchema);

  const email = normalizeEmail(body?.email);
  const role = parseInviteRole(body?.role);

  const [owner] = await db
    .select({ id: schema.users.id, email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.id, access.ownerId))
    .limit(1);

  if (owner?.email.toLowerCase() === email) {
    throw createError({ statusCode: 400, statusMessage: "Library owner is already included" });
  }

  const [existingUser] = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      displayName: schema.users.displayName,
      avatarUrl: schema.users.avatarUrl,
    })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);

  if (existingUser) {
    const [existingMember] = await db
      .select({
        id: schema.libraryMembers.id,
        role: schema.libraryMembers.role,
      })
      .from(schema.libraryMembers)
      .where(
        and(
          eq(schema.libraryMembers.libraryId, libraryId),
          eq(schema.libraryMembers.userId, existingUser.id),
        ),
      )
      .limit(1);

    if (existingMember) {
      return {
        action: "already_member",
        member: {
          id: existingMember.id,
          userId: existingUser.id,
          role: existingMember.role,
          user: existingUser,
        },
      };
    }

    const memberRows = await db
      .insert(schema.libraryMembers)
      .values({
        libraryId,
        userId: existingUser.id,
        role,
      })
      .returning({
        id: schema.libraryMembers.id,
        userId: schema.libraryMembers.userId,
        role: schema.libraryMembers.role,
        createdAt: schema.libraryMembers.createdAt,
      });
    const member = memberRows[0];
    if (!member) {
      throw createError({ statusCode: 500, statusMessage: "Failed to add member" });
    }

    await db
      .update(schema.libraryInvites)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.libraryInvites.libraryId, libraryId),
          eq(schema.libraryInvites.invitedEmail, email),
          isNull(schema.libraryInvites.acceptedAt),
          isNull(schema.libraryInvites.revokedAt),
          or(
            isNull(schema.libraryInvites.expiresAt),
            gt(schema.libraryInvites.expiresAt, new Date()),
          ),
        ),
      );

    return {
      action: "added",
      member: {
        id: member.id,
        userId: member.userId,
        role: member.role,
        createdAt: member.createdAt.toISOString(),
        user: existingUser,
      },
    };
  }

  const [existingInvite] = await db
    .select({
      id: schema.libraryInvites.id,
      token: schema.libraryInvites.token,
      role: schema.libraryInvites.role,
      invitedEmail: schema.libraryInvites.invitedEmail,
      createdAt: schema.libraryInvites.createdAt,
    })
    .from(schema.libraryInvites)
    .where(
      and(
        eq(schema.libraryInvites.libraryId, libraryId),
        eq(schema.libraryInvites.invitedEmail, email),
        isNull(schema.libraryInvites.acceptedAt),
        isNull(schema.libraryInvites.revokedAt),
        or(
          isNull(schema.libraryInvites.expiresAt),
          gt(schema.libraryInvites.expiresAt, new Date()),
        ),
      ),
    )
    .limit(1);

  let invite = existingInvite;
  if (!invite) {
    const inviteRows = await db
      .insert(schema.libraryInvites)
      .values({
        libraryId,
        invitedByUserId: event.context.userId as string,
        invitedEmail: email,
        role,
        token: generateInviteToken(),
      })
      .returning({
        id: schema.libraryInvites.id,
        token: schema.libraryInvites.token,
        role: schema.libraryInvites.role,
        invitedEmail: schema.libraryInvites.invitedEmail,
        createdAt: schema.libraryInvites.createdAt,
      });
    invite = inviteRows[0];
  }

  if (!invite) {
    throw createError({ statusCode: 500, statusMessage: "Failed to create invite" });
  }

  const origin = getRequestURL(event).origin;

  return {
    action: "invited",
    invite: {
      id: invite.id,
      invitedEmail: invite.invitedEmail,
      role: invite.role,
      createdAt: invite.createdAt.toISOString(),
      inviteUrl: `${origin}/invites/${invite.token}`,
    },
  };
});
