import 'package:sqflite/sqflite.dart';
import '../core/db/database.dart';

/// High-level database service — thin wrapper over the sqflite [Database].
/// Ported from ftpos `services/db_service.dart` unchanged except for logging.
class DatabaseService {
  static final DatabaseService _instance = DatabaseService._internal();
  factory DatabaseService() => _instance;
  DatabaseService._internal();

  Future<Database> get db async => DatabaseManager.getInstance();

  Future<void> initialize() async {
    final database = await db;
    // ignore: avoid_print
    print('✅ Database initialised');
    final stats = await DatabaseManager.getTableStats();
    // ignore: avoid_print
    print('📊 Tables: ${stats.length}');
    database; // touch to ensure open
  }

  Future<List<Map<String, Object?>>> rawQuery(String sql,
          [List<Object?>? args]) async =>
      (await db).rawQuery(sql, args);

  Future<int> rawUpdate(String sql, [List<Object?>? args]) async =>
      (await db).rawUpdate(sql, args);

  Future<int> rawInsert(String sql, [List<Object?>? args]) async =>
      (await db).rawInsert(sql, args);

  Future<int> insert(String table, Map<String, Object?> values) async =>
      (await db).insert(table, values);

  Future<int> update(String table, Map<String, Object?> values,
          {String? where, List<Object?>? whereArgs}) async =>
      (await db).update(table, values, where: where, whereArgs: whereArgs);

  Future<int> delete(String table,
          {String? where, List<Object?>? whereArgs}) async =>
      (await db).delete(table, where: where, whereArgs: whereArgs);

  Future<List<Map<String, Object?>>> query(
    String table, {
    List<String>? columns,
    String? where,
    List<Object?>? whereArgs,
    String? orderBy,
    int? limit,
    int? offset,
  }) async =>
      (await db).query(table,
          columns: columns,
          where: where,
          whereArgs: whereArgs,
          orderBy: orderBy,
          limit: limit,
          offset: offset);

  Future<T> transaction<T>(
          Future<T> Function(Transaction txn) action) async =>
      (await db).transaction(action);

  // ── Tolerant reader (projman-01 §3.2) ──────────────────────────────────────
  // A pull payload's `data` may carry read-only server columns the app does not
  // mirror (e.g. organisations.created_at/abn_checked_at/trial_ends_at,
  // users.force_logout_flag). SQLite throws on an INSERT/UPDATE naming a column
  // that does not exist, so the sync-apply layer MUST filter incoming rows to
  // the local table's columns first — the exact mirror of the server dropping
  // unknown columns on push (§3.4). Reading the allowlist from the live schema
  // (PRAGMA table_info) means it can never drift from the actual table.

  final Map<String, Set<String>> _columnCache = {};

  /// The set of column names on local [table], read from the live schema and
  /// cached. Empty set if the table does not exist.
  Future<Set<String>> tableColumns(String table) async {
    final cached = _columnCache[table];
    if (cached != null) return cached;
    final rows = await rawQuery('PRAGMA table_info("$table")');
    final cols = {for (final r in rows) r['name'] as String};
    _columnCache[table] = cols;
    return cols;
  }

  /// Filters a pull `data` map to keys that are real columns of [table],
  /// dropping any the app does not mirror. Use before applying a pulled row.
  Future<Map<String, Object?>> filterToTableColumns(
    String table,
    Map<String, Object?> data,
  ) async {
    final cols = await tableColumns(table);
    return {
      for (final e in data.entries)
        if (cols.contains(e.key)) e.key: e.value,
    };
  }

  Future<int> getVersion() async => (await db).getVersion();

  Future<void> close() => DatabaseManager.close();

  Future<void> clearAllData() => DatabaseManager.clearAllData();

  Future<Map<String, int>> getTableStats() => DatabaseManager.getTableStats();
}
