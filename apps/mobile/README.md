# FamShield Mobile

Flutter Android client with sign-in, registration, phone/email verification, and password reset
screens. It uses the same `/api` authentication contract as the React app and stores tokens with
`flutter_secure_storage`.

The app also provides a protected account dashboard, profile settings, and active-session
management, family creation, active member management, verified-contact invitations, invitation
acceptance/decline, removal, leaving, and ownership transfer. Mobile sign-in uses
`clientType: "mobile"` and bearer access tokens; the rotating
refresh token is submitted only to the existing `/api/auth/refresh` endpoint. Both tokens are kept
in secure storage and cleared on logout. The app does not use browser cookies or store tokens in
SharedPreferences. Invitation tokens are returned once and can be copied to the intended invitee;
no email/SMS delivery provider is assumed. The family list supports pasting a token from an
invitation link. Family membership does not grant location access.

The Location Sharing Privacy screen shows per-family consent status and audit history. Granting
requires an unchecked-by-default confirmation; consent is only for the selected family and can be
revoked by the account holder. Leaving or being removed from a family revokes its active consent.
Location sharing starts only after active family consent and an explicit **Start Sharing** action.
Android requests only foreground coarse/fine location permission at that point; approximate access
is supported. Collection is paused when the app becomes inactive, and resuming requires another
explicit action. The app does not request background location permission or use a background
service, worker, or location history. A persistent in-app indicator is shown while sharing.

The family location screen retrieves coordinates from the authorized HTTP API. Socket.IO events
carry metadata only and trigger a fresh API read. Mobile sockets authenticate with the access
token in the Socket.IO handshake, not a URL parameter. Use HTTPS/WSS in production; development
emulator configuration may use the local HTTP API URL shown below.

If the backend explicitly enables its development-only OTP response, the app may display those
codes only in debug builds to support local testing. Production builds never render OTP values.

## Run

From the repository root, configure the API URL for the target device and run:

```powershell
Set-Location apps\mobile
flutter pub get
flutter run --dart-define=FAMSHIELD_API_URL=http://10.0.2.2:3000/api/
```

For a physical device, use the development machine's reachable LAN address in the API URL. Use
HTTPS outside local development.

The mobile app mirrors the request and response contracts in
[`packages/shared-types/src/index.ts`](../../packages/shared-types/src/index.ts). Keep Dart model
field names, JSON shapes, and error handling aligned with those TypeScript contracts and the API
documentation.
