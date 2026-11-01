# Brand and design foundation

## Brand

FamShield should feel trustworthy, modern, secure, family-friendly, and professional. Interface
language should be calm and supportive, never alarmist or coercive. Privacy and personal choice
must be visible in the product experience.

## Tokens

| Category        | Token           | Value                                 |
| --------------- | --------------- | ------------------------------------- |
| Primary         | Navy            | `#102A43`                             |
| Primary         | Blue            | `#1F5A85`                             |
| Accent          | Teal            | `#0F9D9A`                             |
| Accent surface  | Mist            | `#E8F4F4`                             |
| Neutral surface | Canvas          | `#F6F8FA`                             |
| Neutral text    | Body            | `#243B53`                             |
| Typography      | Sans            | Inter, system sans-serif fallback     |
| Spacing         | Base unit       | 4 px; compose 8/12/16/24/32 px rhythm |
| Radius          | Small / control | 8 px                                  |
| Radius          | Card            | 16 px                                 |
| Radius          | Pill            | 999 px                                |

Web tokens are configured in `apps/web/tailwind.config.js` and `apps/web/src/styles.css`; the
Flutter Material 3 color scheme and text styles are defined in `apps/mobile/lib/main.dart`.
Maintain readable contrast and a clearly visible keyboard focus indicator. Prefer spacious layouts,
clear hierarchy, and reusable rounded components over dense dashboards.
