// siteState.js — the AU states/territories a site can be in (projects.site_state, v053).
// It drives the deposit cap on the payment schedule (xprojman-43 §2.1); blank on create
// means the server defaults it to the organisation's state.
export const SITE_STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'];
export const SITE_STATE_HINT = 'Sets the deposit cap on the payment schedule.';
