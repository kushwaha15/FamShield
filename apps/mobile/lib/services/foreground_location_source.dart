import 'package:geolocator/geolocator.dart';

class LocationFix {
  const LocationFix({
    required this.latitude,
    required this.longitude,
    required this.accuracyMeters,
    required this.recordedAt,
  });

  final double latitude;
  final double longitude;
  final double accuracyMeters;
  final DateTime recordedAt;
}

enum ForegroundPermissionStatus {
  granted,
  denied,
  deniedForever,
  servicesDisabled,
}

class ForegroundPermissionResult {
  const ForegroundPermissionResult({
    required this.status,
    required this.approximate,
  });

  final ForegroundPermissionStatus status;
  final bool approximate;
}

abstract interface class ForegroundLocationSource {
  Future<ForegroundPermissionResult> requestForegroundPermission();
  Stream<LocationFix> getPositionStream();
}

class GeolocatorForegroundLocationSource implements ForegroundLocationSource {
  @override
  Future<ForegroundPermissionResult> requestForegroundPermission() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      return const ForegroundPermissionResult(
        status: ForegroundPermissionStatus.servicesDisabled,
        approximate: false,
      );
    }

    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    final status = switch (permission) {
      LocationPermission.whileInUse || LocationPermission.always =>
        ForegroundPermissionStatus.granted,
      LocationPermission.deniedForever =>
        ForegroundPermissionStatus.deniedForever,
      LocationPermission.denied => ForegroundPermissionStatus.denied,
      LocationPermission.unableToDetermine =>
        ForegroundPermissionStatus.denied,
    };
    if (status != ForegroundPermissionStatus.granted) {
      return ForegroundPermissionResult(status: status, approximate: false);
    }

    final accuracy = await Geolocator.getLocationAccuracy();
    return ForegroundPermissionResult(
      status: status,
      approximate: accuracy == LocationAccuracyStatus.reduced,
    );
  }

  @override
  Stream<LocationFix> getPositionStream() =>
      Geolocator.getPositionStream(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          distanceFilter: 25,
        ),
      ).map(
        (position) => LocationFix(
          latitude: position.latitude,
          longitude: position.longitude,
          accuracyMeters: position.accuracy,
          recordedAt: position.timestamp,
        ),
      );
}
