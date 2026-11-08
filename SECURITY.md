# Security

Focussr can see scroll positions, window titles and, with video on, the camera and screenshots of the
attached window. Please report anything that could expose that data.

**Report privately** through the
[private reporting form](https://github.com/chheangg/focussr/security/advisories/new), not a public issue.

Especially useful reports:

- Anything that sends data off the computer.
- Video or screenshots being kept when they shouldn't be.
- Reaching the MCP tools from another user account or from a website.
- Getting `open_item` to run a program, or to open files outside the home folder.

## Connected AI tools

The MCP tools are off until turned on, and are reachable only through a socket owned by the current user.
`read_screen` returns text from whatever is on screen, which can include instructions planted by a web
page, so AI clients should treat it as untrusted data.
