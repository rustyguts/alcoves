import type { CandidateEvidence } from "~~/server/services/face-detection/clustering";

// pickAutoMergeTarget is a pure function — test it directly
async function getPickAutoMergeTarget() {
  const mod = await import("~~/server/services/face-detection/clustering");
  return mod.pickAutoMergeTarget;
}

function makeCandidate(overrides: Partial<CandidateEvidence> = {}): CandidateEvidence {
  return {
    personId: "person-1",
    supportCount: 5,
    strongCount: 3,
    bestDistance: 0.3,
    avgDistance: 0.35,
    score: 0.3 * 0.7 + 0.35 * 0.3,
    ...overrides,
  };
}

describe("pickAutoMergeTarget", () => {
  it("returns null for empty candidates", async () => {
    const pickAutoMergeTarget = await getPickAutoMergeTarget();
    expect(pickAutoMergeTarget([])).toBeNull();
  });

  it("returns the best candidate when unambiguous", async () => {
    const pickAutoMergeTarget = await getPickAutoMergeTarget();
    const candidates = [
      makeCandidate({ personId: "person-1", supportCount: 5, strongCount: 3, bestDistance: 0.25 }),
      makeCandidate({ personId: "person-2", supportCount: 2, strongCount: 0, bestDistance: 0.55 }),
    ];
    expect(pickAutoMergeTarget(candidates)).toBe("person-1");
  });

  it("returns null when support count is too low", async () => {
    const pickAutoMergeTarget = await getPickAutoMergeTarget();
    const candidates = [
      makeCandidate({ personId: "person-1", supportCount: 1, strongCount: 1, bestDistance: 0.3 }),
    ];
    expect(pickAutoMergeTarget(candidates)).toBeNull();
  });

  it("returns null when best distance exceeds threshold", async () => {
    const pickAutoMergeTarget = await getPickAutoMergeTarget();
    const candidates = [
      makeCandidate({
        personId: "person-1",
        supportCount: 5,
        strongCount: 0,
        bestDistance: 0.7,
        avgDistance: 0.75,
        score: 0.7 * 0.7 + 0.75 * 0.3,
      }),
    ];
    expect(pickAutoMergeTarget(candidates)).toBeNull();
  });

  it("returns null when two candidates are ambiguous (scores too close)", async () => {
    const pickAutoMergeTarget = await getPickAutoMergeTarget();
    const score1 = 0.3 * 0.7 + 0.35 * 0.3;
    const score2 = score1 + 0.01; // within 0.025 margin
    const candidates = [
      makeCandidate({
        personId: "person-1",
        supportCount: 5,
        strongCount: 3,
        score: score1,
        bestDistance: 0.3,
        avgDistance: 0.35,
      }),
      makeCandidate({
        personId: "person-2",
        supportCount: 5,
        strongCount: 3,
        score: score2,
        bestDistance: 0.31,
        avgDistance: 0.36,
      }),
    ];
    expect(pickAutoMergeTarget(candidates)).toBeNull();
  });

  it("returns best when second candidate has much worse distance", async () => {
    const pickAutoMergeTarget = await getPickAutoMergeTarget();
    const candidates = [
      makeCandidate({
        personId: "person-1",
        supportCount: 5,
        strongCount: 4,
        bestDistance: 0.2,
        score: 0.2,
      }),
      makeCandidate({
        personId: "person-2",
        supportCount: 3,
        strongCount: 0,
        bestDistance: 0.6,
        score: 0.6,
      }),
    ];
    expect(pickAutoMergeTarget(candidates)).toBe("person-1");
  });

  it("prefers candidate with more strong matches", async () => {
    const pickAutoMergeTarget = await getPickAutoMergeTarget();
    const candidates = [
      makeCandidate({
        personId: "person-1",
        supportCount: 4,
        strongCount: 1,
        bestDistance: 0.3,
        score: 0.3,
      }),
      makeCandidate({
        personId: "person-2",
        supportCount: 4,
        strongCount: 4,
        bestDistance: 0.3,
        score: 0.15,
      }),
    ];
    // person-2 has more strong matches so should be ranked first
    expect(pickAutoMergeTarget(candidates)).toBe("person-2");
  });
});
