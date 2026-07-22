// One error type the service layer throws; routes translate it to HTTP.
//
// Services never touch `res` — they return data or throw a ServiceError carrying the
// status + stable code the route maps. This is what lets the same service be called
// from a route, from another service, or (later) from a job, without dragging Express
// through the business logic.

class ServiceError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
    this.status = status;
  }
}

/** Translate a thrown error into the standard `{ success:false, message, code }` body. */
function sendError(res, err) {
  if (err instanceof ServiceError) {
    return res.status(err.status).json({ success: false, message: err.message, code: err.code });
  }
  console.error('[SERVICE] Unhandled:', err.message);
  return res.status(500).json({ success: false, message: 'Internal server error', code: 'INTERNAL_ERROR' });
}

module.exports = { ServiceError, sendError };
