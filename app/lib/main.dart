import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'config/build_config.dart';
import 'config/router.dart';
import 'config/providers.dart';

/// Ported from ftpos `main.dart`: an async boot that initialises the DB, then
/// hands off to the go_router `initialLocation`. Vietnamese loading strings and
/// the MAOI/BANOI branding are replaced with English + ProjMan2; the locale is
/// `en_AU` only (development.md §5.5 — no Vietnamese anywhere).
void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const ProviderScope(child: ProjMan2App()));
}

class ProjMan2App extends ConsumerStatefulWidget {
  const ProjMan2App({super.key});

  @override
  ConsumerState<ProjMan2App> createState() => _ProjMan2AppState();
}

class _ProjMan2AppState extends ConsumerState<ProjMan2App> {
  @override
  void initState() {
    super.initState();
    _initializeApp();
  }

  Future<void> _initializeApp() async {
    try {
      await ref.read(appInitializationProvider.future);
      debugPrint('[Main] ✅ App initialised');
    } catch (e) {
      debugPrint('[Main] ❌ App initialisation failed: $e');
    }
  }

  @override
  Widget build(BuildContext context) {
    final routerAsync = ref.watch(goRouterProvider);

    const delegates = <LocalizationsDelegate<dynamic>>[
      GlobalMaterialLocalizations.delegate,
      GlobalWidgetsLocalizations.delegate,
      GlobalCupertinoLocalizations.delegate,
    ];
    const supportedLocales = <Locale>[Locale('en', 'AU')];

    // Structural touch-target fix (polish audit 2026-08-05, finding B2): most
    // screens call FilledButton/OutlinedButton.styleFrom() to set only a colour,
    // so they fall back to Material 3's ~40dp default height — under the 48dp
    // minimum. Setting it once here means every button gets it without relying
    // on each screen remembering to; a screen can still override explicitly.
    const minButtonSize = Size(64, 48);
    final buttonThemes = (
      filled: FilledButtonThemeData(
        style: FilledButton.styleFrom(minimumSize: minButtonSize),
      ),
      outlined: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(minimumSize: minButtonSize),
      ),
      text: TextButtonThemeData(
        style: TextButton.styleFrom(minimumSize: minButtonSize),
      ),
    );

    final lightTheme = ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(
        seedColor: const Color(0xFF0066FF),
        brightness: Brightness.light,
      ),
      filledButtonTheme: buttonThemes.filled,
      outlinedButtonTheme: buttonThemes.outlined,
      textButtonTheme: buttonThemes.text,
    );
    final darkTheme = ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(
        seedColor: const Color(0xFF0066FF),
        brightness: Brightness.dark,
      ),
      filledButtonTheme: buttonThemes.filled,
      outlinedButtonTheme: buttonThemes.outlined,
      textButtonTheme: buttonThemes.text,
    );

    return routerAsync.when(
      data: (router) => MaterialApp.router(
        title: APP_NAME,
        routerConfig: router,
        localizationsDelegates: delegates,
        supportedLocales: supportedLocales,
        locale: const Locale('en', 'AU'),
        theme: lightTheme,
        darkTheme: darkTheme,
        themeMode: ThemeMode.system,
        debugShowCheckedModeBanner: false,
      ),
      loading: () => const MaterialApp(
        title: APP_NAME,
        debugShowCheckedModeBanner: false,
        home: _AppLoadingScreen(),
      ),
      error: (err, stack) => MaterialApp(
        title: APP_NAME,
        localizationsDelegates: delegates,
        supportedLocales: supportedLocales,
        home: Scaffold(
          body: Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.error, size: 64, color: Colors.red),
                const SizedBox(height: 16),
                Text('Initialisation error: $err'),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Branded loading screen shown while the DB + router initialise.
class _AppLoadingScreen extends StatefulWidget {
  const _AppLoadingScreen();
  @override
  State<_AppLoadingScreen> createState() => _AppLoadingScreenState();
}

class _AppLoadingScreenState extends State<_AppLoadingScreen> {
  static const _steps = [
    'Setting up the database…',
    'Preparing the interface…',
    'Loading configuration…',
    'Almost there…',
  ];
  int _step = 0;

  @override
  void initState() {
    super.initState();
    _tick();
  }

  void _tick() {
    Future.delayed(const Duration(seconds: 2), () {
      if (!mounted) return;
      setState(() => _step = (_step + 1) % _steps.length);
      _tick();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0A0F18),
      body: SafeArea(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Spacer(),
            const Text(
              APP_NAME,
              style: TextStyle(
                fontSize: 52,
                fontWeight: FontWeight.w800,
                color: Colors.white,
                letterSpacing: -1,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'eBizco Australia',
              style: TextStyle(
                fontSize: 11,
                letterSpacing: 2.5,
                color: Colors.white.withValues(alpha: 0.45),
              ),
            ),
            const Spacer(),
            const SizedBox(
              width: 28,
              height: 28,
              child: CircularProgressIndicator(
                strokeWidth: 2.5,
                color: Color(0xFF0066FF),
              ),
            ),
            const SizedBox(height: 16),
            AnimatedSwitcher(
              duration: const Duration(milliseconds: 400),
              child: Text(
                _steps[_step],
                key: ValueKey(_step),
                style: TextStyle(
                  fontSize: 13,
                  color: Colors.white.withValues(alpha: 0.6),
                ),
              ),
            ),
            const SizedBox(height: 48),
          ],
        ),
      ),
    );
  }
}
