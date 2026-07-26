import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import '../config/build_config.dart';
import 'device_service.dart';
import 'session_service.dart';

/// Client for the Nexus ProjMan2 identity API (projman-01 §1).
///
/// A focused rewrite of ftpos `services/nexus_service.dart` — the F&B sync
/// machinery is left behind (it returns at P3), and the **CCCD login path is
/// gone**: registration is org (ABN) + user (email), login is email + password.
/// Every response is `{ success, ... }` with a stable `code` on error (§1.6), so
/// callers branch on [ApiResult.code], never the message string.
class NexusService {
  // ── Generic result ─────────────────────────────────────────────────────────

  /// The server wraps success payloads in an envelope: `{success, data:{…}}`
  /// (projman-01). Unwrap `data` so callers read fields directly
  /// (`res.data['accessToken']`, `res.data['user']`, …). Error bodies carry no
  /// `data` object and pass through unchanged; `code`/`message` stay top-level.
  static Map<String, dynamic> _payload(Map<String, dynamic> json) =>
      json['data'] is Map
          ? Map<String, dynamic>.from(json['data'] as Map)
          : json;

  /// Low-level POST returning the decoded body + a success flag + error code.
  static Future<ApiResult> _post(
    String path, {
    required Map<String, dynamic> body,
    String? bearer,
  }) async {
    final uri = Uri.parse('$API_BASE_URL$path');
    final client = HttpClient()
      ..connectionTimeout = const Duration(seconds: 15);
    try {
      final req = await client.postUrl(uri);
      req.headers.set(HttpHeaders.contentTypeHeader, 'application/json');
      if (bearer != null) {
        req.headers.set(HttpHeaders.authorizationHeader, 'Bearer $bearer');
      }
      req.add(utf8.encode(jsonEncode(body)));
      final resp = await req.close();
      final text = await resp.transform(utf8.decoder).join();
      final Map<String, dynamic> json =
          text.isEmpty ? {} : jsonDecode(text) as Map<String, dynamic>;
      final ok = resp.statusCode >= 200 &&
          resp.statusCode < 300 &&
          json['success'] != false;
      if (!ok) {
        debugPrint('[Nexus] POST $path → ${resp.statusCode} '
            'code=${json['code']} msg=${json['message']}');
      }
      return ApiResult(
        success: ok,
        status: resp.statusCode,
        data: _payload(json),
        code: json['code']?.toString(),
        message: json['message']?.toString(),
      );
    } on SocketException catch (e) {
      debugPrint('[Nexus] network error on $path: $e');
      return const ApiResult(
        success: false,
        status: 0,
        data: {},
        code: 'NETWORK',
        message: 'Cannot reach the server. Check your connection.',
      );
    } catch (e) {
      debugPrint('[Nexus] error on $path: $e');
      return ApiResult(
        success: false,
        status: 0,
        data: const {},
        code: 'CLIENT_ERROR',
        message: e.toString(),
      );
    } finally {
      client.close(force: true);
    }
  }

  /// Low-level GET returning the decoded body + success flag + error code.
  static Future<ApiResult> _get(String path, {String? bearer}) async {
    final uri = Uri.parse('$API_BASE_URL$path');
    final client = HttpClient()
      ..connectionTimeout = const Duration(seconds: 15);
    try {
      final req = await client.getUrl(uri);
      if (bearer != null) {
        req.headers.set(HttpHeaders.authorizationHeader, 'Bearer $bearer');
      }
      final resp = await req.close();
      final text = await resp.transform(utf8.decoder).join();
      final Map<String, dynamic> json =
          text.isEmpty ? {} : jsonDecode(text) as Map<String, dynamic>;
      final ok = resp.statusCode >= 200 &&
          resp.statusCode < 300 &&
          json['success'] != false;
      return ApiResult(
        success: ok,
        status: resp.statusCode,
        data: _payload(json),
        code: json['code']?.toString(),
        message: json['message']?.toString(),
      );
    } on SocketException {
      return const ApiResult(
          success: false,
          status: 0,
          data: {},
          code: 'NETWORK',
          message: 'Cannot reach the server.');
    } catch (e) {
      return ApiResult(
          success: false, status: 0, data: const {}, code: 'CLIENT_ERROR',
          message: e.toString());
    } finally {
      client.close(force: true);
    }
  }

  // ── Auth ───────────────────────────────────────────────────────────────────

  /// POST /auth/register — create org + first user (Org Admin). On success the
  /// server returns a working session, which this persists. (projman-01 §1.1)
  static Future<ApiResult> register({
    required Map<String, dynamic> organisation,
    required Map<String, dynamic> user,
  }) async {
    final res = await _post('/auth/register', body: {
      'organisation': organisation,
      'user': user,
      'device': await DeviceService.describe(),
    });
    await _persistSession(res);
    return res;
  }

  /// POST /auth/login — email + password → session. (projman-01 §1.1)
  static Future<ApiResult> login({
    required String email,
    required String password,
  }) async {
    final res = await _post('/auth/login', body: {
      'email': email,
      'password': password,
      'device': await DeviceService.describe(),
    });
    await _persistSession(res);
    return res;
  }

  // ── Authed helpers (domain services build on these) ────────────────────────

  /// Authenticated GET — attaches the stored access token; unwraps the envelope.
  /// On a 401 it refreshes the token once and retries, so an expired access
  /// token recovers transparently instead of looking like empty/lost data. If
  /// the refresh also fails the result carries `code: 'SESSION_EXPIRED'` for the
  /// UI to route to Login (rather than silently showing nothing).
  static Future<ApiResult> authedGet(String path) =>
      _authed((bearer) => _get(path, bearer: bearer));

  /// Authenticated POST — same token-attach + refresh-on-401-and-retry as GET.
  static Future<ApiResult> authedPost(String path, Map<String, dynamic> body) =>
      _authed((bearer) => _post(path, body: body, bearer: bearer));

  /// Runs an authed request; on `401` refreshes once and retries the same call.
  static Future<ApiResult> _authed(
      Future<ApiResult> Function(String? bearer) send) async {
    final res = await send(await SessionService.accessToken());
    if (res.status != 401) return res;
    // Access token rejected (expired, or invalidated by a server matrix/secret
    // rotation). Try to mint a new one from the refresh token, then retry once.
    if (await refresh()) {
      return send(await SessionService.accessToken());
    }
    return const ApiResult(
      success: false,
      status: 401,
      data: {},
      code: 'SESSION_EXPIRED',
      message: 'Your session has expired. Please sign in again.',
    );
  }

  /// POST /auth/refresh — refresh token → new access token. (projman-01 §1.1)
  static Future<bool> refresh() async {
    final refreshToken = await SessionService.refreshToken();
    if (refreshToken == null) return false;
    final res = await _post('/auth/refresh', body: {
      'refreshToken': refreshToken,
    });
    final access = res.data['accessToken']?.toString();
    if (res.success && access != null) {
      await SessionService.updateAccessToken(access);
      return true;
    }
    return false;
  }

  /// POST /auth/logout. Best-effort; the local session is cleared regardless.
  static Future<void> logout() async {
    final token = await SessionService.accessToken();
    final refresh = await SessionService.refreshToken();
    if (token != null) {
      await _post('/auth/logout', body: {'refreshToken': refresh}, bearer: token);
    }
    await SessionService.clear();
  }

  // ── Recovery / forgot password (projman-01 §1.2) ───────────────────────────

  /// POST /auth/recovery/request — identify by email, server sends a code.
  /// Always succeeds (does not reveal whether the email exists).
  static Future<ApiResult> recoveryRequest({
    required String email,
    String purpose = 'password_reset',
  }) =>
      _post('/auth/recovery/request', body: {
        'email': email,
        'purpose': purpose,
      });

  /// POST /auth/recovery/verify — code → short-lived recovery token.
  static Future<ApiResult> recoveryVerify({
    required String email,
    required String code,
    String purpose = 'password_reset',
  }) =>
      _post('/auth/recovery/verify', body: {
        'email': email,
        'code': code,
        'purpose': purpose,
      });

  /// POST /auth/recovery/reset — recovery token + new password.
  static Future<ApiResult> recoveryReset({
    required String recoveryToken,
    required String newPassword,
  }) =>
      _post('/auth/recovery/reset', body: {
        'recoveryToken': recoveryToken,
        'newPassword': newPassword,
      });

  // ── OAuth + AU onboarding (projman-01 §1.8) ────────────────────────────────

  /// POST /auth/oauth/:provider — token-exchange. The app obtains a provider
  /// token (real SDK, or a `dev:` bypass token in dev) and posts it; the server
  /// verifies it against the provider and issues our session. On a brand-new
  /// email the response carries `onboardingRequired: true`.
  /// `provider` ∈ google | microsoft | facebook.
  static Future<ApiResult> oauth(
    String provider, {
    required String token,
  }) async {
    final res = await _post('/auth/oauth/$provider', body: {
      'token': token,
      'device': await DeviceService.describe(),
    });
    await _persistSession(res);
    return res;
  }

  /// POST /auth/onboarding — AU onboarding after a first sign-in (Bearer).
  /// `businessType` is the server enum (`sole_trader|partnership|company|trust`).
  static Future<ApiResult> onboarding({
    String? organisationName,
    required String state,
    required String businessType,
    required bool gstRegistered,
    String? abn,
  }) async {
    final token = await SessionService.accessToken();
    final res = await _post('/auth/onboarding', bearer: token, body: {
      if (organisationName != null && organisationName.trim().isNotEmpty)
        'organisation_name': organisationName.trim(),
      'state': state,
      'business_type': businessType,
      'gst_registered': gstRegistered,
      if (abn != null && abn.trim().isNotEmpty)
        'abn': abn.replaceAll(RegExp(r'\s'), ''),
    });
    final org = res.data['organisation'];
    if (res.success && org is Map<String, dynamic>) {
      await SessionService.updateOrg(org);
    }
    return res;
  }

  // ── Device pairing (projman-01 §1.3) ───────────────────────────────────────
  // The primary (authenticated) initiates → shows a QR → polls pending →
  // confirms with a role. The joining device (no session yet — the nonce is its
  // credential) requests → polls status → receives its role + tokens.

  /// POST /pairing/initiate (Bearer) — primary starts pairing for [role].
  /// Returns `{request_id, qr_payload{v,org,id,nonce}, role, expires_in}`.
  static Future<ApiResult> pairingInitiate({
    required String role,
    String? label,
    int? ttlSeconds,
  }) async {
    final token = await SessionService.accessToken();
    return _post('/pairing/initiate', bearer: token, body: {
      'role': role,
      'label': ?label,
      'ttl_seconds': ?ttlSeconds,
    });
  }

  /// GET /pairing/pending (Bearer) — primary polls for join requests.
  static Future<ApiResult> pairingPending() async {
    final token = await SessionService.accessToken();
    return _get('/pairing/pending', bearer: token);
  }

  /// POST /pairing/confirm (Bearer) — approve + assign role.
  static Future<ApiResult> pairingConfirm({
    required String requestId,
    String? role,
  }) async {
    final token = await SessionService.accessToken();
    return _post('/pairing/confirm', bearer: token, body: {
      'request_id': requestId,
      'role': ?role,
    });
  }

  /// POST /pairing/reject (Bearer).
  static Future<ApiResult> pairingReject({required String requestId}) async {
    final token = await SessionService.accessToken();
    return _post('/pairing/reject',
        bearer: token, body: {'request_id': requestId});
  }

  /// POST /pairing/request (no auth) — joining device submits the scanned nonce.
  static Future<ApiResult> pairingRequest({
    required String requestId,
    required String nonce,
  }) async {
    return _post('/pairing/request', body: {
      'request_id': requestId,
      'nonce': nonce,
      'device': await DeviceService.describe(),
    });
  }

  /// GET /pairing/status/:id (no auth) — joining device polls until confirmed.
  /// On confirm the response may carry `{role, device_id, accessToken?,
  /// refreshToken?, requiresLogin}`; if tokens are present this persists them.
  static Future<ApiResult> pairingStatus({required String requestId}) async {
    final uid = await DeviceService.deviceUid();
    final res = await _get(
        '/pairing/status/$requestId?device_uid=${Uri.encodeQueryComponent(uid)}');
    await _persistSession(res); // no-op unless tokens are present
    return res;
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  static Future<void> _persistSession(ApiResult res) async {
    if (!res.success) return;
    final access = res.data['accessToken']?.toString();
    final refresh = res.data['refreshToken']?.toString();
    if (access == null || refresh == null) return;
    await SessionService.save(
      accessToken: access,
      refreshToken: refresh,
      user: res.data['user'] as Map<String, dynamic>?,
      organisation: res.data['organisation'] as Map<String, dynamic>?,
    );
  }
}

/// A decoded API response. Callers read [success] + [code] (§1.6) and pull
/// fields out of [data].
class ApiResult {
  final bool success;
  final int status;
  final Map<String, dynamic> data;
  final String? code;
  final String? message;

  const ApiResult({
    required this.success,
    required this.status,
    required this.data,
    this.code,
    this.message,
  });

  /// A human-friendly message for a failed call, mapping the stable server
  /// codes (§1.6) to English copy; falls back to the server message.
  String get friendlyError {
    switch (code) {
      case 'INVALID_CREDENTIALS':
        return 'That email or password is not right.';
      case 'TOO_MANY_LOGIN_ATTEMPTS':
      case 'TOO_MANY_ATTEMPTS':
      case 'RATE_LIMITED':
        return 'Too many attempts. Please wait a moment and try again.';
      case 'DUPLICATE_EMAIL':
        return 'An account with that email already exists.';
      case 'DUPLICATE_ABN':
        return 'An organisation with that ABN is already registered.';
      case 'INVALID_ABN':
        return 'That ABN does not look valid.';
      case 'INVALID_CODE':
        return 'That code is incorrect or has expired.';
      case 'INVALID_RECOVERY_TOKEN':
        return 'This reset link has expired. Please start again.';
      case 'VALIDATION_ERROR':
        return message ?? 'Please check the details and try again.';
      case 'NETWORK':
        return 'Cannot reach the server. Check your connection.';
      default:
        return message ?? 'Something went wrong. Please try again.';
    }
  }
}
