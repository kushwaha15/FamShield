# Data flow

## Client communication and authentication

```mermaid
sequenceDiagram
  participant Person as Family member
  participant Web as React web
  participant Mobile as Flutter Android
  participant API as FamShield API
  participant DB as Supabase PostgreSQL
  Person->>Web: Register or sign in
  Person->>Mobile: Register or sign in
  Web->>API: HTTPS auth request; cookies on authenticated calls
  Mobile->>API: HTTPS auth request; bearer token on authenticated calls
  API->>DB: Validate account and persist hashed credentials/session records
  API-->>Web: User response and HttpOnly cookies
  API-->>Mobile: User response and token pair
  Note over Web,Mobile: Location permission is not requested; no location is collected
```

Both clients use the same authentication API. The web client does not persist tokens in
`localStorage`; the Flutter client uses platform secure storage. No live map or fabricated
family/location data is shown.

## Registration and location-consent boundary

```mermaid
sequenceDiagram
  actor Person as Family member
  participant App as Web or mobile app
  participant API as FamShield API
  participant DB as Supabase PostgreSQL
  participant Delivery as Email/SMS adapter
  Person->>App: Submit registration details
  App->>API: Send registration request over HTTPS
  API->>API: Validate fields and hash password
  API->>DB: Create pending account and hashed OTP records
  API->>Delivery: Send separate email and phone codes
  Person->>App: Enter each verification code
  App->>API: Submit code over HTTPS
  API->>DB: Verify hash, expiry, attempt limit, and update status
  API-->>App: Confirm verification status
  Note over Person,DB: Terms/Privacy acceptance is recorded; location consent is not collected
  Note over Person,App: Any future location workflow must explain purpose and recipients, then make consent optional and revocable
```

Location consent and GPS collection are not implemented. Future location features must require
separate explicit consent; declining consent must not prevent unrelated account access.
