class AuthSession {
  const AuthSession({
    required this.sessionId,
    required this.createdAt,
    required this.expiresAt,
    this.deviceInfo,
  });

  final String sessionId;
  final String createdAt;
  final String expiresAt;
  final String? deviceInfo;

  factory AuthSession.fromJson(Map<String, dynamic> json) {
    return AuthSession(
      sessionId: json['sessionId'] as String,
      createdAt: json['createdAt'] as String,
      expiresAt: json['expiresAt'] as String,
      deviceInfo: json['deviceInfo'] as String?,
    );
  }
}
