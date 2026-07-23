import 'package:flutter/material.dart';

/// Operational (light) palette — appspec Decision 1. Used by the working tabs
/// (Projects, Site, Safety, Quality) which are read outdoors in sunlight, unlike
/// the dark identity screens. Contrast ≥ 7:1 on text.
class Op {
  static const bg = Color(0xFFF8FAFC);
  static const surface = Color(0xFFFFFFFF);
  static const text = Color(0xFF1E293B);
  static const muted = Color(0xFF64748B);
  static const accent = Color(0xFF0066FF);
  static const border = Color(0xFFE2E8F0);

  // Status = colour + icon + label (never colour alone).
  static const success = Color(0xFF34D399); // synced / passed / complete
  static const warning = Color(0xFFF59E0B); // pending / due / hold point
  static const danger = Color(0xFFEF4444); // overdue / failed / incomplete
}
