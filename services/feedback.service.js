const db = require('../database/db');
const { CATEGORIES, PRIORITIES } = require('./triage.service');

function submitFeedback(ticketId, payload) {
  const { corrected_category, corrected_priority, reviewer_id } = payload;

  if (!corrected_category || !corrected_priority || !reviewer_id) {
    throw new Error('corrected_category, corrected_priority, and reviewer_id are required');
  }

  if (!CATEGORIES.includes(corrected_category)) {
    throw new Error(`Invalid corrected_category "${corrected_category}"`);
  }

  if (!PRIORITIES.includes(corrected_priority)) {
    throw new Error(`Invalid corrected_priority "${corrected_priority}"`);
  }

  const ticket = db.prepare(`
    SELECT id, category, priority
    FROM tickets
    WHERE id = ?
  `).get(ticketId);

  if (!ticket) {
    const error = new Error(`Ticket "${ticketId}" not found`);
    error.statusCode = 404;
    throw error;
  }

  const existingFeedback = db.prepare(`
    SELECT id FROM feedback WHERE ticket_id = ?
  `).get(ticketId);

  if (existingFeedback) {
    const error = new Error(`Feedback already exists for ticket "${ticketId}"`);
    error.statusCode = 409;
    throw error;
  }

  const categoryWrong = ticket.category === corrected_category ? 0 : 1;
  const priorityWrong = ticket.priority === corrected_priority ? 0 : 1;

  const result = db.prepare(`
    INSERT INTO feedback (
      ticket_id,
      ai_category,
      ai_priority,
      corrected_category,
      corrected_priority,
      reviewer_id,
      category_wrong,
      priority_wrong
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    ticketId,
    ticket.category,
    ticket.priority,
    corrected_category,
    corrected_priority,
    reviewer_id,
    categoryWrong,
    priorityWrong
  );

  return {
    id: result.lastInsertRowid,
    ticket_id: ticketId,
    ai_category: ticket.category,
    ai_priority: ticket.priority,
    corrected_category,
    corrected_priority,
    reviewer_id,
    category_wrong: categoryWrong,
    priority_wrong: priorityWrong,
  };
}

module.exports = {
  submitFeedback,
};
