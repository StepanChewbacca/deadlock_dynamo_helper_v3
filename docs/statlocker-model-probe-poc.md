# Statlocker model endpoint probe POC

Purpose: quickly test whether Statlocker-derived analytics can be consumed as external evidence without integrating Statlocker as a production dependency.

## What this probe intentionally targets

High-value Statlocker-derived signals that are not equivalent to ordinary Deadlock match/profile data:

1. Item Meta / WPA by hero, patch, rank, queue and build type.
2. Purchase timing and souls/net-worth-at-purchase distributions.
3. Comeback / Win-More item context.
4. T4 build chains and item synergy.
5. Eternus derived build aggregates: phase pick rate, WPA, timing, synergy and core/frequent/sometimes labels.
6. Build Lab WPA-powered recommendations.
7. Win Chance timeline as an independent state-model benchmark.

## What is intentionally excluded

Do not use Statlocker for data we already have or can get from the general Deadlock API:

- raw match history;
- raw match players/items;
- generic profiles;
- generic item catalog;
- generic hero statistics;
- generic leaderboards;
- ordinary build purchase history;
- public draft API.

Statlocker's own API documentation explicitly recommends using a general Deadlock API for raw Deadlock data and Statlocker for the analytics they build on top of it.

## UI

Run the API locally and open:

```text
GET /deadlock/tools/statlocker
```

The UI has three parts:

1. A small list of useful Statlocker analytics targets.
2. Endpoint discovery from Statlocker's public frontend JavaScript assets.
3. A manual request tester for discovered `/api/*` endpoints.

## Discovery behavior

`GET /deadlock/tools/statlocker/discover`

The discovery call:

1. downloads a small fixed set of public Statlocker pages related to WPA, Win Chance, Eternus Builds and Build Lab;
2. extracts same-origin `<script src="...">` assets;
3. downloads at most 20 JavaScript bundles;
4. extracts literal `/api/...` paths;
5. ranks paths containing keywords such as `wpa`, `timing`, `chain`, `synergy`, `eternus`, `recommend`, or `win-chance` above generic endpoints;
6. marks the documented raw public match/profile endpoints as duplicate data that we do not need.

This is not brute-force endpoint enumeration.

## Request tester

`POST /deadlock/tools/statlocker/request`

Example:

```json
{
  "method": "GET",
  "path": "/api/some-discovered-path",
  "query": {
    "hero": "Abrams"
  }
}
```

The tester is intentionally constrained:

- only `GET` and `POST`;
- only `statlocker.gg` / `www.statlocker.gg`;
- only `/api/*` paths;
- no cookies;
- no Statlocker API key;
- no custom auth headers;
- no anti-bot or authentication bypass.

A `401` or `403` is a valid POC result: it means the endpoint exists but is not directly reusable without official access.

## Decision rule after the POC

A Statlocker endpoint is interesting for the recommendation system only if it provides a derived signal we cannot reproduce cheaply from Deadlock API + our own PostgreSQL, for example WPA, model win probability, contextual item timing, chain/synergy aggregates, or derived Eternus recommendations.

Even if usable, Statlocker data should remain optional, versioned external evidence. Recommendation serving must keep working when Statlocker is unavailable.
