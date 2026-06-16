# AI Ticket Triage Service

An Express-based service that classifies support tickets in batch using Anthropic Claude Sonnet, persists results to SQLite, accepts human feedback, and reports triage accuracy over time.

## Tech Stack

- Node.js
- Express
- CommonJS
- better-sqlite3
- Anthropic Claude Sonnet (`@anthropic-ai/sdk`)
- dotenv

## Installation

```bash
npm install
```

## Setup

1. Copy the example environment file:

```bash
cp .env.example .env
```

2. Add your Anthropic API key to `.env`:

```env
PORT=3000
ANTHROPIC_API_KEY=your_anthropic_key_here
```

3. Start the server:

```bash
npm start
```

For development with auto-reload:

```bash
npm run dev
```

The API listens on `http://localhost:3000` by default.


## Architecture

```
Client
  |
  v
server.js
  |
  +-- routes/triage.routes.js
  |     |
  |     +-- services/triage.service.js   (Claude batch triage + stats)
  |     +-- services/feedback.service.js   (human corrections)
  |     +-- services/accuracy.service.js   (precision reporting)
  |
  +-- database/db.js                       (SQLite schema + connection)
  |
  +-- data/
        triage_results.json                 (latest batch response)
        accuracy_report.json                (latest accuracy report)
```

### Request Flow

1. **POST /triage** sends all tickets in one Claude request.
2. Results are validated, stored in SQLite, and written to `data/triage_results.json`.
3. **POST /triage/:id/feedback** stores reviewer corrections linked to the original AI prediction.
4. **GET /triage/accuracy** reads feedback from the database and writes `data/accuracy_report.json`.
5. **GET /triage/stats** aggregates ticket activity from the last 24 hours.

## Database Design

SQLite database file: `triage.db` (created automatically on startup).

Foreign keys are enabled.

### `batch_runs`

Tracks each Claude batch invocation.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment row id |
| `batch_id` | TEXT | UUID for the batch |
| `ticket_count` | INTEGER | Number of tickets processed |
| `input_tokens` | INTEGER | Total Claude input tokens |
| `output_tokens` | INTEGER | Total Claude output tokens |
| `processing_time_ms` | INTEGER | End-to-end batch latency |
| `created_at` | TEXT | Timestamp |

### `tickets`

Stores individual triage results.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Ticket id from the request |
| `description` | TEXT | Original ticket text |
| `category` | TEXT | AI category |
| `priority` | TEXT | AI priority |
| `assigned_team` | TEXT | Routed team |
| `summary` | TEXT | Short AI summary (<= 20 words) |
| `confidence` | REAL | Confidence score (0 to 1) |
| `batch_id` | TEXT | Associated batch |
| `input_tokens` | INTEGER | Allocated input tokens |
| `output_tokens` | INTEGER | Allocated output tokens |
| `processing_time_ms` | INTEGER | Batch processing time |
| `created_at` | TEXT | Timestamp |

### `feedback`

Stores one reviewer correction per ticket.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment row id |
| `ticket_id` | TEXT UNIQUE | References `tickets.id` |
| `ai_category` | TEXT | Original AI category |
| `ai_priority` | TEXT | Original AI priority |
| `corrected_category` | TEXT | Human-corrected category |
| `corrected_priority` | TEXT | Human-corrected priority |
| `reviewer_id` | TEXT | Reviewer identifier |
| `category_wrong` | INTEGER | `1` if category differed, else `0` |
| `priority_wrong` | INTEGER | `1` if priority differed, else `0` |
| `created_at` | TEXT | Timestamp |

## Allowed Values

**Categories:** Billing, Technical, Account, Feature Request, Other

**Priorities:** Low, Medium, High, Critical

**Teams:** Billing Team, Engineering, Customer Success, Product

## API Endpoints

### POST /triage

Classify a batch of tickets with a single Claude API call.

```bash
curl -X POST http://localhost:3000/triage \
  -H "Content-Type: application/json" \
  -d '{
    "tickets": [
      {
        "id": "T001",
        "description": "I was charged twice for my subscription this month."
      },
      {
        "id": "T002",
        "description": "The mobile app crashes whenever I open settings."
      }
    ]
  }'
```

Example response:

```json
{
  "batch_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "ticket_count": 2,
  "input_tokens": 420,
  "output_tokens": 180,
  "processing_time_ms": 2100,
  "results": [
    {
      "id": "T001",
      "category": "Billing",
      "priority": "High",
      "assigned_team": "Billing Team",
      "summary": "Customer charged twice for subscription.",
      "confidence": 0.95
    }
  ]
}
```

### GET /triage/stats

Return aggregate metrics for the last 24 hours from SQLite.

```bash
curl http://localhost:3000/triage/stats
```

Example response:

```json
{
  "totalTicketsProcessed": 50,
  "totalBatchesProcessed": 1,
  "averageProcessingTimeMs": 1000,
  "inputTokens": 1000,
  "outputTokens": 500,
  "estimatedCost": 0.01,
  "categoryDistribution": [
    {
      "category": "Billing",
      "count": 10,
      "percentage": 20
    }
  ]
}
```

### POST /triage/:id/feedback

Submit reviewer corrections for a triaged ticket.

```bash
curl -X POST http://localhost:3000/triage/T001/feedback \
  -H "Content-Type: application/json" \
  -d '{
    "corrected_category": "Account",
    "corrected_priority": "Medium",
    "reviewer_id": "agent-1"
  }'
```

Returns `404` if the ticket does not exist and `409` if feedback was already submitted.

### GET /triage/accuracy

Generate an accuracy report from feedback data and write it to `data/accuracy_report.json`.

```bash
curl http://localhost:3000/triage/accuracy
```

Example response:

```json
{
  "categories": [
    {
      "category": "Billing",
      "reviewed": 10,
      "correct": 8,
      "precision": 80,
      "correctionPatterns": [
        {
          "from": "Billing",
          "to": "Account",
          "count": 2
        }
      ]
    }
  ],
  "overallPrecision": 84,
  "needsPromptRefinement": [
    {
      "category": "Billing",
      "precision": 60
    }
  ],
  "generatedAt": "2026-06-16T10:00:00.000Z"
}
```

Categories with precision below 70 are flagged in `needsPromptRefinement`.

## Output Files

- `data/triage_results.json` — latest batch triage response
- `data/accuracy_report.json` — latest accuracy report

## Cost Notes

Estimated cost in `/triage/stats` uses Claude Sonnet pricing assumptions:

- Input: $3.00 per 1M tokens
- Output: $15.00 per 1M tokens

See `cost_comparison.md` for a batch-vs-individual API call analysis.

## Health Check

```bash
curl http://localhost:3000/health
```

## License

ISC
