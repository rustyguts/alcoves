# Face Recognition Dataset

Put your local benchmark photos in this directory, grouped by identity:

```text
test/fixtures/face-recognition/
  me/
    photo-01.jpg
    photo-02.jpg
  friend-1/
    img-a.jpg
    img-b.jpg
```

Rules:

- One subdirectory per identity (folder name is the expected label).
- Include only images where that identity is the primary face.
- Use at least 2 images per identity for meaningful pairwise metrics.

Run the evaluator:

```bash
bun run test:face-ml
```

Optional thresholds:

```bash
bun run test:face-ml --min-pair-f1 0.93 --min-detection-rate 0.95 --max-clusters-per-identity 1
```
