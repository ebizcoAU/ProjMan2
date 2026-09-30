import 'dart:typed_data';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import '../config/app_theme.dart';

/// A finger-drawn signature box. It needs no package. It's reused by
/// checklist sign-offs now and by site inductions and SWMS sign-on later
/// (xprojman-48 F6).
///
/// [toPng] renders the strokes to a PNG, which the caller queues as a
/// `documents` row with `entity_type='signoff'` (kind `signature`).
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

  /// The pad's last laid-out size, recorded by [SignaturePad] so [toPng]
  /// renders at the size the person actually signed at.
  Size _size = const Size(600, 160);

  /// White background, dark ink, 2× for legibility. Null when empty.
  Future<Uint8List?> toPng({double pixelRatio = 2}) async {
    if (isEmpty) return null;
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder)..scale(pixelRatio);
    canvas.drawRect(Offset.zero & _size, Paint()..color = Colors.white);
    _SignaturePainter(_strokes).paint(canvas, _size);
    final image = await recorder.endRecording().toImage(
      (_size.width * pixelRatio).ceil(),
      (_size.height * pixelRatio).ceil(),
    );
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    return data?.buffer.asUint8List();
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
        child: LayoutBuilder(
          builder: (_, box) {
            controller._size = Size(box.maxWidth, height);
            return GestureDetector(
              onPanStart: (d) => controller._begin(d.localPosition),
              onPanUpdate: (d) => controller._extend(d.localPosition),
              child: AnimatedBuilder(
                animation: controller,
                builder: (_, _) => Stack(
                  children: [
                    if (controller.isEmpty)
                      const Center(
                        child: Text(
                          'Sign here',
                          style: TextStyle(color: Op.muted, fontSize: 14),
                        ),
                      ),
                    Positioned.fill(
                      child: CustomPaint(
                        painter: _SignaturePainter(controller.strokes),
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
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
