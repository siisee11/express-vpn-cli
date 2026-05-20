# evpn

Unofficial CLI wrapper for the local ExpressVPN desktop client.

`evpn` does not implement a VPN protocol, bundle ExpressVPN, or bypass account
requirements. It calls the `expressvpnctl` binary that ships with the installed
ExpressVPN desktop app.

## Install

```sh
npm install -g @siisee11/evpn
```

## Requirements

- macOS with the ExpressVPN desktop app installed.
- Node.js 18 or newer.
- A valid ExpressVPN account.

The default controller path is:

```sh
/Applications/ExpressVPN.app/Contents/MacOS/expressvpnctl
```

You can override it with:

```sh
evpn --ctl /path/to/expressvpnctl status
```

## Usage

Log in with an activation code:

```sh
evpn login
```

Check status:

```sh
evpn status
```

List available regions:

```sh
evpn regions
evpn regions japan
evpn regions usa --json
```

Connect:

```sh
evpn connect smart
evpn connect japan-tokyo
evpn connect south-korea-2
```

Disconnect:

```sh
evpn disconnect
```

Allow CLI connections while the ExpressVPN GUI is not running:

```sh
evpn background enable
```

Pass through a raw `expressvpnctl` command:

```sh
evpn raw get protocol
evpn raw set networklock true
```

## Publishing

Before publishing, make sure the package name is still available:

```sh
npm view @siisee11/evpn
```

Publish:

```sh
npm login
npm publish --access public
```

Then verify:

```sh
npm install -g @siisee11/evpn
evpn status
```

## Security

`evpn login` writes the activation code to a temporary `0600` file because
`expressvpnctl login` requires a file path. The file is removed immediately
after the login command exits.

This package has no runtime dependencies and does not collect telemetry.

## Disclaimer

This project is unofficial and is not affiliated with, endorsed by, sponsored
by, or maintained by ExpressVPN. ExpressVPN is a trademark of its respective
owner.
