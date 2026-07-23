import '../models/domain.dart';
import 'nexus_service.dart';

/// Result of a create/mutate call: an id on success, or a stable error code +
/// message the UI can surface (e.g. `DUPLICATE_CODE`).
typedef MutateResult = ({String? id, String? code, String? message});

/// P4 project workflow client — projects, customers, the 18-stage programme, and
/// stage advancement (projman-04 §4, servdesignspec §10). All calls are
/// permission- and scope-guarded server-side; this is a thin typed wrapper over
/// [NexusService.authedGet]/[authedPost].
class ProjectService {
  /// The system WA residential 18-stage template (GET /stage-templates).
  static const wa18TemplateId = '00000000-0000-4000-8000-00000000wa18';

  // ── Reads ──────────────────────────────────────────────────────────────────

  static Future<List<Project>> list() async {
    final res = await NexusService.authedGet('/projects');
    if (!res.success) return const [];
    final rows = (res.data['projects'] as List?) ?? const [];
    return rows
        .map((e) => Project.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  static Future<({Project? project, List<ProjectStage> stages})> detail(
      String id) async {
    final res = await NexusService.authedGet('/projects/$id');
    if (!res.success) return (project: null, stages: const <ProjectStage>[]);
    final p = res.data['project'] as Map<String, dynamic>?;
    final st = (res.data['stages'] as List?) ?? const [];
    return (
      project: p == null ? null : Project.fromJson(p),
      stages: st
          .map((e) => ProjectStage.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }

  // ── Stage 1: create customer + project + stamp the programme ─────────────────

  /// Creates a customer, returns its id (or null on failure).
  static Future<MutateResult> createCustomer({
    required String name,
    String? email,
    String? phone,
    String? address,
    String? suburb,
    String? state,
    String? postcode,
  }) async {
    final res = await NexusService.authedPost('/customers', {
      'name': name,
      if (_has(email)) 'email': email,
      if (_has(phone)) 'phone': phone,
      if (_has(address)) 'address': address,
      if (_has(suburb)) 'suburb': suburb,
      if (_has(state)) 'state': state,
      if (_has(postcode)) 'postcode': postcode,
    });
    return (
      id: res.success ? res.data['id']?.toString() : null,
      code: res.code,
      message: res.message,
    );
  }

  /// Creates a project. `code` is the unique-per-org job number (required by the
  /// server); a `DUPLICATE_CODE` surfaces as [MutateResult.code].
  static Future<MutateResult> createProject({
    required String name,
    required String code,
    required String customerId,
    String? siteAddress,
    String? lotPlan,
    String? templateId,
  }) async {
    final res = await NexusService.authedPost('/projects', {
      'name': name,
      'code': code,
      'customer_id': customerId,
      if (_has(siteAddress)) 'site_address': siteAddress,
      if (_has(lotPlan)) 'lot_plan': lotPlan,
      if (_has(templateId)) 'template_id': templateId,
    });
    return (
      id: res.success ? res.data['id']?.toString() : null,
      code: res.code,
      message: res.message,
    );
  }

  /// Stamps the project's `project_stages` from a template (matrix Stage 9, but
  /// we instantiate at create so the tracker is populated from day one — the
  /// projman-01 §10 redline).
  static Future<bool> instantiateProgramme(
    String projectId, {
    String templateId = wa18TemplateId,
  }) async {
    final res = await NexusService.authedPost(
        '/projects/$projectId/programme', {'template_id': templateId});
    return res.success;
  }

  // ── Stage advancement (Decision b: manual + tag) ─────────────────────────────

  /// POST /projects/:id/stages/:stageId/advance — run the progression gates.
  /// Fails (with a code like `STAGE_NOT_VALIDATED` / `STAGE_GATE_PREV`) if a gate
  /// blocks the move; the caller surfaces that as the INCOMPLETE tag.
  static Future<MutateResult> advanceStage({
    required String projectId,
    required String stageId,
    required String toStatus,
    String? milestone,
  }) async {
    final res = await NexusService.authedPost(
        '/projects/$projectId/stages/$stageId/advance', {
      'to_status': toStatus,
      if (_has(milestone)) 'milestone': milestone,
    });
    return (id: stageId, code: res.success ? null : res.code, message: res.message);
  }

  static bool _has(String? s) => s != null && s.trim().isNotEmpty;
}
