import '../core/app_error.dart';

class FamilyLocation {
  const FamilyLocation({
    required this.userId,
    required this.fullName,
    required this.latitude,
    required this.longitude,
    required this.accuracyMeters,
    required this.recordedAt,
    required this.status,
  });

  final String userId;
  final String fullName;
  final double latitude;
  final double longitude;
  final double accuracyMeters;
  final DateTime recordedAt;
  final String status;

  factory FamilyLocation.fromJson(Map<String, dynamic> json) {
    final latitude = json['latitude'];
    final longitude = json['longitude'];
    final accuracy = json['accuracyMeters'];
    final recordedAt = DateTime.tryParse(json['recordedAt'] as String? ?? '');
    if (latitude is! num ||
        longitude is! num ||
        accuracy is! num ||
        recordedAt == null) {
      throw const AppError('The server returned an invalid family location.');
    }
    return FamilyLocation(
      userId: json['userId'] as String,
      fullName: json['fullName'] as String,
      latitude: latitude.toDouble(),
      longitude: longitude.toDouble(),
      accuracyMeters: accuracy.toDouble(),
      recordedAt: recordedAt,
      status: json['status'] as String,
    );
  }
}
