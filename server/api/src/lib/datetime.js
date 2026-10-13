// Wall-clock DATETIME normalisation.
//
// The pool pins the session to +08:00 and returns DATETIMEs as strings, but it only converts
// Date OBJECTS on the way in. A client string like '2026-10-14T01:00:00Z' would land as the
// literal wall time, 8h wrong. Every client-writable DATETIME that arrives over REST or sync
// goes through here: wall-clock ('YYYY-MM-DD HH:MM[:SS]') passes as-is, ISO with Z or an
// offset is converted to Perth, anything unparseable is a 400.

const config = require('../config');
const { ServiceError } = require('../services/errors');

const WALL_CLOCK = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/;

function toWallClock(value, field) {
  if (value === null) return null;
  if (typeof value === 'string' && WALL_CLOCK.test(value)) return value.length === 16 ? `${value}:00` : value;
  const d = typeof value === 'string' && value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) throw new ServiceError('VALIDATION_ERROR', `${field} must be a date-time`, 400);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: config.server.timezone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/** Now, as a Perth wall-clock DATETIME string. */
const nowWallClock = () => toWallClock(new Date().toISOString(), 'now');

module.exports = { toWallClock, nowWallClock };
