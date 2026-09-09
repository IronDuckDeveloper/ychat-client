# ychat

A personal, peer-to-peer encrypted chat application. No central server stores your messages — chat rooms live on IPFS/libp2p and replicate directly between peers.

ychat consists of two repositories:

- **ychat-client** *(this repo)* — React + TypeScript + Vite frontend
- **[ychat-relay](https://github.com/IronDuckDeveloper/ychat-relay)** — Node.js relay/archivist server (bootstrap peer, rate-limit backstop, ban sync, session tokens)

## Features

- **P2P messaging** over libp2p + OrbitDB (documents store for rooms, keyvalue store for private/profile data) — no central message storage
- **Spam-resistant by design** — a custom `RateLimitedAccessController` (sliding window + character cap) is enforced locally by every replicating peer via `canAppend`, so spam entries never propagate in the first place
- **Message ownership** — writes are validated against sender identity embedded in the message `_id`
- **Rich media** — camera and video capture (mobile `capture` attribute + desktop `getUserMedia`/`MediaRecorder`), file uploads with retry/backoff, WebP storage at rest with alpha-aware conversion back to JPEG/PNG on download
- **Reply & forward** — denormalized reply snapshots, IPLD-safe (no `undefined` fields)
- **Multilingual UI** via `react-i18next` — Russian (default), English, Spanish
- **Nginx security gateway** in front of Kubo

## Tech stack

React · TypeScript · Vite · SCSS · Lucide React · Helia (IPFS/Kubo) · libp2p · OrbitDB v2 · gossipsub

> Dependency versions are intentionally pinned after a lengthy libp2p/OrbitDB/Helia compatibility pass — avoid bumping them casually.

## Getting started

### Prerequisites

- Node.js
- A running `ychat-relay` instance to bootstrap against

### Install

```bash
npm install
```

### Run in dev mode

```bash
npm run dev
```

### Build for production

```bash
npm run build
```

### Lint

```bash
npm run lint
```

## Project layout (key files)

| File | Purpose |
|---|---|
| `useChatLogic.ts` | Core chat state/behavior hook |
| `Chat.tsx` | Main chat UI |
| `roomService.ts` | OrbitDB room lifecycle |
| `fileService.ts` | Upload/download, WebP conversion |
| `hiddenMessagesService.ts` | Cross-device local message deletion (private keyvalue store) |
| `src/i18n/` | Locale JSON files (ru/en/es) |

## License

TBD