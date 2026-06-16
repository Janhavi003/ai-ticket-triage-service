const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../database/db');

const CATEGORIES = [
'Billing',
'Technical',
'Account',
'Feature Request',
'Other',
];

const PRIORITIES = [
'Low',
'Medium',
'High',
'Critical',
];

const TEAMS = [
'Billing Team',
'Engineering',
'Customer Success',
'Product',
];

const MODEL = 'claude-sonnet-4-20250514';

const RESULTS_PATH = path.join(
__dirname,
'..',
'data',
'triage_results.json'
);

const INPUT_COST_PER_TOKEN = 3 / 1_000_000;
const OUTPUT_COST_PER_TOKEN = 15 / 1_000_000;

const client = new Anthropic({
apiKey: process.env.ANTHROPIC_API_KEY,
});

function buildPrompt(tickets) {
return `
You are a support ticket triage assistant.

Classify ALL tickets.

Return ONLY valid JSON.

No markdown.
No code fences.
No explanations.

Response format:

{
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

Rules:

Allowed Categories:
${CATEGORIES.join(', ')}

Allowed Priorities:
${PRIORITIES.join(', ')}

Allowed Teams:
${TEAMS.join(', ')}

Team Mapping:
Billing -> Billing Team
Technical -> Engineering
Account -> Customer Success
Feature Request -> Product
Other -> Customer Success

Summary Rules:

* Maximum 20 words
* Clear and concise

Confidence Rules:

* Number between 0 and 1

Return one result for every ticket.

Tickets:

${JSON.stringify(tickets, null, 2)}
`;
}

function extractJson(text) {
const trimmed = text.trim();

try {
return JSON.parse(trimmed);
} catch (_) {}

const fenceMatch = trimmed.match(
/`(?:json)?\s*([\s\S]*?)`/i
);

if (fenceMatch) {
try {
return JSON.parse(fenceMatch[1].trim());
} catch (_) {}
}

const start = trimmed.search(/[[{]/);
const end = Math.max(
trimmed.lastIndexOf('}'),
trimmed.lastIndexOf(']')
);

if (
start !== -1 &&
end !== -1 &&
end > start
) {
try {
return JSON.parse(
trimmed.slice(start, end + 1)
);
} catch (_) {}
}

throw new Error(
'Claude returned malformed JSON'
);
}

function countWords(text) {
return text
.trim()
.split(/\s+/)
.filter(Boolean).length;
}

function validateResult(result, ticketIds) {
const requiredFields = [
'id',
'category',
'priority',
'assigned_team',
'summary',
'confidence',
];

for (const field of requiredFields) {
if (
result[field] === undefined ||
result[field] === null ||
result[field] === ''
) {
throw new Error(
`Missing field ${field}`
);
}
}

if (!ticketIds.has(result.id)) {
throw new Error(
`Unexpected ticket id ${result.id}`
);
}

if (
!CATEGORIES.includes(result.category)
) {
throw new Error(
`Invalid category ${result.category}`
);
}

if (
!PRIORITIES.includes(result.priority)
) {
throw new Error(
`Invalid priority ${result.priority}`
);
}

if (
!TEAMS.includes(result.assigned_team)
) {
throw new Error(
`Invalid team ${result.assigned_team}`
);
}

if (
countWords(String(result.summary)) > 20
) {
throw new Error(
`Summary exceeds 20 words for ${result.id}`
);
}

const confidence = Number(
result.confidence
);

if (
Number.isNaN(confidence) ||
confidence < 0 ||
confidence > 1
) {
throw new Error(
`Invalid confidence for ${result.id}`
);
}

return {
id: String(result.id),
category: result.category,
priority: result.priority,
assigned_team: result.assigned_team,
summary: String(result.summary).trim(),
confidence: Number(
confidence.toFixed(2)
),
};
}

async function callClaude(tickets) {
const prompt = buildPrompt(tickets);

const response =
await client.messages.create({
model: MODEL,
temperature: 0,
max_tokens: 8192,
messages: [
{
role: 'user',
content: prompt,
},
],
});

const textBlock =
response.content.find(
(block) => block.type === 'text'
);

if (!textBlock) {
throw new Error(
'Claude returned no text'
);
}

const parsed = extractJson(
textBlock.text
);

const results = Array.isArray(parsed)
? parsed
: parsed.results;

if (!Array.isArray(results)) {
throw new Error(
'Claude response must contain results array'
);
}

return {
results,
inputTokens:
response.usage?.input_tokens || 0,
outputTokens:
response.usage?.output_tokens || 0,
};
}

function writeResultsFile(payload) {
fs.writeFileSync(
RESULTS_PATH,
JSON.stringify(payload, null, 2)
);
}

async function triageTickets(tickets) {
if (
!Array.isArray(tickets) ||
tickets.length === 0
) {
throw new Error(
'tickets array is required'
);
}

const batchId = crypto.randomUUID();

const startTime = Date.now();

const {
results: rawResults,
inputTokens,
outputTokens,
} = await callClaude(tickets);

const processingTimeMs =
Date.now() - startTime;

const ticketMap = new Map(
tickets.map((ticket) => [
String(ticket.id),
ticket,
])
);

const ticketIds = new Set(
ticketMap.keys()
);

const validatedResults =
rawResults.map((result) =>
validateResult(result, ticketIds)
);

if (
validatedResults.length !==
tickets.length
) {
throw new Error(
'Claude must return one result per ticket'
);
}

if (
new Set(
validatedResults.map(
(r) => r.id
)
).size !== tickets.length
) {
throw new Error(
'Duplicate ticket ids returned by Claude'
);
}

const perTicketInputTokens =
Math.floor(
inputTokens / tickets.length
);

const perTicketOutputTokens =
Math.floor(
outputTokens / tickets.length
);

const insertBatch =
db.prepare(`       INSERT INTO batch_runs (
        batch_id,
        ticket_count,
        input_tokens,
        output_tokens,
        processing_time_ms
      )
      VALUES (?, ?, ?, ?, ?)
    `);

const insertTicket =
db.prepare(`       INSERT OR REPLACE INTO tickets (
        id,
        description,
        category,
        priority,
        assigned_team,
        summary,
        confidence,
        batch_id,
        input_tokens,
        output_tokens,
        processing_time_ms
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

const saveBatch = db.transaction(() => {
insertBatch.run(
batchId,
tickets.length,
inputTokens,
outputTokens,
processingTimeMs
);

```
for (const result of validatedResults) {
  const source = ticketMap.get(
    result.id
  );

  insertTicket.run(
    result.id,
    source.description,
    result.category,
    result.priority,
    result.assigned_team,
    result.summary,
    result.confidence,
    batchId,
    perTicketInputTokens,
    perTicketOutputTokens,
    processingTimeMs
  );
}
```

});

saveBatch();

const payload = {
batch_id: batchId,
ticket_count: tickets.length,
input_tokens: inputTokens,
output_tokens: outputTokens,
processing_time_ms:
processingTimeMs,
results: validatedResults,
};

writeResultsFile(payload);

return payload;
}

function getStats() {
const batchStats = db.prepare(`     SELECT
      COUNT(*) AS totalBatchesProcessed,
      COALESCE(
        AVG(processing_time_ms),
        0
      ) AS averageProcessingTimeMs,
      COALESCE(
        SUM(input_tokens),
        0
      ) AS inputTokens,
      COALESCE(
        SUM(output_tokens),
        0
      ) AS outputTokens
    FROM batch_runs
    WHERE datetime(created_at)       >= datetime('now','-24 hours')
  `).get();

const ticketStats = db.prepare(`     SELECT
      COUNT(*) AS totalTicketsProcessed
    FROM tickets
    WHERE datetime(created_at)       >= datetime('now','-24 hours')
  `).get();

const categoryRows = db.prepare(`     SELECT
      category,
      COUNT(*) AS count
    FROM tickets
    WHERE datetime(created_at)       >= datetime('now','-24 hours')
    GROUP BY category
    ORDER BY count DESC
  `).all();

const totalTickets =
ticketStats.totalTicketsProcessed || 0;

const categoryDistribution =
categoryRows.map((row) => ({
category: row.category,
count: row.count,
percentage:
totalTickets === 0
? 0
: Number(
(
(row.count /
totalTickets) *
100
).toFixed(2)
),
}));

const inputTokens =
batchStats.inputTokens || 0;

const outputTokens =
batchStats.outputTokens || 0;

const estimatedCost =
inputTokens *
INPUT_COST_PER_TOKEN +
outputTokens *
OUTPUT_COST_PER_TOKEN;

return {
totalTicketsProcessed:
totalTickets,
totalBatchesProcessed:
batchStats.totalBatchesProcessed ||
0,
averageProcessingTimeMs:
Math.round(
batchStats.averageProcessingTimeMs ||
0
),
inputTokens,
outputTokens,
estimatedCost: Number(
estimatedCost.toFixed(4)
),
categoryDistribution,
};
}

module.exports = {
triageTickets,
getStats,
CATEGORIES,
PRIORITIES,
TEAMS,
};
