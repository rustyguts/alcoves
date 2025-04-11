import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { randomUUIDv7 } from "bun";

function isRunningInDocker(): boolean {
	let inDocker = false;
	try {
		if (existsSync("/.dockerenv")) {
			inDocker = true;
			return inDocker;
		}

		const cgroupContent = readFileSync("/proc/self/cgroup", "utf-8");
		return cgroupContent.includes("docker");
	} catch (error) {
		return false;
	}
}

export function getDataDirectory(): string {
	let dataDir = "";
	const ENV_OVERRIDE = process.env.ALCOVES_DATA_DIR;

	if (ENV_OVERRIDE) {
		dataDir = ENV_OVERRIDE;
	}

	if (isRunningInDocker()) {
		dataDir = "/data";
	} else {
		dataDir = `${process.cwd()}/../data`;
	}

	if (!existsSync(dataDir)) {
		mkdirSync(dataDir, { recursive: true });
	}

	return dataDir;
}

export function getBaseAssetsDirectory(): string {
	const dataDir = getDataDirectory();
	const assetsDir = `${dataDir}/assets`;

	if (!existsSync(assetsDir)) {
		mkdirSync(assetsDir, { recursive: true });
	}

	return assetsDir;
}

export function getAssetDirectory(): { directory: string; id: string } {
	const assetsDir = getBaseAssetsDirectory();
	const id = randomUUIDv7();
	const directory = `${assetsDir}/${id}`;

	if (!existsSync(directory)) {
		mkdirSync(directory, { recursive: true });
	}

	return {
		id,
		directory,
	};
}

export function getTemporaryDirectory(): { directory: string; id: string } {
	const dataDir = getDataDirectory();
	const id = randomUUIDv7();
	const directory = `${dataDir}/tmp/${id}`;

	if (!existsSync(directory)) {
		mkdirSync(directory, { recursive: true });
	}

	return {
		id,
		directory,
	};
}

export function getDatabasePath(): string {
	const dataDir = getDataDirectory();
	const databasePath = `${dataDir}/alcoves.db`;

	return databasePath;
}

console.info("Alcoves Data Directory:", getDataDirectory());
console.info("Database path:", getDatabasePath());
console.info("Assets path:", getBaseAssetsDirectory());
console.info(
	`Alcoves is ${isRunningInDocker() ? "running in a container" : "not running in a container"}.`,
);
