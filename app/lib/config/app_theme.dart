import 'package:flutter/material.dart';

/// Operational (light) palette — appspec Decision 1. Used by the working tabs
/// (Projects, Site, Safety, Quality) which are read outdoors in sunlight, unlike
/// the dark identity screens. Contrast ≥ 7:1 on text.
class Op {
  static const bg = Color(0xFFF8FAFC);
  static const surface = Color(0xFFFFFFFF);
  static const text = Color(0xFF1E293B);
  // slate-600, not slate-500 — the old #64748B only cleared 4.5–4.76:1 on our
  // backgrounds (bare AA, not the ≥7:1 this file claims). Measured 7.24–7.58:1.
  static const muted = Color(0xFF475569);
  static const accent = Color(0xFF0066FF);
  static const border = Color(0xFFE2E8F0);

  // Status = colour + icon + label (never colour alone). These three are
  // VIVID/DECORATIVE only — pale badge fills, dots, large swatches. They measure
  // 1.9–3.8:1 against white and MUST NOT be used as text/icon colour or as a
  // filled-button background with white text on top (audit 2026-08-05, finding
  // A3/B — several screens did exactly that). Use the *Text variants below for
  // anything read directly: small icons, labels, or a solid button fill.
  static const success = Color(0xFF34D399); // synced / passed / complete
  static const warning = Color(0xFFF59E0B); // pending / due / hold point
  static const danger = Color(0xFFEF4444); // overdue / failed / incomplete

  // Same three hues, darkened until they read as text/icons/button-fills:
  // 7.09–8.31:1 on white, and 7.09–8.31:1 for white text on top of them.
  static const successText = Color(0xFF065F46);
  static const warningText = Color(0xFF92400E);
  static const dangerText = Color(0xFF991B1B);
}

/// Spacing scale (polish audit 2026-08-05, finding F) — screens currently use
/// ~25 distinct `EdgeInsets` literals with no shared scale. New/touched code
/// should build padding from these rather than adding another one-off number;
/// existing call sites are NOT being mass-migrated in this pass (cosmetic,
/// not a defect — would be a large, low-value diff for its own sake).
class Spacing {
  static const xs = 4.0;
  static const sm = 8.0;
  static const md = 12.0;
  static const lg = 16.0;
  static const xl = 24.0;
  /// Bottom padding for a ListView sitting above a fixed action bar/FAB.
  static const listBottomInset = 96.0;
}

/// Corner-radius scale — screens currently use 9 distinct
/// `BorderRadius.circular()` values (3–20). Same non-migration note as
/// [Spacing] applies.
class Radii {
  static const sm = 8.0; // small chips/thumbnails
  static const md = 10.0; // inputs, list rows
  static const lg = 12.0; // cards
  static const sheet = 18.0; // bottom-sheet top corners
}
