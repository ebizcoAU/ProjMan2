import 'package:flutter/material.dart';
import '../config/app_theme.dart';

/// A finger-drawn signature box. It needs no package. It's reused by
/// checklist sign-offs now and by site inductions and SWMS sign-on later
/// (xprojman-48 F6).
///
/// The mockup only needs to know *whether* someone signed ([isEmpty]).
/// When the store is wired, the strokes are rendered to a PNG and queued
/// as a `documents` row with `entity_type='signoff'`. The pad itself
/// doesn't change.
class SignaturePadController extends ChangeNotifier {
  final List<List<Offset>> _strokes = [];

  List<List<Offset>> get strokes => _strokes;
  bool get isEmpty => _strokes.every((s) => s.length < 2);

  void _begin(Offset p) {
    _strokes.add([p]);
    notifyListeners();
  }

  void _extend(Offset p) {
    if (_strokes.isEmpty) return;
    _strokes.last.add(p);
    notifyListeners();
  }

  void clear() {
    _strokes.clear();
    notifyListeners();
  }
}

class SignaturePad extends StatelessWidget {
  final SignaturePadController controller;
  final double height;
  const SignaturePad({super.key, required this.controller, this.height = 160});

  @override
  Widget build(BuildContext context) {
    return Container(
      height: height,
      decoration: BoxDecoration(
        color: Op.surface,
        borderRadius: BorderRadius.circular(Radii.md),
        border: Border.all(color: Op.border, width: 1.5),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(Radii.md),
        child: GestureDetector(
          onPanStart: (d) => controller._begin(d.localPosition),
          onPanUpdate: (d) => controller._extend(d.localPosition),
          child: AnimatedBuilder(
            animation: controller,
            builder: (_, _) => Stack(children: [
              if (controller.isEmpty)
                const Center(
                  child: Text('Sign here',
                      style: TextStyle(color: Op.muted, fontSize: 14)),
                ),
              Positioned.fill(
                child: CustomPaint(painter: _SignaturePainter(controller.strokes)),
              ),
            ]),
          ),
        ),
      ),
    );
  }
}

class _SignaturePainter extends CustomPainter {
  final List<List<Offset>> strokes;
  _SignaturePainter(this.strokes);

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = Op.text
      ..strokeWidth = 2.4
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round
      ..style = PaintingStyle.stroke;
    for (final s in strokes) {
      if (s.length < 2) continue;
      final path = Path()..moveTo(s.first.dx, s.first.dy);
      for (final p in s.skip(1)) {
        path.lineTo(p.dx, p.dy);
      }
      canvas.drawPath(path, paint);
    }
  }

  // Strokes are mutated in place, so always repaint. It's cheap at this size.
  @override
  bool shouldRepaint(covariant _SignaturePainter old) => true;
}
