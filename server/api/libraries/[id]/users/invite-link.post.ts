import { db, schema } from "~~/server/database";
import { generateInviteToken } from "~~/server/utils/invites";
import { requireCollaborativeLibraryAdmin } from "~~/server/utils/libraries";

export default defineEventHandler(async (event) => {
  const libraryId = getRouterParam(event, "id")!;
  await requireCollaborativeLibraryAdmin(event, libraryId);

  const userId = event.context.userId as string;

  const inviteRows = await db
    .insert(schema.libraryInvites)
    .values({
      libraryId,
      invitedByUserId: userId,
      token: generateInviteToken(),
    })
    .returning({
      id: schema.libraryInvites.id,
      token: schema.libraryInvites.token,
      useCount: schema.libraryInvites.useCount,
      invitedEmail: schema.libraryInvites.invitedEmail,
      createdAt: schema.libraryInvites.createdAt,
    });
  const invite = inviteRows[0];
  if (!invite) {
    throw createError({ statusCode: 500, statusMessage: "Failed to create invite link" });
  }

  const origin = getRequestURL(event).origin;

  return {
    id: invite.id,
    invitedEmail: invite.invitedEmail,
    useCount: invite.useCount,
    createdAt: invite.createdAt.toISOString(),
    inviteUrl: `${origin}/invites/${invite.token}`,
  };
});
