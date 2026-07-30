import 'dart:async';
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
  // `HttpClient.connectionTimeout` only bounds the TCP-connect step — if the
  // server accepts the connection but never sends a response (e.g. a route
  // that isn't registered on some server configs just hangs rather than
  // 404ing), the awaits below had nothing bounding them and the UI's spinner
  // never cleared. This bounds the whole round trip, not just connecting.
  static const _requestTimeout = Duration(seconds: 20);

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
    final sw = Stopwatch()..start();
    debugPrint('[Nexus] → POST $uri');
    final client = HttpClient()
      ..connectionTimeout = const Duration(seconds: 15);
    try {
      final req = await client.postUrl(uri);
      debugPrint('[Nexus]   connected after ${sw.elapsedMilliseconds}ms, sending body…');
      req.headers.set(HttpHeaders.contentTypeHeader, 'application/json');
      if (bearer != null) {
        req.headers.set(HttpHeaders.authorizationHeader, 'Bearer $bearer');
      }
      req.add(utf8.encode(jsonEncode(body)));
      final resp = await req.close().timeout(_requestTimeout);
      debugPrint('[Nexus]   headers back after ${sw.elapsedMilliseconds}ms: '
          '${resp.statusCode}, reading body…');
      final text =
          await resp.transform(utf8.decoder).join().timeout(_requestTimeout);
      final Map<String, dynamic> json =
          text.isEmpty ? {} : jsonDecode(text) as Map<String, dynamic>;
      final ok = resp.statusCode >= 200 &&
          resp.statusCode < 300 &&
          json['success'] != false;
      debugPrint('[Nexus] ← POST $path → ${resp.statusCode} '
          'in ${sw.elapsedMilliseconds}ms ok=$ok code=${json['code']} '
          'msg=${json['message']}');
      return ApiResult(
        success: ok,
        status: resp.statusCode,
        data: _payload(json),
        code: json['code']?.toString(),
        message: json['message']?.toString(),
      );
    } on SocketException catch (e) {
      debugPrint('[Nexus] ← POST $path network error after '
          '${sw.elapsedMilliseconds}ms: $e');
      return const ApiResult(
        success: false,
        status: 0,
        data: {},
        code: 'NETWORK',
        message: 'Cannot reach the server. Check your connection.',
      );
    } on TimeoutException catch (e) {
      debugPrint('[Nexus] ← POST $path timeout after '
          '${sw.elapsedMilliseconds}ms: $e');
      return const ApiResult(
        success: false,
        status: 0,
        data: {},
        code: 'NETWORK',
        message: 'The server took too long to respond. Please try again.',
      );
    } catch (e) {
      debugPrint('[Nexus] ← POST $path error after '
          '${sw.elapsedMilliseconds}ms: $e');
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
    final sw = Stopwatch()..start();
    debugPrint('[Nexus] → GET $uri');
    final client = HttpClient()
      ..connectionTimeout = const Duration(seconds: 15);
    try {
      final req = await client.getUrl(uri);
      debugPrint('[Nexus]   connected after ${sw.elapsedMilliseconds}ms, awaiting response…');
      if (bearer != null) {
        req.headers.set(HttpHeaders.authorizationHeader, 'Bearer $bearer');
      }
      final resp = await req.close().timeout(_requestTimeout);
      debugPrint('[Nexus]   headers back after ${sw.elapsedMilliseconds}ms: '
          '${resp.statusCode}, reading body…');
      final text =
          await resp.transform(utf8.decoder).join().timeout(_requestTimeout);
      final Map<String, dynamic> json =
          text.isEmpty ? {} : jsonDecode(text) as Map<String, dynamic>;
      final ok = resp.statusCode >= 200 &&
          resp.statusCode < 300 &&
          json['success'] != false;
      debugPrint('[Nexus] ← GET $path → ${resp.statusCode} '
          'in ${sw.elapsedMilliseconds}ms ok=$ok code=${json['code']} '
          'msg=${json['message']}');
      return ApiResult(
        success: ok,
        status: resp.statusCode,
        data: _payload(json),
        code: json['code']?.toString(),
        message: json['message']?.toString(),
      );
    } on SocketException catch (e) {
      debugPrint('[Nexus] ← GET $path network error after '
          '${sw.elapsedMilliseconds}ms: $e');
      return const ApiResult(
          success: false,
          status: 0,
          data: {},
          code: 'NETWORK',
          message: 'Cannot reach the server.');
    } on TimeoutException catch (e) {
      debugPrint('[Nexus] ← GET $path timeout after '
          '${sw.elapsedMilliseconds}ms: $e');
      return const ApiResult(
          success: false,
          status: 0,
          data: {},
          code: 'NETWORK',
          message: 'The server took too long to respond. Please try again.');
    } catch (e) {
      debugPrint('[Nexus] ← GET $path error after '
          '${sw.elapsedMilliseconds}ms: $e');
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

  // ── Introduction (appdesignspecification.md §2.2/§2.3) ─────────────────────
  // A QR business-card swap between two already-self-registered users — no
  // job, no project, no device implied. Distinct from device pairing above:
  // both parties already hold their own session, so this only ever writes an
  // `introductions` contact-book row, never a new device/session. Contract
  // CONFIRMED by the Server Agent (docs/decisions/xprojman-04.md) — the code
  // is a stateless signed token (opaque string, 5 min TTL), NOT a JSON
  // payload; the scan is the only create path (no raw "introduce me to
  // user_id" call, so a cold stranger can never be introduced without their
  // code actually being scanned).

  /// POST /introductions/code (Bearer) — mints this user's own signed QR
  /// code. Returns `{code, expires_in}` (`expires_in` in seconds — re-mint on
  /// display, don't cache).
  static Future<ApiResult> introductionCode() =>
      authedPost('/introductions/code', const {});

  /// POST /introductions/scan (Bearer) — submits the raw string read off the
  /// other party's QR (the opaque `code`, not JSON). `201` first time /
  /// `200` idempotent repeat, both carry `{id, alreadyIntroduced, contact}`;
  /// `400 INVALID_CODE` (forged/expired/wrong org) or `400 VALIDATION_ERROR`
  /// (scanned your own code).
  static Future<ApiResult> introductionScan(String code) =>
      authedPost('/introductions/scan', {'code': code});

  /// GET /introductions (Bearer) — this user's contact book: `{contacts: [
  /// {id, user_id, full_name, role, introduced_at, initiated_by}, … ]}`.
  static Future<ApiResult> introductionContacts() =>
      authedGet('/introductions');

  // ── Job Award — the S9.7 accept/decline tap (appdesignspecification.md §4.2) ─
  // The invitation itself (S9.6) is sent from the PM's desk (Portal, `panel.manage`);
  // the app's slice is the invited person receiving it and tapping accept/decline.
  //
  // `respondJobAward` hits a CONFIRMED, real endpoint (server routes/projects.js):
  //   POST /projects/:id/job-awards/:jaId/respond  { accept: bool } → { id, status }
  // — and deliberately does NOT require project membership, so an invited-but-not-
  // yet-enrolled person can accept (membership is written on accept, server-side).
  //
  // `pendingJobAwards` closes the discovery chicken/egg: an invited person has no
  // way to see an award addressed to them (the only other list,
  // GET /projects/:id/job-awards, is membership-gated and they aren't a member
  // until they accept). Shape was proposed in xprojman-11 and CONFIRMED + built
  // verbatim by the Server Agent in xprojman-12 (from_name ← users.full_name and
  // project_name ← projects.name, both aliased server-side — nothing to rename).
  // The endpoint is live once the server side commits; until then the inbox reads
  // empty rather than erroring.

  /// GET /job-awards/pending (Bearer) — CONFIRMED, xprojman-12. Awards where
  /// `to_user_id = me AND status = 'sent'`, across projects, NOT membership-gated.
  /// Shape: `{pending: [{id, project_id, project_name, from_user_id, from_name,
  /// role_offered, builder_engagement_type, sent_at}]}`.
  static Future<ApiResult> pendingJobAwards() =>
      authedGet('/job-awards/pending');

  /// POST /projects/:id/job-awards/:jaId/respond (Bearer) — the S9.7 tap. Only the
  /// invited person may respond; `{accept}` → `{id, status:'accepted'|'declined'}`.
  /// Errors: `403 FORBIDDEN` (not the invitee), `409 ALREADY_RESPONDED`.
  static Future<ApiResult> respondJobAward({
    required String projectId,
    required String jobAwardId,
    required bool accept,
  }) =>
      authedPost('/projects/$projectId/job-awards/$jobAwardId/respond',
          {'accept': accept});

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
