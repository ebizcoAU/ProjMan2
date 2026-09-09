import 'package:uuid/uuid.dart';
import 'session_service.dart';

/// Safety/OHS — hazard + incident capture. **UI MOCKUP ONLY, in-memory, no
/// schema/API.** No `hazards`/`incidents` table exists anywhere in the schema
/// (confirmed against every migration — `schema-relationship-map.md` §0,
/// `xprojman-27.md` module #19) and there's no server endpoint to call. Per
/// the owner's 2026-09-03 directive ("mocked-up design first, wiring after" —
/// same pattern the Site/Quality tabs originally used), this service exists
/// to let the screens be reviewed before a schema is proposed — see
/// `xprojman-28.md` §5, `appdesignspecification.md` §9. Shaped like
/// `DefectEntry`/`quality_ops_service.dart`'s `DefectEntry` deliberately,
/// since that's the schema shape `xprojman-28` §5 recommends reusing. State
/// is process-lifetime only — restarting the app loses it, on purpose;
/// nothing here is meant to survive to a real build.
enum SafetyKind { hazard, incident }

enum SafetySeverity { low, medium, high }

enum SafetyStatus { open, inProgress, closed }

class SafetyEntry {
  final String id;
  final String projectId;
  SafetyKind kind;
  String description;
  String? location;
  SafetySeverity severity;
  SafetyStatus status;
  String? raisedByName;
  final DateTime raisedAt;
  bool hasPhoto; // mock flag only — no real capture/queue wired yet

  SafetyEntry({
    String? id,
    required this.projectId,
    required this.kind,
    required this.description,
    this.location,
    this.severity = SafetySeverity.medium,
    this.status = SafetyStatus.open,
    this.raisedByName,
    DateTime? raisedAt,
    this.hasPhoto = false,
  })  : id = id ?? const Uuid().v4(),
        raisedAt = raisedAt ?? DateTime.now();
}

class SafetyOpsService {
  SafetyOpsService._();
  static final SafetyOpsService instance = SafetyOpsService._();

  final Map<String, List<SafetyEntry>> _byProject = {};
  bool _seeded = false;

  List<SafetyEntry> entries(String projectId,
      {SafetyKind? kind, SafetyStatus? status}) {
    _seedOnce(projectId);
    final list = _byProject[projectId] ?? const [];
    return list
        .where((e) => kind == null || e.kind == kind)
        .where((e) => status == null || e.status == status)
        .toList()
      ..sort((a, b) => b.raisedAt.compareTo(a.raisedAt));
  }

  Future<SafetyEntry> raise({
    required String projectId,
    required SafetyKind kind,
    required String description,
    String? location,
    SafetySeverity severity = SafetySeverity.medium,
    bool hasPhoto = false,
  }) async {
    final user = await SessionService.currentUser();
    final entry = SafetyEntry(
      projectId: projectId,
      kind: kind,
      description: description,
      location: location,
      severity: severity,
      raisedByName: user?['fullName'] as String?,
      hasPhoto: hasPhoto,
    );
    (_byProject[projectId] ??= []).add(entry);
    return entry;
  }

  void update(String projectId, SafetyEntry updated) {
    final list = _byProject[projectId];
    if (list == null) return;
    final i = list.indexWhere((e) => e.id == updated.id);
    if (i != -1) list[i] = updated;
  }

  // A couple of realistic fixtures so the screen isn't reviewed empty —
  // clearly mock data, not seeded from anywhere real.
  void _seedOnce(String projectId) {
    if (_seeded || (_byProject[projectId]?.isNotEmpty ?? false)) return;
    _seeded = true;
    _byProject[projectId] = [
      SafetyEntry(
        projectId: projectId,
        kind: SafetyKind.hazard,
        description: 'Exposed reo bar at slab edge, north side',
        location: 'Slab — north edge',
        severity: SafetySeverity.high,
        raisedByName: 'Sample data',
        hasPhoto: true,
      ),
      SafetyEntry(
        projectId: projectId,
        kind: SafetyKind.hazard,
        description: 'Trip hazard — loose timber offcuts near site entry',
        location: 'Site entry',
        severity: SafetySeverity.low,
        status: SafetyStatus.closed,
        raisedByName: 'Sample data',
      ),
      SafetyEntry(
        projectId: projectId,
        kind: SafetyKind.incident,
        description: 'Minor laceration — trade cut hand on sheet metal edge',
        location: 'Roof',
        severity: SafetySeverity.medium,
        status: SafetyStatus.inProgress,
        raisedByName: 'Sample data',
        hasPhoto: true,
      ),
    ];
  }
}
