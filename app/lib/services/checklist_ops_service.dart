import 'package:uuid/uuid.dart';
import 'session_service.dart';
import 'signoff_store.dart';

/// Quality → Checklists: generic checklists (internal QA, toolbox talks,
/// plant pre-starts). **UI MOCKUP ONLY, in-memory, no schema/API.**
/// The owner's "mockup before wiring" rule applies, with PM go-ahead on
/// 2026-09-30.
///
/// Built against xprojman-46 (still a draft, migration v046 not yet
/// applied). This mirrors its rules so that swapping this store for sync
/// changes the storage and nothing else:
/// - **F2 snapshot:** starting a checklist copies each template item's
///   label / required / photo-required into the instance. Later template
///   edits never touch a started record.
/// - **F5 completion:** refused while a required item is pending or a
///   photo-required item has no photo (the server's `CHECKLIST_INCOMPLETE`).
///   `result` is derived: fail if any item failed, otherwise pass, with
///   N/A ignored. A completed instance is frozen (`CHECKLIST_FROZEN`).
///   A correction is a new instance carrying `supersedesId`.
/// - **F6:** a generic checklist never blocks a stage. Statutory hold
///   points stay on Inspections.
///
/// Sign-offs (toolbox attendees, plant operator) go through [SignoffStore],
/// never a checklist-specific list. xprojman-48 F6 may rename the table.
///
/// State only lasts while the app is running. Restarting the app loses it
/// on purpose.
enum ChecklistCategory {
  internalQa('internal_qa', 'Internal QA'),
  toolboxTalk('toolbox_talk', 'Toolbox talk'),
  plantPrestart('plant_prestart', 'Plant pre-start'),
  other('other', 'Other');

  final String wire;
  final String label;
  const ChecklistCategory(this.wire, this.label);

  /// What the sign-off section is called for this category (appspec §4.2):
  /// toolbox talks collect attendees, plant pre-starts an operator.
  String get signoffHeading => switch (this) {
        ChecklistCategory.toolboxTalk => 'Attendees',
        ChecklistCategory.plantPrestart => 'Operator sign-off',
        _ => 'Sign-off',
      };
}

enum ChecklistStatus { inProgress, completed }

enum ChecklistResult { pending, pass, fail }

enum ChecklistItemResult { pending, pass, fail, na }

class ChecklistTemplateItem {
  final String id;
  final int seq;
  final String label;
  final bool isRequired;
  final bool photoRequired;
  const ChecklistTemplateItem({
    required this.id,
    required this.seq,
    required this.label,
    this.isRequired = true,
    this.photoRequired = false,
  });
}

class ChecklistTemplate {
  final String id;
  final String name;
  final ChecklistCategory category;
  final String? description;
  final List<ChecklistTemplateItem> items;
  const ChecklistTemplate({
    required this.id,
    required this.name,
    required this.category,
    this.description,
    required this.items,
  });
}

/// One executed item. [label], [isRequired] and [photoRequired] are the F2
/// snapshot, frozen at start.
class ChecklistItem {
  final String id;
  final int seq;
  final String label;
  final bool isRequired;
  final bool photoRequired;
  ChecklistItemResult result;
  String? note;

  /// Mock stand-in for photo evidence. Real evidence is a `documents` row,
  /// `entity_type='checklist_item'`, keyed by [id] (xprojman-46 §7 #1),
  /// captured via DocumentQueueService once that entity type exists
  /// server-side.
  int photoCount;

  ChecklistItem({
    String? id,
    required this.seq,
    required this.label,
    required this.isRequired,
    required this.photoRequired,
    this.result = ChecklistItemResult.pending,
    this.note,
    this.photoCount = 0,
  }) : id = id ?? const Uuid().v4();

  /// Why this item blocks completion, or null if it doesn't. This matches
  /// the server rule (xprojman-46 §7, Server 2026-09-30): a required item
  /// can't be pending, and photo evidence is checked only on an answered
  /// Pass/Fail. N/A and an unanswered optional item never need a photo.
  String? get blocker {
    if (isRequired && result == ChecklistItemResult.pending) return 'Not answered';
    final answered = result == ChecklistItemResult.pass ||
        result == ChecklistItemResult.fail;
    if (photoRequired && answered && photoCount == 0) return 'Photo required';
    return null;
  }
}

class ChecklistInstance {
  final String id;
  final String projectId;
  final String templateId;
  final String templateName; // snapshot
  final ChecklistCategory category; // snapshot
  final String? supersedesId;
  final String? startedByName;
  final DateTime startedAt;
  final List<ChecklistItem> items;
  ChecklistStatus status;
  ChecklistResult result;
  String? completedByName;
  DateTime? completedAt;
  String? notes;

  ChecklistInstance({
    String? id,
    required this.projectId,
    required this.templateId,
    required this.templateName,
    required this.category,
    required this.items,
    this.supersedesId,
    this.startedByName,
    DateTime? startedAt,
    this.status = ChecklistStatus.inProgress,
    this.result = ChecklistResult.pending,
  })  : id = id ?? const Uuid().v4(),
        startedAt = startedAt ?? DateTime.now();

  bool get isFrozen => status == ChecklistStatus.completed;
  int get answered =>
      items.where((i) => i.result != ChecklistItemResult.pending).length;
}

/// Mirrors the server's completion outcomes so the UI branches the same way
/// once it's wired: `CHECKLIST_INCOMPLETE` (retryable, lists items) and
/// `CHECKLIST_FROZEN` (terminal).
class ChecklistCompletion {
  final bool success;
  final String? code;
  final List<ChecklistItem> blockers;
  const ChecklistCompletion.ok()
      : success = true,
        code = null,
        blockers = const [];
  const ChecklistCompletion.fail(this.code, [this.blockers = const []])
      : success = false;
}

class ChecklistOpsService {
  ChecklistOpsService._();
  static final ChecklistOpsService instance = ChecklistOpsService._();

  final Map<String, List<ChecklistInstance>> _byProject = {};
  SignoffStore get _signoffs => SignoffStore.instance;

  /// Published templates. Real ones pull down over sync (published only,
  /// owner `portal`, xprojman-46 §5). These are the three
  /// system templates §5 seeds, with Product's wording (see below).
  List<ChecklistTemplate> templates() => _seedTemplates;

  List<ChecklistInstance> instances(String projectId,
      {ChecklistStatus? status}) {
    final list = _byProject[projectId] ?? const [];
    return list.where((i) => status == null || i.status == status).toList()
      ..sort((a, b) => b.startedAt.compareTo(a.startedAt));
  }

  ChecklistInstance? byId(String projectId, String id) {
    for (final i in _byProject[projectId] ?? const <ChecklistInstance>[]) {
      if (i.id == id) return i;
    }
    return null;
  }

  /// Start a checklist from a template, taking the F2 snapshot.
  Future<ChecklistInstance> start(String projectId, ChecklistTemplate t,
      {String? supersedesId}) async {
    final user = await SessionService.currentUser();
    final inst = ChecklistInstance(
      projectId: projectId,
      templateId: t.id,
      templateName: t.name,
      category: t.category,
      supersedesId: supersedesId,
      startedByName: user?['fullName'] as String?,
      items: [
        for (final ti in t.items)
          ChecklistItem(
            seq: ti.seq,
            label: ti.label,
            isRequired: ti.isRequired,
            photoRequired: ti.photoRequired,
          ),
      ],
    );
    (_byProject[projectId] ??= []).add(inst);
    return inst;
  }

  /// Start a correction of a completed checklist: a fresh instance that
  /// supersedes it, re-using its snapshot rather than the live template,
  /// so it corrects what was actually run.
  Future<ChecklistInstance> startCorrection(ChecklistInstance old) async {
    final user = await SessionService.currentUser();
    final inst = ChecklistInstance(
      projectId: old.projectId,
      templateId: old.templateId,
      templateName: old.templateName,
      category: old.category,
      supersedesId: old.id,
      startedByName: user?['fullName'] as String?,
      items: [
        for (final i in old.items)
          ChecklistItem(
            seq: i.seq,
            label: i.label,
            isRequired: i.isRequired,
            photoRequired: i.photoRequired,
          ),
      ],
    );
    (_byProject[old.projectId] ??= []).add(inst);
    return inst;
  }

  /// Every mutation goes through here, so the frozen rule has one gate.
  bool _mutable(ChecklistInstance inst) => !inst.isFrozen;

  bool setResult(ChecklistInstance inst, ChecklistItem item,
      ChecklistItemResult r) {
    if (!_mutable(inst)) return false;
    item.result = r;
    return true;
  }

  bool setNote(ChecklistInstance inst, ChecklistItem item, String? note) {
    if (!_mutable(inst)) return false;
    item.note = (note == null || note.trim().isEmpty) ? null : note.trim();
    return true;
  }

  bool addMockPhoto(ChecklistInstance inst, ChecklistItem item) {
    if (!_mutable(inst)) return false;
    item.photoCount++;
    return true;
  }

  List<Signoff> signoffs(ChecklistInstance inst) =>
      _signoffs.signoffsFor(SignoffSubject.checklistInstance, inst.id);

  Signoff? addSignoff(ChecklistInstance inst,
      {String? userId, required String displayName, required bool signed}) {
    if (!_mutable(inst)) return null;
    return _signoffs.add(
      subjectType: SignoffSubject.checklistInstance,
      subjectId: inst.id,
      projectId: inst.projectId,
      userId: userId,
      displayName: displayName,
      hasSignature: signed,
    );
  }

  bool removeSignoff(ChecklistInstance inst, Signoff s) {
    if (!_mutable(inst)) return false;
    _signoffs.remove(s.id);
    return true;
  }

  /// The mock counterpart of pushing `status='completed'` (xprojman-46 F5).
  /// Once wired, the same validation is enforced by the server, and the
  /// app will only send completion after the items, sign-offs and uploads
  /// have synced (xprojman-46 §7 #2).
  Future<ChecklistCompletion> complete(ChecklistInstance inst) async {
    if (inst.isFrozen) {
      return const ChecklistCompletion.fail('CHECKLIST_FROZEN');
    }
    final blockers = inst.items.where((i) => i.blocker != null).toList();
    if (blockers.isNotEmpty) {
      return ChecklistCompletion.fail('CHECKLIST_INCOMPLETE', blockers);
    }
    final user = await SessionService.currentUser();
    inst
      ..result = inst.items.any((i) => i.result == ChecklistItemResult.fail)
          ? ChecklistResult.fail
          : ChecklistResult.pass
      ..status = ChecklistStatus.completed
      ..completedByName = user?['fullName'] as String?
      ..completedAt = DateTime.now();
    return const ChecklistCompletion.ok();
  }

  /// Template wording from Product (`projman2-d4`, 2026-09-30, at the Owner's
  /// request). Items are statements to mark Pass / Fail / N/A. An item that
  /// may not apply is required and relies on N/A, rather than optional.
  /// The wording makes no compliance claims.
  static final List<ChecklistTemplate> _seedTemplates = [
    ChecklistTemplate(
      id: 'tpl-toolbox',
      name: 'Toolbox talk',
      category: ChecklistCategory.toolboxTalk,
      description: 'Pre-start crew briefing. Record what was covered; every attendee signs on.',
      items: const [
        ChecklistTemplateItem(id: 'tb1', seq: 1, label: 'Today\'s tasks, work areas and sequence explained'),
        ChecklistTemplateItem(id: 'tb2', seq: 2, label: 'Site hazards for today reviewed, including new or changed hazards'),
        ChecklistTemplateItem(id: 'tb3', seq: 3, label: 'SWMS for today\'s high-risk work reviewed with the workers doing it'),
        ChecklistTemplateItem(id: 'tb4', seq: 4, label: 'PPE for today\'s tasks confirmed and available'),
        ChecklistTemplateItem(id: 'tb5', seq: 5, label: 'Exclusion zones, plant movements and overhead/underground services discussed'),
        ChecklistTemplateItem(id: 'tb6', seq: 6, label: 'Weather and heat/cold conditions considered'),
        ChecklistTemplateItem(id: 'tb7', seq: 7, label: 'Emergency assembly point, first aider and first-aid kit location confirmed'),
        ChecklistTemplateItem(id: 'tb8', seq: 8, label: 'Incidents, near misses or hazards since the last talk discussed'),
        ChecklistTemplateItem(id: 'tb9', seq: 9, label: 'Crew questions and concerns recorded (use the note)', isRequired: false),
      ],
    ),
    ChecklistTemplate(
      id: 'tpl-plant',
      name: 'Plant pre-start',
      category: ChecklistCategory.plantPrestart,
      description: "Operator's daily check before first use. Any Fail: tag the plant out and tell your supervisor.",
      items: const [
        ChecklistTemplateItem(id: 'pl1', seq: 1, label: 'Operator holds the required licence/ticket and is competent on this machine'),
        ChecklistTemplateItem(id: 'pl2', seq: 2, label: 'Operator\'s manual and plant risk assessment available'),
        ChecklistTemplateItem(id: 'pl3', seq: 3, label: 'Walk-around done: no leaks, damage, loose or missing parts', photoRequired: true),
        ChecklistTemplateItem(id: 'pl4', seq: 4, label: 'Engine oil, hydraulic oil, coolant and fuel at correct levels'),
        ChecklistTemplateItem(id: 'pl5', seq: 5, label: 'Tyres/tracks, rims and undercarriage in good condition', photoRequired: true),
        ChecklistTemplateItem(id: 'pl6', seq: 6, label: 'Brakes, steering and all controls operate correctly'),
        ChecklistTemplateItem(id: 'pl7', seq: 7, label: 'Lights, beacon, horn and reversing alarm working'),
        ChecklistTemplateItem(id: 'pl8', seq: 8, label: 'Seatbelt, ROPS/FOPS and guards intact'),
        ChecklistTemplateItem(id: 'pl9', seq: 9, label: 'Attachment and quick hitch secure, safety pin fitted (N/A if none)'),
        ChecklistTemplateItem(id: 'pl10', seq: 10, label: 'Fire extinguisher present, charged and in date'),
        ChecklistTemplateItem(id: 'pl11', seq: 11, label: 'Hour meter reading recorded (use the note)', isRequired: false),
      ],
    ),
    ChecklistTemplate(
      id: 'tpl-qa',
      name: 'Internal QA: pre-pour slab',
      category: ChecklistCategory.internalQa,
      description: "Builder's own check before the engineer or certifier inspection. It doesn't replace that inspection.",
      items: const [
        ChecklistTemplateItem(id: 'qa1', seq: 1, label: 'Set-out and levels checked against the drawings'),
        ChecklistTemplateItem(id: 'qa2', seq: 2, label: 'Formwork and edge forms braced, true and to dimension'),
        ChecklistTemplateItem(id: 'qa3', seq: 3, label: 'Reo size, spacing and laps as per structural drawings', photoRequired: true),
        ChecklistTemplateItem(id: 'qa4', seq: 4, label: 'Bar chairs and cover as specified', photoRequired: true),
        ChecklistTemplateItem(id: 'qa5', seq: 5, label: 'Starter bars, cogs and ties secured'),
        ChecklistTemplateItem(id: 'qa6', seq: 6, label: 'Penetrations, set-downs, conduits and sleeves in place and fixed', photoRequired: true),
        ChecklistTemplateItem(id: 'qa7', seq: 7, label: 'Vapour barrier lapped, taped and undamaged'),
        ChecklistTemplateItem(id: 'qa8', seq: 8, label: 'Termite management system installed as specified (N/A if not required)'),
        ChecklistTemplateItem(id: 'qa9', seq: 9, label: 'Excavation clean, no water or loose material'),
        ChecklistTemplateItem(id: 'qa10', seq: 10, label: 'Concrete order confirmed: grade, slump, volume, pump booked', isRequired: false),
      ],
    ),
  ];
}
