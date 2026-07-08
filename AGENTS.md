# Agent Notes

## Publishing

Use the npm skill before publishing:

```text
/Users/tyler/code/agent-scripts/agent-scripts/skills/npm/SKILL.md
```

This npm account uses passkey/WebAuthn for publish auth. Do not use `bun publish --otp=...` unless a real six-digit TOTP exists.

Default publish flow:

```bash
bun test
npm publish --access public --auth-type=web
npm view @tylerjnewman/kb@<version> version dist.tarball --prefer-online
bunx @tylerjnewman/kb@<version> new <smoke-name>
```

The browser auth page is expected. The user approves it with their passkey.

If registry reads briefly return 404 after a successful publish, run:

```bash
npm cache clean --force
npm view @tylerjnewman/kb@<version> version dist.tarball --prefer-online
```

If retrying publish says `previously published versions: <version>`, the version is already reserved/published; verify rather than trying to overwrite it.
