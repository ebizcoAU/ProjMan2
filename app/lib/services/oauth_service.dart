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
/// **Real provider SDKs are not integrated yet** (they need per-platform client
/// IDs and the `google_sign_in` / MSAL / `flutter_facebook_auth` plugins). Until
/// then, in dev we use the server's **dev bypass** (projman-01 §1.8,
/// `OAUTH_DEV_BYPASS=true`): a token `dev:<provider>:<email>:<name>` is accepted so
/// the full sign-in → onboarding UI can be built and tested against the live
/// server. The real flow swaps only this token; everything after is identical.
class OAuthService {
  /// Build a dev-bypass token from a simulated provider identity.
  static String devToken(
    OAuthProvider provider, {
    required String email,
    required String name,
  }) =>
      'dev:${provider.slug}:$email:$name';
}
