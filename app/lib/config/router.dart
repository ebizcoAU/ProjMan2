import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/session_service.dart';
import '../screens/welcome_screen.dart';
import '../screens/login_screen.dart';
import '../screens/register_screen.dart';
import '../screens/recovery_screen.dart';
import '../screens/onboarding_screen.dart';
import '../screens/pairing/pair_device_screen.dart';
import '../screens/pairing/join_device_screen.dart';
import '../screens/projects/create_project_screen.dart';
import '../screens/projects/project_detail_screen.dart';
import '../screens/home_screen.dart';

class AppRoutes {
  static const String welcome = '/welcome';
  static const String login = '/login';
  static const String register = '/register';
  static const String recovery = '/recovery';
  static const String onboarding = '/onboarding';
  static const String pairDevice = '/pair-device'; // primary shows QR
  static const String joinDevice = '/join-device'; // new device scans
  static const String home = '/home';
  static const String projectCreate = '/project/create'; // Stage 1
  static const String projectDetail = '/project/detail'; // 18-stage tracker
  // Handoff lands here later in P2.
}

/// Boot route decision. Ported from ftpos `config/router.dart` and stripped of
/// the CCCD / BANOI / MAOI-secondary branches — ProjMan2 registers by ABN+email
/// (development.md §6), so the "no userCCCD → welcome" gate becomes
/// "no session → welcome". The device-role secondary boot returns later.
final bootRouteProvider = FutureProvider<String>((ref) async {
  try {
    final hasSession = await SessionService.hasSession();
    if (hasSession) {
      debugPrint('[Router] boot — active session → home');
      return AppRoutes.home;
    }
    // No active session: a device that has signed in before returns to Login;
    // only a genuinely fresh install sees Welcome.
    final returning = await SessionService.hasSignedInBefore();
    debugPrint('[Router] boot — no session, returning=$returning');
    return returning ? AppRoutes.login : AppRoutes.welcome;
  } catch (e) {
    debugPrint('⚠️ [Router] boot error: $e');
    return AppRoutes.welcome;
  }
});

final goRouterProvider = FutureProvider<GoRouter>((ref) async {
  final bootRoute = await ref.watch(bootRouteProvider.future);

  return GoRouter(
    initialLocation: bootRoute,
    debugLogDiagnostics: true,
    routes: [
      GoRoute(
        path: AppRoutes.welcome,
        name: 'welcome',
        builder: (context, state) => const WelcomeScreen(),
      ),
      GoRoute(
        path: AppRoutes.login,
        name: 'login',
        builder: (context, state) => const LoginScreen(),
      ),
      GoRoute(
        path: AppRoutes.register,
        name: 'register',
        builder: (context, state) => const RegisterScreen(),
      ),
      GoRoute(
        path: AppRoutes.recovery,
        name: 'recovery',
        builder: (context, state) => const RecoveryScreen(),
      ),
      GoRoute(
        path: AppRoutes.onboarding,
        name: 'onboarding',
        builder: (context, state) => const OnboardingScreen(),
      ),
      GoRoute(
        path: AppRoutes.pairDevice,
        name: 'pairDevice',
        builder: (context, state) => const PairDeviceScreen(),
      ),
      GoRoute(
        path: AppRoutes.joinDevice,
        name: 'joinDevice',
        builder: (context, state) => const JoinDeviceScreen(),
      ),
      GoRoute(
        path: AppRoutes.home,
        name: 'home',
        builder: (context, state) => const HomeScreen(),
      ),
      GoRoute(
        path: AppRoutes.projectCreate,
        name: 'projectCreate',
        builder: (context, state) => const CreateProjectScreen(),
      ),
      GoRoute(
        path: AppRoutes.projectDetail,
        name: 'projectDetail',
        builder: (context, state) =>
            ProjectDetailScreen(projectId: state.extra as String),
      ),
      GoRoute(
        path: '/error',
        name: 'error',
        builder: (context, state) =>
            _ErrorScreen(message: state.extra as String? ?? 'Unknown error'),
      ),
    ],
    errorBuilder: (context, state) =>
        _ErrorScreen(message: 'Route not found: ${state.matchedLocation}'),
  );
});

class _ErrorScreen extends StatelessWidget {
  final String message;
  const _ErrorScreen({required this.message});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0A0F18),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.error_outline, color: Colors.red, size: 64),
              const SizedBox(height: 16),
              const Text('Error',
                  style: TextStyle(
                      color: Colors.white,
                      fontSize: 22,
                      fontWeight: FontWeight.bold)),
              const SizedBox(height: 8),
              Text(message,
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Color(0xB3FFFFFF), fontSize: 14)),
            ],
          ),
        ),
      ),
    );
  }
}
