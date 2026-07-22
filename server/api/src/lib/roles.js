// ProjMan2 roles.
//
// Role is a property of the DEVICE BINDING as well as the user (MAOI's contract,
// ftpos XF-06/07/41) — a shared site tablet holds `supervisor` without the crew
// passing a password around.
//
// Enforcement is server-side. The app mirrors these permissions to decide what to
// draw; it never substitutes for them.

const ROLES = [
  'org_admin',          // tenant owner — billing, users, org settings
  'project_developer',  // creates projects/customers, budgets, approves variations and claims
  'project_manager',    // runs assigned projects; project costs only, not portfolio finance
  'supervisor',         // site subset — attendance, diary, hazards, defects, photos. No financials.
  'tradie',             // own check-in/out and assigned tasks only
  'customer',           // read-only view of their own project, web only
];

// Rank orders authority for `atLeast` checks. It is deliberately NOT a permission
// model: `tradie` and `customer` are not "less than supervisor", they are different
// audiences with disjoint access. Anything involving them must name them explicitly.
const RANK = {
  org_admin: 100,
  project_developer: 80,
  project_manager: 60,
  supervisor: 40,
  tradie: 10,
  customer: 10,
};

// Roles that may hold a session on the field app at all.
const FIELD_ROLES = new Set(['org_admin', 'project_developer', 'project_manager', 'supervisor', 'tradie']);

// Roles that can see money. The supervisor split is the whole point of the role:
// they run the site and never see what it costs.
const FINANCIAL_ROLES = new Set(['org_admin', 'project_developer', 'project_manager']);

const isRole = (r) => ROLES.includes(r);

const atLeast = (role, minimum) => (RANK[role] ?? 0) >= (RANK[minimum] ?? Infinity);

module.exports = { ROLES, RANK, FIELD_ROLES, FINANCIAL_ROLES, isRole, atLeast };
