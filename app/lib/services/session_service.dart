import 'dart:convert';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'async_storage.dart';

/// Holds the live session — access/refresh tokens plus the user + organisation
/// the server returned. Tokens live in the OS keystore (`flutter_secure_storage`),
/// not SharedPreferences. Non-secret profile bits (the boot flag, display name,
/// org name) go in [AsyncStorage] so the router can read them synchronously-ish
/// on boot. Token model per projman-01 §1.7: access 15m, refresh is an opaque
/// session UUID valid 30d.
class SessionService {
  static const _secure = FlutterSecureStorage();
  static const _kAccess = 'projman2_access_token';
  static const _kRefresh = 'projman2_refresh_token';

  // Mirror flag the router boot reads (see router.dart bootRouteProvider).
  static const _kHasSession = 'accessToken'; // kept as the boot sentinel key
  static const _kUser = 'projman2_user_json';
  static const _kOrg = 'projman2_org_json';

  static Future<void> save({
    required String accessToken,
    required String refreshToken,
    Map<String, dynamic>? user,
    Map<String, dynamic>? organisation,
  }) async {
    await _secure.write(key: _kAccess, value: accessToken);
    await _secure.write(key: _kRefresh, value: refreshToken);
    await AsyncStorage.setItem(_kHasSession, '1');
    if (user != null) await AsyncStorage.setItem(_kUser, jsonEncode(user));
    if (organisation != null) {
      await AsyncStorage.setItem(_kOrg, jsonEncode(organisation));
    }
  }

  static Future<String?> accessToken() => _secure.read(key: _kAccess);
  static Future<String?> refreshToken() => _secure.read(key: _kRefresh);

  static Future<void> updateAccessToken(String token) =>
      _secure.write(key: _kAccess, value: token);

  static Future<void> updateOrg(Map<String, dynamic> org) =>
      AsyncStorage.setItem(_kOrg, jsonEncode(org));

  static Future<bool> hasSession() async {
    final flag = await AsyncStorage.getItem(_kHasSession);
    return flag == '1';
  }

  static Future<Map<String, dynamic>?> currentUser() async {
    final raw = await AsyncStorage.getItem(_kUser);
    return raw == null ? null : jsonDecode(raw) as Map<String, dynamic>;
  }

  static Future<Map<String, dynamic>?> currentOrg() async {
    final raw = await AsyncStorage.getItem(_kOrg);
    return raw == null ? null : jsonDecode(raw) as Map<String, dynamic>;
  }

  static Future<void> clear() async {
    await _secure.delete(key: _kAccess);
    await _secure.delete(key: _kRefresh);
    await AsyncStorage.removeItem(_kHasSession);
    await AsyncStorage.removeItem(_kUser);
    await AsyncStorage.removeItem(_kOrg);
  }
}
