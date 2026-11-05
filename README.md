# BeaLingo

BeaLingo is an adaptive personal language coach. A learner describes their target language, current ability, goals, preferred activities, correction style, and schedule. BeaLingo uses that profile to create daily lessons, short practice sets, revision cards, and progress insights.

## Current product flow

1. Complete the conversational learning-profile setup.
2. Take a vocabulary and short writing assessment.
3. Receive daily material as sentences, flashcards, conversations, or quizzes.
4. Rate lesson difficulty and practice the material.
5. Review saved vocabulary through a lightweight spaced-revision queue.
6. Inspect Knowledge and Progress summaries or start mixed practice.

## Technology

- Frontend: React 18 and Vite
- Backend: FastAPI and Uvicorn
- AI generation: connected ChatGPT plan on localhost; Groq in the public demo
- Deployment: public Vercel frontend/API proxy and Render FastAPI demo backend
- Local server cache: SQLite (`backend/bealingo.db`)
- Learner data: browser `localStorage`

Learner profiles and progress are currently device-local. Clearing site data removes them, and they do not synchronize between browsers.

## Local setup

Requirements: Node.js, npm, Python 3.10 or newer, and a Groq API key.

```sh
npm install
python3 -m venv backend/venv
backend/venv/bin/pip install -r backend/requirements.txt
cp backend/.env.example backend/.env
```

Add a valid `GROQ_API_KEY` to `backend/.env`. Then start the backend:

```sh
cd backend
venv/bin/python -m uvicorn main:app --reload --host 127.0.0.1 --port 8010
```

In a second terminal, start the frontend:

```sh
npm run dev -- --host 127.0.0.1
```

Vite prints the URL it selected. The backend accepts local `localhost` and `127.0.0.1` development origins on any port.

## Environment variables

Backend (`backend/.env`):

- `GROQ_API_KEY` — required for generated lessons and coach chat.
- `GROQ_MODEL` — optional Groq model override; defaults to `qwen/qwen3.8-27b`.
- `BEALINGO_MODE` — `local` or `demo`. Demo mode cannot read ChatGPT credentials.
- `PRIVATE_PROXY_SECRET` — required by deployed backends; must match the server-only Vercel value.

Frontend (`.env`, optional):

- `VITE_API_BASE` — optional backend URL override. By default the frontend uses same-origin `/api` requests, which Vite proxies to the local backend.

## Cloud deployment

The repository supports two isolated ways to run from the same codebase:

- **Local personal version:** runs only on the laptop in `local` mode and uses the locally stored ChatGPT-plan connection.
- **Portfolio demo:** a public Vercel deployment and Render service in `demo` mode. It uses Groq and cannot read the local ChatGPT credential.

Configure Vercel with `BEALINGO_BACKEND_URL`, `PRIVATE_PROXY_SECRET`, and `VITE_BEALINGO_MODE=demo`. Render must use the same proxy secret and `BEALINGO_MODE=demo`.

All Vercel variables named above are server-side except `VITE_BEALINGO_MODE`. Never prefix a credential, provider key, backend URL, or proxy secret with `VITE_`.

## Private local phone access

BeaLingo can be shared privately to devices on the same personal Tailscale network without exposing it to the public internet:

1. Install Tailscale on the Mac and phone and sign into the same personal tailnet.
2. Start the backend on `127.0.0.1:8010`.
3. Run `npm run dev:private` in this project.
4. Run `tailscale serve --bg 5180` and open the private `https://...ts.net` URL it reports on the phone.

Keep both local servers bound to `127.0.0.1`. Tailscale Serve supplies private HTTPS access and tailnet authentication. Do not use Tailscale Funnel, which would make the service public. If ChatGPT needs to be reconnected, complete that login from the Mac using the local BeaLingo URL.

Never commit real API keys.

## Project structure

```text
src/App.jsx                 Home, Knowledge, Progress, and Practice
src/pages/SessionPage.jsx   Onboarding and daily learning session
src/lib/profile.js          Learner-profile persistence
src/lib/revision.js         Practice history and revision scheduling
src/lib/groq.js             Frontend API client
backend/main.py             FastAPI routes and generation logic
backend/vocab_data.py       Static placement-test vocabulary
backend/db.py               SQLite vocabulary-list cache
backend/tests/              Backend regression tests
api/[...path].js            Vercel server-only Render proxy
render.yaml                 Public demo Render service
```

## API

- `GET /api/health` — service health
- `POST /api/vocab-list` — placement vocabulary
- `POST /api/generate-lesson` — generate a lesson
- `POST /api/generate-sentences` — sentence-generation compatibility route
- `POST /api/generate-practice` — lesson-grounded practice
- `POST /api/ask-coach` — contextual lesson chat

Interactive documentation is available at `http://127.0.0.1:8010/docs` while the backend runs.

## Quality checks

```sh
npm run lint
npm run build
npm test
backend/venv/bin/python -m py_compile backend/*.py
```

Tests cover profile completion and reset behavior, service health, local CORS, vocabulary responses, and language-variant rules without making paid AI requests.

## Known limitations

- No account or cloud synchronization
- No audio, listening, or pronunciation exercises
- AI lessons require network access and a valid provider key
- Revision is lightweight rather than a full SRS algorithm
- Learning history remains browser-local and does not synchronize between the laptop and phone

## Data and privacy

Learning profiles and progress are stored in the browser. Lesson-generation requests send relevant profile and lesson context to the configured AI provider. Avoid entering sensitive personal information during setup or coach chat.
