class AuthUser {
  const AuthUser({
    required this.id,
    required this.fullName,
    required this.email,
    required this.phone,
    required this.emailVerified,
    required this.phoneVerified,
    required this.status,
    this.profileImageUrl,
  });

  final String id;
  final String fullName;
  final String email;
  final String phone;
  final bool emailVerified;
  final bool phoneVerified;
  final String status;
  final String? profileImageUrl;

  factory AuthUser.fromJson(Map<String, dynamic> json) {
    return AuthUser(
      id: json['id'] as String,
      fullName: json['fullName'] as String,
      email: json['email'] as String,
      phone: json['phone'] as String,
      emailVerified: json['emailVerified'] as bool,
      phoneVerified: json['phoneVerified'] as bool,
      status: json['status'] as String,
      profileImageUrl: json['profileImageUrl'] as String?,
    );
  }
}
