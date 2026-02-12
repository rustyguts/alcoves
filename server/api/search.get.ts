import { searchGlobalForUser } from "~~/server/services/search";

export default defineEventHandler(async (event) => {
  const userId = event.context.userId as string;
  const query = getQuery(event);

  return searchGlobalForUser(userId, {
    q: query.q,
    limit: query.limit,
  });
});
