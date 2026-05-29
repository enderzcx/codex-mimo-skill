import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const STATE_VERSION = 1;
const MAX_JOBS = 50;

export function nowIso() {
  return new Date().toISOString();
}

export function resolveWorkspaceRoot(cwd = process.cwd()) {
  const result = spawnSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  return resolve(cwd);
}

export function resolveStateDir(cwd = process.cwd()) {
  const root = resolveWorkspaceRoot(cwd);
  const slug = (root.split("/").filter(Boolean).pop() || "workspace")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "workspace";
  const hash = createHash("sha256").update(root).digest("hex").slice(0, 16);
  return join(homedir(), ".local", "state", "codex-mimo-skill", `${slug}-${hash}`);
}

export function resolveJobsDir(cwd = process.cwd()) {
  return join(resolveStateDir(cwd), "jobs");
}

export function resolveStateFile(cwd = process.cwd()) {
  return join(resolveStateDir(cwd), "state.json");
}

export function resolveJobFile(cwd, jobId) {
  return join(resolveJobsDir(cwd), `${jobId}.json`);
}

export function resolveJobLogFile(cwd, jobId) {
  return join(resolveJobsDir(cwd), `${jobId}.log`);
}

export function ensureStateDir(cwd = process.cwd()) {
  mkdirSync(resolveJobsDir(cwd), { recursive: true });
}

function defaultState() {
  return { version: STATE_VERSION, jobs: [] };
}

export function loadState(cwd = process.cwd()) {
  const stateFile = resolveStateFile(cwd);
  if (!existsSync(stateFile)) return defaultState();
  try {
    const parsed = JSON.parse(readFileSync(stateFile, "utf8"));
    return {
      ...defaultState(),
      ...parsed,
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
    };
  } catch {
    return defaultState();
  }
}

export function saveState(cwd, state) {
  ensureStateDir(cwd);
  const jobs = [...(state.jobs ?? [])]
    .sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")))
    .slice(0, MAX_JOBS);
  const next = { version: STATE_VERSION, jobs };
  writeFileSync(resolveStateFile(cwd), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  pruneJobArtifacts(cwd, new Set(jobs.map((job) => job.id)));
  return next;
}

function pruneJobArtifacts(cwd, retainedIds) {
  const jobsDir = resolveJobsDir(cwd);
  if (!existsSync(jobsDir)) return;
  for (const entry of readdirSync(jobsDir)) {
    const match = entry.match(/^(.*)\.(?:json|log)$/);
    if (!match || retainedIds.has(match[1])) continue;
    rmSync(join(jobsDir, entry), { force: true });
  }
}

export function generateJobId(prefix = "mimo") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function upsertJob(cwd, patch) {
  const timestamp = nowIso();
  const state = loadState(cwd);
  const index = state.jobs.findIndex((job) => job.id === patch.id);
  const nextJob = index === -1
    ? { createdAt: timestamp, ...patch, updatedAt: timestamp }
    : { ...state.jobs[index], ...patch, updatedAt: timestamp };
  if (index === -1) state.jobs.unshift(nextJob);
  else state.jobs[index] = nextJob;
  saveState(cwd, state);
  return nextJob;
}

export function writeJob(cwd, jobId, payload) {
  ensureStateDir(cwd);
  writeFileSync(resolveJobFile(cwd, jobId), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
}

export function readJob(cwd, jobId) {
  const path = resolveJobFile(cwd, jobId);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

export function appendLog(cwd, jobId, message) {
  ensureStateDir(cwd);
  const line = String(message ?? "").trim();
  if (!line) return;
  writeFileSync(resolveJobLogFile(cwd, jobId), `[${nowIso()}] ${line}\n`, { flag: "a" });
}

export function createJob(cwd, job) {
  const created = upsertJob(cwd, job);
  writeJob(cwd, job.id, created);
  return created;
}

export function updateJob(cwd, jobId, patch) {
  const current = readJob(cwd, jobId) ?? {};
  const next = upsertJob(cwd, { ...current, ...patch, id: jobId });
  writeJob(cwd, jobId, next);
  return next;
}

export function listJobs(cwd = process.cwd()) {
  return loadState(cwd).jobs;
}

export function resolveJobReference(cwd, reference = "", predicate = () => true) {
  const jobs = listJobs(cwd).filter(predicate);
  if (!jobs.length) return null;
  if (!reference) return jobs[0];
  return jobs.find((job) => job.id === reference || job.id.startsWith(reference)) ?? null;
}

export function isActiveStatus(status) {
  return status === "queued" || status === "running";
}
