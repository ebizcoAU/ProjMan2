import 'package:sqflite/sqflite.dart';
import 'schema_core.dart';
import 'schema_domain.dart';

/// Database initialisation and migration manager.
///
/// Ported from ftpos `core/db/database.dart` but starting clean: ProjMan2 is a
/// new install with no legacy `c1projman` data to migrate (development.md §8.2),
/// so the 129 ftpos migrations are dropped and we open at schema **v1**. New
/// tables land as `onUpgrade` steps from here.
class DatabaseManager {
  /// Bump on every schema change and add a matching `onUpgrade` branch.
  ///   v1 — identity, device, sync, settings (P1/P2)
  ///   v2 — site ops: site_diary/site_attendance/deliveries (P5, servdesignspec §11)
  ///   v3 — quality: inspections/inspection_items/defects/certificates (P6a, §12)
  ///   v4 — disputes (appdesignspecification.md §2.7, local-only — no sync yet)
  static const int currentVersion = 4;

  static Database? _instance;

  /// Singleton instance of the database.
  static Future<Database> getInstance() async {
    _instance ??= await _initDatabase();
    return _instance!;
  }

  static Future<Database> _initDatabase() async {
    final dbPath = await getDatabasesPath();
    final path = '$dbPath/projman2.db';

    return openDatabase(
      path,
      version: currentVersion,
      onConfigure: (db) => db.execute('PRAGMA foreign_keys = ON'),
      onCreate: _onCreate,
      onUpgrade: _onUpgrade,
      onDowngrade: onDatabaseDowngradeDelete,
    );
  }

  static Future<void> _onCreate(Database db, int version) async {
    await db.transaction((txn) async {
      for (final stmt in CoreSchema.all) {
        await txn.execute(stmt);
      }
      for (final stmt in DomainSchema.all) {
        await txn.execute(stmt);
      }
      await _createIndexes(txn);
      await _createSiteOpsIndexes(txn);
      await _createQualityIndexes(txn);
      await _createDisputeIndexes(txn);
    });
    // ignore: avoid_print
    print('✅ [DB] Created projman2.db v$version '
        '(${CoreSchema.all.length + DomainSchema.all.length} tables)');
  }

  static Future<void> _onUpgrade(
    Database db,
    int oldVersion,
    int newVersion,
  ) async {
    if (oldVersion < 2) {
      await db.transaction((txn) async {
        for (final stmt in DomainSchema.v2) {
          await txn.execute(stmt);
        }
        await _createSiteOpsIndexes(txn);
      });
    }
    if (oldVersion < 3) {
      await db.transaction((txn) async {
        for (final stmt in DomainSchema.v3) {
          await txn.execute(stmt);
        }
        await _createQualityIndexes(txn);
      });
    }
    if (oldVersion < 4) {
      await db.transaction((txn) async {
        for (final stmt in DomainSchema.v4) {
          await txn.execute(stmt);
        }
        await _createDisputeIndexes(txn);
      });
    }
    // ignore: avoid_print
    print('ℹ️ [DB] upgrade $oldVersion → $newVersion');
  }

  /// Row counts per table — used by the startup log to confirm tables exist.
  static Future<Map<String, int>> getTableStats() async {
    final db = await getInstance();
    final rows = await db.rawQuery(
      "SELECT name FROM sqlite_master WHERE type='table' "
      "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'android_%'",
    );
    final stats = <String, int>{};
    for (final r in rows) {
      final name = r['name'] as String;
      final c = await db.rawQuery('SELECT COUNT(*) AS n FROM "$name"');
      stats[name] = (c.first['n'] as int?) ?? 0;
    }
    return stats;
  }

  static Future<void> close() async {
    await _instance?.close();
    _instance = null;
  }

  /// Delete every row from every app table (keeps the schema). Used by reset.
  static Future<void> clearAllData() async {
    final db = await getInstance();
    await db.transaction((txn) async {
      for (final stmt in [...CoreSchema.all, ...DomainSchema.all]) {
        final match = RegExp(r'CREATE TABLE IF NOT EXISTS (\w+)').firstMatch(stmt);
        if (match != null) {
          await txn.delete(match.group(1)!);
        }
      }
    });
  }

  static Future<void> _createIndexes(Transaction txn) async {
    await txn.execute(
      'CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status)',
    );
    await txn.execute(
      'CREATE INDEX IF NOT EXISTS idx_sync_queue_idempotency '
      'ON sync_queue(idempotency_key)',
    );
    await txn.execute(
      'CREATE INDEX IF NOT EXISTS idx_auth_session_email ON auth_session(email)',
    );
    await txn.execute(
      'CREATE INDEX IF NOT EXISTS idx_device_state_device_id '
      'ON device_state(device_id)',
    );
    // Synced tables (projman-01 §2.2): scope-by-org, look up a device by uid.
    await txn.execute(
      'CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id)',
    );
    await txn.execute(
      'CREATE INDEX IF NOT EXISTS idx_devices_org ON devices(org_id)',
    );
    await txn.execute(
      'CREATE INDEX IF NOT EXISTS idx_devices_uid ON devices(device_uid)',
    );
  }

  // Site ops (P5, servdesignspec §11.9) — project-scoped reads + outbox scans.
  static Future<void> _createSiteOpsIndexes(Transaction txn) async {
    await txn.execute(
      'CREATE INDEX IF NOT EXISTS idx_diary_project ON site_diary(project_id, entry_date)',
    );
    await txn.execute(
      'CREATE INDEX IF NOT EXISTS idx_diary_dirty ON site_diary(is_dirty)',
    );
    await txn.execute(
      'CREATE INDEX IF NOT EXISTS idx_attendance_project ON site_attendance(project_id)',
    );
    await txn.execute(
      'CREATE INDEX IF NOT EXISTS idx_attendance_dirty ON site_attendance(is_dirty)',
    );
    await txn.execute(
      'CREATE INDEX IF NOT EXISTS idx_deliveries_project ON deliveries(project_id)',
    );
    await txn.execute(
      'CREATE INDEX IF NOT EXISTS idx_deliveries_dirty ON deliveries(is_dirty)',
    );
  }

  // Quality (P6a, servdesignspec §12.9) — project-scoped reads (inspection_items
  // via its parent's inspection_id, per §12.9 — it carries no project_id) + outbox.
  static Future<void> _createQualityIndexes(Transaction txn) async {
    await txn.execute(
      'CREATE INDEX IF NOT EXISTS idx_insp_project ON inspections(project_id)',
    );
    await txn.execute(
      'CREATE INDEX IF NOT EXISTS idx_insp_dirty ON inspections(is_dirty)',
    );
    await txn.execute(
      'CREATE INDEX IF NOT EXISTS idx_items_inspection ON inspection_items(inspection_id)',
    );
    await txn.execute(
      'CREATE INDEX IF NOT EXISTS idx_items_dirty ON inspection_items(is_dirty)',
    );
    await txn.execute(
      'CREATE INDEX IF NOT EXISTS idx_defect_project ON defects(project_id)',
    );
    await txn.execute(
      'CREATE INDEX IF NOT EXISTS idx_defect_status ON defects(project_id, status)',
    );
    await txn.execute(
      'CREATE INDEX IF NOT EXISTS idx_defect_dirty ON defects(is_dirty)',
    );
    await txn.execute(
      'CREATE INDEX IF NOT EXISTS idx_cert_project ON certificates(project_id)',
    );
    await txn.execute(
      'CREATE INDEX IF NOT EXISTS idx_cert_dirty ON certificates(is_dirty)',
    );
  }

  // Disputes (appdesignspecification.md §2.7) — local-only, project-scoped reads.
  static Future<void> _createDisputeIndexes(Transaction txn) async {
    await txn.execute(
      'CREATE INDEX IF NOT EXISTS idx_dispute_project ON disputes(project_id)',
    );
    await txn.execute(
      'CREATE INDEX IF NOT EXISTS idx_dispute_status ON disputes(status)',
    );
    await txn.execute(
      'CREATE INDEX IF NOT EXISTS idx_dispute_subject ON disputes(subject_type, subject_id)',
    );
  }
}
