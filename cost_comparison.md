# Cost Comparison: Batch Triage vs Individual API Calls

This document compares processing **one batch of 50 tickets** in a single Claude request versus making **50 separate Claude requests** (one ticket per call).

Assumptions:

- Model: Claude Sonnet
- Pricing used for estimates:
  - Input: **$3.00 / 1M tokens**
  - Output: **$15.00 / 1M tokens**
- Average ticket description: ~120 words (~160 input tokens per ticket body)
- Average structured triage output per ticket: ~80 output tokens
- System/instruction prompt overhead: ~450 tokens

## Scenario A: One Batch of 50 Tickets

| Metric | Estimate |
|--------|----------|
| API calls | **1** |
| Input tokens | ~8,450 (450 prompt + 50 × 160 ticket text) |
| Output tokens | ~4,000 (50 × 80) |
| Input cost | $0.0254 |
| Output cost | $0.0600 |
| **Total API cost** | **~$0.085** |
| End-to-end latency | ~3–8 seconds (one round trip) |

## Scenario B: 50 Individual API Calls

| Metric | Estimate |
|--------|----------|
| API calls | **50** |
| Input tokens | ~10,250 (50 × (450 prompt + 160 ticket text)) |
| Output tokens | ~4,000 (50 × 80) |
| Input cost | $0.0308 |
| Output cost | $0.0600 |
| **Total API cost** | **~$0.091** |
| End-to-end latency | ~150–400 seconds sequential, ~10–20 seconds fully parallel |

## Comparison Summary

| Dimension | Batch (1 call) | Individual (50 calls) | Winner |
|-----------|----------------|------------------------|--------|
| API cost | ~$0.085 | ~$0.091 | Batch (~6% cheaper) |
| Input token overhead | 1× system prompt | 50× system prompt | Batch |
| Output tokens | Same total | Same total | Tie |
| Latency (sequential) | ~3–8 s | ~150–400 s | Batch |
| Latency (parallel) | ~3–8 s | ~10–20 s + orchestration | Batch |
| Rate-limit exposure | 1 request | 50 requests | Batch |
| Failure handling | All-or-nothing retry | Partial success possible | Individual |
| Simplicity | Single parse/validate path | Aggregation + dedup needed | Batch |

## Latency

Batch triage completes in a single network round trip. The model processes all tickets together, so total wall-clock time stays close to one inference job.

Individual calls multiply latency:

- **Sequential processing:** 50 calls × ~3–8 seconds each ≈ **2.5–7 minutes**
- **Parallel processing:** limited by provider rate limits, connection pools, and client concurrency; still requires orchestration overhead and 50 response validations

For operational triage pipelines, batching dramatically reduces time-to-route tickets to the correct teams.

## Token Overhead

The largest difference is **repeated system/instruction prompt tokens**.

- Batch: pay for instructions once
- Individual: pay for the same instructions 50 times

With 450 tokens of prompt overhead:

- Batch extra cost from prompt: 450 input tokens
- Individual extra cost from prompt: 22,500 input tokens

That is **~22,050 extra input tokens**, or about **$0.066** additional cost per 50-ticket cycle when using individual calls.

As batch size grows, the relative savings from batching increase because prompt overhead is amortized across more tickets.

## API Cost

Output token cost is nearly identical because the model still returns one structured result per ticket.

Input token cost favors batching because shared instructions are sent once. For 50 tickets the savings are modest in absolute dollars (~$0.006 per batch) but become significant at scale:

| Tickets / day | Individual daily input overhead | Batch daily input overhead | Daily savings |
|---------------|----------------------------------|----------------------------|---------------|
| 500 | ~$0.66 | ~$0.001 | ~$0.66 |
| 5,000 | ~$6.60 | ~$0.001 | ~$6.60 |
| 50,000 | ~$66.00 | ~$0.001 | ~$66.00 |

These figures isolate prompt duplication savings and exclude variable ticket body length.

## Scalability

### Batch approach

**Pros**

- Minimal request count against provider rate limits
- Lower operations complexity (one validation path, one DB transaction)
- Better throughput for nightly or hourly ingestion jobs
- Lower median latency for downstream routing

**Cons**

- Large batches increase single-response size and may require higher `max_tokens`
- One malformed batch response affects the entire group unless retry logic reprocesses all tickets
- Very large batches may approach context window limits

### Individual approach

**Pros**

- Fine-grained retries per ticket
- Easier incremental processing for streaming ticket intake
- Smaller per-request payloads

**Cons**

- Higher cumulative prompt cost
- More HTTP/API management code
- Greater exposure to rate limiting under load
- Harder to maintain consistent batch-level analytics unless reconstructed manually

## Recommendation

For this triage service, **batch processing is the preferred production design**:

1. It matches the assignment requirement of one Claude call per batch.
2. It reduces latency from minutes to seconds.
3. It lowers input token waste from repeated instructions.
4. It scales more predictably under higher ticket volume.

Use individual calls only when tickets arrive one-at-a-time and must be routed within seconds with no batching window, or when partial failure isolation is more important than cost and throughput.

## Implementation Note

This service implements the batch model in `services/triage.service.js`:

- One `messages.create` call per request
- Shared token and timing metrics stored in `batch_runs`
- Per-ticket rows in `tickets` for analytics and feedback loops

That design aligns cost, latency, and scalability with high-volume support operations.
