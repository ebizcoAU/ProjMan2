import 'package:sqflite/sqflite.dart';
import 'schema_core.dart';

/// Database initialisation and migration manager.
///
/// Ported from ftpos `core/db/database.dart` but starting clean: ProjMan2 is a
/// new install with no legacy `c1projman` data to migrate (development.md §8.2),
/// so the 129 ftpos migrations are dropped and we open at schema **v1**. New
/// tables land as `onUpgrade` steps from here — the construction domain (§5)
/// arrives as v2 at P3.
class DatabaseManager {
  /// Bump on every schema change and add a matching `onUpgrade` branch.
  ///   v1 — identity, device, sync, settings (P1/P2)
  static const int currentVersion = 1;

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
      await _createIndexes(txn);
    });
    // ignore: avoid_print
    print('✅ [DB] Created projman2.db v$version '
        '(${CoreSchema.all.length} core tables)');
  }

  static Future<void> _onUpgrade(
    Database db,
    int oldVersion,
    int newVersion,
  ) async {
    // No migrations past v1 yet. Domain schema (§5) will add a `v < 2` branch.
    // ignore: avoid_print
    print('ℹ️ [DB] upgrade $oldVersion → $newVersion (no steps registered)');
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
      for (final stmt in CoreSchema.all) {
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
}
