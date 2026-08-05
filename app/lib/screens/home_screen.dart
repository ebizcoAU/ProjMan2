import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../config/app_theme.dart';
import '../config/providers.dart';
import '../services/db_service.dart';
import '../services/permissions_service.dart';
import 'tabs/projects_tab.dart';
import 'tabs/site_tab.dart';
import 'tabs/safety_tab.dart';
import 'tabs/quality_tab.dart';
import 'tabs/profile_tab.dart';

/// The field-app shell. Ported navigation model from ftpos `home_screen.dart`:
/// five bottom tabs over an [IndexedStack], sub-pages cycled by tapping the
/// header title, back returns to the tab's default page (development.md §4).
/// Deliberately fewer options than MAOI — used one-handed on a site.
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _TabDef {
  final String key;
  final IconData icon;
  final List<String> titles;
  const _TabDef(this.key, this.icon, this.titles);
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  int _selectedIndex = 0;

  @override
  void initState() {
    super.initState();
    // This shell only mounts once there's a session, so this is the first
    // point permissions can actually be fetched (projman-05 §10.1 item 2).
    // Fire-and-forget: gated screens await PermissionsService.ensureLoaded()
    // themselves, so a slow/offline fetch here never blocks the tab bar.
    PermissionsService.instance.ensureLoaded();
  }

  static const _tabs = <_TabDef>[
    _TabDef('projects', Icons.folder_outlined,
        ['Projects', 'Programme', 'Costs']),
    _TabDef('site', Icons.today_outlined,
        ['Today', 'Site Diary', 'Attendance']),
    _TabDef('safety', Icons.health_and_safety_outlined,
        ['Safety', 'Incidents', 'Inductions']),
    _TabDef('quality', Icons.fact_check_outlined,
        ['Inspections', 'Defects', 'Certificates', 'Disputes']),
    _TabDef('profile', Icons.person_outline,
        ['Profile', 'Device & Sync']),
  ];

  /// The header-title toggle provider for the active tab.
  StateProvider<int> _pageProviderFor(int tab) {
    switch (_tabs[tab].key) {
      case 'projects':
        return projectsPageProvider;
      case 'site':
        return sitePageProvider;
      case 'safety':
        return safetyPageProvider;
      case 'quality':
        return qualityPageProvider;
      default:
        return profilePageProvider;
    }
  }

  void _cycleTitle() {
    final provider = _pageProviderFor(_selectedIndex);
    final titles = _tabs[_selectedIndex].titles;
    final current = ref.read(provider);
    ref.read(provider.notifier).state = (current + 1) % titles.length;
  }

  @override
  Widget build(BuildContext context) {
    final tab = _tabs[_selectedIndex];
    final subPage = ref.watch(_pageProviderFor(_selectedIndex));
    final title = tab.titles[subPage % tab.titles.length];

    final screens = <Widget>[
      ProjectsTab(subPage: ref.watch(projectsPageProvider)),
      SiteTab(subPage: ref.watch(sitePageProvider)),
      SafetyTab(subPage: ref.watch(safetyPageProvider)),
      QualityTab(subPage: ref.watch(qualityPageProvider)),
      ProfileTab(subPage: ref.watch(profilePageProvider)),
    ];

    return PopScope(
      canPop: subPage == 0,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) {
          // Back returns to the tab's default sub-page before leaving.
          ref.read(_pageProviderFor(_selectedIndex).notifier).state = 0;
        }
      },
      child: Scaffold(
        appBar: AppBar(
          title: GestureDetector(
            onTap: tab.titles.length > 1 ? _cycleTitle : null,
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(title),
                if (tab.titles.length > 1) ...[
                  const SizedBox(width: 6),
                  Icon(Icons.unfold_more,
                      size: 18,
                      color: Theme.of(context)
                          .colorScheme
                          .onSurface
                          .withValues(alpha: 0.5)),
                ],
              ],
            ),
          ),
          // Was only visible two taps deep (Profile → Device & Sync) — the
          // directive's "offline state must be clear and always visible"
          // wasn't met anywhere users actually work offline (audit finding,
          // Profile screen-review). One indicator, visible from every tab.
          actions: [
            _SyncIndicator(onTap: () {
              setState(() => _selectedIndex = 4);
              ref.read(profilePageProvider.notifier).state = 1;
            }),
          ],
        ),
        body: IndexedStack(index: _selectedIndex, children: screens),
        bottomNavigationBar: NavigationBar(
          selectedIndex: _selectedIndex,
          onDestinationSelected: (i) => setState(() => _selectedIndex = i),
          destinations: [
            for (final t in _tabs)
              NavigationDestination(
                icon: Icon(t.icon),
                label: t.titles.first,
              ),
          ],
        ),
      ),
    );
  }
}

/// Always-on offline-state indicator (audit finding, "offline state must be
/// clear and always visible") — lives in the shell's AppBar so it's visible
/// regardless of which tab is active, not just on Profile → Device & Sync.
/// Polls the local queue depth; sync pushes/pulls don't currently emit an
/// event ([SyncEvents] only covers pull-triggered data changes), so a short
/// poll is the simplest correct option without adding a new event channel.
class _SyncIndicator extends StatefulWidget {
  final VoidCallback onTap;
  const _SyncIndicator({required this.onTap});

  @override
  State<_SyncIndicator> createState() => _SyncIndicatorState();
}

class _SyncIndicatorState extends State<_SyncIndicator> {
  int _pending = 0;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _poll();
    _timer = Timer.periodic(const Duration(seconds: 8), (_) => _poll());
  }

  Future<void> _poll() async {
    try {
      final rows = await DatabaseService().rawQuery(
          "SELECT COUNT(*) AS n FROM sync_queue WHERE status = 'pending'");
      final n = (rows.first['n'] as int?) ?? 0;
      if (mounted) setState(() => _pending = n);
    } catch (_) {
      // Offline-first: a query failure here shouldn't crash the shell —
      // just leave the indicator showing its last-known state.
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final synced = _pending == 0;
    final color = synced ? Op.successText : Op.warningText;
    return IconButton(
      tooltip: synced
          ? 'All changes synced'
          : '$_pending change${_pending == 1 ? '' : 's'} waiting to sync — tap for details',
      onPressed: widget.onTap,
      icon: Badge(
        isLabelVisible: _pending > 0,
        label: Text('$_pending'),
        backgroundColor: Op.warningText,
        child: Icon(
          synced ? Icons.cloud_done_outlined : Icons.cloud_upload_outlined,
          color: color,
        ),
      ),
    );
  }
}
