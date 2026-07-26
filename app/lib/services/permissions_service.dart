import 'nexus_service.dart';

/// The client side of "roles as data" (projman-05 §6.3, §10.1 item 2). The app
/// must gate UI actions off the permissions the SERVER says this session holds
/// — never a hard-coded role check — because the matrix (`matrixVersion`) can
/// change server-side without an app release. `GET /auth/permissions` is the
/// one source of truth: `permissions` for `if (has('quality.validate')) …`
/// gates, `pairableRoles`/`assignableRoles` for the pairing/user-management
/// screens (no more hard-coded role lists there — see `pair_device_screen.dart`).
class PermissionsService {
  PermissionsService._();
  static final PermissionsService instance = PermissionsService._();

  int? matrixVersion;
  String? role;
  String? scopeClass;
  List<RoleOption> pairableRoles = const [];
  List<RoleOption> assignableRoles = const [];
  Set<String> _permissions = const {};

  bool _loaded = false;
  bool get loaded => _loaded;
  Future<void>? _inFlight;

  /// `true` if this session's role currently holds [permission]. Drives UI
  /// enablement only — the server enforces every one of these independently
  /// (projman-05 §6.3: "the app's UI should gate actions based on permissions,
  /// not roles" — the check itself always still happens server-side too).
  bool has(String permission) => _permissions.contains(permission);

  /// Loads once and caches; safe to call from every screen's `initState` —
  /// concurrent callers share the one in-flight request.
  Future<void> ensureLoaded() {
    if (_loaded) return Future.value();
    return _inFlight ??= _load().whenComplete(() => _inFlight = null);
  }

  /// Forces a re-fetch — call after a matrix-version mismatch is noticed, or
  /// after a role change (e.g. this device was re-paired with a new role).
  Future<void> refresh() {
    _inFlight ??= _load().whenComplete(() => _inFlight = null);
    return _inFlight!;
  }

  Future<void> _load() async {
    final res = await NexusService.authedGet('/auth/permissions');
    if (!res.success) return; // no session yet, or offline — leave prior cache/defaults
    final data = res.data;
    matrixVersion = (data['matrixVersion'] as num?)?.toInt();
    role = data['role']?.toString();
    scopeClass = data['scopeClass']?.toString();
    _permissions = {
      for (final p in (data['permissions'] as List? ?? const [])) p.toString(),
    };
    pairableRoles = _roles(data['pairableRoles']);
    assignableRoles = _roles(data['assignableRoles']);
    _loaded = true;
  }

  static List<RoleOption> _roles(Object? raw) => ((raw as List?) ?? const [])
      .map((r) => RoleOption.fromJson(Map<String, dynamic>.from(r as Map)))
      .toList();
}

/// A role as server data: the wire enum plus its display label (projman-05
/// §6.3 — `pairableRoles`/`assignableRoles` shapes).
class RoleOption {
  final String role;
  final String label;
  const RoleOption({required this.role, required this.label});

  static RoleOption fromJson(Map<String, dynamic> j) => RoleOption(
        role: j['role'].toString(),
        label: j['label']?.toString() ?? j['role'].toString(),
      );
}
