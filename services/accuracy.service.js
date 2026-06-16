const fs = require('fs');
const path = require('path');
const db = require('../database/db');
const { CATEGORIES } = require('./triage.service');

const REPORT_PATH = path.join(
  __dirname,
  '..',
  'data',
  'accuracy_report.json'
);

function buildCategoryReport(category) {
  const reviewedRow = db.prepare(`
    SELECT COUNT(*) AS reviewed
    FROM feedback
    WHERE ai_category = ?
  `).get(category);

  const reviewed = reviewedRow.reviewed || 0;

  const correctRow = db.prepare(`
    SELECT COUNT(*) AS correct
    FROM feedback
    WHERE ai_category = ?
    AND category_wrong = 0
  `).get(category);

  const correct = correctRow.correct || 0;

  const precision =
    reviewed === 0
      ? 0
      : Number(((correct / reviewed) * 100).toFixed(2));

  const patternRows = db.prepare(`
    SELECT
      corrected_category,
      COUNT(*) AS count
    FROM feedback
    WHERE ai_category = ?
      AND category_wrong = 1
    GROUP BY corrected_category
    ORDER BY count DESC
  `).all(category);

  const correctionPatterns = patternRows.map((row) => ({
    from: category,
    to: row.corrected_category,
    count: row.count,
  }));

  return {
    category,
    reviewed,
    correct,
    precision,
    correctionPatterns,
  };
}

function generateAccuracyReport() {
  const categories = CATEGORIES
    .map((category) => buildCategoryReport(category))
    .filter((category) => category.reviewed > 0);

  const totals = db.prepare(`
    SELECT
      COUNT(*) AS reviewed,
      SUM(
        CASE
          WHEN category_wrong = 0 THEN 1
          ELSE 0
        END
      ) AS correct
    FROM feedback
  `).get();

  const reviewed = totals.reviewed || 0;
  const correct = totals.correct || 0;

  const overallPrecision =
    reviewed === 0
      ? 0
      : Number(((correct / reviewed) * 100).toFixed(2));

  const needsPromptRefinement = categories
    .filter((category) => category.precision < 70)
    .map((category) => ({
      category: category.category,
      precision: category.precision,
    }));

  const report = {
    overallPrecision,
    categories,
    needsPromptRefinement,
    generatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(
    REPORT_PATH,
    JSON.stringify(report, null, 2)
  );

  return report;
}

module.exports = {
  generateAccuracyReport,
};