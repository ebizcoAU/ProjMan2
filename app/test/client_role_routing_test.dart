import 'package:flutter_test/flutter_test.dart';
import 'package:projman2/config/router.dart';

// xprojman-50 §10/§11 F7: a client never lands in the staff shell.
void main() {
  test('client role lands on the client home', () {
    expect(homeRouteForRole('client'), AppRoutes.clientHome);
  });

  test('staff roles and unknown role land on the staff shell', () {
    for (final role in ['builder', 'projectManager', 'tradie', 'inspector', null, '']) {
      expect(homeRouteForRole(role), AppRoutes.home, reason: '$role');
    }
  });
}
