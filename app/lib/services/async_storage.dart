import 'package:shared_preferences/shared_preferences.dart';

/// Simple string key/value store over SharedPreferences.
/// Ported from ftpos `services/async_storage.dart`, unchanged.
class AsyncStorage {
  static Future<String?> getItem(String key) async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(key);
  }

  static Future<void> setItem(String key, String value) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(key, value);
  }

  static Future<void> removeItem(String key) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(key);
  }
}
