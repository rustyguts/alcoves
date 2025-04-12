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

	if (isRunningInDocker()) {
		dataDir = "/data";
	} else {
		dataDir = `${process.cwd()}/../data`;
	}

	if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

	return dataDir;
}

export function getDirectory(type: "tmpDir" | "cacheDir" | "assetDir"): {
	id: string;
	directory: string;
} {
	const { tmpDir, cacheDir, assetsDir } = getBaseDirectories();
	const id = randomUUIDv7();
	let directory = "";
	if (type === "tmpDir") {
		directory = `${tmpDir}/${id}`;
	} else if (type === "cacheDir") {
		directory = `${cacheDir}/${id}`;
	} else if (type === "assetDir") {
		directory = `${assetsDir}/${id}`;
	} else {
		throw new Error("Invalid type");
	}

	mkdirSync(directory, { recursive: true });
	return { id, directory };
}

export function getDatabasePath(): string {
	const dataDir = getDataDirectory();
	return `${dataDir}/alcoves.db`;
}

export function getBaseDirectories(): {
	tmpDir: string;
	cacheDir: string;
	assetsDir: string;
} {
	const dataDir = getDataDirectory();
	const tmpDir = `${dataDir}/tmp`;
	const cacheDir = `${dataDir}/cache`;
	const assetsDir = `${dataDir}/assets`;

	if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
	if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
	if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
	if (!existsSync(assetsDir)) mkdirSync(assetsDir, { recursive: true });

	return { tmpDir, cacheDir, assetsDir };
}

getBaseDirectories();
