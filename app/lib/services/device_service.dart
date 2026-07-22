import 'dart:io';
import 'package:device_info_plus/device_info_plus.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:uuid/uuid.dart';
import 'async_storage.dart';

/// Identity of *this* device — the `device{device_uid, platform, model, ...}`
/// block every auth call carries (projman-01 §1.1). Ported in spirit from ftpos
/// `services/device_service.dart`; the `device_uid` is a stable client UUID we
/// persist once and reuse, so the server can recognise the same handset across
/// reinstalls-that-keep-storage and across pair/handoff.
class DeviceService {
  static const _uidKey = 'projman2_device_uid';

  static Future<String> deviceUid() async {
    var uid = await AsyncStorage.getItem(_uidKey);
    if (uid == null || uid.isEmpty) {
      uid = const Uuid().v4();
      await AsyncStorage.setItem(_uidKey, uid);
    }
    return uid;
  }

  /// The device block for a register/login/pairing/recovery body.
  static Future<Map<String, dynamic>> describe() async {
    final info = DeviceInfoPlugin();
    final pkg = await PackageInfo.fromPlatform();
    String platform = 'unknown';
    String model = 'unknown';
    String osVersion = 'unknown';
    String name = 'ProjMan2 device';

    try {
      if (Platform.isAndroid) {
        final a = await info.androidInfo;
        platform = 'android';
        model = '${a.manufacturer} ${a.model}';
        osVersion = 'Android ${a.version.release}';
        name = a.model;
      } else if (Platform.isIOS) {
        final i = await info.iosInfo;
        platform = 'ios';
        model = i.utsname.machine;
        osVersion = '${i.systemName} ${i.systemVersion}';
        name = i.name;
      } else if (Platform.isMacOS) {
        final m = await info.macOsInfo;
        platform = 'macos';
        model = m.model;
        osVersion = 'macOS ${m.osRelease}';
        name = m.computerName;
      }
    } catch (_) {
      // device_info can throw on unusual platforms — the defaults above stand.
    }

    return {
      'device_uid': await deviceUid(),
      'device_name': name,
      'platform': platform,
      'model': model,
      'os_version': osVersion,
      'app_version': pkg.version,
    };
  }
}
