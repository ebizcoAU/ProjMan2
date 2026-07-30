// Mounted at /job-awards — the identity-level Job Award inbox (xprojman-11).
//
// This is deliberately NOT under /projects/:id. An invited person is not a
// `project_members` row until they accept (the membership write lives inside
// JobAwardService.respond), so a project-scoped list can never reach an award
// addressed to them — the chicken/egg the App Team flagged. This route is scoped
// to the caller (`to_user_id = req.auth.userId`), so it needs no project membership
// and no permission beyond being authenticated — same posture as GET /introductions.
//
// The accept/decline action itself stays where it belongs, on the project resource:
//   POST /projects/:id/job-awards/:jaId/respond   (already built, membership-ungated)

const router = require('express').Router();

const { authenticate } = require('../middleware/auth');
const { sendError } = require('../services/errors');
const JobAwardService = require('../services/JobAwardService');

router.use(authenticate);

// GET /job-awards/pending — the caller's pending (status='sent') invitations.
router.get('/pending', async (req, res) => {
  try {
    const data = await JobAwardService.pending({
      orgId: req.auth.orgId, userId: req.auth.userId,
    });
    return res.json({ success: true, data });
  } catch (err) {
    return sendError(res, err);
  }
});

module.exports = router;
