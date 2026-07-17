## 2025-02-18 - CSWSH & CSRF in Developer Local Server
**Vulnerability:** A local WebSocket server and local HTTP POST endpoints were exposed to Cross-Site WebSocket Hijacking (CSWSH) and Cross-Site Request Forgery (CSRF).
**Learning:** Local dev tooling is highly susceptible to CSWSH and CSRF since local servers (e.g. running on port 3001) can be reached by a malicious website visited in the developer's browser. WebSocket connections lack Same-Origin Policy (SOP) by default and must manually enforce it.
**Prevention:** Always validate the `Origin` header for incoming WebSocket connections (`verifyClient`) and HTTP endpoints in development servers to ensure they only accept requests from trusted origins (`localhost` or `127.0.0.1`).
