import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { detectFaces } from "../../server/services/face-detection/detect";
import { computeEmbedding } from "../../server/services/face-detection/recognize";

interface CliOptions {
  datasetDir: string;
  minDetectionRate: number;
  minPairF1: number;
  maxClustersPerIdentity: number;
  distanceThreshold: number;
}

interface SampleEmbedding {
  label: string;
  filePath: string;
  embedding: number[];
}

interface ExtractionResult {
  imagesTotal: number;
  facesDetected: number;
  multiFaceImages: number;
  samples: SampleEmbedding[];
}

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"]);

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseCli(): CliOptions {
  const args = process.argv.slice(2);
  const getArg = (name: string): string | undefined => {
    const index = args.findIndex((arg) => arg === name);
    if (index === -1) return undefined;
    return args[index + 1];
  };

  const datasetDir = resolve(
    getArg("--dataset") ?? process.env.ALCOVES_FACE_EVAL_DATASET ?? "test/fixtures/face-recognition",
  );

  return {
    datasetDir,
    minDetectionRate: parseNumber(
      getArg("--min-detection-rate") ?? process.env.ALCOVES_FACE_EVAL_MIN_DETECTION_RATE,
      0.9,
    ),
    minPairF1: parseNumber(getArg("--min-pair-f1") ?? process.env.ALCOVES_FACE_EVAL_MIN_PAIR_F1, 0.9),
    maxClustersPerIdentity: Math.max(
      1,
      Math.floor(
        parseNumber(
          getArg("--max-clusters-per-identity") ??
            process.env.ALCOVES_FACE_EVAL_MAX_CLUSTERS_PER_IDENTITY,
          2,
        ),
      ),
    ),
    distanceThreshold: parseNumber(
      getArg("--distance-threshold") ??
        process.env.ALCOVES_FACE_RECOGNITION_MAX_DISTANCE ??
        process.env.ALCOVES_FACE_EVAL_DISTANCE_THRESHOLD,
      0.42,
    ),
  };
}

function cosineDistance(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < length; i++) {
    const va = a[i] ?? 0;
    const vb = b[i] ?? 0;
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom <= 0) return 1;
  const similarity = dot / denom;
  return 1 - similarity;
}

class UnionFind {
  private readonly parent: number[];
  private readonly rank: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, index) => index);
    this.rank = Array.from({ length: size }, () => 0);
  }

  find(index: number): number {
    if (this.parent[index] !== index) {
      this.parent[index] = this.find(this.parent[index]!);
    }
    return this.parent[index]!;
  }

  union(a: number, b: number): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return;

    const rankA = this.rank[rootA]!;
    const rankB = this.rank[rootB]!;
    if (rankA < rankB) {
      this.parent[rootA] = rootB;
    } else if (rankA > rankB) {
      this.parent[rootB] = rootA;
    } else {
      this.parent[rootB] = rootA;
      this.rank[rootA] = rankA + 1;
    }
  }
}

async function listDatasetSamples(datasetDir: string): Promise<Array<{ label: string; filePath: string }>> {
  const entries = await readdir(datasetDir, { withFileTypes: true });
  const labels = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const samples: Array<{ label: string; filePath: string }> = [];

  for (const label of labels) {
    const labelDir = join(datasetDir, label);
    const files = await readdir(labelDir, { withFileTypes: true });
    for (const file of files) {
      if (!file.isFile()) continue;
      const dotIndex = file.name.lastIndexOf(".");
      const extension = dotIndex >= 0 ? file.name.slice(dotIndex).toLowerCase() : "";
      if (!IMAGE_EXTENSIONS.has(extension)) continue;
      samples.push({ label, filePath: join(labelDir, file.name) });
    }
  }

  return samples.sort((a, b) => a.filePath.localeCompare(b.filePath));
}

async function extractEmbeddings(datasetDir: string): Promise<ExtractionResult> {
  const sampleFiles = await listDatasetSamples(datasetDir);
  const samples: SampleEmbedding[] = [];
  let facesDetected = 0;
  let multiFaceImages = 0;

  for (const sample of sampleFiles) {
    const buffer = await readFile(sample.filePath);
    const { faces } = await detectFaces(buffer);

    if (faces.length === 0) continue;
    facesDetected += 1;
    if (faces.length > 1) multiFaceImages += 1;

    const bestFace = [...faces].sort((a, b) => b.confidence - a.confidence)[0]!;
    const embedding = await computeEmbedding(buffer, bestFace);
    samples.push({
      label: sample.label,
      filePath: sample.filePath,
      embedding: Array.from(embedding),
    });
  }

  return {
    imagesTotal: sampleFiles.length,
    facesDetected,
    multiFaceImages,
    samples,
  };
}

function evaluatePairwise(
  samples: SampleEmbedding[],
  distanceThreshold: number,
): {
  pairPrecision: number;
  pairRecall: number;
  pairF1: number;
  clustersPerIdentity: Map<string, number>;
} {
  const unionFind = new UnionFind(samples.length);

  for (let i = 0; i < samples.length; i++) {
    for (let j = i + 1; j < samples.length; j++) {
      const distance = cosineDistance(samples[i]!.embedding, samples[j]!.embedding);
      if (distance <= distanceThreshold) {
        unionFind.union(i, j);
      }
    }
  }

  const clusterByIndex = samples.map((_, index) => unionFind.find(index));
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;

  for (let i = 0; i < samples.length; i++) {
    for (let j = i + 1; j < samples.length; j++) {
      const sameIdentity = samples[i]!.label === samples[j]!.label;
      const predictedSameCluster = clusterByIndex[i] === clusterByIndex[j];

      if (predictedSameCluster && sameIdentity) truePositive += 1;
      if (predictedSameCluster && !sameIdentity) falsePositive += 1;
      if (!predictedSameCluster && sameIdentity) falseNegative += 1;
    }
  }

  const pairPrecision = truePositive + falsePositive > 0 ? truePositive / (truePositive + falsePositive) : 1;
  const pairRecall = truePositive + falseNegative > 0 ? truePositive / (truePositive + falseNegative) : 1;
  const pairF1 =
    pairPrecision + pairRecall > 0 ? (2 * pairPrecision * pairRecall) / (pairPrecision + pairRecall) : 0;

  const clustersPerIdentity = new Map<string, Set<number>>();
  for (let i = 0; i < samples.length; i++) {
    const label = samples[i]!.label;
    const cluster = clusterByIndex[i]!;
    const existing = clustersPerIdentity.get(label) ?? new Set<number>();
    existing.add(cluster);
    clustersPerIdentity.set(label, existing);
  }

  return {
    pairPrecision,
    pairRecall,
    pairF1,
    clustersPerIdentity: new Map(
      Array.from(clustersPerIdentity.entries()).map(([label, clusters]) => [label, clusters.size]),
    ),
  };
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

async function main(): Promise<void> {
  const options = parseCli();
  const extraction = await extractEmbeddings(options.datasetDir);

  if (extraction.imagesTotal === 0) {
    throw new Error(`No images found in dataset directory: ${options.datasetDir}`);
  }

  if (extraction.samples.length < 2) {
    throw new Error(
      `Not enough embeddings produced (${extraction.samples.length}). Add at least 2 images with detectable faces.`,
    );
  }

  const detectionRate = extraction.facesDetected / extraction.imagesTotal;
  const evaluation = evaluatePairwise(extraction.samples, options.distanceThreshold);
  const worstFragmentation = Math.max(...evaluation.clustersPerIdentity.values());

  console.log("Face Recognition Evaluation");
  console.log(`Dataset: ${options.datasetDir}`);
  console.log(`Images total: ${extraction.imagesTotal}`);
  console.log(`Images with detected faces: ${extraction.facesDetected} (${formatPct(detectionRate)})`);
  console.log(`Images with multiple faces: ${extraction.multiFaceImages}`);
  console.log(`Embeddings generated: ${extraction.samples.length}`);
  console.log(`Distance threshold: ${options.distanceThreshold}`);
  console.log(`Pair precision: ${formatPct(evaluation.pairPrecision)}`);
  console.log(`Pair recall: ${formatPct(evaluation.pairRecall)}`);
  console.log(`Pair F1: ${formatPct(evaluation.pairF1)}`);
  console.log(`Worst fragmentation (clusters for one identity): ${worstFragmentation}`);

  for (const [label, clusterCount] of evaluation.clustersPerIdentity.entries()) {
    console.log(`Identity '${label}': ${clusterCount} predicted cluster(s)`);
  }

  const failures: string[] = [];
  if (detectionRate < options.minDetectionRate) {
    failures.push(
      `Detection rate ${formatPct(detectionRate)} is below minimum ${formatPct(options.minDetectionRate)}`,
    );
  }
  if (evaluation.pairF1 < options.minPairF1) {
    failures.push(`Pair F1 ${formatPct(evaluation.pairF1)} is below minimum ${formatPct(options.minPairF1)}`);
  }
  if (worstFragmentation > options.maxClustersPerIdentity) {
    failures.push(
      `Worst fragmentation ${worstFragmentation} exceeds max ${options.maxClustersPerIdentity} clusters per identity`,
    );
  }

  if (failures.length > 0) {
    console.error("\nEvaluation failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("\nEvaluation passed.");
}

await main();
