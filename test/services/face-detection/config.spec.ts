describe("face-detection config", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore original env
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("ALCOVES_FACE_")) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
    vi.resetModules();
  });

  async function loadConfig() {
    return await import("~~/server/services/face-detection/config");
  }

  it("uses default values when env vars are not set", async () => {
    delete process.env.ALCOVES_FACE_DETECTION_MIN_SCORE;
    delete process.env.ALCOVES_FACE_RECOGNITION_MAX_DISTANCE;
    delete process.env.ALCOVES_FACE_RECOGNITION_NEIGHBOR_LOOKUP;
    delete process.env.ALCOVES_FACE_RECOGNITION_MIN_FACES;
    delete process.env.ALCOVES_FACE_QUALITY_MIN_SCORE;

    const config = await loadConfig();
    expect(config.FACE_DETECTION_MIN_SCORE).toBe(0.55);
    expect(config.FACE_RECOGNITION_MAX_DISTANCE).toBe(0.52);
    expect(config.FACE_RECOGNITION_NEIGHBOR_LOOKUP).toBe(80);
    expect(config.FACE_RECOGNITION_MIN_FACES).toBe(2);
    expect(config.FACE_QUALITY_MIN_SCORE).toBe(0.25);
  });

  it("reads FACE_DETECTION_MIN_SCORE from env and clamps", async () => {
    process.env.ALCOVES_FACE_DETECTION_MIN_SCORE = "0.8";
    const config = await loadConfig();
    expect(config.FACE_DETECTION_MIN_SCORE).toBe(0.8);
  });

  it("clamps FACE_DETECTION_MIN_SCORE to valid range", async () => {
    process.env.ALCOVES_FACE_DETECTION_MIN_SCORE = "5.0";
    const config = await loadConfig();
    expect(config.FACE_DETECTION_MIN_SCORE).toBe(0.99);
  });

  it("reads FACE_RECOGNITION_MAX_DISTANCE from env", async () => {
    process.env.ALCOVES_FACE_RECOGNITION_MAX_DISTANCE = "0.45";
    const config = await loadConfig();
    expect(config.FACE_RECOGNITION_MAX_DISTANCE).toBe(0.45);
  });

  it("reads FACE_QUALITY_MIN_SCORE from env", async () => {
    process.env.ALCOVES_FACE_QUALITY_MIN_SCORE = "0.5";
    const config = await loadConfig();
    expect(config.FACE_QUALITY_MIN_SCORE).toBe(0.5);
  });

  it("ignores non-numeric env values and uses defaults", async () => {
    process.env.ALCOVES_FACE_DETECTION_MIN_SCORE = "notanumber";
    const config = await loadConfig();
    expect(config.FACE_DETECTION_MIN_SCORE).toBe(0.55);
  });

  it("enforces minimum of 1 for FACE_RECOGNITION_MIN_FACES", async () => {
    process.env.ALCOVES_FACE_RECOGNITION_MIN_FACES = "0";
    const config = await loadConfig();
    expect(config.FACE_RECOGNITION_MIN_FACES).toBe(1);
  });
});
