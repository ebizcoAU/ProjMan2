import 'package:google_sign_in/google_sign_in.dart';

/// The three OAuth providers ProjMan2 supports — and only these three
/// (auth-strategy: Google, Microsoft, Facebook). Deliberately NOT
/// Apple/GitHub/TikTok/X/LinkedIn.
enum OAuthProvider { google, microsoft, facebook }

extension OAuthProviderInfo on OAuthProvider {
  String get label => switch (this) {
        OAuthProvider.google => 'Google',
        OAuthProvider.microsoft => 'Microsoft',
        OAuthProvider.facebook => 'Facebook',
      };

  /// The `:provider` path segment the server expects (projman-01 §1.8).
  String get slug => name; // google | microsoft | facebook
}

/// OAuth token acquisition.
///
/// **Google is real** (`google_sign_in`, wired against the Firebase-provisioned
/// OAuth client — `GoogleService-Info.plist`/`google-services.json`); its ID
/// token goes straight to `/auth/oauth/google` for the server to verify (§1.8).
///
/// **Microsoft and Facebook are not integrated yet** (need MSAL /
/// `flutter_facebook_auth` + their own app registrations). Until then, in dev,
/// those two still use the server's **dev bypass**
/// (`OAUTH_DEV_BYPASS=true`): a token `dev:<provider>:<email>:<name>`. The real
/// flow for each provider swaps only how the token is obtained — everything
/// after (`/auth/oauth/:provider` onward) is identical.
class OAuthService {
  static final GoogleSignIn _google = GoogleSignIn(scopes: ['email', 'profile']);

  /// Set by [googleSignIn] on failure, for the caller to surface — sign-in
  /// failures/misconfiguration return `null` rather than throwing, since a
  /// user cancelling the picker is a normal, silent outcome, not an error.
  static String? lastGoogleError;

  /// Runs the real Google Sign-In flow and returns the ID token to send to
  /// `/auth/oauth/google`, or `null` if the user cancelled or it failed (see
  /// [lastGoogleError] for the reason in the latter case).
  static Future<String?> googleSignIn() async {
    lastGoogleError = null;
    try {
      final account = await _google.signIn();
      if (account == null) return null; // user cancelled the picker
      final auth = await account.authentication;
      final idToken = auth.idToken;
      if (idToken == null) {
        lastGoogleError = 'Google did not return a sign-in token.';
        return null;
      }
      return idToken;
    } catch (e) {
      lastGoogleError = 'Google sign-in failed: $e';
      return null;
    }
  }

  static Future<void> googleSignOut() => _google.signOut();

  /// Build a dev-bypass token from a simulated provider identity — Microsoft
  /// and Facebook only, until their real SDKs are wired.
  static String devToken(
    OAuthProvider provider, {
    required String email,
    required String name,
  }) =>
      'dev:${provider.slug}:$email:$name';
}
