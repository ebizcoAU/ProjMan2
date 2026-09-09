import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/db_service.dart';
import '../services/document_queue_service.dart';
import '../models/domain.dart';

// ── Field-app tab sub-page toggles ────────────────────────────────────────────
// Each of the five bottom tabs cycles its sub-pages by tapping the header title
// (development.md §4). 0 = the tab's default page.
//   Projects → 0 Projects · 1 Programme · 2 Costs
//   Site     → 0 Today · 1 Site Diary · 2 Attendance
//   Safety   → 0 Safety · 1 Incidents · 2 Inductions
//   Quality  → 0 Inspections · 1 Defects · 2 Certificates · 3 Disputes
//   Profile  → 0 Profile · 1 Device & Sync
final projectsPageProvider = StateProvider<int>((ref) => 0);
final sitePageProvider = StateProvider<int>((ref) => 0);
final safetyPageProvider = StateProvider<int>((ref) => 0);
final qualityPageProvider = StateProvider<int>((ref) => 0);
final profilePageProvider = StateProvider<int>((ref) => 0);

// ── Active org (tenant) ───────────────────────────────────────────────────────
// Resolved from the is_primary organisation on load. '' until first resolved.
final orgIdProvider = StateProvider<String?>((ref) => null);

// ── Active site project ───────────────────────────────────────────────────────
// The Site tab (daily driver) is project-scoped — a supervisor works one site at
// a time (appspec §5.3). Held here so the selection survives sub-page cycling
// (Today ↔ Diary ↔ Attendance). Null until the supervisor picks a job.
final activeSiteProjectProvider = StateProvider<Project?>((ref) => null);

// ── Active quality project ───────────────────────────────────────────────────
// Same pattern as Site (§5.5) — Inspections/Defects/Certificates are all
// project-scoped, so the Quality tab picks one job at a time too.
final activeQualityProjectProvider = StateProvider<Project?>((ref) => null);

// ── Active safety project ─────────────────────────────────────────────────────
// Same pattern again — Hazards/Incidents are project-scoped. UI mockup only for
// now (SafetyOpsService is in-memory, no schema/API — appspec §9 module 5,
// xprojman-28 §5, gated on a 3-team schema pass before real wiring).
final activeSafetyProjectProvider = StateProvider<Project?>((ref) => null);

// ── Database service singleton ────────────────────────────────────────────────
final databaseServiceProvider = FutureProvider<DatabaseService>((ref) async {
  final db = DatabaseService();
  await db.initialize();
  return db;
});

// ── App initialisation — DB ready; sync wiring arrives at P3 ──────────────────
final appInitializationProvider = FutureProvider<bool>((ref) async {
  await ref.watch(databaseServiceProvider.future);
  // Start the offline document/image queue: wire its connectivity trigger and
  // flush any captures that were queued while offline (xprojman-22).
  await DocumentQueueService.instance.start();
  return true;
});
