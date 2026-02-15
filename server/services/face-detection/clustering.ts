import { and, desc, eq, gte, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { cosineDistance } from "drizzle-orm/sql/functions/vector";
import { db, schema } from "~~/server/database";
import {
  FACE_QUALITY_MIN_SCORE,
  FACE_RECOGNITION_MAX_DISTANCE,
  FACE_RECOGNITION_MIN_FACES,
  FACE_RECOGNITION_NEIGHBOR_LOOKUP,
} from "./config";

const MATCH_CANDIDATE_DISTANCE = Math.min(FACE_RECOGNITION_MAX_DISTANCE + 0.04, 0.9);

const AUTO_MERGE_SOURCE_SAMPLES = 6;
const AUTO_MERGE_NEIGHBOR_LOOKUP = Math.max(FACE_RECOGNITION_NEIGHBOR_LOOKUP, 80);
const AUTO_MERGE_CANDIDATE_DISTANCE = Math.min(FACE_RECOGNITION_MAX_DISTANCE + 0.02, 0.9);
const AUTO_MERGE_BEST_DISTANCE = FACE_RECOGNITION_MAX_DISTANCE;
const AUTO_MERGE_AVG_DISTANCE = Math.min(FACE_RECOGNITION_MAX_DISTANCE + 0.02, 0.9);
const AUTO_MERGE_MIN_SUPPORT = 3;
const AUTO_MERGE_STRONG_DISTANCE = Math.max(0.22, FACE_RECOGNITION_MAX_DISTANCE - 0.06);
const AUTO_MERGE_AMBIGUITY_MARGIN = 0.025;

/** Distance below which a single high-quality match is enough to assign */
const DIRECT_ASSIGN_DISTANCE = 0.35;

/** Quality score (0-1000) threshold for clustering lookups */
const QUALITY_MIN_SCORE_INT = Math.round(FACE_QUALITY_MIN_SCORE * 1000);

interface SimilarFace {
  id: string;
  personId: string | null;
  distance: number;
  qualityScore: number | null;
}

export interface CandidateEvidence {
  personId: string;
  supportCount: number;
  strongCount: number;
  bestDistance: number;
  avgDistance: number;
  score: number;
}

export interface FaceAssignmentResult {
  personId: string;
  created: boolean;
}

async function createPerson(libraryId: string, coverFaceDetectionId: string): Promise<string> {
  const [person] = await db
    .insert(schema.people)
    .values({
      libraryId,
      coverFaceDetectionId,
      faceCount: 1,
    })
    .returning({ id: schema.people.id });

  return person!.id;
}

async function assignFaceToPerson(faceDetectionId: string, personId: string): Promise<void> {
  await db
    .update(schema.faceDetections)
    .set({ personId })
    .where(eq(schema.faceDetections.id, faceDetectionId));

  await db
    .update(schema.people)
    .set({ faceCount: sql`${schema.people.faceCount} + 1` })
    .where(eq(schema.people.id, personId));

  await db
    .update(schema.people)
    .set({ coverFaceDetectionId: faceDetectionId })
    .where(and(eq(schema.people.id, personId), isNull(schema.people.coverFaceDetectionId)));
}

async function findSimilarFaces(
  libraryId: string,
  embedding: number[],
  limit: number,
  assignedOnly = false,
): Promise<SimilarFace[]> {
  const similarity = cosineDistance(schema.faceDetections.embedding, embedding);

  // Base conditions: same library, has embedding, quality above threshold
  const qualityFilter =
    QUALITY_MIN_SCORE_INT > 0
      ? gte(schema.faceDetections.qualityScore, QUALITY_MIN_SCORE_INT)
      : undefined;

  const conditions = assignedOnly
    ? and(
        eq(schema.faceDetections.libraryId, libraryId),
        isNotNull(schema.faceDetections.embedding),
        isNotNull(schema.faceDetections.personId),
        qualityFilter,
      )
    : and(
        eq(schema.faceDetections.libraryId, libraryId),
        isNotNull(schema.faceDetections.embedding),
        qualityFilter,
      );

  const nearest = await db
    .select({
      id: schema.faceDetections.id,
      personId: schema.faceDetections.personId,
      distance: similarity.as("distance"),
      qualityScore: schema.faceDetections.qualityScore,
    })
    .from(schema.faceDetections)
    .where(conditions)
    .orderBy(similarity)
    .limit(Math.max(limit, 1));

  const matches: SimilarFace[] = [];
  for (const row of nearest) {
    const distance = Number(row.distance);
    if (!Number.isFinite(distance) || distance > MATCH_CANDIDATE_DISTANCE) continue;
    matches.push({
      id: row.id,
      personId: row.personId,
      distance,
      qualityScore: row.qualityScore,
    });
  }

  return matches;
}

async function assignUnassignedMatches(personId: string, faceIds: string[]): Promise<void> {
  if (faceIds.length === 0) return;

  await db.transaction(async (tx) => {
    await tx
      .update(schema.faceDetections)
      .set({ personId })
      .where(
        and(inArray(schema.faceDetections.id, faceIds), isNull(schema.faceDetections.personId)),
      );
    await recalculatePersonStats(tx, personId);
  });
}

// Core-point assignment:
// 1) prefer existing nearby person
// 2) create a person only when enough nearby faces exist
// 3) otherwise keep face unassigned for later evidence
// 4) direct assign when distance is very low (< 0.35) even with only 1 match
export async function assignFaceUsingCorePoint(
  libraryId: string,
  faceDetectionId: string,
  embedding: number[],
): Promise<FaceAssignmentResult | null> {
  const nearby = await findSimilarFaces(
    libraryId,
    embedding,
    FACE_RECOGNITION_NEIGHBOR_LOOKUP,
    false,
  );

  // Find the best assigned person match
  let bestAssignedMatch = nearby.find((match) => match.personId);
  if (!bestAssignedMatch) {
    const nearestAssigned = await findSimilarFaces(libraryId, embedding, 1, true);
    bestAssignedMatch = nearestAssigned[0] ?? undefined;
  }

  // Direct assign: if a single very-close match exists with a person, assign immediately
  if (bestAssignedMatch?.personId && bestAssignedMatch.distance < DIRECT_ASSIGN_DISTANCE) {
    await assignFaceToPerson(faceDetectionId, bestAssignedMatch.personId);
    return { personId: bestAssignedMatch.personId, created: false };
  }

  if (FACE_RECOGNITION_MIN_FACES > 1 && nearby.length <= 1) {
    return null;
  }

  if (bestAssignedMatch?.personId) {
    await assignFaceToPerson(faceDetectionId, bestAssignedMatch.personId);
    return { personId: bestAssignedMatch.personId, created: false };
  }

  const isCorePoint = nearby.length >= FACE_RECOGNITION_MIN_FACES;
  if (!isCorePoint) {
    return null;
  }

  const newPersonId = await createPerson(libraryId, faceDetectionId);
  const unassignedNearbyIds = nearby
    .filter((match) => match.personId === null)
    .map((match) => match.id);
  await assignUnassignedMatches(newPersonId, unassignedNearbyIds);
  return { personId: newPersonId, created: true };
}

export function pickAutoMergeTarget(candidates: CandidateEvidence[]): string | null {
  const ranked = [...candidates].sort((a, b) => {
    if (b.strongCount !== a.strongCount) return b.strongCount - a.strongCount;
    if (b.supportCount !== a.supportCount) return b.supportCount - a.supportCount;
    return a.score - b.score;
  });

  const best = ranked[0];
  if (!best) return null;

  const hasEnoughSupport = best.supportCount >= AUTO_MERGE_MIN_SUPPORT;
  const hasStrongDistanceEvidence =
    best.bestDistance <= AUTO_MERGE_BEST_DISTANCE || best.avgDistance <= AUTO_MERGE_AVG_DISTANCE;
  if (!hasEnoughSupport || !hasStrongDistanceEvidence) {
    return null;
  }

  const second = ranked[1];
  if (
    second &&
    second.bestDistance <= AUTO_MERGE_BEST_DISTANCE + 0.02 &&
    Math.abs(second.score - best.score) < AUTO_MERGE_AMBIGUITY_MARGIN
  ) {
    return null;
  }

  return best.personId;
}

async function chooseValidCoverFace(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  personId: string,
): Promise<string | null> {
  const [person] = await tx
    .select({ coverFaceDetectionId: schema.people.coverFaceDetectionId })
    .from(schema.people)
    .where(eq(schema.people.id, personId))
    .limit(1);

  let coverFaceDetectionId = person?.coverFaceDetectionId ?? null;
  if (coverFaceDetectionId) {
    const [coverExists] = await tx
      .select({ id: schema.faceDetections.id })
      .from(schema.faceDetections)
      .where(
        and(
          eq(schema.faceDetections.id, coverFaceDetectionId),
          eq(schema.faceDetections.personId, personId),
        ),
      )
      .limit(1);

    if (!coverExists) coverFaceDetectionId = null;
  }

  if (!coverFaceDetectionId) {
    const [latestFace] = await tx
      .select({ id: schema.faceDetections.id })
      .from(schema.faceDetections)
      .where(eq(schema.faceDetections.personId, personId))
      .orderBy(desc(schema.faceDetections.createdAt))
      .limit(1);
    coverFaceDetectionId = latestFace?.id ?? null;
  }

  return coverFaceDetectionId;
}

async function recalculatePersonStats(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  personId: string,
): Promise<void> {
  const [count] = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.faceDetections)
    .where(eq(schema.faceDetections.personId, personId));

  const coverFaceDetectionId = await chooseValidCoverFace(tx, personId);
  await tx
    .update(schema.people)
    .set({
      faceCount: count?.total ?? 0,
      coverFaceDetectionId,
    })
    .where(eq(schema.people.id, personId));
}

export async function reconcileNewPerson(
  libraryId: string,
  sourcePersonId: string,
): Promise<string> {
  const sourceEmbeddings = await db
    .select({ embedding: schema.faceDetections.embedding })
    .from(schema.faceDetections)
    .where(
      and(
        eq(schema.faceDetections.libraryId, libraryId),
        eq(schema.faceDetections.personId, sourcePersonId),
        isNotNull(schema.faceDetections.embedding),
      ),
    )
    .orderBy(desc(schema.faceDetections.createdAt))
    .limit(AUTO_MERGE_SOURCE_SAMPLES);

  if (sourceEmbeddings.length === 0) {
    return sourcePersonId;
  }

  const grouped = new Map<string, number[]>();
  for (const row of sourceEmbeddings) {
    if (!row.embedding) continue;

    const similarity = cosineDistance(schema.faceDetections.embedding, row.embedding as number[]);
    const nearest = await db
      .select({
        personId: schema.faceDetections.personId,
        distance: similarity.as("distance"),
      })
      .from(schema.faceDetections)
      .where(
        and(
          eq(schema.faceDetections.libraryId, libraryId),
          isNotNull(schema.faceDetections.personId),
          ne(schema.faceDetections.personId, sourcePersonId),
          isNotNull(schema.faceDetections.embedding),
        ),
      )
      .orderBy(similarity)
      .limit(AUTO_MERGE_NEIGHBOR_LOOKUP);

    for (const candidate of nearest) {
      if (!candidate.personId) continue;
      const distance = Number(candidate.distance);
      if (!Number.isFinite(distance) || distance > AUTO_MERGE_CANDIDATE_DISTANCE) continue;

      const distances = grouped.get(candidate.personId);
      if (distances) {
        distances.push(distance);
      } else {
        grouped.set(candidate.personId, [distance]);
      }
    }
  }

  if (grouped.size === 0) {
    return sourcePersonId;
  }

  const candidates: CandidateEvidence[] = Array.from(grouped.entries()).map(
    ([personId, distances]) => {
      const sorted = [...distances].sort((a, b) => a - b);
      const bestDistance = sorted[0]!;
      const supportCount = sorted.length;
      const strongCount = sorted.filter(
        (distance) => distance <= AUTO_MERGE_STRONG_DISTANCE,
      ).length;
      const top = sorted.slice(0, Math.min(4, sorted.length));
      const avgDistance = top.reduce((sum, value) => sum + value, 0) / top.length;
      const score = bestDistance * 0.7 + avgDistance * 0.3;

      return {
        personId,
        supportCount,
        strongCount,
        bestDistance,
        avgDistance,
        score,
      };
    },
  );

  const targetPersonId = pickAutoMergeTarget(candidates);
  if (!targetPersonId) {
    return sourcePersonId;
  }

  await db.transaction(async (tx) => {
    const [sourcePerson] = await tx
      .select({ id: schema.people.id })
      .from(schema.people)
      .where(and(eq(schema.people.id, sourcePersonId), eq(schema.people.libraryId, libraryId)))
      .limit(1);
    const [targetPerson] = await tx
      .select({ id: schema.people.id })
      .from(schema.people)
      .where(and(eq(schema.people.id, targetPersonId), eq(schema.people.libraryId, libraryId)))
      .limit(1);

    if (!sourcePerson || !targetPerson || sourcePersonId === targetPersonId) return;

    await tx
      .update(schema.faceDetections)
      .set({ personId: targetPersonId })
      .where(eq(schema.faceDetections.personId, sourcePersonId));

    await tx.delete(schema.people).where(eq(schema.people.id, sourcePersonId));
    await recalculatePersonStats(tx, targetPersonId);
  });

  return targetPersonId;
}
