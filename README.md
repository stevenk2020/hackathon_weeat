<p align="center">
  <img src="weeat-v2-frontend/public/images/logo-mark.svg" width="64" height="64" alt="WeEat AI logo" />
</p>

<h1 align="center">WeEat AI</h1>
<p align="center"><strong>Your next meal is hiding in your saved videos.</strong></p>

<p align="center"><a href="https://hackathon.weeat.site/">Open the Live App</a></p>

<p align="center">
  <img src="https://img.shields.io/badge/React-19-149eca" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-5.7-3178c6" alt="TypeScript 5.7" />
  <img src="https://img.shields.io/badge/Vite-6-646cff" alt="Vite 6" />
  <img src="https://img.shields.io/badge/Tests-Playwright-2e7d32" alt="Tested with Playwright" />
</p>

WeEat AI connects food-video inspiration with places worth visiting. Paste a YouTube Shorts or TikTok video or photo link, review discovered restaurants, save favorites, and explore your collection through search, a food map and conversation. Built by **Four of a Kind** for the **Sea × OpenAI Codex Hackathon 2026**, this repository contains the live app and its separate extraction backend.

> **Live app:** [hackathon.weeat.site](https://hackathon.weeat.site/)

The React app and its Node API server are in [`weeat-v2-frontend/`](weeat-v2-frontend/). The video extraction service is in [`backend-api/backend/`](backend-api/backend/). These are separate servers; starting the app does not start the extraction service.

## The Problem

A food video can make you hungry in seconds—and leave you scrolling for minutes later. Names, addresses, dishes and prices are scattered across videos and captions. Saving a video rarely makes that information easy to find when you actually want to eat.

## Our Solution

WeEat AI organizes discoveries around restaurants and their original videos. Review the places found, explicitly save the ones you want, and return to a searchable collection. Sample behavior stays separate from real API responses.

## Key Features

| Capability | Implemented experience |
| --- | --- |
| **Video discovery** | YouTube Shorts and TikTok video/photo validation, clipboard paste, progress and recoverable errors. |
| **Analysis results** | Multiple restaurants, source preview, dishes, addresses and prices. Development extraction uses fixed fixtures. |
| **Personal Library** | Individual/save-all actions, composite-key duplicate prevention and sibling-preserving removal. |
| **Details & transcripts** | Source links, transcript expansion, comment highlights and personal notes. |
| **Search & organization** | Accent-insensitive name/dish/address search, platform/category filters and sorting. Transcript search belongs to Ask AI, not Library. |
| **Food Map** | Live Goong/MapLibre map with radius and Along Route exploration; mock mode uses an illustrative SVG map. |
| **Ask WeEat AI** | Streaming answers and reference cards grounded in saved places. Mock chat searches saved fixtures without a model call. |
| **Memory & history** | Live sessions and memories are stored on the server; mock mode keeps demo data in the browser. |
| **Profile & localization** | Home-address onboarding, Google sign-in for the live app, English/Vietnamese controls and responsive layouts. |
| **Multimodal extraction — backend** | Gemini & OpenAI analysis of video, images and captions from TikTok, YouTube Shorts. |
| **Data enrichment — backend** | Price normalization, food categorization, evidence checks, conflict flags, coordinates, map/ShopeeFood links and comment sentiment. |
| **Personal data APIs — app server** | Authenticated Library operations, notes, saved-data question answering and PostgreSQL persistence. |

## User Journey

**Watch → Paste Link → Discover → Save → Explore → Ask → Eat**


## Sample Links for Testing

Copy a link below into Discover to test the submission flow.

| Platform | Sample |
| --- | --- |
| YouTube Shorts | <https://www.youtube.com/shorts/ZFMTdsNuGOA> |
| YouTube Shorts | <https://www.youtube.com/shorts/fR82h_A1nGc> |
| YouTube Shorts | <https://www.youtube.com/shorts/f5ymLZzz_PI> |
| TikTok photo post | <https://www.tiktok.com/@iamnot_kita/photo/7485602011031833863?q=pizza%20g%E1%BA%A7n%20%C4%91%C3%A2y&t=1793419697742> |
| TikTok video | <https://www.tiktok.com/@caitiemcaphe/video/7687917905840753928?q=tr%C3%A0%20tr%C3%A1i%20c%C3%A2y%20ngon&t=1793419902439> |
| TikTok video | <https://www.tiktok.com/@kalamacoffeebinhchanh/video/7523877143554575623?q=marble%20b%E1%BA%A1c%20x%E1%BB%89u&t=1793420032485> |


## Tech Stack

| Layer | Technologies |
| --- | --- |
| Frontend | React 19, TypeScript 5.7, React Router 7, Vite 6 and the Vite React plugin |
| UI | Custom CSS, Lucide icons, local Inter/Playfair Display fonts and supplied imagery |
| Integration | Typed fetch client, runtime validation, same-origin session cookie and request timeouts |
| Testing | Playwright domain tests and Chrome browser tests |
| App server | Node.js, PostgreSQL, Google OAuth session cookies and OpenAI |
| Extraction service | Node.js, SQLite, PostgreSQL integration, Gemini and media readers |
| Maps and external APIs | Goong, VietMap and YouTube Data API |

## Testing & Quality Assurance

The repository includes Playwright browser and unit tests. See the [project plan](weeat-v2-frontend/docs/spec/PLAN.md) for recorded checks and remaining work; this README update does not claim a fresh full-suite run.

## Hackathon Development

During the hackathon, the team built both the **WeEat AI frontend** and its **backend and AI pipeline**.

### Frontend

We implemented a responsive English/Vietnamese application covering Discover, My Library, Restaurant Details, Map, Ask WeEat AI, Memory, Chat History and Profile. The work included reusable components, typed API integration, response validation, duplicate-save prevention, loading/error states and automated tests, with **OpenAI Codex assistance**.

### Backend & AI Pipeline

The backend turns social food content into structured restaurant information that the application can save, search and use for question answering. Its work spans media analysis, data quality, enrichment, authenticated APIs and persistence.

**Pipeline overview**

**Social link → Video / images / captions → OpenAI & Gemini analysis → Normalization & evidence checks → Enriched restaurant records → Personal Library & AI answers**

#### Multimodal Food Discovery

Extraction APIs process **TikTok and YouTube Shorts**. Gemini and OpenAI analyze video, images and captions to identify restaurant names, signature dishes, prices and addresses. Structured results give the frontend restaurant-level information to review and save, rather than leaving users to search through the original post again.

#### Data Quality & Evidence

The processing layer normalizes prices, assigns food categories and cross-checks extracted information against supporting evidence. Conflicting information is flagged so uncertainty remains visible during review. These steps help turn model output into more consistent records for Library search and downstream features.

#### Location, Ordering & Comment Enrichment

Restaurant records are enriched with coordinates and links for maps and ShopeeFood. Comment sentiment analysis adds context from audience reactions. This connects the information extracted from a post with practical details for exploring a place, reviewing its source and finding an ordering destination.

#### Personal Library & Grounded Question Answering

The backend provides APIs for saving and unsaving restaurants, searching personal collections, filtering categories and adding notes. AI question answering uses saved data as its grounding context, connecting conversational food discovery with the places users have chosen to keep.

#### Authentication, Persistence & Integration

The app server uses **Google OAuth**, signed session cookies and **PostgreSQL** for personal data. The separate extraction service includes **SQLite**, optional PostgreSQL writing and result caching. Error handling, tests and API documentation support integration between the two services.

The extraction backend source and its tests are available in [`backend-api/backend/`](backend-api/backend/). The app server source is in [`weeat-v2-frontend/server/`](weeat-v2-frontend/server/).

## Open-Source Projects, Preparation & Third-Party Services

### Backend

The extraction service uses **Node.js**, **SQLite** and **node-postgres (`pg`)**. Its personal routes use Firebase ID tokens; the separate app server uses Google OAuth sessions. PostgreSQL is self-hosted on the server.

- **Optional TikTok content retrieval:** `yt-dlp` and `gallery-dl`.
- **Third-party services and APIs:** Google Gemini API, YouTube Data API, Goong, VietMap and OpenAI.

### Frontend

We built the frontend application during the hackathon. We used pre-prepared WeEat AI materials: mockups, intended user journeys, API specifications agreed between the frontend and backend teams, bilingual UI copy, sample-data testing links and supplied static assets. We did not copy application source code from any previous personal project.

The frontend uses standard open-source npm packages: **React/React DOM, React Router, Lucide, TypeScript, Vite, the Vite React plugin, Playwright and DefinitelyTyped packages**. We also bundle **Inter** and **Playfair Display** fonts with their **SIL Open Font License (OFL)** notices.
