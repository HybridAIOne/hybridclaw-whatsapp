# HybridClaw WhatsApp Plugin

Install-on-demand WhatsApp Web transport for
[HybridClaw](https://github.com/HybridAIOne/hybridclaw).

## Install

HybridClaw installs this plugin only after an explicit enable action:

```bash
hybridclaw plugin enable whatsapp --yes
```

The HybridClaw plugin catalog points to a versioned release package from this
repository. Core HybridClaw installs, updates, builds, and tests do not download
or compile this plugin.

After installation, configure and link WhatsApp through the normal HybridClaw
channel setup flow.

## Send Results

Text and media sends return `{ messageIds: string[] }`. Text IDs follow chunk
order; missing socket IDs are omitted. These IDs identify accepted sends, not
delivery receipts or verified recipients. The plugin does not verify recipient
registration or track delivery receipts. HybridClaw reports delivery as unconfirmed.

## Development

Requires Node.js 22 and npm 11.10 or newer.

```bash
npm ci --ignore-scripts
npm run check
npm pack
```

Release archives contain the compiled `dist/` tree, plugin manifest, lockfile,
license, README, and third-party notices. HybridClaw installs those archives
with lifecycle scripts disabled.

## License

This plugin is licensed under
[GNU GPL version 3 only](./LICENSE). Its current Baileys dependency includes
`libsignal`, which is also GPLv3. See
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for the complete production
dependency inventory and license texts.

HybridClaw itself remains separately distributed under its own license.
