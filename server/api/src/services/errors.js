// One error type the service layer throws; routes translate it to HTTP.
//
// Services never touch `res` — they return data or throw a ServiceError carrying the
// status + stable code the route maps. This is what lets the same service be called
// from a route, from another service, or (later) from a job, without dragging Express
// through the business logic.

class ServiceError extends Error {
  // `details` (optional) is machine-readable context a client acts on, e.g. the item ids
  // behind a CHECKLIST_INCOMPLETE, or the index of a bad item in a payload.
  constructor(code, message, status = 400, details) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

/** Translate a thrown error into the standard `{ success:false, message, code }` body. */
function sendError(res, err) {
  if (err instanceof ServiceError) {
    return res.status(err.status).json({
      success: false, message: err.message, code: err.code,
      ...(err.details !== undefined ? { details: err.details } : {}),
    });
  }
  console.error('[SERVICE] Unhandled:', err.message);
  return res.status(500).json({ success: false, message: 'Internal server error', code: 'INTERNAL_ERROR' });
}

module.exports = { ServiceError, sendError };
