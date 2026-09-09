# Security

## What this project holds

Two things worth protecting live on your machine:

- `.env`: your MyToyota email and password, in plain text. The Toyota backend has no token or
  API key for third parties, so the password is the only way in. Both files are git-ignored.
- `data/`: the cached API responses and the SQLite database. They contain precise GPS traces
  of every trip, which means your home, your workplace and your habits. Back it up the way you
  would back up a diary, and do not paste it into an issue.

The dashboard binds to `127.0.0.1` and has no authentication, because it is not meant to be
reachable from anywhere else. Do not put it behind a public reverse proxy without adding one.

## Reporting a vulnerability

Open a private security advisory through GitHub on this repository. Please do not open a
public issue for anything that would expose someone's credentials or location history.

## Scope note

The Toyota endpoints used here are undocumented and unofficial. A bug in this project cannot
grant access to anyone else's vehicle: everything runs with your own credentials, against your
own account, on your own machine.
