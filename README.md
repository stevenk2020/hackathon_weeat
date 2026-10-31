# WeEat AI 🍜

**Save a food video. Find the restaurant again when you need it.**

[Try the live app](https://hackathon.weeat.site/) · Built for the Sea x OpenAI Codex Hackathon 2026 by **Four of a Kind**.

WeEat turns TikTok and YouTube Shorts food videos into a personal restaurant library. Paste a video link to extract places and dishes, save the ones you want, explore them on a map, and ask AI questions grounded in your saved places. Personal features use Google sign-in.

## What is in this repository

```text
.
├── weeat-v2-frontend/    React app and its Node API server
└── backend-api/
    └── backend/          Standalone video extraction service
```

- **`weeat-v2-frontend/`** contains the Discover, Library, Map, Profile, and Ask AI screens. Its `server/` directory serves the app and personal APIs using PostgreSQL, OpenAI, and Goong/MapLibre. It calls the extraction service for videos that are not already in the database.
- **`backend-api/backend/`** contains the separate video extraction API, its prompts, specifications, and tests. See its [README](backend-api/backend/README.md) and [API reference](backend-api/backend/API.md).

The two server directories have different roles; starting the frontend app server does not start the extraction service.

## Run the frontend demo locally

The mock UI works without API credentials:

```sh
cd weeat-v2-frontend
npm ci
VITE_API_MODE=mock npm run dev
```

Open `http://127.0.0.1:5173`. For the live app server, see the [deployment notes](weeat-v2-frontend/deploy/README.md). Keep local credentials in ignored environment files; never commit them.

## Project status

This checkpoint brings the app and the extraction backend into one repository. The live app is available at [hackathon.weeat.site](https://hackathon.weeat.site/). Current implementation notes and remaining work are tracked in the [project plan](weeat-v2-frontend/docs/spec/PLAN.md).
