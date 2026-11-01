# FamShield Mobile

Flutter Android client with sign-in, registration, phone/email verification, and password reset
screens. It uses the same `/api` authentication contract as the React app and stores tokens with
`flutter_secure_storage`. It does not request location permissions or collect location data.

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
