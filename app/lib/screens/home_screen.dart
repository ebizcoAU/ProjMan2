import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../config/providers.dart';
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

  static const _tabs = <_TabDef>[
    _TabDef('projects', Icons.folder_outlined,
        ['Projects', 'Programme', 'Costs']),
    _TabDef('site', Icons.today_outlined,
        ['Today', 'Site Diary', 'Attendance']),
    _TabDef('safety', Icons.health_and_safety_outlined,
        ['Safety', 'Incidents', 'Inductions']),
    _TabDef('quality', Icons.fact_check_outlined,
        ['Inspections', 'Defects', 'Certificates']),
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
