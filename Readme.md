# Nest Markets Monorepo

This repository is organized as a monorepo for the full prediction market stack:

- `apps/ui`: frontend application
- `apps/indexer`: indexing and data pipeline service
- `contracts`: NEAR smart contracts workspace

## Testnet Deployment

| Contract       | Account                    |
| -------------- | -------------------------- |
| Outcome Token  | `<your-outcome-token-account>` |
| Market         | `<your-market-account>` |
| Oracle (from nest-contracts) | `nest-oracle-7.testnet` |
| nUSD (mock)    | `<your-nusd-account>` |

Use `POST_DEPLOYMENT.md` with your deployed account IDs for exact wiring steps.

## Quick Start

- Contracts docs and commands: `contracts/Readme.md`
- Post-deployment wiring checklist: `POST_DEPLOYMENT.md`
- UI app scaffold: `apps/ui/README.md`
- Indexer scaffold: `apps/indexer/README.md`
