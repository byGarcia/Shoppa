import { randomUUID } from "crypto";
import { apiText } from "@/lib/api-messages";

/**
 * In-process queue of "download this URL for me" jobs that an external fetcher
 * inside the operator's own network picks up within seconds.
 * `PRICE_FETCH_MODE=assisted` only.
 *
 * Why this exists: shops like Amazon serve a datacenter address a bot wall but
 * hand a residential one the real page. Rather than opening a path INTO that
 * network (a tunnelled fetch service is an open proxy the day its token leaks),
 * the fetcher keeps polling outwards: it asks `GET /api/prices/fetch-jobs`,
 * does the download, and POSTs the HTML back. Same result, no inbound surface.
 *
 * Deliberately in memory, not in Postgres: a job lives for seconds, and keeping
 * it out of the DB avoids a migration and any cleanup story. The trade-off is
 * that it only works while the app runs as a SINGLE container — with two
 * replicas the fetcher could complete a job on the instance that did not create
 * it. Recorded here so nobody scales it out and wonders why previews hang.
 */

export type JobResult = { html: string } | { error: string };

type Job = {
  id: string;
  url: string;
  createdAt: number;
  takenAt?: number;
  settle: (result: JobResult) => void;
  promise: Promise<JobResult>;
};

/** A job nobody claimed by then is dead; the requester has long given up. */
const JOB_TTL_MS = 60_000;

const jobs = new Map<string, Job>();

async function sweep(): Promise<void> {
  const now = Date.now();
  const expired = [...jobs].filter(([, job]) => now - job.createdAt > JOB_TTL_MS);
  if (expired.length === 0) return;
  // This reason ends up in the product's lastError, which the card shows.
  const reason = await apiText("fetch.workerDidNotTake");
  for (const [id, job] of expired) {
    job.settle({ error: reason });
    jobs.delete(id);
  }
}

export function enqueueFetch(url: string): Job {
  void sweep();
  let settle!: (result: JobResult) => void;
  const promise = new Promise<JobResult>((resolve) => {
    settle = resolve;
  });
  const job: Job = { id: randomUUID(), url, createdAt: Date.now(), settle, promise };
  jobs.set(job.id, job);
  return job;
}

/**
 * Hand the pending jobs to the agent. Marking them taken means a job is served
 * once: if the agent dies mid-download the requester times out rather than two
 * agents racing on the same URL.
 */
export function listPendingJobs(): Array<{ id: string; url: string }> {
  sweep();
  const pending: Array<{ id: string; url: string }> = [];
  for (const job of jobs.values()) {
    if (job.takenAt) continue;
    job.takenAt = Date.now();
    pending.push({ id: job.id, url: job.url });
  }
  return pending;
}

export function completeFetch(id: string, result: JobResult): boolean {
  const job = jobs.get(id);
  if (!job) return false;
  job.settle(result);
  jobs.delete(id);
  return true;
}

/** Wait for the agent, but never hang a request: on timeout the caller falls back. */
export async function awaitFetch(job: Job, timeoutMs: number): Promise<JobResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onTimeout = await apiText("fetch.workerTimedOut");
  const timeout = new Promise<JobResult>((resolve) => {
    timer = setTimeout(() => resolve({ error: onTimeout }), timeoutMs);
  });
  try {
    return await Promise.race([job.promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    jobs.delete(job.id);
  }
}
