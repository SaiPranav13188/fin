# Fin

Fin is an Android app for splitting money with friends, flatmates and family. You tell it what happened
("I paid 2400 for dinner, Rahul skipped drinks"), and a team of AI agents drafts the split, tracks who owes whom,
writes polite reminders and helps you settle up through your own UPI app. A coin-shaped mascot called Chillar
reacts to every step.

Fin never holds or moves money. Paying opens GPay, PhonePe or Paytm with the details filled in.

> The source is public so the work can be read and evaluated. It is **not open source**: see [LICENSE](LICENSE).

## What is in this repository

| Folder | What it is |
|---|---|
| [backend/](backend/) | FastAPI service: accounts, groups, expenses, balances, settlements, chat, reminders, and the agent system |
| [mobile/](mobile/) | Expo (React Native) app: screens, the Chillar mascot and all animations |
| [.github/workflows/](.github/workflows/) | CI: lint, tests, the agent eval gate, migrations, typecheck and a Docker build |

## The agent system

Nine agents sit behind one orchestrator (a LangGraph graph). Each one can only read data and produce a **draft**.
Nothing is saved, sent or paid until the user confirms.

| Agent | Job |
|---|---|
| Orchestrator | Routes a message to the right agent |
| Expense Parser | Text or voice to a draft expense (English, Hindi, Hinglish, Telugu) |
| Receipt Reader | A bill photo to line items, tax and tip |
| Split Advisor | "Rahul skipped drinks" to who shares which item |
| Settle-up Planner | The fewest payments that settle a group, with UPI links |
| Nudge Writer | A friendly reminder in the chosen tone and language |
| Insights | Answers questions with read-only SQL over the user's own records |
| Safety Guard | Checks every payment: new UPI ID, unusual amount, duplicate, scam phrases |
| Monitor | Daily job for rent, EMI and subscription reminders |

### Safety rules, enforced in code

The harness in [backend/app/agents/harness.py](backend/app/agents/harness.py) applies these to every agent:

- **Draft, then confirm.** `/agent/confirm` is the only write path, and it re-validates the expense with the same
  rules as one typed by hand.
- **Read-only tools**, each scoped to the signed-in user.
- **No invented data.** A validator removes any member id that is not in the group and any amount that cannot be
  traced to the user's message. Gaps become questions.
- **Prompt-injection defence.** User, receipt and friend text is passed as tagged data, never as instructions.
- **Budgets.** A step limit, a token budget, a timeout and two retries per request.
- **Works offline.** Every agent has a rule-based fallback, used when there is no API key or the model fails.
- **Audit log.** Every run is stored in `agent_runs` with its tool calls, tokens and latency.
- **Insights isolation.** Model-written SQL runs in a throwaway in-memory database that holds only that user's
  rows, with an authorizer that allows only `SELECT`.

The Settle-up Planner and Safety Guard are deterministic on purpose, so anything that decides where money goes
gives the same answer every time.

### Evals

[backend/evals/cases.json](backend/evals/cases.json) holds 64 expense cases (typos, "2.5k", Hinglish, Hindi and
Telugu script, missing amounts, unknown names, prompt injection), plus intent and safety cases. CI fails if field
accuracy drops below 95% or any hallucinated field appears.

## Run it locally

Backend (Python 3.12, [uv](https://docs.astral.sh/uv/)):

```bash
cd backend
cp .env.example .env          # add FIN_ANTHROPIC_API_KEY to use the model; without it the rules fallback runs
uv sync
uv run uvicorn app.main:app --reload
uv run pytest                 # tests and the eval gate
uv run python -m evals.runner # full eval report
```

App (Node 22):

```bash
cd mobile
npm install
npx expo start                # press w for a browser preview
```

Voice input and haptics need a development build on a phone: `npx eas-cli build --profile development -p android`.

## Deploy

- **API:** [render.yaml](render.yaml) deploys the Docker image. Set `FIN_DATABASE_URL` (Supabase Postgres),
  `FIN_ANTHROPIC_API_KEY` and `FIN_PUBLIC_BASE_URL` in the Render dashboard. Migrations run on start.
- **App:** `npx eas-cli build -p android --profile production` builds the `.aab` for Google Play.

Secrets live only in environment variables. `.env` files, keystores and service-account keys are git-ignored.

## Credits

The playful payments idea was inspired by a public UPI redesign concept (`loksh1910/puffin`). That project has no
license, so Fin uses none of its code, artwork or mascot. All code, designs and the Chillar mascot here are original.
