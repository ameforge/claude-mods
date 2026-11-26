# property-tests

The `property-tests` skill: write, review and triage property-based tests with
fast-check in JavaScript or TypeScript.

## Source and license

Adapted from the `property-based-testing` plugin (1.2.3) in
[trailofbits/skills](https://github.com/trailofbits/skills/tree/main/plugins/property-based-testing)
by Henrik Brodin, Trail of Bits, licensed
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). This adaptation is
released under the same license.

Changes: kept fast-check only, so the library list and the Solidity, Echidna and
Medusa guidance are gone; rewrote the generating and reviewing examples from
Hypothesis to fast-check; dropped the evals and assets.
