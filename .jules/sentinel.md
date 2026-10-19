## 2026-10-19 - Add Security Headers to Express App
**Vulnerability:** Missing Security Headers (CSP, X-Frame-Options, X-Content-Type-Options) in Express backend API endpoints.
**Learning:** Even internal/local dev tools should enforce basic security headers to mitigate risks like Clickjacking or MIME sniffing if accessed accidentally via a browser or iframe.
**Prevention:** Always add standard security headers middleware early in the Express application setup.