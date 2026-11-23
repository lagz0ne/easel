# access: a refresh token that stops at once (expected to break)

Expected to break: this is why the refresh token that was used last still works until the new one
is used. This is a what-if, kept as a warning. It is the [access-connector](access-connector.md)
model with `KeepPrevious = FALSE`: a refresh stops the old refresh token at once. When the answer
of a refresh does not reach Claude, Claude holds only the old token. Its next refresh is a reuse,
and the reuse stops the connector. The person must then get a new password from an owner. The
model is [models/access/Connector.tla](models/access/Connector.tla) with
[ConnectorStrict.cfg](models/access/ConnectorStrict.cfg). `scripts/statecharts.sh` expects this
chart to break, and fails if it ever holds. Cloudflare's `workers-oauth-provider` keeps the
previous token for the same reason.

```mermaid
---
title: "A Claude connector: a password from an owner, the sign-in, the tokens, and a revoke"
---
stateDiagram-v2
  direction LR
  state "Legend" as legend {
    lg0: waiting
    lg1: in
    lg2: out
    lg3: Breaks ALostAnswerNeverStopsTheConnector in some cases
    lg4: Path to the ALostAnswerNeverStopsTheConnector bug
  }
  class lg0 yellow
  class lg1 teal
  class lg2 tan
  class lg3 mayBreak
  class lg4 bugPath
  state "At the same time" as all {
    state "easel" as r0 {
      s0: No connector user
      s1: A password waits for its sign-in
      s2: The password ran out
      s3: Revoked, the name is free
      s4: The person signed in
      s5: Someone else signed in
      [*] --> s0
      s0 --> s1: an owner makes a password (users.add)
      s1 --> s2: the password runs out (24 hours)
      s1 --> s3: an owner revokes the connector
      s1 --> s4: the person signs in with the password [when Not connected]
      s1 --> s5: someone else signs in with the password
      s2 --> s3: an owner revokes the connector
      s3 --> s1: an owner makes a password (users.add)
      s4 --> s3: an owner revokes the connector
      s5 --> s3: an owner revokes the connector
    }
    --
    state "The person's Claude" as r1 {
      s6: Not connected
      s7: Has a code
      s8: Told to get a new password
      s9: Has a code, token answer lost
      s10: Connected
      s11: Connected, its tokens stopped
      s12: Connected, access token ran out
      s13: Connected, refresh answer lost
      [*] --> s6
      s6 --> s7: the person signs in with the password [when A password waits for its sign-in]
      s6 --> s8: the page says the password does not work now [unless A password waits for its sign-in or No connector user]
      s7 --> s9: the code gives the tokens, but the answer is lost [when The person signed in]
      s7 --> s10: the code gives the tokens [when The person signed in]
      s8 --> s6: an owner makes a password (users.add) [when Revoked, the name is free]
      s7 --> s8: the code is refused (invalid_grant)
      s9 --> s8: the code is refused (invalid_grant)
      s10 --> s11: an owner revokes the connector or a copy of an old refresh token is used
      s10 --> s12: the access token runs out (1 hour)
      s10 --> s13: Claude refreshes, but the answer is lost
      s11 --> s8: the refresh is refused (invalid_grant)
      s12 --> s10: Claude refreshes
      s12 --> s11: an owner revokes the connector or a copy of an old refresh token is used
      s12 --> s13: Claude refreshes, but the answer is lost
      s13 --> s11: an owner revokes the connector or a copy of an old refresh token is used
      s13 --> s8: the refresh is refused (invalid_grant)
    }
  }
  classDef mayBreak fill:#fff3e6,stroke:#e8730c,stroke-width:2.5px,color:#b85a06
  class s0 tan
  class s0 bugPath
  class s1 mayBreak
  class s1 bugPath
  class s2 mayBreak
  class s3 mayBreak
  class s4 mayBreak
  class s4 bugPath
  class s5 mayBreak
  class s6 tan
  class s6 bugPath
  class s7 yellow
  class s7 mayBreak
  class s7 bugPath
  class s8 tan
  class s8 mayBreak
  class s8 bugPath
  class s9 yellow
  class s9 mayBreak
  class s10 teal
  class s10 mayBreak
  class s10 bugPath
  class s11 teal
  class s11 mayBreak
  class s12 teal
  class s12 mayBreak
  class s13 teal
  class s13 mayBreak
  class s13 bugPath
```

| Rule                                                       | In plain words                                                                                                        | Spec anchor                                          |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `ALostAnswerNeverStopsTheConnector`                        | **Breaks.** Claude refreshes, the answer is lost, and Claude refreshes again with the old token: the connector stops. | SPEC-mcp-auth.md § The tokens of a connector, step 3 |
| The other rules of [access-connector](access-connector.md) | Hold.                                                                                                                 |                                                      |

## What the model leaves out

The same as [access-connector](access-connector.md#what-the-model-leaves-out).

## Steps the chart hides

- Steps that stay in one chart state (13). The full counterexample is in the output of the
  generator: `tlc-ALostAnswerNeverStopsTheConnector.out`.

## Make it again

```sh
scripts/statecharts.sh access-connector-strict          # rewrite this page's mermaid block in place if it differs
scripts/statecharts.sh --check access-connector-strict  # change nothing; compare the block and the verdict in charts.tsv
```
