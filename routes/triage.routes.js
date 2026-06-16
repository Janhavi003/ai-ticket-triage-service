const express = require('express');
const triageService = require('../services/triage.service');
const feedbackService = require('../services/feedback.service');
const accuracyService = require('../services/accuracy.service');

const router = express.Router();

router.post('/triage', async (req, res, next) => {
  try {
    const result = await triageService.triageTickets(req.body.tickets);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

router.get('/triage/stats', (req, res, next) => {
  try {
    const stats = triageService.getStats();
    res.status(200).json(stats);
  } catch (error) {
    next(error);
  }
});

router.get('/triage/accuracy', (req, res, next) => {
  try {
    const report = accuracyService.generateAccuracyReport();
    res.status(200).json(report);
  } catch (error) {
    next(error);
  }
});

router.post('/triage/:id/feedback', (req, res, next) => {
  try {
    const feedback = feedbackService.submitFeedback(req.params.id, req.body);
    res.status(201).json(feedback);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
