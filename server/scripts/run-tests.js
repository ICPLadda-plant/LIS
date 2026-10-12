const { readdirSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");

function testFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : testFiles(path);
    return /\.(test|spec)\.js$/.test(entry.name) ? [path] : [];
  });
}

const files = testFiles(process.cwd());
const nodeTests = files.filter((path) => readFileSync(path, "utf8").includes("node:test"));
const jestTests = files.filter((path) => !nodeTests.includes(path));

const nodeResult = spawnSync(process.execPath, ["--test", ...nodeTests], { stdio: "inherit" });
const jestResult = spawnSync(process.execPath, [require.resolve("jest/bin/jest"), ...jestTests, "--runInBand"], { stdio: "inherit" });

if (nodeResult.error) throw nodeResult.error;
if (jestResult.error) throw jestResult.error;
process.exitCode = nodeResult.status || jestResult.status || 0;
