import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../config/app_theme.dart';
import '../services/document_queue_service.dart';

/// Shared capture entry point for every document/image surface (xprojman-22).
/// Presents a camera/library chooser, reads the picked image, and hands it to
/// the one [DocumentQueueService] — returning the `client_ref` for the caller
/// to drop into the owning row's local cache. The photo is persisted + queued
/// offline-first; upload happens later on its own.
///
/// [entityId] is the owning row's app-minted UUID (held at capture) so the
/// document self-describes its owner and neither side waits (xprojman-21 §P1).
/// For compose-then-save surfaces (delivery/dispute/diary) mint that id up
/// front and pass it here + into the create call.
final ImagePicker _picker = ImagePicker();

Future<String?> captureAndEnqueue(
  BuildContext context, {
  required String entityType,
  required String entityId,
  String? projectId,
  String? kind,
}) async {
  final messenger = ScaffoldMessenger.of(context);
  final source = await _pickSource(context);
  if (source == null) return null;

  // Down-scale on capture: keeps typical phone shots well under the server's
  // 25 MB ceiling, so the too-large refusal is a genuine edge, not routine.
  final XFile? file = await _picker.pickImage(
    source: source,
    imageQuality: 85,
    maxWidth: 2560,
    maxHeight: 2560,
  );
  if (file == null) return null;

  final bytes = await file.readAsBytes();
  try {
    return await DocumentQueueService.instance.enqueue(
      entityType: entityType,
      entityId: entityId,
      bytes: bytes,
      projectId: projectId,
      kind: kind,
      originalFilename: file.name,
      mimeType: file.mimeType,
    );
  } on DocumentTooLargeException catch (e) {
    final mb = (e.sizeBytes / (1024 * 1024)).toStringAsFixed(1);
    final cap = DocumentQueueService.maxUploadBytes ~/ (1024 * 1024);
    messenger.showSnackBar(
      SnackBar(content: Text('That image is $mb MB — over the $cap MB limit.')),
    );
    return null;
  }
}

Future<ImageSource?> _pickSource(BuildContext context) {
  return showModalBottomSheet<ImageSource>(
    context: context,
    backgroundColor: Op.surface,
    shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(18))),
    builder: (_) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const SizedBox(height: 8),
          ListTile(
            leading: const Icon(Icons.photo_camera_outlined, color: Op.accent),
            title: const Text('Take a photo', style: TextStyle(color: Op.text)),
            onTap: () => Navigator.pop(context, ImageSource.camera),
          ),
          ListTile(
            leading: const Icon(Icons.photo_library_outlined, color: Op.accent),
            title:
                const Text('Choose from library', style: TextStyle(color: Op.text)),
            onTap: () => Navigator.pop(context, ImageSource.gallery),
          ),
          const SizedBox(height: 8),
        ],
      ),
    ),
  );
}
