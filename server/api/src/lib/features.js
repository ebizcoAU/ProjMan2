// Feature flags for the accounting surfaces hidden by xprojman-43 §13.5 (config.features).
//
// A route behind a flag that's off answers 404 FEATURE_DISABLED, so a client can tell "hidden by
// configuration" apart from "no such record". Hooks call isOn() and quietly do nothing.

const config = require('../config');

const isOn = (name) => config.features[name] !== false;

const requireFeature = (name) => (req, res, next) => {
  if (isOn(name)) return next();
  return res.status(404).json({
    success: false, code: 'FEATURE_DISABLED',
    message: 'This feature is turned off: accounting is handled in your accounting system (Xero/MYOB/QuickBooks)',
    details: { feature: name },
  });
};

/** The flags as Portal/App read them (GET /organisation → features). */
const publicFeatures = () => ({ ...config.features });

module.exports = { isOn, requireFeature, publicFeatures };
