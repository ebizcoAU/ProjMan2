// Domain models for the P4 project workflow — thin readers over the server's
// JSON (projman-04 §4 / §10). Tolerant: unknown fields are ignored, missing
// ones default, so the app survives the server shipping extra columns.

int _asInt(dynamic v) => v is int ? v : int.tryParse('${v ?? ''}') ?? 0;
bool _asBool(dynamic v) => v == 1 || v == true || v == '1';
String _s(dynamic v) => (v ?? '').toString();
String? _sn(dynamic v) => v?.toString();

class Customer {
  final String id;
  final String name;
  final String? email;
  final String? phone;

  Customer({required this.id, required this.name, this.email, this.phone});

  factory Customer.fromJson(Map<String, dynamic> j) => Customer(
        id: _s(j['id']),
        name: _s(j['name']),
        email: _sn(j['email']),
        phone: _sn(j['phone']),
      );
}

class Project {
  final String id;
  final String name;
  final String? code;
  final String? status;
  final String? customerName;
  final String? siteAddress;
  final String? templateId;
  final num? contractValue; // money-redacted for roles without money.read

  Project({
    required this.id,
    required this.name,
    this.code,
    this.status,
    this.customerName,
    this.siteAddress,
    this.templateId,
    this.contractValue,
  });

  factory Project.fromJson(Map<String, dynamic> j) => Project(
        id: _s(j['id']),
        name: _s(j['name']),
        code: _sn(j['code']),
        status: _sn(j['status']),
        customerName: _sn(j['customer_name']),
        siteAddress: _sn(j['site_address']),
        templateId: _sn(j['template_id']),
        contractValue: j['contract_value'] is num ? j['contract_value'] : null,
      );
}

/// One row of the 18-stage programme. `status` is the closed gate enum
/// (`not_started|in_progress|blocked|complete|skipped`, servdesignspec §10.3);
/// `milestone` is the optional rich workflow label.
class ProjectStage {
  final String id;
  final int seq;
  final String stageCode;
  final String name;
  final String status;
  final String? part; // A–E
  final bool isHoldPoint;
  final bool isValidated;
  final String? milestone;

  ProjectStage({
    required this.id,
    required this.seq,
    required this.stageCode,
    required this.name,
    required this.status,
    required this.part,
    required this.isHoldPoint,
    required this.isValidated,
    required this.milestone,
  });

  factory ProjectStage.fromJson(Map<String, dynamic> j) => ProjectStage(
        id: _s(j['id']),
        seq: _asInt(j['seq']),
        stageCode: _s(j['stage_code']),
        name: _s(j['name']),
        status: _s(j['status']).isEmpty ? 'not_started' : _s(j['status']),
        part: _sn(j['part']),
        isHoldPoint: _asBool(j['is_hold_point']),
        isValidated: _asBool(j['is_validated']),
        milestone: _sn(j['milestone']),
      );

  bool get isComplete => status == 'complete';
  bool get isActive => status == 'in_progress';
  bool get isBlocked => status == 'blocked';
}
